import { and, asc, desc, eq, gte, sql } from "drizzle-orm";
import type { AuthContext } from "../auth/context";
import { isUuid } from "../auth/mock-session";
import { copy } from "../copy";
import { getDb } from "../db/client";
import {
  calls,
  memberships,
  playbooks,
  retentionPolicies,
  transcriptSegments,
  transcripts,
  users,
  webhookInbox,
  type CallSource,
} from "../db/schema";
import { ApiError, pgErrorCode } from "../http/errors";
import { logIngest } from "../http/logger";
import { audioPersistenceAllowed, CONSENT_REQUIRED_MESSAGE } from "../ingest/consent";
import { zoomProvider } from "../ingest/providers";
import { hashWebhookHeaders, zoomEncryptedToken } from "../ingest/zoom-signature";
import { getSpeechToText } from "../ingest/stt";
import type { NormalizedMeeting, TranscriptSegmentInput } from "../ingest/types";
import type { CallDetail, CallListResponse, CallSummary } from "./types";

type CallRow = typeof calls.$inferSelect;

function notFound(): ApiError {
  return new ApiError(404, "not_found", "Call not found.");
}

function iso(value: Date | null): string | null {
  return value ? value.toISOString() : null;
}

export function startOfWeekUtc(now = new Date()): Date {
  const day = now.getUTCDay();
  const mondayOffset = day === 0 ? 6 : day - 1;
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  start.setUTCDate(start.getUTCDate() - mondayOffset);
  return start;
}

function toSummary(row: CallRow): CallSummary {
  return {
    id: row.id,
    orgId: row.orgId,
    sellerId: row.sellerId,
    playbookId: row.playbookId,
    title: row.title,
    source: row.source,
    externalId: row.externalId,
    status: row.status,
    durationSec: row.durationSec,
    consentRecordedAt: iso(row.consentRecordedAt),
    startedAt: iso(row.startedAt),
    endedAt: iso(row.endedAt),
    errorMessage: row.errorMessage,
    createdAt: row.createdAt.toISOString(),
    audioStored: Boolean(row.audioUrl),
  };
}

async function loadDetail(id: string): Promise<CallDetail> {
  const [row] = await getDb().select().from(calls).where(eq(calls.id, id));
  if (!row) throw notFound();
  const [transcript] = await getDb().select().from(transcripts).where(eq(transcripts.callId, id));
  const segments = transcript
    ? await getDb()
        .select()
        .from(transcriptSegments)
        .where(eq(transcriptSegments.transcriptId, transcript.id))
        .orderBy(asc(transcriptSegments.idx))
    : [];
  return {
    ...toSummary(row),
    transcriptProvider: transcript?.provider ?? null,
    segments: segments.map((segment) => ({
      id: segment.id,
      idx: segment.idx,
      tStartMs: segment.tStartMs,
      tEndMs: segment.tEndMs,
      speaker: segment.speaker,
      text: segment.text,
    })),
  };
}

async function requireVisible(auth: AuthContext, id: string): Promise<CallRow> {
  if (!isUuid(id)) throw notFound();
  const [row] = await getDb().select().from(calls).where(eq(calls.id, id));
  if (!row || row.orgId !== auth.orgId) throw notFound();
  if (auth.role === "seller" && row.sellerId !== auth.userId) throw notFound();
  return row;
}

export async function ensureRetentionPolicy(orgId: string): Promise<void> {
  await getDb().insert(retentionPolicies).values({ orgId }).onConflictDoNothing();
}

async function activePlaybookId(orgId: string): Promise<string | null> {
  const [row] = await getDb()
    .select({ id: playbooks.id })
    .from(playbooks)
    .where(and(eq(playbooks.orgId, orgId), eq(playbooks.status, "active")));
  return row?.id ?? null;
}

