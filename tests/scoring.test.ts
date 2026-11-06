import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { POST as createCall, GET as listCalls } from "../src/app/api/calls/route";
import { GET as getCall } from "../src/app/api/calls/[id]/route";
import { POST as rescoreCall } from "../src/app/api/calls/[id]/rescore/route";
import { POST as reviewCall } from "../src/app/api/calls/[id]/review/route";
import { GET as metricsRoute } from "../src/app/api/metrics/scoring/route";
import { getDb } from "../src/lib/db/client";
import { playbookObjections, playbookPhases, playbooks } from "../src/lib/db/schema";
import { FailingCallScorer, setCallScorerForTests } from "../src/lib/scoring/engine";
import { invoke, readJson, resetDb, seedOrg } from "./helpers";

async function activePlaybook(orgId: string, createdBy: string) {
  const [playbook] = await getDb()
    .insert(playbooks)
    .values({
      orgId,
      name: "Ativo",
      version: 1,
      status: "active",
      createdBy,
      publishedAt: new Date(),
    })
    .returning();
  if (!playbook) throw new Error("playbook missing");
  await getDb().insert(playbookPhases).values({
    playbookId: playbook.id,
    sortOrder: 0,
    name: "Descoberta",
    checklistItems: ["situação atual"],
  });
  await getDb().insert(playbookObjections).values({
    playbookId: playbook.id,
    sortOrder: 0,
    label: "Preço",
    signals: ["está caro"],
    suggestedResponse: "piloto curto com critério",
  });
  return playbook;
}

type ScoredCall = {
  id: string;
  source: string;
  noneActive: boolean;
  score: {
    overall: number | null;
    badFlag: boolean;
    status: string;
    stale: boolean;
    reviewedAt: string | null;
    playbookVersion: number;
  } | null;
  scoreDetail: {
    phaseScores: { name: string; score: number; adherence: string }[];
    objectionScores: { label: string; hit: boolean; score: number | null; evidence: { text: string }[] }[];
    reasons: string[];
    errorMessage: string | null;
  };
};

async function paste(userId: string, title: string, transcript: string): Promise<ScoredCall> {
  const response = await invoke(createCall, {
    method: "POST",
    path: "/api/calls",
    userId,
    body: { title, transcript },
  });
  expect(response.status).toBe(201);
  return (await readJson(response)) as unknown as ScoredCall;
}

