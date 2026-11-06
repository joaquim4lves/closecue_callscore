import { beforeEach, describe, expect, it } from "vitest";
import { GET as listPlaybooks } from "../src/app/api/playbooks/route";
import { GET as getPlaybook, PATCH as patchPlaybook } from "../src/app/api/playbooks/[id]/route";
import { POST as publishPlaybook } from "../src/app/api/playbooks/[id]/publish/route";
import { POST as createPhase } from "../src/app/api/playbooks/[id]/phases/route";
import { invoke, readJson, resetDb, seedOrg } from "./helpers";

async function createActive(managerId: string, name: string) {
  const { POST } = await import("../src/app/api/playbooks/route");
  const created = await invoke(POST, {
    method: "POST",
    path: "/api/playbooks",
    userId: managerId,
    body: { name },
  });
  const draft = await readJson(created);
  const id = String(draft.id);
  await invoke(createPhase, {
    method: "POST",
    path: `/api/playbooks/${id}/phases`,
    userId: managerId,
    params: { id },
    body: { name: "Abertura", script: name },
  });
  const published = await invoke(publishPlaybook, {
    method: "POST",
    path: `/api/playbooks/${id}/publish`,
    userId: managerId,
    params: { id },
    body: {},
  });
  expect(published.status).toBe(200);
  return id;
}

describe("cross-org isolation", () => {
  beforeEach(resetDb);

  it("hides another organization's playbooks from managers and sellers", async () => {
    const orgA = await seedOrg("org-a");
    const orgB = await seedOrg("org-b");
    const playbookB = await createActive(orgB.manager.id, "Playbook B");

    const managerRead = await invoke(getPlaybook, {
      path: `/api/playbooks/${playbookB}`,
      userId: orgA.manager.id,
      params: { id: playbookB },
    });
    expect(managerRead.status).toBe(404);

    const sellerRead = await invoke(getPlaybook, {
      path: `/api/playbooks/${playbookB}`,
      userId: orgA.seller.id,
      params: { id: playbookB },
    });
    expect(sellerRead.status).toBe(404);

    const managerWrite = await invoke(patchPlaybook, {
      method: "PATCH",
      path: `/api/playbooks/${playbookB}`,
      userId: orgA.manager.id,
      params: { id: playbookB },
      body: { name: "Invadido" },
    });
    expect(managerWrite.status).toBe(404);

    const managerPublish = await invoke(publishPlaybook, {
      method: "POST",
      path: `/api/playbooks/${playbookB}/publish`,
      userId: orgA.manager.id,
      params: { id: playbookB },
      body: { replaceActive: true },
    });
    expect(managerPublish.status).toBe(404);

    const list = await invoke(listPlaybooks, { path: "/api/playbooks", userId: orgA.manager.id });
    const body = await readJson(list);
    const ids = (body.playbooks as { id: string }[]).map((playbook) => playbook.id);
    expect(ids).not.toContain(playbookB);

    const sellerList = await invoke(listPlaybooks, { path: "/api/playbooks", userId: orgA.seller.id });
    expect((await readJson(sellerList)).playbooks).toEqual([]);
  });
});
