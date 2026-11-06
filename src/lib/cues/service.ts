import { and, asc, eq } from "drizzle-orm";
import { currentCue, matchAdherence } from "../adherence/match";
import type { AuthContext } from "../auth/context";
import { isUuid } from "../auth/mock-session";
import { getDb } from "../db/client";
import {
  calls,
  cueEvents,
  cueSessions,
  playbookObjections,
  playbookPhases,
  playbooks,
  retentionPolicies,
} from "../db/schema";
import { ApiError } from "../http/errors";

type SessionRow = typeof cueSessions.$inferSelect;

function notFound(): ApiError {
  return new ApiError(404, "not_found", "Cue session not found.");
}

function iso(value: Date | null): string | null {
  return value ? value.toISOString() : null;
}

async function badBelow(orgId: string): Promise<number> {
  const [policy] = await getDb()
    .select({ badScoreBelow: retentionPolicies.badScoreBelow })
    .from(retentionPolicies)
    .where(eq(retentionPolicies.orgId, orgId));
  return policy?.badScoreBelow ?? 60;
}

async function loadPlaybook(playbookId: string) {
  const [playbook] = await getDb().select().from(playbooks).where(eq(playbooks.id, playbookId));
  if (!playbook) return null;
  const phases = await getDb()
    .select()
    .from(playbookPhases)
    .where(eq(playbookPhases.playbookId, playbookId))
    .orderBy(asc(playbookPhases.sortOrder));
  const objections = await getDb()
    .select()
    .from(playbookObjections)
    .where(eq(playbookObjections.playbookId, playbookId))
    .orderBy(asc(playbookObjections.sortOrder));
  return { playbook, phases, objections };
}

function toSession(row: SessionRow) {
  return {
    id: row.id,
    orgId: row.orgId,
    sellerId: row.sellerId,
    callId: row.callId,
    playbookId: row.playbookId,
    playbookVersion: row.playbookVersion,
    status: row.status,
    noneActive: row.playbookId == null,
    startedAt: row.startedAt.toISOString(),
    endedAt: iso(row.endedAt),
  };
}

function toEvent(row: typeof cueEvents.$inferSelect) {
  return {
    id: row.id,
    sessionId: row.sessionId,
    phaseId: row.phaseId,
    objectionId: row.objectionId,
    kind: row.kind,
    payload: row.payload,
    firedAt: row.firedAt.toISOString(),
    acknowledgedAt: iso(row.acknowledgedAt),
    dismissedAt: iso(row.dismissedAt),
  };
}

async function requireSession(auth: AuthContext, id: string): Promise<SessionRow> {
  if (!isUuid(id)) throw notFound();
  const [row] = await getDb().select().from(cueSessions).where(eq(cueSessions.id, id));
  if (!row || row.orgId !== auth.orgId) throw notFound();
  if (auth.role === "seller" && row.sellerId !== auth.userId) throw notFound();
  return row;
}

export async function startCueSession(auth: AuthContext, input: { callId?: string }) {
  let callId: string | null = null;
  if (input.callId) {
    if (!isUuid(input.callId)) throw notFound();
    const [call] = await getDb().select().from(calls).where(eq(calls.id, input.callId));
    if (!call || call.orgId !== auth.orgId) throw new ApiError(404, "not_found", "Call not found.");
    if (auth.role === "seller" && call.sellerId !== auth.userId) throw new ApiError(404, "not_found", "Call not found.");
    callId = call.id;
  }
  const [active] = await getDb()
    .select()
    .from(playbooks)
    .where(and(eq(playbooks.orgId, auth.orgId), eq(playbooks.status, "active")));
  const [created] = await getDb()
    .insert(cueSessions)
    .values({
      orgId: auth.orgId,
      sellerId: auth.userId,
      callId,
      playbookId: active?.id ?? null,
      playbookVersion: active?.version ?? null,
      status: active ? "live" : "idle",
    })
    .returning();
  if (!created) throw new ApiError(500, "internal_error", "Could not start cue session.");
  return toSession(created);
}

export async function endCueSession(auth: AuthContext, id: string) {
  const row = await requireSession(auth, id);
  if (row.status === "ended") return toSession(row);
  const [updated] = await getDb()
    .update(cueSessions)
    .set({ status: "ended", endedAt: new Date() })
    .where(eq(cueSessions.id, id))
    .returning();
  return toSession(updated ?? row);
}

export async function listCueEvents(auth: AuthContext, id: string) {
  await requireSession(auth, id);
  const rows = await getDb()
    .select()
    .from(cueEvents)
    .where(eq(cueEvents.sessionId, id))
    .orderBy(asc(cueEvents.firedAt));
  return rows.map(toEvent);
}