async function resolveSeller(orgId: string, hostEmail: string | null, explicitSellerId?: string | null): Promise<string> {
  if (explicitSellerId) {
    const [member] = await getDb()
      .select({ userId: memberships.userId })
      .from(memberships)
      .where(and(eq(memberships.orgId, orgId), eq(memberships.userId, explicitSellerId)));
    if (!member) throw new ApiError(400, "invalid_seller", "Seller is not in this organization.");
    return member.userId;
  }
  if (hostEmail) {
    const [match] = await getDb()
      .select({ userId: users.id })
      .from(users)
      .innerJoin(memberships, eq(memberships.userId, users.id))
      .where(and(eq(memberships.orgId, orgId), sql`lower(${users.email}) = ${hostEmail.toLowerCase()}`));
    if (match) return match.userId;
  }
  const fallback = process.env.ZOOM_DEFAULT_SELLER_ID;
  if (fallback && isUuid(fallback)) {
    const [member] = await getDb()
      .select({ userId: memberships.userId })
      .from(memberships)
      .where(and(eq(memberships.orgId, orgId), eq(memberships.userId, fallback)));
    if (member) return member.userId;
  }
  const [seller] = await getDb()
    .select({ userId: memberships.userId })
    .from(memberships)
    .where(and(eq(memberships.orgId, orgId), eq(memberships.role, "seller")))
    .orderBy(memberships.createdAt);
  if (!seller) throw new ApiError(422, "no_seller", "Organization has no seller to attach this call to.");
  return seller.userId;
}

async function replaceTranscript(
  callId: string,
  provider: string,
  segments: TranscriptSegmentInput[],
  raw: unknown,
): Promise<void> {
  await getDb().transaction(async (tx) => {
    await tx.delete(transcripts).where(eq(transcripts.callId, callId));
    const [created] = await tx
      .insert(transcripts)
      .values({ callId, provider, rawJson: raw ?? null })
      .returning();
    if (!created || segments.length === 0) return;
    await tx.insert(transcriptSegments).values(
      segments.map((segment) => ({
        transcriptId: created.id,
        idx: segment.idx,
        tStartMs: segment.tStartMs,
        tEndMs: segment.tEndMs,
        speaker: segment.speaker,
        text: segment.text,
      })),
    );
  });
}

async function upsertExternalCall(input: {
  orgId: string;
  sellerId: string;
  source: CallSource;
  meeting: NormalizedMeeting;
  consentRecordedAt: Date | null;
}): Promise<CallRow> {
  const playbookId = await activePlaybookId(input.orgId);
  const audioAllowed = audioPersistenceAllowed(input.consentRecordedAt);
  const audioUrl = input.meeting.audioUrl && audioAllowed ? input.meeting.audioUrl : null;
  const values = {
    orgId: input.orgId,
    sellerId: input.sellerId,
    playbookId,
    title: input.meeting.title,
    source: input.source,
    externalId: input.meeting.externalId,
    status: "processing" as const,
    audioUrl,
    audioContentType: audioUrl ? input.meeting.audioContentType : null,
    durationSec: input.meeting.durationSec,
    consentRecordedAt: input.consentRecordedAt,
    startedAt: input.meeting.startedAt,
    endedAt: input.meeting.endedAt,
    errorMessage: null,
  };
  try {
    const [created] = await getDb().insert(calls).values(values).returning();
    if (!created) throw new ApiError(500, "internal_error", "Could not create call.");
    return created;
  } catch (error) {
    if (pgErrorCode(error) !== "23505") throw error;
    const [existing] = await getDb()
      .select()
      .from(calls)
      .where(
        and(
          eq(calls.orgId, input.orgId),
          eq(calls.source, input.source),
          eq(calls.externalId, input.meeting.externalId),
        ),
      );
    if (!existing) throw error;
    return existing;
  }
}

