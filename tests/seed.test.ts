import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { GET as listPlaybooks } from "../src/app/api/playbooks/route";
import { DEMO, DEMO_PHASES } from "../src/lib/dev/demo-data";
import { seedDemo } from "../src/lib/dev/seed";
import { getDb } from "../src/lib/db/client";
import { playbookObjections, playbookPhases, playbooks } from "../src/lib/db/schema";
import { getPlaybookForScoring } from "../src/lib/playbooks/scoring-input";
import { invoke, readJson, resetDb } from "./helpers";

describe("demo seed", () => {
  beforeEach(resetDb);

  it("is idempotent and exposes the active playbook to the seller", async () => {
    const first = await seedDemo();
    const second = await seedDemo();
    expect(first.playbookStatus).toBe("active");
    expect(second).toMatchObject({
      orgId: DEMO.orgId,
      managerId: DEMO.managerId,
      sellerId: DEMO.sellerId,
      playbookId: DEMO.playbookId,
      playbookStatus: "active",
      phaseCount: 5,
      objectionCount: 4,
    });

    const phases = await getDb()
      .select()
      .from(playbookPhases)
      .where(eq(playbookPhases.playbookId, DEMO.playbookId));
    expect(phases).toHaveLength(5);
    expect(phases.sort((a, b) => a.sortOrder - b.sortOrder).map((phase) => phase.name)).toEqual(
      DEMO_PHASES.map((phase) => phase.name),
    );
    const objections = await getDb()
      .select()
      .from(playbookObjections)
      .where(eq(playbookObjections.playbookId, DEMO.playbookId));
    expect(objections.length).toBeGreaterThanOrEqual(3);
    expect(objections.length).toBeLessThanOrEqual(5);
    expect(await getDb().select().from(playbooks)).toHaveLength(1);

    const scoring = await getPlaybookForScoring(DEMO.orgId);
    expect(scoring?.id).toBe(DEMO.playbookId);
    expect(scoring?.status).toBe("active");

    const seller = await invoke(listPlaybooks, { path: "/api/playbooks", userId: DEMO.sellerId });
    const body = await readJson(seller);
    expect(body.activePlaybookId).toBe(DEMO.playbookId);
    expect(body.noneActive).toBeNull();
    expect((body.playbooks as { status: string }[]).every((item) => item.status === "active")).toBe(true);
  });
});