export async function tickCueSession(auth: AuthContext, id: string, input: { text?: string; simulate?: "phase" | "objection" }) {
  const session = await requireSession(auth, id);
  if (session.status === "ended") throw new ApiError(409, "session_ended", "This cue session has ended.");
  if (!session.playbookId) {
    return { session: toSession(session), events: [] as ReturnType<typeof toEvent>[], noneActive: true };
  }
  const playbook = await loadPlaybook(session.playbookId);
  if (!playbook) {
    return { session: toSession(session), events: [] as ReturnType<typeof toEvent>[], noneActive: true };
  }
  const text = resolveTickText(input, playbook);
  if (!text) throw new ApiError(400, "invalid_request", "Send text or simulate=phase|objection.");

  const prior = await getDb().select().from(cueEvents).where(eq(cueEvents.sessionId, id)).orderBy(asc(cueEvents.firedAt));
  const transcript = [
    ...prior.filter((event) => event.kind === "tick").map((event) => String(event.payload.text ?? "")),
    text,
  ];
  const threshold = await badBelow(session.orgId);
  const segments = transcript.map((line, index) => ({ id: `tick-${index}`, text: line }));
  const match = matchAdherence({
    badBelow: threshold,
    segments,
    phases: playbook.phases.map((phase) => ({
      id: phase.id,
      name: phase.name,
      checklistItems: Array.isArray(phase.checklistItems) ? phase.checklistItems.filter((item) => typeof item === "string") : [],
      script: phase.script,
      triggerText: phase.triggerText,
    })),
    objections: playbook.objections.map((item) => ({
      id: item.id,
      label: item.label,
      signals: Array.isArray(item.signals) ? item.signals.filter((signal) => typeof signal === "string") : [],
      suggestedResponse: item.suggestedResponse,
    })),
  });
  const cue = currentCue(match, threshold);
  const created = [];
  const [tick] = await getDb()
    .insert(cueEvents)
    .values({ sessionId: id, kind: "tick", payload: { text } })
    .returning();
  if (tick) created.push(tick);

  const already = new Set(
    prior.filter((event) => event.kind === "phase" || event.kind === "objection").map((event) => `${event.kind}:${event.phaseId ?? ""}:${event.objectionId ?? ""}`),
  );
  if (cue.kind === "objection") {
    const key = `objection::${cue.objection.objectionId}`;
    const source = playbook.objections.find((item) => item.id === cue.objection.objectionId);
    if (!already.has(key)) {
      const [row] = await getDb()
        .insert(cueEvents)
        .values({
          sessionId: id,
          kind: "objection",
          objectionId: cue.objection.objectionId,
          payload: {
            label: cue.objection.label,
            cue: (source?.suggestedResponse ?? "").slice(0, 240),
            score: cue.objection.score,
            playbookVersion: session.playbookVersion,
          },
        })
        .returning();
      if (row) created.push(row);
    }
  } else if (cue.kind === "phase") {
    const key = `phase:${cue.phase.phaseId}:`;
    if (!already.has(key)) {
      const [row] = await getDb()
        .insert(cueEvents)
        .values({
          sessionId: id,
          kind: "phase",
          phaseId: cue.phase.phaseId,
          payload: {
            name: cue.phase.name,
            gap: cue.phase.gap,
            adherence: cue.phase.adherence,
            cue: (cue.detail?.unmatched[0] ?? cue.detail?.script ?? cue.phase.name).slice(0, 240),
            script: (cue.detail?.script ?? "").slice(0, 240),
            playbookVersion: session.playbookVersion,
          },
        })
        .returning();
      if (row) created.push(row);
    }
  }
  return { session: toSession(session), events: created.map(toEvent), noneActive: false };
}

function resolveTickText(
  input: { text?: string; simulate?: "phase" | "objection" },
  playbook: NonNullable<Awaited<ReturnType<typeof loadPlaybook>>>,
): string {
  const text = input.text?.trim() ?? "";
  if (text) return text;
  if (input.simulate === "objection") {
    const signal = playbook.objections.flatMap((item) => (Array.isArray(item.signals) ? item.signals : [])).find((signal) => typeof signal === "string" && signal.trim());
    return typeof signal === "string" ? signal : "";
  }
  if (input.simulate === "phase") return "seguimos na call";
  return "";
}

async function requireEvent(auth: AuthContext, id: string) {
  if (!isUuid(id)) throw new ApiError(404, "not_found", "Cue not found.");
  const [event] = await getDb().select().from(cueEvents).where(eq(cueEvents.id, id));
  if (!event) throw new ApiError(404, "not_found", "Cue not found.");
  await requireSession(auth, event.sessionId);
  return event;
}

export async function acknowledgeCue(auth: AuthContext, id: string) {
  const event = await requireEvent(auth, id);
  if (event.kind === "tick") throw new ApiError(409, "not_a_cue", "Ticks are not cues.");
  if (event.acknowledgedAt) return toEvent(event);
  const [updated] = await getDb()
    .update(cueEvents)
    .set({ acknowledgedAt: new Date() })
    .where(eq(cueEvents.id, id))
    .returning();
  return toEvent(updated ?? event);
}

export async function dismissCue(auth: AuthContext, id: string) {
  const event = await requireEvent(auth, id);
  if (event.kind === "tick") throw new ApiError(409, "not_a_cue", "Ticks are not cues.");
  if (event.dismissedAt) return toEvent(event);
  const [updated] = await getDb()
    .update(cueEvents)
    .set({ dismissedAt: new Date() })
    .where(eq(cueEvents.id, id))
    .returning();
  return toEvent(updated ?? event);
}