async function finishCall(call: CallRow, meeting: NormalizedMeeting): Promise<CallRow> {
  if (call.status === "ready") {
    logIngest({
      msg: "ingest",
      callId: call.id,
      externalId: call.externalId,
      source: call.source,
      status: call.status,
    });
    return call;
  }
  const consent = call.consentRecordedAt;
  const audioAllowed = audioPersistenceAllowed(consent);
  const audioUrl = meeting.audioUrl && audioAllowed ? meeting.audioUrl : null;
  try {
    if (meeting.transcript && meeting.transcript.segments.length > 0) {
      await replaceTranscript(call.id, meeting.transcript.provider, meeting.transcript.segments, meeting.transcript.raw);
      const [updated] = await getDb()
        .update(calls)
        .set({
          status: "ready",
          errorMessage: null,
          audioUrl,
          audioContentType: audioUrl ? meeting.audioContentType : null,
          title: meeting.title || call.title,
        })
        .where(eq(calls.id, call.id))
        .returning();
      const ready = updated ?? call;
      logIngest({
        msg: "ingest",
        callId: ready.id,
        externalId: ready.externalId,
        source: ready.source,
        status: ready.status,
      });
      return ready;
    }
    if (meeting.audioUrl && !audioAllowed) {
      const [updated] = await getDb()
        .update(calls)
        .set({ status: "failed", errorMessage: CONSENT_REQUIRED_MESSAGE, audioUrl: null, audioContentType: null })
        .where(eq(calls.id, call.id))
        .returning();
      const failed = updated ?? call;
      logIngest({
        msg: "ingest",
        callId: failed.id,
        externalId: failed.externalId,
        source: failed.source,
        status: "failed",
        error: CONSENT_REQUIRED_MESSAGE,
      });
      return failed;
    }
    if (!meeting.audioUrl) {
      const [updated] = await getDb()
        .update(calls)
        .set({ status: "failed", errorMessage: "Payload has neither transcript nor audio." })
        .where(eq(calls.id, call.id))
        .returning();
      return updated ?? call;
    }
    const stt = getSpeechToText();
    const result = await stt.transcribe({
      audioUrl: meeting.audioUrl,
      contentType: meeting.audioContentType,
      callId: call.id,
    });
    await replaceTranscript(call.id, result.provider, result.segments, result.raw);
    const [updated] = await getDb()
      .update(calls)
      .set({
        status: "ready",
        errorMessage: null,
        audioUrl,
        audioContentType: audioUrl ? meeting.audioContentType : null,
      })
      .where(eq(calls.id, call.id))
      .returning();
    const ready = updated ?? call;
    logIngest({
      msg: "ingest",
      callId: ready.id,
      externalId: ready.externalId,
      source: ready.source,
      status: ready.status,
    });
    return ready;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Ingest failed.";
    const [updated] = await getDb()
      .update(calls)
      .set({ status: "failed", errorMessage: message })
      .where(eq(calls.id, call.id))
      .returning();
    logIngest({
      msg: "ingest",
      callId: call.id,
      externalId: call.externalId,
      source: call.source,
      status: "failed",
      error: message,
    });
    return updated ?? call;
  }
}

export async function recordWebhookInbox(input: {
  provider: "zoom" | "meet" | "fireflies";
  orgId: string | null;
  headers: Headers;
  payload: Record<string, unknown>;
  signatureOk: boolean;
  error?: string | null;
  processed?: boolean;
}): Promise<string> {
  const [row] = await getDb()
    .insert(webhookInbox)
    .values({
      provider: input.provider,
      orgId: input.orgId,
      headersHash: hashWebhookHeaders(input.headers),
      payload: input.payload,
      signatureOk: input.signatureOk,
      error: input.error ?? null,
      processedAt: input.processed ? new Date() : null,
    })
    .returning({ id: webhookInbox.id });
  if (!row) throw new ApiError(500, "internal_error", "Could not store webhook.");
  return row.id;
}

export async function acceptZoomWebhook(rawBody: string, headers: Headers): Promise<
  | { status: 401 }
  | { status: 200; body: { plainToken: string; encryptedToken: string } }
  | { status: 202; inboxId: string; process: (() => Promise<void>) | null }
  | { status: 503; inboxId: string }
