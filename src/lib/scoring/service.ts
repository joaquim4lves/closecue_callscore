import { and, asc, eq, gte, inArray } from "drizzle-orm";
import type { AuthContext } from "../auth/context";
import { isUuid } from "../auth/mock-session";
import { startOfWeekUtc } from "../calls/week";
import { getDb } from "../db/client";
import {
  calls,
  playbookObjections,
  playbookPhases,
  playbooks,
  retentionPolicies,
  scores,
  transcriptSegments,
  transcripts,
} from "../db/schema";
import { ApiError } from "../http/errors";
import { logIngest } from "../http/logger";
import { getCallScorer, type ObjectionScore, type PhaseScore } from "./engine";

function stringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string");
}

export function asPhaseScores(value: unknown): PhaseScore[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const row = item as Record<string, unknown>;
    if (typeof row.phaseId !== "string" || typeof row.name !== "string" || typeof row.score !== "number") return [];
    const adherence = row.adherence === "cumprida" || row.adherence === "parcial" || row.adherence === "falhou" ? row.adherence : "falhou";
    return [
      {
        phaseId: row.phaseId,
        name: row.name,
        score: row.score,
        gap: typeof row.gap === "string" ? row.gap : null,
        adherence,
        evidenceSegmentIds: stringArray(row.evidenceSegmentIds),
      },
    ];
  });
}

export function asObjectionScores(value: unknown): ObjectionScore[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const row = item as Record<string, unknown>;
    if (typeof row.objectionId !== "string" || typeof row.label !== "string" || typeof row.hit !== "boolean") return [];
    return [
      {
        objectionId: row.objectionId,
        label: row.label,
        hit: row.hit,
        score: typeof row.score === "number" ? row.score : null,
        evidenceSegmentIds: stringArray(row.evidenceSegmentIds),
      },
    ];
  });
}

async function badBelow(orgId: string): Promise<number> {
  const [policy] = await getDb()
    .select({ badScoreBelow: retentionPolicies.badScoreBelow })
    .from(retentionPolicies)
    .where(eq(retentionPolicies.orgId, orgId));
  if (policy) return policy.badScoreBelow;
  const fromEnv = Number(process.env.SCORE_BAD_BELOW ?? "60");
  if (Number.isFinite(fromEnv) && fromEnv >= 0 && fromEnv <= 100) return fromEnv;
  return 60;
}

async function activePlaybook(orgId: string) {
  const [playbook] = await getDb()
    .select()
    .from(playbooks)
    .where(and(eq(playbooks.orgId, orgId), eq(playbooks.status, "active")));
  if (!playbook) return null;
  const phases = await getDb()
    .select()
    .from(playbookPhases)
    .where(eq(playbookPhases.playbookId, playbook.id))
    .orderBy(asc(playbookPhases.sortOrder));
  const objections = await getDb()
    .select()
    .from(playbookObjections)
    .where(eq(playbookObjections.playbookId, playbook.id))
    .orderBy(asc(playbookObjections.sortOrder));
  return { playbook, phases, objections };
}

