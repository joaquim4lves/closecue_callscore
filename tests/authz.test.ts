import { beforeEach, describe, expect, it } from "vitest";
import { POST as createSession } from "../src/app/api/dev/session/route";
import { GET as listPlaybooks, POST as createPlaybook } from "../src/app/api/playbooks/route";
import { GET as getPlaybook } from "../src/app/api/playbooks/[id]/route";
import { PATCH as patchPhase } from "../src/app/api/playbooks/[id]/phases/[phaseId]/route";
import { getDb } from "../src/lib/db/client";
import { users } from "../src/lib/db/schema";
import { invoke, readJson, resetDb, seedOrg } from "./helpers";

describe("role authorization", () => {
  beforeEach(resetDb);

  it("rejects missing, unknown, and membership-less users", async () => {
    const missing = await invoke(listPlaybooks, { path: "/api/playbooks" });
    expect(missing.status).toBe(401);

    const unknown = await invoke(listPlaybooks, {
      path: "/api/playbooks",
      userId: "99999999-9999-4999-8999-999999999999",
    });
    expect(unknown.status).toBe(401);

    const [orphan] = await getDb()
      .insert(users)
      .values({ email: "orphan@test.local", name: "Orphan" })
      .returning();
    const noMembership = await invoke(listPlaybooks, {
      path: "/api/playbooks",
      userId: orphan?.id,
    });
    expect(noMembership.status).toBe(403);
    expect((await readJson(noMembership)).error).toBe("no_membership");
  });

  it("lets a manager write a draft and only lets a seller read the active playbook", async () => {
    const { manager, seller } = await seedOrg("authz");
    const created = await invoke(createPlaybook, {
      method: "POST",
      path: "/api/playbooks",
      userId: manager.id,
      body: { name: "Rascunho" },
    });
    expect(created.status).toBe(201);
    const draft = await readJson(created);
    expect(draft.status).toBe("draft");

    const sellerCreate = await invoke(createPlaybook, {
      method: "POST",
      path: "/api/playbooks",
      userId: seller.id,
      body: { name: "Não pode" },
    });
    expect(sellerCreate.status).toBe(403);

    const sellerDraft = await invoke(getPlaybook, {
      path: `/api/playbooks/${String(draft.id)}`,
      userId: seller.id,
      params: { id: String(draft.id) },
    });
    expect(sellerDraft.status).toBe(404);

    const sellerList = await invoke(listPlaybooks, { path: "/api/playbooks", userId: seller.id });
    expect(sellerList.status).toBe(200);
    const listed = await readJson(sellerList);
    expect(listed.playbooks).toEqual([]);
    expect(listed.noneActive).toMatchObject({ copyKey: "playbook.none_active" });

    const withPhase = await invoke(
      (await import("../src/app/api/playbooks/[id]/phases/route")).POST,
      {
        method: "POST",
        path: `/api/playbooks/${String(draft.id)}/phases`,
        userId: manager.id,
        params: { id: String(draft.id) },
        body: { name: "Abertura", script: "Olá" },
      },
    );
    expect(withPhase.status).toBe(201);
    const phased = await readJson(withPhase);
    const phaseId = (phased.phases as { id: string }[])[0]?.id;
    expect(phaseId).toBeTruthy();

    const published = await invoke(
      (await import("../src/app/api/playbooks/[id]/publish/route")).POST,
      {
        method: "POST",
        path: `/api/playbooks/${String(draft.id)}/publish`,
        userId: manager.id,
        params: { id: String(draft.id) },
        body: {},
      },
    );
    expect(published.status).toBe(200);

    const sellerRead = await invoke(getPlaybook, {
      path: `/api/playbooks/${String(draft.id)}`,
      userId: seller.id,
      cookieUserId: seller.id,
      params: { id: String(draft.id) },
    });
    expect(sellerRead.status).toBe(200);
    expect((await readJson(sellerRead)).status).toBe("active");

    const session = await invoke(createSession, {
      method: "POST",
      path: "/api/dev/session",
      body: { userId: manager.id },
    });
    expect(session.status).toBe(200);
    expect(session.headers.get("set-cookie")).toContain(`mock_user_id=${manager.id}`);

    const sellerWrite = await invoke(patchPhase, {
      method: "PATCH",
      path: `/api/playbooks/${String(draft.id)}/phases/${phaseId}`,
      userId: seller.id,
      params: { id: String(draft.id), phaseId: phaseId ?? "" },
      body: { script: "Vendedor não edita" },
    });
    expect(sellerWrite.status).toBe(403);
  });
});