> {
  const signatureOk = zoomProvider.verifySignature(rawBody, headers);
  let payload: Record<string, unknown> = {};
  try {
    const parsed = JSON.parse(rawBody) as unknown;
    payload = parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : { value: parsed };
  } catch {
    payload = { raw: rawBody };
  }
  if (!signatureOk) {
    await recordWebhookInbox({
      provider: "zoom",
      orgId: process.env.ZOOM_ORG_ID && isUuid(process.env.ZOOM_ORG_ID) ? process.env.ZOOM_ORG_ID : null,
      headers,
      payload,
      signatureOk: false,
      error: "invalid_signature",
      processed: true,
    });
    return { status: 401 };
  }
  const event = zoomProvider.parseEvent(payload);
  if (event.type === "url_validation") {
    const secret = process.env.ZOOM_WEBHOOK_SECRET_TOKEN ?? "";
    await recordWebhookInbox({
      provider: "zoom",
      orgId: null,
      headers,
      payload,
      signatureOk: true,
      processed: true,
    });
    return {
      status: 200,
      body: { plainToken: event.plainToken, encryptedToken: zoomEncryptedToken(secret, event.plainToken) },
    };
  }
  const orgId = process.env.ZOOM_ORG_ID ?? "";
  if (!isUuid(orgId)) {
    const inboxId = await recordWebhookInbox({
      provider: "zoom",
      orgId: null,
      headers,
      payload,
      signatureOk: true,
      error: "ZOOM_ORG_ID is not set.",
      processed: true,
    });
    return { status: 503, inboxId };
  }
  const inboxId = await recordWebhookInbox({
    provider: "zoom",
    orgId,
    headers,
    payload,
    signatureOk: true,
  });
  if (event.type === "ignore") {
    await getDb()
      .update(webhookInbox)
      .set({ processedAt: new Date(), error: event.reason })
      .where(eq(webhookInbox.id, inboxId));
    return { status: 202, inboxId, process: null };
  }
  const meeting = event.meeting;
  return {
    status: 202,
    inboxId,
    process: async () => {
      try {
        await ensureRetentionPolicy(orgId);
        const sellerId = await resolveSeller(orgId, meeting.hostEmail);
        const call = await upsertExternalCall({
          orgId,
          sellerId,
          source: "zoom",
          meeting,
          consentRecordedAt: null,
        });
        await finishCall(call, meeting);
        await getDb().update(webhookInbox).set({ processedAt: new Date(), error: null }).where(eq(webhookInbox.id, inboxId));
      } catch (error) {
        const message = error instanceof Error ? error.message : "Ingest failed.";
        await getDb().update(webhookInbox).set({ processedAt: new Date(), error: message }).where(eq(webhookInbox.id, inboxId));
        logIngest({ msg: "ingest", inboxId, externalId: meeting.externalId, source: "zoom", status: "failed", error: message });
      }
    },
  };
}

export async function listCalls(
  auth: AuthContext,
  query: { source?: CallSource; period?: "week"; sellerId?: string },
): Promise<CallListResponse> {
  const filters = [eq(calls.orgId, auth.orgId)];
  if (auth.role === "seller") {
    if (query.sellerId && query.sellerId !== auth.userId) {
      throw new ApiError(403, "forbidden", "Seller can only list their own calls.");
    }
    filters.push(eq(calls.sellerId, auth.userId));
  } else if (query.sellerId) {
    if (!isUuid(query.sellerId)) throw new ApiError(400, "invalid_request", "sellerId must be a UUID.");
    filters.push(eq(calls.sellerId, query.sellerId));
  }
  if (query.source) filters.push(eq(calls.source, query.source));
  if (query.period === "week") filters.push(gte(calls.createdAt, startOfWeekUtc()));
  const rows = await getDb()
    .select()
    .from(calls)
    .where(and(...filters))
    .orderBy(desc(calls.createdAt));
  return {
    calls: rows.map(toSummary),
    emptyWeek:
      query.period === "week" && rows.length === 0
        ? { copyKey: "calls.empty_week", copy: copy["calls.empty_week"] }
        : null,
    connectSource: { copyKey: "calls.connect_source", copy: copy["calls.connect_source"] },
    ingestFailed: { copyKey: "calls.ingest_failed", copy: copy["calls.ingest_failed"] },
  };
}

