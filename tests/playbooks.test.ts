import { beforeEach, describe, expect, it } from "vitest";
import { POST as createPlaybook } from "../src/app/api/playbooks/route";
import { DELETE as deletePlaybook, GET as getPlaybook } from "../src/app/api/playbooks/[id]/route";
import { POST as saveDraft } from "../src/app/api/playbooks/[id]/save-draft/route";
import { POST as publishPlaybook } from "../src/app/api/playbooks/[id]/publish/route";
import { POST as createPhase } from "../src/app/api/playbooks/[id]/phases/route";
import { PATCH as patchPhase } from "../src/app/api/playbooks/[id]/phases/[phaseId]/route";
import { POST as reorderPhases } from "../src/app/api/playbooks/[id]/phases/reorder/route";
import { POST as createObjection } from "../src/app/api/playbooks/[id]/objections/route";
import { copy } from "../src/lib/copy";
import { getDb } from "../src/lib/db/client";
import { playbooks } from "../src/lib/db/schema";
import { eq } from "drizzle-orm";
import { getPlaybookForScoring } from "../src/lib/playbooks/scoring-input";
import { invoke, readJson, resetDb, seedOrg } from "./helpers";

async function draftWithPhase(managerId: string, name: string, script: string) {
  const created = await invoke(createPlaybook, {
    method: "POST",
    path: "/api/playbooks",
    userId: managerId,
    body: { name },
  });
  const draft = await readJson(created);
  const id = String(draft.id);
  const phased = await invoke(createPhase, {
    method: "POST",
    path: `/api/playbooks/${id}/phases`,
    userId: managerId,
    params: { id },
    body: { name: "Abertura", script, checklistItems: ["Confirmar agenda"] },
  });
  const detail = await readJson(phased);
  const phaseId = (detail.phases as { id: string }[])[0]?.id ?? "";
  return { id, phaseId };
}

