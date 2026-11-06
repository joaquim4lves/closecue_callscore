import { afterEach, describe, expect, it } from "vitest";
import { POST as startSession } from "../src/app/api/cue-sessions/route";
import { POST as endSession } from "../src/app/api/cue-sessions/[id]/end/route";
import { GET as listEvents } from "../src/app/api/cue-sessions/[id]/events/route";
import { GET as streamEvents } from "../src/app/api/cue-sessions/[id]/stream/route";
import { POST as tickSession } from "../src/app/api/cue-sessions/[id]/ticks/route";
import { POST as ackCue } from "../src/app/api/cue-events/[id]/ack/route";
import { POST as dismissCue } from "../src/app/api/cue-events/[id]/dismiss/route";
import { matchAdherence } from "../src/lib/adherence/match";
import { getDb } from "../src/lib/db/client";
import { playbookObjections, playbookPhases, playbooks } from "../src/lib/db/schema";
import { invoke, readJson, resetDb, seedOrg } from "./helpers";

async function playbookFor(orgId: string, createdBy: string) {
  const [playbook] = await getDb()
    .insert(playbooks)
    .values({ orgId, name: "Ativo", version: 3, status: "active", createdBy, publishedAt: new Date() })
    .returning();
  if (!playbook) throw new Error("playbook missing");
  const [phase] = await getDb()
    .insert(playbookPhases)
    .values({ playbookId: playbook.id, sortOrder: 0, name: "Descoberta", checklistItems: ["situação atual"], script: "Pergunte a situação atual." })
    .returning();
  const [objection] = await getDb()
    .insert(playbookObjections)
    .values({ playbookId: playbook.id, sortOrder: 0, label: "Preço", signals: ["está caro"], suggestedResponse: "piloto curto com critério" })
    .returning();
  return { playbook, phase, objection };
}

describe("closecue overlay", () => {
  afterEach(() => {
    setTimeout(() => undefined, 0);
  });

  it("starts, ticks, acknowledges, dismisses, and ends", async () => {
    await resetDb();
    const { org, manager, seller } = await seedOrg("overlay");
    const { playbook, phase, objection } = await playbookFor(org.id, manager.id);
    const started = await invoke(startSession, {
      method: "POST",
      path: "/api/cue-sessions",
      userId: seller.id,
      body: {},
    });
    expect(started.status).toBe(201);
    const session = await readJson(started);
    expect(session).toMatchObject({ status: "live", playbookId: playbook.id, playbookVersion: 3, noneActive: false });

    const phaseTick = await invoke(tickSession, {
      method: "POST",
      path: `/api/cue-sessions/${String(session.id)}/ticks`,
      userId: seller.id,
      params: { id: String(session.id) },
      body: { simulate: "phase" },
    });
    const phaseBody = await readJson(phaseTick);
    const phaseCue = (phaseBody.events as { id: string; kind: string; phaseId: string; payload: { cue: string } }[]).find((event) => event.kind === "phase");
    expect(phaseCue?.phaseId).toBe(phase?.id);
    const shared = matchAdherence({
      badBelow: 60,
      segments: [{ id: "tick-0", text: "seguimos na call" }],
      phases: [{ id: phase?.id ?? "", name: "Descoberta", checklistItems: ["situação atual"], script: "Pergunte a situação atual." }],
      objections: [{ id: objection?.id ?? "", label: "Preço", signals: ["está caro"], suggestedResponse: "piloto curto com critério" }],
    });
    expect(shared.phaseScores[0]?.adherence).not.toBe("cumprida");
    expect(phaseCue?.payload.cue).toBe(shared.phaseDetail[0]?.unmatched[0]);

    const objectionTick = await invoke(tickSession, {
      method: "POST",
      path: `/api/cue-sessions/${String(session.id)}/ticks`,
      userId: seller.id,
      params: { id: String(session.id) },
      body: { text: "está caro" },
    });
    const objectionCue = (await readJson(objectionTick)).events as { id: string; kind: string; objectionId: string; payload: { playbookVersion: number } }[];
    const objectionEvent = objectionCue.find((event) => event.kind === "objection");
    expect(objectionEvent).toMatchObject({ objectionId: objection?.id, payload: { playbookVersion: 3 } });

    const acked = await invoke(ackCue, {
      method: "POST",
      path: `/api/cue-events/${objectionEvent?.id}/ack`,
      userId: seller.id,
      params: { id: objectionEvent?.id ?? "" },
    });
    expect((await readJson(acked)).acknowledgedAt).toEqual(expect.any(String));
    const dismissed = await invoke(dismissCue, {
      method: "POST",
      path: `/api/cue-events/${phaseCue?.id}/dismiss`,
      userId: seller.id,
      params: { id: String(phaseCue?.id) },
    });
    expect((await readJson(dismissed)).dismissedAt).toEqual(expect.any(String));

    const ended = await invoke(endSession, {
      method: "POST",
      path: `/api/cue-sessions/${String(session.id)}/end`,
      userId: seller.id,
      params: { id: String(session.id) },
    });
    expect((await readJson(ended)).status).toBe("ended");
    const after = await invoke(tickSession, {
      method: "POST",
      path: `/api/cue-sessions/${String(session.id)}/ticks`,
      userId: seller.id,
      params: { id: String(session.id) },
      body: { text: "de novo" },
    });
    expect(after.status).toBe(409);
  });

  it("does not invent cues without an active playbook and hides other orgs", async () => {
    await resetDb();
    const quiet = await seedOrg("quiet-overlay");
    const started = await invoke(startSession, {
      method: "POST",
      path: "/api/cue-sessions",
      userId: quiet.seller.id,
      body: {},
    });
    const session = await readJson(started);
    expect(session).toMatchObject({ status: "idle", noneActive: true, playbookId: null });
    const tick = await invoke(tickSession, {
      method: "POST",
      path: `/api/cue-sessions/${String(session.id)}/ticks`,
      userId: quiet.seller.id,
      params: { id: String(session.id) },
      body: { text: "está caro" },
    });
    expect((await readJson(tick)).events).toEqual([]);

    const other = await seedOrg("other-overlay");
    const hidden = await invoke(listEvents, {
      path: `/api/cue-sessions/${String(session.id)}/events`,
      userId: other.seller.id,
      params: { id: String(session.id) },
    });
    expect(hidden.status).toBe(404);

    const liveOrg = await seedOrg("stream");
    await playbookFor(liveOrg.org.id, liveOrg.manager.id);
    const live = await invoke(startSession, {
      method: "POST",
      path: "/api/cue-sessions",
      userId: liveOrg.seller.id,
      body: {},
    });
    const liveId = String((await readJson(live)).id);
    const controller = new AbortController();
    const response = await streamEvents(
      new Request(`http://127.0.0.1/api/cue-sessions/${liveId}/stream`, {
        headers: { "x-mock-user-id": liveOrg.seller.id },
        signal: controller.signal,
      }),
      { params: Promise.resolve({ id: liveId }) },
    );
    expect(response.headers.get("content-type")).toContain("text/event-stream");
    const reader = response.body?.getReader();
    const chunk = await reader?.read();
    expect(new TextDecoder().decode(chunk?.value)).toContain("event: ready");
    controller.abort();
    await reader?.cancel();
  });
});
