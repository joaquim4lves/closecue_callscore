import { and, eq } from "drizzle-orm";
import { getDb } from "../db/client";
import {
  memberships,
  organizations,
  playbookObjections,
  playbookPhases,
  playbooks,
  retentionPolicies,
  users,
} from "../db/schema";
import { DEMO, DEMO_OBJECTIONS, DEMO_PHASES } from "./demo-data";

export type SeedResult = {
  orgId: string;
  managerId: string;
  sellerId: string;
  playbookId: string;
  playbookStatus: "draft" | "active" | "archived";
  phaseCount: number;
  objectionCount: number;
};

export async function seedDemo(): Promise<SeedResult> {
  const db = getDb();
  return db.transaction(async (tx) => {
    await tx
      .insert(organizations)
      .values({ id: DEMO.orgId, name: DEMO.orgName })
      .onConflictDoNothing({ target: organizations.id });

    await tx
      .insert(users)
      .values([
        { id: DEMO.managerId, email: DEMO.manager.email, name: DEMO.manager.name },
        { id: DEMO.sellerId, email: DEMO.seller.email, name: DEMO.seller.name },
      ])
      .onConflictDoNothing({ target: users.id });

    await tx
      .insert(memberships)
      .values([
        { orgId: DEMO.orgId, userId: DEMO.managerId, role: "manager" },
        { orgId: DEMO.orgId, userId: DEMO.sellerId, role: "seller" },
      ])
      .onConflictDoNothing({ target: [memberships.orgId, memberships.userId] });

    await tx.insert(retentionPolicies).values({ orgId: DEMO.orgId }).onConflictDoNothing();

    const [existing] = await tx.select().from(playbooks).where(eq(playbooks.id, DEMO.playbookId));
    if (!existing) {
      const [otherActive] = await tx
        .select({ id: playbooks.id })
        .from(playbooks)
        .where(and(eq(playbooks.orgId, DEMO.orgId), eq(playbooks.status, "active")));
      const status = otherActive ? "draft" : "active";
      await tx.insert(playbooks).values({
        id: DEMO.playbookId,
        orgId: DEMO.orgId,
        name: DEMO.playbookName,
        version: 1,
        status,
        createdBy: DEMO.managerId,
        publishedAt: status === "active" ? new Date() : null,
      });
    }

    await tx
      .insert(playbookPhases)
      .values(
        DEMO_PHASES.map((phase) => ({
          id: phase.id,
          playbookId: DEMO.playbookId,
          sortOrder: phase.sortOrder,
          name: phase.name,
          triggerText: phase.triggerText,
          script: phase.script,
          checklistItems: [...phase.checklistItems],
        })),
      )
      .onConflictDoNothing({ target: playbookPhases.id });

    await tx
      .insert(playbookObjections)
      .values(
        DEMO_OBJECTIONS.map((item) => ({
          id: item.id,
          playbookId: DEMO.playbookId,
          sortOrder: item.sortOrder,
          label: item.label,
          signals: [...item.signals],
          suggestedResponse: item.suggestedResponse,
        })),
      )
      .onConflictDoNothing({ target: playbookObjections.id });

    const [playbook] = await tx.select().from(playbooks).where(eq(playbooks.id, DEMO.playbookId));
    if (!playbook) {
      throw new Error("Seed did not create the demo playbook.");
    }
    return {
      orgId: DEMO.orgId,
      managerId: DEMO.managerId,
      sellerId: DEMO.sellerId,
      playbookId: DEMO.playbookId,
      playbookStatus: playbook.status,
      phaseCount: DEMO_PHASES.length,
      objectionCount: DEMO_OBJECTIONS.length,
    };
  });
}