describe("draft versus active", () => {
  beforeEach(resetDb);

  it("keeps a saved draft out of scoring until publish, then requires replace confirmation", async () => {
    const { org, manager, seller } = await seedOrg("score");
    const first = await draftWithPhase(manager.id, "Versão 1", "SCRIPT-ATIVO");

    await getDb().update(playbooks).set({ updatedAt: new Date("2020-01-01T00:00:00.000Z") }).where(eq(playbooks.id, first.id));
    const saved = await invoke(saveDraft, {
      method: "POST",
      path: `/api/playbooks/${first.id}/save-draft`,
      userId: manager.id,
      params: { id: first.id },
      body: {},
    });
    expect(saved.status).toBe(200);
    const savedBody = await readJson(saved);
    expect(savedBody.status).toBe("draft");
    expect(new Date(String(savedBody.updatedAt)).getTime()).toBeGreaterThan(new Date("2020-01-01").getTime());
    expect(await getPlaybookForScoring(org.id)).toBeNull();

    const published = await invoke(publishPlaybook, {
      method: "POST",
      path: `/api/playbooks/${first.id}/publish`,
      userId: manager.id,
      params: { id: first.id },
      body: {},
    });
    expect(published.status).toBe(200);
    const active = await getPlaybookForScoring(org.id);
    expect(active?.id).toBe(first.id);
    expect(active?.status).toBe("active");
    expect(active?.phases[0]?.script).toBe("SCRIPT-ATIVO");

    const mutateActive = await invoke(patchPhase, {
      method: "PATCH",
      path: `/api/playbooks/${first.id}/phases/${first.phaseId}`,
      userId: manager.id,
      params: { id: first.id, phaseId: first.phaseId },
      body: { script: "NÃO DEVE GRAVAR" },
    });
    expect(mutateActive.status).toBe(409);
    expect((await getPlaybookForScoring(org.id))?.phases[0]?.script).toBe("SCRIPT-ATIVO");

    const saveActive = await invoke(saveDraft, {
      method: "POST",
      path: `/api/playbooks/${first.id}/save-draft`,
      userId: manager.id,
      params: { id: first.id },
      body: { name: "Não muda o ativo" },
    });
    expect(saveActive.status).toBe(409);

    const second = await draftWithPhase(manager.id, "Versão 2", "SCRIPT-RASCUNHO");
    const objection = await invoke(createObjection, {
      method: "POST",
      path: `/api/playbooks/${second.id}/objections`,
      userId: manager.id,
      params: { id: second.id },
      body: { label: "Preço", signals: ["está caro"], suggestedResponse: "Piloto curto." },
    });
    expect(objection.status).toBe(201);

    const savedSecond = await invoke(saveDraft, {
      method: "POST",
      path: `/api/playbooks/${second.id}/save-draft`,
      userId: manager.id,
      params: { id: second.id },
      body: {},
    });
    expect((await readJson(savedSecond)).status).toBe("draft");
    expect((await getPlaybookForScoring(org.id))?.id).toBe(first.id);

    const blocked = await invoke(publishPlaybook, {
      method: "POST",
      path: `/api/playbooks/${second.id}/publish`,
      userId: manager.id,
      params: { id: second.id },
      body: {},
    });
    expect(blocked.status).toBe(409);
    const blockedBody = await readJson(blocked);
    expect(blockedBody.error).toBe("playbook.replace_active");
    expect(blockedBody.copyKey).toBe("playbook.replace_active");
    expect(blockedBody.copy).toBe(copy["playbook.replace_active"]);
    expect((await getPlaybookForScoring(org.id))?.id).toBe(first.id);

    const replaced = await invoke(publishPlaybook, {
      method: "POST",
      path: `/api/playbooks/${second.id}/publish`,
      userId: manager.id,
      params: { id: second.id },
      body: { replaceActive: true },
    });
    expect(replaced.status).toBe(200);
    expect((await readJson(replaced)).status).toBe("active");

    const scoring = await getPlaybookForScoring(org.id);
    expect(scoring?.id).toBe(second.id);
    expect(scoring?.phases[0]?.script).toBe("SCRIPT-RASCUNHO");
    expect(scoring?.objections.map((item) => item.label)).toEqual(["Preço"]);

    const previous = await invoke(getPlaybook, {
      path: `/api/playbooks/${first.id}`,
      userId: manager.id,
      params: { id: first.id },
    });
    expect((await readJson(previous)).status).toBe("archived");

    const sellerList = await invoke((await import("../src/app/api/playbooks/route")).GET, {
      path: "/api/playbooks",
      userId: seller.id,
    });
    const visible = (await readJson(sellerList)).playbooks as { id: string; status: string }[];
    expect(visible.map((item) => item.id)).toEqual([second.id]);
    expect(visible.every((item) => item.status === "active")).toBe(true);
  });

  it("reorders phases on a draft", async () => {
    const { manager } = await seedOrg("reorder");
    const created = await invoke(createPlaybook, {
      method: "POST",
      path: "/api/playbooks",
      userId: manager.id,
      body: { name: "Ordem" },
    });
    const id = String((await readJson(created)).id);
    await invoke(createPhase, {
      method: "POST",
      path: `/api/playbooks/${id}/phases`,
      userId: manager.id,
      params: { id },
      body: { name: "Abertura" },
    });
    const second = await invoke(createPhase, {
      method: "POST",
      path: `/api/playbooks/${id}/phases`,
      userId: manager.id,
      params: { id },
      body: { name: "Fechar" },
    });
    const phases = (await readJson(second)).phases as { id: string; name: string }[];
    expect(phases.map((phase) => phase.name)).toEqual(["Abertura", "Fechar"]);

    const reordered = await invoke(reorderPhases, {
      method: "POST",
      path: `/api/playbooks/${id}/phases/reorder`,
      userId: manager.id,
      params: { id },
      body: { orderedIds: [phases[1]?.id, phases[0]?.id] },
    });
    expect(reordered.status).toBe(200);
    expect(((await readJson(reordered)).phases as { name: string }[]).map((phase) => phase.name)).toEqual([
      "Fechar",
      "Abertura",
    ]);

    const removed = await invoke(deletePlaybook, {
      method: "DELETE",
      path: `/api/playbooks/${id}`,
      userId: manager.id,
      params: { id },
    });
    expect(removed.status).toBe(204);
    expect(removed.headers.get("x-request-id")).toBeTruthy();
    const gone = await invoke(getPlaybook, {
      path: `/api/playbooks/${id}`,
      userId: manager.id,
      params: { id },
    });
    expect(gone.status).toBe(404);
  });
});