export async function getCall(auth: AuthContext, id: string): Promise<CallDetail> {
  await requireVisible(auth, id);
  return loadDetail(id);
}

export async function reprocessCall(auth: AuthContext, id: string): Promise<CallDetail> {
  const row = await requireVisible(auth, id);
  if (auth.role !== "manager") throw new ApiError(403, "forbidden", "Manager role required.");
  if (row.status === "ready") return loadDetail(id);
  const meeting: NormalizedMeeting = {
    externalId: row.externalId ?? row.id,
    title: row.title,
    hostEmail: null,
    startedAt: row.startedAt,
    endedAt: row.endedAt,
    durationSec: row.durationSec,
    audioUrl: row.audioUrl,
    audioContentType: row.audioContentType,
    transcript: null,
  };
  await getDb().update(calls).set({ status: "processing", errorMessage: null }).where(eq(calls.id, id));
  const [processing] = await getDb().select().from(calls).where(eq(calls.id, id));
  await finishCall(processing ?? row, meeting);
  return loadDetail(id);
}

function linesToSegments(transcript: string): TranscriptSegmentInput[] {
  return transcript
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((text, idx) => ({
      idx,
      tStartMs: idx * 1000,
      tEndMs: idx * 1000 + 1000,
      speaker: "unknown" as const,
      text,
    }));
}

export async function createManualCall(
  auth: AuthContext,
  input: {
    title: string;
    transcript: string | null;
    sellerId?: string;
    consentRecordedAt: Date | null;
    audio: { url: string; contentType: string } | null;
  },
): Promise<CallDetail> {
  if (!input.transcript && !input.audio) {
    throw new ApiError(400, "invalid_request", "Send a transcript or an audio file.");
  }
  const sellerId = await resolveSeller(
    auth.orgId,
    null,
    input.sellerId ?? (auth.role === "seller" ? auth.userId : auth.userId),
  );
  if (auth.role === "seller" && sellerId !== auth.userId) {
    throw new ApiError(403, "forbidden", "Seller can only create their own calls.");
  }
  if (input.audio && !audioPersistenceAllowed(input.consentRecordedAt)) {
    throw new ApiError(422, "consent_required", CONSENT_REQUIRED_MESSAGE);
  }
  await ensureRetentionPolicy(auth.orgId);
  const source: CallSource = input.audio ? "upload" : "paste";
  const playbookId = await activePlaybookId(auth.orgId);
  const [created] = await getDb()
    .insert(calls)
    .values({
      orgId: auth.orgId,
      sellerId,
      playbookId,
      title: input.title,
      source,
      status: "processing",
      audioUrl: input.audio?.url ?? null,
      audioContentType: input.audio?.contentType ?? null,
      consentRecordedAt: input.consentRecordedAt,
    })
    .returning();
  if (!created) throw new ApiError(500, "internal_error", "Could not create call.");
  const meeting: NormalizedMeeting = {
    externalId: created.id,
    title: input.title,
    hostEmail: null,
    startedAt: null,
    endedAt: null,
    durationSec: null,
    audioUrl: input.audio?.url ?? null,
    audioContentType: input.audio?.contentType ?? null,
    transcript: input.transcript
      ? { provider: source, segments: linesToSegments(input.transcript), raw: { transcript: input.transcript } }
      : null,
  };
  await finishCall(created, meeting);
  return loadDetail(created.id);
}