describe("call score", () => {
  beforeEach(async () => {
    await resetDb();
    setCallScorerForTests(null);
  });

  afterEach(() => {
    setCallScorerForTests(null);
  });

  it("scores a ready call against phases and objections", async () => {
    const { org, manager } = await seedOrg("score");
    await activePlaybook(org.id, manager.id);

    const missed = await paste(manager.id, "Vazia", "oi");
    expect(missed.score).toMatchObject({ status: "ok", badFlag: true, stale: false });
    expect(missed.scoreDetail.phaseScores).toEqual([
      expect.objectContaining({ name: "Descoberta", score: 0, adherence: "falhou" }),
    ]);
    expect(missed.scoreDetail.objectionScores).toEqual([
      expect.objectContaining({ label: "Preço", hit: false, score: null }),
    ]);
    expect(missed.scoreDetail.reasons.length).toBeGreaterThanOrEqual(1);
    expect(missed.scoreDetail.reasons.length).toBeLessThanOrEqual(3);
    expect(missed.score?.overall ?? 100).toBeLessThan(60);

    const covered = await paste(manager.id, "Coberta", "A situação atual está clara.");
    expect(covered.score).toMatchObject({ status: "ok", badFlag: false, overall: 100 });
    expect(covered.source).toBe("paste");

    const objection = await paste(manager.id, "Preço", "O cliente disse que está caro demais.");
    expect(objection.score?.badFlag).toBe(true);
    expect(objection.scoreDetail.objectionScores[0]).toMatchObject({ hit: true, score: 20 });
    expect(objection.scoreDetail.objectionScores[0].evidence[0].text).toContain("está caro");
    expect(objection.scoreDetail.reasons).toContain("Preço sem resposta");

    const ruins = await invoke(listCalls, { path: "/api/calls?bad=true&period=week", userId: manager.id });
    const ruinCalls = (await readJson(ruins)).calls as { title: string; source: string }[];
    const titles = ruinCalls.map((call) => call.title);
    expect(titles).toEqual(expect.arrayContaining(["Vazia", "Preço"]));
    expect(titles).not.toContain("Coberta");
    expect(ruinCalls.every((call) => call.source === "paste")).toBe(true);
  });

  it("skips scoring without an active playbook, retries failure, reviews, and matches metrics", async () => {
    const quiet = await seedOrg("quiet");
    const unscored = await paste(quiet.manager.id, "Sem playbook", "oi");
    expect(unscored.score).toBeNull();
    expect(unscored.noneActive).toBe(true);
    const quietList = await invoke(listCalls, { path: "/api/calls?period=week", userId: quiet.manager.id });
    expect((await readJson(quietList)).noneActive).toMatchObject({ copyKey: "playbook.none_active" });

    const { org, manager, seller } = await seedOrg("metrics");
    const playbook = await activePlaybook(org.id, manager.id);
    const bad = await paste(seller.id, "Ruim", "oi");
    const good = await paste(manager.id, "Boa", "situação atual combinada");
    setCallScorerForTests(new FailingCallScorer());
    const failed = await paste(manager.id, "Falhou", "situação atual");
    expect(failed.score).toMatchObject({ status: "failed", overall: null });
    expect(failed.scoreDetail.errorMessage).toContain("Score provider failed");

    setCallScorerForTests(null);
    const retried = await invoke(rescoreCall, {
      method: "POST",
      path: `/api/calls/${String(failed.id)}/rescore`,
      userId: manager.id,
      params: { id: String(failed.id) },
    });
    expect(retried.status).toBe(200);
    expect(((await readJson(retried)) as unknown as ScoredCall).score?.status).toBe("ok");

    const sellerReview = await invoke(reviewCall, {
      method: "POST",
      path: `/api/calls/${String(bad.id)}/review`,
      userId: seller.id,
      params: { id: String(bad.id) },
    });
    expect(sellerReview.status).toBe(403);
    const reviewed = await invoke(reviewCall, {
      method: "POST",
      path: `/api/calls/${String(bad.id)}/review`,
      userId: manager.id,
      params: { id: String(bad.id) },
    });
    expect(reviewed.status).toBe(200);
    expect(((await readJson(reviewed)) as unknown as ScoredCall).score?.reviewedAt).toEqual(expect.any(String));

    const metrics = await invoke(metricsRoute, { path: "/api/metrics/scoring?period=week", userId: manager.id });
    expect(await readJson(metrics)).toMatchObject({
      ready: 3,
      scoredOk: 3,
      percentScored: 100,
      bad: 1,
      badReviewed: 1,
      percentBadReviewed: 100,
    });
    void good;

    const other = await seedOrg("other-score");
    const hidden = await invoke(reviewCall, {
      method: "POST",
      path: `/api/calls/${String(bad.id)}/review`,
      userId: other.manager.id,
      params: { id: String(bad.id) },
    });
    expect(hidden.status).toBe(404);
    const otherMetrics = await invoke(metricsRoute, { path: "/api/metrics/scoring", userId: other.manager.id });
    expect(await readJson(otherMetrics)).toMatchObject({
      ready: 0,
      scoredOk: 0,
      percentScored: null,
      bad: 0,
      percentBadReviewed: null,
    });

    await getDb().update(playbooks).set({ version: 4 }).where(eq(playbooks.id, playbook.id));
    const stale = await invoke(getCall, {
      path: `/api/calls/${String(bad.id)}`,
      userId: manager.id,
      params: { id: String(bad.id) },
    });
    expect(((await readJson(stale)) as unknown as ScoredCall).score?.stale).toBe(true);
    const refreshed = await invoke(rescoreCall, {
      method: "POST",
      path: `/api/calls/${String(bad.id)}/rescore`,
      userId: manager.id,
      params: { id: String(bad.id) },
    });
    const refreshedBody = await readJson(refreshed);
    expect((refreshedBody as unknown as ScoredCall).score).toMatchObject({
      playbookVersion: 4,
      stale: false,
      reviewedAt: null,
    });
  });
});
