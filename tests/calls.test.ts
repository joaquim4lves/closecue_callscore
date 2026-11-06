import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GET as listCalls, POST as createCall } from "../src/app/api/calls/route";
import { GET as getCall } from "../src/app/api/calls/[id]/route";
import { POST as reprocessCall } from "../src/app/api/calls/[id]/reprocess/route";
import { POST as zoomWebhook } from "../src/app/api/webhooks/zoom/route";
import { POST as meetWebhook } from "../src/app/api/webhooks/meet/route";
import { POST as firefliesWebhook } from "../src/app/api/webhooks/fireflies/route";
import { calls, memberships, playbooks, retentionPolicies, users, webhookInbox } from "../src/lib/db/schema";
import { getDb } from "../src/lib/db/client";
import { drainIngestQueue } from "../src/lib/ingest/queue";
import { FailingSpeechToText, MockSpeechToText, setSpeechToTextForTests } from "../src/lib/ingest/stt";
import { zoomEncryptedToken, zoomSignature } from "../src/lib/ingest/zoom-signature";
import { invoke, readJson, resetDb, seedOrg } from "./helpers";

const SECRET = "zoom-test-secret";

function signedZoom(body: unknown, secret = SECRET): Request {
  const raw = JSON.stringify(body);
  const timestamp = String(Math.floor(Date.now() / 1000));
  return new Request("http://127.0.0.1/api/webhooks/zoom", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-request-id": "req-zoom",
      "x-zm-request-timestamp": timestamp,
      "x-zm-signature": zoomSignature(secret, timestamp, raw),
    },
    body: raw,
  });
}