export async function scoreReadyCall(callId: string, options?: { force?: boolean }): Promise<void> {
  const [call] = await getDb().select().from(calls).where(eq(calls.id, callId));
  if (!call || call.status !== "ready") return;
  const active = await activePlaybook(call.orgId);
  const [existing] = await getDb().select().from(scores).where(eq(scores.callId, callId));
  if (!active) return;
  if (
    existing?.status === "ok" &&
    existing.playbookVersion === active.playbook.version &&
    options?.force !== true
  ) {
    return;
  }

  const [transcript] = await getDb().select().from(transcripts).where(eq(transcripts.callId, callId));
  const segments = transcript
    ? await getDb()
        .select()
        .from(transcriptSegments)
        .where(eq(transcriptSegments.transcriptId, transcript.id))
        .orderBy(asc(transcriptSegments.idx))
    : [];
  try {
    const draft = await getCallScorer().score({
      badBelow: await badBelow(call.orgId),
      phases: active.phases.map((phase) => ({
        id: phase.id,
        name: phase.name,
        checklistItems: stringArray(phase.checklistItems),
      })),
      objections: active.objections.map((item) => ({
        id: item.id,
        label: item.label,
        signals: stringArray(item.signals),
        suggestedResponse: item.suggestedResponse,
      })),
      segments: segments.map((segment) => ({ id: segment.id, text: segment.text })),
    });
    await getDb()
      .insert(scores)
      .values({
        callId,
        playbookId: active.playbook.id,
        playbookVersion: active.playbook.version,
        overall: draft.overall,
        badFlag: draft.badFlag,
        shortReason: draft.shortReason,
        phaseScores: draft.phaseScores,
        objectionScores: draft.objectionScores,
        reasons: draft.reasons,
        model: draft.model,
        promptVersion: draft.promptVersion,
        status: "ok",
        errorMessage: null,
        reviewedAt: null,
        reviewedBy: null,
      })
      .onConflictDoUpdate({
        target: scores.callId,
        set: {
          playbookId: active.playbook.id,
          playbookVersion: active.playbook.version,
          overall: draft.overall,
          badFlag: draft.badFlag,
          shortReason: draft.shortReason,
          phaseScores: draft.phaseScores,
          objectionScores: draft.objectionScores,
          reasons: draft.reasons,
          model: draft.model,
          promptVersion: draft.promptVersion,
          status: "ok",
          errorMessage: null,
          reviewedAt: null,
          reviewedBy: null,
          createdAt: new Date(),
        },
      });
    logIngest({
      msg: "score",
      callId,
      externalId: call.externalId,
      source: call.source,
      status: "ok",
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Score failed.";
    await getDb()
      .insert(scores)
      .values({
        callId,
        playbookId: active.playbook.id,
        playbookVersion: active.playbook.version,
        overall: null,
        badFlag: false,
        shortReason: null,
        phaseScores: [],
        objectionScores: [],
        reasons: [],
        model: getCallScorer().provider,
        promptVersion: null,
        status: "failed",
        errorMessage: message,
      })
      .onConflictDoUpdate({
        target: scores.callId,
        set: {
          playbookId: active.playbook.id,
          playbookVersion: active.playbook.version,
          overall: null,
          badFlag: false,
          shortReason: null,
          phaseScores: [],
          objectionScores: [],
          reasons: [],
          status: "failed",
          errorMessage: message,
          reviewedAt: null,
          reviewedBy: null,
          createdAt: new Date(),
        },
      });
    logIngest({ msg: "score", callId, externalId: call.externalId, source: call.source, status: "failed", error: message });
  }
}

async function visibleCall(auth: AuthContext, id: string) {
  if (!isUuid(id)) throw new ApiError(404, "not_found", "Call not found.");
  const [row] = await getDb().select().from(calls).where(eq(calls.id, id));
  if (!row || row.orgId !== auth.orgId) throw new ApiError(404, "not_found", "Call not found.");
  if (auth.role === "seller" && row.sellerId !== auth.userId) throw new ApiError(404, "not_found", "Call not found.");
  return row;
}

export async function rescoreCall(auth: AuthContext, id: string): Promise<void> {
  const row = await visibleCall(auth, id);
  if (auth.role !== "manager") throw new ApiError(403, "forbidden", "Manager role required.");
  if (row.status !== "ready") throw new ApiError(409, "call_not_ready", "Only a ready call can be scored.");
  const active = await activePlaybook(row.orgId);
  if (!active) throw new ApiError(409, "playbook.none_active", "Publish a playbook before scoring.");
  await scoreReadyCall(id, { force: true });
}

export async function reviewCall(auth: AuthContext, id: string): Promise<void> {
  const row = await visibleCall(auth, id);
  if (auth.role !== "manager") throw new ApiError(403, "forbidden", "Manager role required.");
  const [score] = await getDb().select().from(scores).where(eq(scores.callId, row.id));
  if (!score || score.status !== "ok") throw new ApiError(409, "score_missing", "This call has no successful score to review.");
  if (score.reviewedAt) return;
  await getDb()
    .update(scores)
    .set({ reviewedAt: new Date(), reviewedBy: auth.userId })
    .where(eq(scores.callId, row.id));
}

export async function scoringMetrics(auth: AuthContext, period?: "week") {
  const filters = [eq(calls.orgId, auth.orgId), eq(calls.status, "ready")];
  if (auth.role === "seller") filters.push(eq(calls.sellerId, auth.userId));
  if (period === "week") filters.push(gte(calls.createdAt, startOfWeekUtc()));
  const readyRows = await getDb()
    .select({ id: calls.id })
    .from(calls)
    .where(and(...filters));
  const ids = readyRows.map((row) => row.id);
  const visible =
    ids.length === 0
      ? []
      : await getDb()
          .select()
          .from(scores)
          .where(and(eq(scores.status, "ok"), inArray(scores.callId, ids)));
  const scoredOk = visible.length;
  const bad = visible.filter((score) => score.badFlag);
  const badReviewed = bad.filter((score) => score.reviewedAt != null);
  const percent = (part: number, total: number) => (total === 0 ? null : Math.round((part / total) * 100));
  return {
    period: period ?? "all",
    ready: ids.length,
    scoredOk,
    percentScored: percent(scoredOk, ids.length),
    bad: bad.length,
    badReviewed: badReviewed.length,
    percentBadReviewed: percent(badReviewed.length, bad.length),
  };
}