describe("call ingest", () => {
  beforeEach(async () => {
    await resetDb();
    vi.stubEnv("ZOOM_WEBHOOK_SECRET_TOKEN", SECRET);
    vi.stubEnv("AUDIO_CONSENT_GATE", "off");
    setSpeechToTextForTests(new MockSpeechToText());
  });

  afterEach(() => {
    setSpeechToTextForTests(null);
    vi.unstubAllEnvs();
  });

  it("rejects a bad Zoom signature and accepts a transcript without STT", async () => {
    const stt = new MockSpeechToText();
    setSpeechToTextForTests(stt);
    const { org, manager, seller } = await seedOrg("zoom");
    vi.stubEnv("ZOOM_ORG_ID", org.id);
    await getDb().insert(playbooks).values({
      orgId: org.id,
      name: "Ativo",
      version: 1,
      status: "active",
      createdBy: manager.id,
      publishedAt: new Date(),
    });

    const rejected = await zoomWebhook(
      new Request("http://127.0.0.1/api/webhooks/zoom", {
        method: "POST",
        headers: { "content-type": "application/json", "x-zm-signature": "v0=nope", "x-zm-request-timestamp": "1" },
        body: JSON.stringify({ event: "recording.completed" }),
      }),
      { params: Promise.resolve({}) },
    );
    expect(rejected.status).toBe(401);
    const inbox = await getDb().select().from(webhookInbox);
    expect(inbox).toHaveLength(1);
    expect(inbox[0]?.signatureOk).toBe(false);
    expect(await getDb().select().from(calls)).toHaveLength(0);

    const payload = {
      event: "recording.completed",
      payload: {
        object: {
          uuid: "zoom-transcript-1",
          topic: "Demo Zoom",
          host_email: seller.email.toUpperCase(),
          start_time: new Date().toISOString(),
          duration: 12,
          transcript: {
            segments: [
              { start_ms: 0, end_ms: 800, speaker: "host", text: "Olá" },
              { start_ms: 800, end_ms: 1600, speaker: "customer", text: "Pode falar" },
            ],
          },
          recording_files: [{ file_type: "M4A", download_url: "https://zoom.example/audio.m4a", recording_type: "audio_only" }],
        },
      },
    };
    const spy = vi.spyOn(console, "info").mockImplementation(() => {});
    const accepted = await zoomWebhook(signedZoom(payload), { params: Promise.resolve({}) });
    expect(accepted.status).toBe(202);
    await drainIngestQueue();
    const again = await zoomWebhook(signedZoom(payload), { params: Promise.resolve({}) });
    expect(again.status).toBe(202);
    await drainIngestQueue();

    const rows = await getDb().select().from(calls);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      source: "zoom",
      status: "ready",
      externalId: "zoom-transcript-1",
      sellerId: seller.id,
      audioUrl: "https://zoom.example/audio.m4a",
    });
    expect(rows[0]?.playbookId).toBeTruthy();
    const detail = await invoke(getCall, {
      path: `/api/calls/${rows[0]?.id}`,
      userId: manager.id,
      params: { id: rows[0]?.id ?? "" },
    });
    const body = await readJson(detail);
    expect(body.transcriptProvider).toBe("zoom");
    expect(body.segments).toEqual([
      expect.objectContaining({ speaker: "seller", text: "Olá" }),
      expect.objectContaining({ speaker: "prospect", text: "Pode falar" }),
    ]);
    expect(stt.calls).toHaveLength(0);
    const logged = spy.mock.calls.map((call) => String(call[0])).join("\n");
    expect(logged).toContain(rows[0]?.id);
    expect(logged).toContain("zoom-transcript-1");
    spy.mockRestore();

    const listed = await invoke(listCalls, {
      path: "/api/calls?source=zoom&period=week",
      userId: seller.id,
    });
    const listBody = await readJson(listed);
    expect(listBody.emptyWeek).toBeNull();
    expect((listBody.calls as { source: string }[]).map((call) => call.source)).toEqual(["zoom"]);
  });

  it("runs batch STT for audio-only Zoom events and records failure", async () => {
    const stt = new MockSpeechToText();
    setSpeechToTextForTests(stt);
    const { org, seller } = await seedOrg("audio");
    vi.stubEnv("ZOOM_ORG_ID", org.id);
    const audioPayload = {
      event: "recording.completed",
      payload: {
        object: {
          uuid: "zoom-audio-1",
          topic: "Só áudio",
          host_email: seller.email,
          recording_files: [{ file_type: "M4A", download_url: "https://zoom.example/only.m4a", recording_type: "audio_only" }],
        },
      },
    };
    expect((await zoomWebhook(signedZoom(audioPayload), { params: Promise.resolve({}) })).status).toBe(202);
    await drainIngestQueue();
    expect(stt.calls).toHaveLength(1);
    const [ready] = await getDb().select().from(calls).where(eq(calls.externalId, "zoom-audio-1"));
    expect(ready?.status).toBe("ready");
    expect(ready?.source).toBe("zoom");

    setSpeechToTextForTests(new FailingSpeechToText());
    const failing = {
      event: "recording.completed",
      payload: {
        object: {
          uuid: "zoom-audio-2",
          topic: "STT falha",
          host_email: seller.email,
          recording_files: [{ file_type: "M4A", download_url: "https://zoom.example/fail.m4a", recording_type: "audio_only" }],
        },
      },
    };
    await zoomWebhook(signedZoom(failing), { params: Promise.resolve({}) });
    await drainIngestQueue();
    const [failed] = await getDb().select().from(calls).where(eq(calls.externalId, "zoom-audio-2"));
    expect(failed?.status).toBe("failed");

    setSpeechToTextForTests(new MockSpeechToText());
    const sellerTry = await invoke(reprocessCall, {
      method: "POST",
      path: `/api/calls/${failed?.id}/reprocess`,
      userId: seller.id,
      params: { id: failed?.id ?? "" },
    });
    expect(sellerTry.status).toBe(403);
    const manager = (await getDb().select().from(memberships).where(eq(memberships.role, "manager")))[0];
    const retried = await invoke(reprocessCall, {
      method: "POST",
      path: `/api/calls/${failed?.id}/reprocess`,
      userId: manager?.userId,
      params: { id: failed?.id ?? "" },
    });
    expect(retried.status).toBe(200);
    expect((await readJson(retried)).status).toBe("ready");
  });

  it("validates the Zoom endpoint and leaves Meet and Fireflies unimplemented", async () => {
    const response = await zoomWebhook(
      signedZoom({ event: "endpoint.url_validation", payload: { plainToken: "plain-123" } }),
      { params: Promise.resolve({}) },
    );
    expect(response.status).toBe(200);
    expect(await readJson(response)).toEqual({
      plainToken: "plain-123",
      encryptedToken: zoomEncryptedToken(SECRET, "plain-123"),
    });

    const meet = await meetWebhook(new Request("http://127.0.0.1/api/webhooks/meet", { method: "POST", body: "{}" }), {
      params: Promise.resolve({}),
    });
    expect(meet.status).toBe(501);
    expect((await readJson(meet)).provider).toBe("meet");
    const fireflies = await firefliesWebhook(
      new Request("http://127.0.0.1/api/webhooks/fireflies", { method: "POST", body: "{}" }),
      { params: Promise.resolve({}) },
    );
    expect(fireflies.status).toBe(501);
    expect(await getDb().select().from(calls)).toHaveLength(0);
  });

  it("stores paste and upload, filters by source, and blocks real audio without consent", async () => {
    const { org, manager, seller } = await seedOrg("manual");
    const pasted = await invoke(createCall, {
      method: "POST",
      path: "/api/calls",
      userId: seller.id,
      body: { title: "Colada", transcript: "Linha um\nLinha dois" },
    });
    expect(pasted.status).toBe(201);
    const pasteBody = await readJson(pasted);
    expect(pasteBody).toMatchObject({ source: "paste", status: "ready", sellerId: seller.id });
    expect(pasteBody.segments).toHaveLength(2);

    const form = new FormData();
    form.set("title", "Gravação");
    form.set("transcript", "Texto do upload");
    form.set("sellerId", seller.id);
    form.set("audio", new File([Uint8Array.from([1, 2, 3])], "call.m4a", { type: "audio/mp4" }));
    const uploaded = await createCall(
      new Request("http://127.0.0.1/api/calls", {
        method: "POST",
        headers: { "x-mock-user-id": manager.id, "x-request-id": "req-upload" },
        body: form,
      }),
      { params: Promise.resolve({}) },
    );
    expect(uploaded.status).toBe(201);
    expect(await readJson(uploaded)).toMatchObject({ source: "upload", status: "ready", audioStored: true });

    const old = await invoke(createCall, {
      method: "POST",
      path: "/api/calls",
      userId: manager.id,
      body: { title: "Antiga", transcript: "fora da semana", sellerId: seller.id },
    });
    const oldId = String((await readJson(old)).id);
    await getDb()
      .update(calls)
      .set({ createdAt: new Date(Date.now() - 40 * 24 * 60 * 60 * 1000) })
      .where(eq(calls.id, oldId));

    const week = await invoke(listCalls, { path: "/api/calls?period=week&source=paste", userId: manager.id });
    const weekBody = await readJson(week);
    const titles = (weekBody.calls as { title: string }[]).map((call) => call.title);
    expect(titles).toEqual(["Colada"]);
    expect(titles).not.toContain("Antiga");

    const otherSeller = (
      await getDb()
        .insert(users)
        .values({ email: "other-seller@test.local", name: "Outro" })
        .returning()
    )[0];
    if (!otherSeller) throw new Error("seller missing");
    await getDb().insert(memberships).values({ orgId: org.id, userId: otherSeller.id, role: "seller" });
    const hidden = await invoke(listCalls, { path: "/api/calls", userId: otherSeller.id });
    expect(await readJson(hidden)).toMatchObject({ calls: [] });

    vi.stubEnv("AUDIO_CONSENT_GATE", "enforce");
    const blockedForm = new FormData();
    blockedForm.set("title", "Sem consentimento");
    blockedForm.set("audio", new File([Uint8Array.from([9])], "secret.m4a", { type: "audio/mp4" }));
    const blocked = await createCall(
      new Request("http://127.0.0.1/api/calls", {
        method: "POST",
        headers: { "x-mock-user-id": manager.id },
        body: blockedForm,
      }),
      { params: Promise.resolve({}) },
    );
    expect(blocked.status).toBe(422);
    expect((await readJson(blocked)).error).toBe("consent_required");

    const audioOnly = {
      event: "recording.completed",
      payload: {
        object: {
          uuid: "zoom-no-consent",
          topic: "Áudio real",
          host_email: seller.email,
          recording_files: [{ file_type: "M4A", download_url: "https://zoom.example/real.m4a", recording_type: "audio_only" }],
        },
      },
    };
    vi.stubEnv("ZOOM_ORG_ID", org.id);
    await zoomWebhook(signedZoom(audioOnly), { params: Promise.resolve({}) });
    await drainIngestQueue();
    const [gated] = await getDb().select().from(calls).where(eq(calls.externalId, "zoom-no-consent"));
    expect(gated?.status).toBe("failed");
    expect(gated?.audioUrl).toBeNull();

    await getDb().insert(retentionPolicies).values({ orgId: org.id }).onConflictDoNothing();
    const [policy] = await getDb().select().from(retentionPolicies).where(eq(retentionPolicies.orgId, org.id));
    expect(policy).toMatchObject({ audioDays: 30, transcriptDays: 90 });
  });

  it("hides calls from another organization", async () => {
    const orgA = await seedOrg("org-a-calls");
    const orgB = await seedOrg("org-b-calls");
    const created = await invoke(createCall, {
      method: "POST",
      path: "/api/calls",
      userId: orgA.manager.id,
      body: { title: "Só A", transcript: "privada" },
    });
    const id = String((await readJson(created)).id);
    const read = await invoke(getCall, {
      path: `/api/calls/${id}`,
      userId: orgB.manager.id,
      params: { id },
    });
    expect(read.status).toBe(404);
    const list = await invoke(listCalls, { path: "/api/calls?period=week", userId: orgB.seller.id });
    const body = await readJson(list);
    expect(body.calls).toEqual([]);
    expect(body.emptyWeek).toMatchObject({ copyKey: "calls.empty_week" });
  });
});
