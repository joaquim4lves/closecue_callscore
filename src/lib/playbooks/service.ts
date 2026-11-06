import { and, asc, eq, sql } from "drizzle-orm";
import type { AuthContext } from "../auth/context";
import { isUuid } from "../auth/mock-session";
import { copy } from "../copy";
import type { Database } from "../db/client";
import { getDb } from "../db/client";
import { playbookObjections, playbookPhases, playbooks } from "../db/schema";
import { ApiError } from "../http/errors";
import type { Objection, Phase, PlaybookDetail, PlaybookListResponse, PlaybookStatus, PlaybookSummary } from "./types";

type Executor = Pick<Database, "select" | "insert" | "update" | "delete">;

const statusRank: Record<PlaybookStatus, number> = { active: 0, draft: 1, archived: 2 };

function notFound(): ApiError {
  return new ApiError(404, "not_found", "Playbook not found.");
}

function forbidden(): ApiError {
  return new ApiError(403, "forbidden", "Manager role required.");
}

function assertId(id: string): void {
  if (!isUuid(id)) throw notFound();
}

function stringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string");
}

function iso(value: Date | null): string | null {
  return value ? value.toISOString() : null;
}

function toSummary(row: typeof playbooks.$inferSelect): PlaybookSummary {
  return {
    id: row.id,
    orgId: row.orgId,
    name: row.name,
    version: row.version,
    status: row.status,
    createdBy: row.createdBy,
    publishedAt: iso(row.publishedAt),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function toPhase(row: typeof playbookPhases.$inferSelect): Phase {
  return {
    id: row.id,
    sortOrder: row.sortOrder,
    name: row.name,
    triggerText: row.triggerText,
    script: row.script,
    checklistItems: stringArray(row.checklistItems),
  };
}

function toObjection(row: typeof playbookObjections.$inferSelect): Objection {
  return {
    id: row.id,
    sortOrder: row.sortOrder,
    label: row.label,
    signals: stringArray(row.signals),
    suggestedResponse: row.suggestedResponse,
  };
}

async function loadRow(db: Executor, id: string) {
  const [row] = await db.select().from(playbooks).where(eq(playbooks.id, id));
  return row ?? null;
}

async function loadDetail(db: Executor, id: string): Promise<PlaybookDetail> {
  const row = await loadRow(db, id);
  if (!row) throw notFound();
  const phases = await db
    .select()
    .from(playbookPhases)
    .where(eq(playbookPhases.playbookId, id))
    .orderBy(asc(playbookPhases.sortOrder));
  const objections = await db
    .select()
    .from(playbookObjections)
    .where(eq(playbookObjections.playbookId, id))
    .orderBy(asc(playbookObjections.sortOrder));
  return {
    ...toSummary(row),
    phases: phases.map(toPhase),
    objections: objections.map(toObjection),
  };
}

async function touch(db: Executor, id: string): Promise<void> {
  await db.update(playbooks).set({ updatedAt: new Date() }).where(eq(playbooks.id, id));
}

async function nextVersion(db: Executor, orgId: string): Promise<number> {
  const [row] = await db
    .select({ maxVersion: sql<number>`coalesce(max(${playbooks.version}), 0)::int` })
    .from(playbooks)
    .where(eq(playbooks.orgId, orgId));
  return Number(row?.maxVersion ?? 0) + 1;
}

async function requireVisible(auth: AuthContext, id: string) {
  assertId(id);
  const row = await loadRow(getDb(), id);
  if (!row || row.orgId !== auth.orgId) throw notFound();
  if (auth.role === "seller" && row.status !== "active") throw notFound();
  return row;
}

async function requireManager(auth: AuthContext, id: string) {
  const row = await requireVisible(auth, id);
  if (auth.role !== "manager") throw forbidden();
  return row;
}

async function requireDraft(auth: AuthContext, id: string) {
  const row = await requireManager(auth, id);
  if (row.status !== "draft") {
    throw new ApiError(
      409,
      "playbook.not_draft",
      "Only a draft can be edited. Duplicate the active playbook to change it without affecting the score.",
    );
  }
  return row;
}

export async function listPlaybooks(auth: AuthContext): Promise<PlaybookListResponse> {
  const filters = [eq(playbooks.orgId, auth.orgId)];
  if (auth.role === "seller") filters.push(eq(playbooks.status, "active"));
  const rows = await getDb()
    .select()
    .from(playbooks)
    .where(and(...filters));
  rows.sort(
    (a, b) => statusRank[a.status] - statusRank[b.status] || b.updatedAt.getTime() - a.updatedAt.getTime(),
  );
  const active = rows.find((row) => row.status === "active") ?? null;
  return {
    playbooks: rows.map(toSummary),
    activePlaybookId: active?.id ?? null,
    noneActive: active
      ? null
      : { copyKey: "playbook.none_active", copy: copy["playbook.none_active"] },
  };
}

export async function getPlaybook(auth: AuthContext, id: string): Promise<PlaybookDetail> {
  await requireVisible(auth, id);
  return loadDetail(getDb(), id);
}

/** Active playbook for an org. Drafts are intentionally excluded. */
export async function getActivePlaybook(orgId: string): Promise<PlaybookDetail | null> {
  const [row] = await getDb()
    .select()
    .from(playbooks)
    .where(and(eq(playbooks.orgId, orgId), eq(playbooks.status, "active")));
  if (!row) return null;
  return loadDetail(getDb(), row.id);
}

export async function createPlaybook(auth: AuthContext, input: { name: string }): Promise<PlaybookDetail> {
  if (auth.role !== "manager") throw forbidden();
  return getDb().transaction(async (tx) => {
    const version = await nextVersion(tx, auth.orgId);
    const [created] = await tx
      .insert(playbooks)
      .values({
        orgId: auth.orgId,
        name: input.name,
        version,
        status: "draft",
        createdBy: auth.userId,
      })
      .returning();
    if (!created) throw new ApiError(500, "internal_error", "Could not create playbook.");
    return loadDetail(tx, created.id);
  });
}

export async function updatePlaybook(
  auth: AuthContext,
  id: string,
  input: { name: string },
): Promise<PlaybookDetail> {
  await requireDraft(auth, id);
  await getDb()
    .update(playbooks)
    .set({ name: input.name, updatedAt: new Date() })
    .where(eq(playbooks.id, id));
  return loadDetail(getDb(), id);
}

export async function deletePlaybook(auth: AuthContext, id: string): Promise<void> {
  const row = await requireManager(auth, id);
  if (row.status === "active") {
    throw new ApiError(
      409,
      "playbook.active_locked",
      "The active playbook stays until another draft is published in its place.",
    );
  }
  await getDb().delete(playbooks).where(eq(playbooks.id, id));
}

export async function saveDraft(
  auth: AuthContext,
  id: string,
  input: { name?: string },
): Promise<PlaybookDetail> {
  await requireDraft(auth, id);
  await getDb()
    .update(playbooks)
    .set({
      ...(input.name ? { name: input.name } : {}),
      updatedAt: new Date(),
    })
    .where(eq(playbooks.id, id));
  return loadDetail(getDb(), id);
}

export async function publishPlaybook(
  auth: AuthContext,
  id: string,
  input: { replaceActive?: boolean },
): Promise<PlaybookDetail> {
  const existing = await requireManager(auth, id);
  if (existing.status !== "draft") {
    throw new ApiError(409, "playbook.not_draft", "Only a draft can be published.");
  }

  return getDb().transaction(async (tx) => {
    const [draft] = await tx.select().from(playbooks).where(eq(playbooks.id, id)).for("update");
    if (!draft || draft.orgId !== auth.orgId || draft.status !== "draft") {
      throw new ApiError(409, "playbook.not_draft", "Only a draft can be published.");
    }
    const phases = await tx
      .select({ id: playbookPhases.id })
      .from(playbookPhases)
      .where(eq(playbookPhases.playbookId, id));
    if (phases.length === 0) {
      throw new ApiError(400, "playbook.empty", "Add at least one phase before publishing.");
    }

    const activeRows = await tx
      .select()
      .from(playbooks)
      .where(and(eq(playbooks.orgId, auth.orgId), eq(playbooks.status, "active")))
      .for("update");
    const currentActive = activeRows[0];
    if (currentActive && input.replaceActive !== true) {
      throw new ApiError(409, "playbook.replace_active", copy["playbook.replace_active"], {
        copyKey: "playbook.replace_active",
        copy: copy["playbook.replace_active"],
        activePlaybook: {
          id: currentActive.id,
          name: currentActive.name,
          version: currentActive.version,
        },
      });
    }

    const now = new Date();
    if (currentActive) {
      await tx
        .update(playbooks)
        .set({ status: "archived", updatedAt: now })
        .where(eq(playbooks.id, currentActive.id));
    }
    await tx
      .update(playbooks)
      .set({ status: "active", publishedAt: now, updatedAt: now })
      .where(eq(playbooks.id, id));
    return loadDetail(tx, id);
  });
}

export async function duplicatePlaybook(auth: AuthContext, id: string): Promise<PlaybookDetail> {
  const source = await requireManager(auth, id);
  return getDb().transaction(async (tx) => {
    const version = await nextVersion(tx, auth.orgId);
    const [created] = await tx
      .insert(playbooks)
      .values({
        orgId: auth.orgId,
        name: source.name,
        version,
        status: "draft",
        createdBy: auth.userId,
      })
      .returning();
    if (!created) throw new ApiError(500, "internal_error", "Could not duplicate playbook.");

    const phases = await tx
      .select()
      .from(playbookPhases)
      .where(eq(playbookPhases.playbookId, source.id))
      .orderBy(asc(playbookPhases.sortOrder));
    if (phases.length > 0) {
      await tx.insert(playbookPhases).values(
        phases.map((phase) => ({
          playbookId: created.id,
          sortOrder: phase.sortOrder,
          name: phase.name,
          triggerText: phase.triggerText,
          script: phase.script,
          checklistItems: phase.checklistItems,
        })),
      );
    }

    const objections = await tx
      .select()
      .from(playbookObjections)
      .where(eq(playbookObjections.playbookId, source.id))
      .orderBy(asc(playbookObjections.sortOrder));
    if (objections.length > 0) {
      await tx.insert(playbookObjections).values(
        objections.map((item) => ({
          playbookId: created.id,
          sortOrder: item.sortOrder,
          label: item.label,
          signals: item.signals,
          suggestedResponse: item.suggestedResponse,
        })),
      );
    }
    return loadDetail(tx, created.id);
  });
}

export async function createPhase(
  auth: AuthContext,
  playbookId: string,
  input: { name: string; triggerText: string; script: string; checklistItems: string[] },
): Promise<PlaybookDetail> {
  await requireDraft(auth, playbookId);
  return getDb().transaction(async (tx) => {
    const [maxRow] = await tx
      .select({ maxOrder: sql<number>`coalesce(max(${playbookPhases.sortOrder}), -1)::int` })
      .from(playbookPhases)
      .where(eq(playbookPhases.playbookId, playbookId));
    await tx.insert(playbookPhases).values({
      playbookId,
      sortOrder: Number(maxRow?.maxOrder ?? -1) + 1,
      name: input.name,
      triggerText: input.triggerText,
      script: input.script,
      checklistItems: input.checklistItems,
    });
    await touch(tx, playbookId);
    return loadDetail(tx, playbookId);
  });
}

export async function updatePhase(
  auth: AuthContext,
  playbookId: string,
  phaseId: string,
  input: { name?: string; triggerText?: string; script?: string; checklistItems?: string[] },
): Promise<PlaybookDetail> {
  assertId(phaseId);
  await requireDraft(auth, playbookId);
  return getDb().transaction(async (tx) => {
    const [phase] = await tx
      .select()
      .from(playbookPhases)
      .where(and(eq(playbookPhases.id, phaseId), eq(playbookPhases.playbookId, playbookId)));
    if (!phase) throw new ApiError(404, "not_found", "Phase not found.");
    await tx
      .update(playbookPhases)
      .set({
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.triggerText !== undefined ? { triggerText: input.triggerText } : {}),
        ...(input.script !== undefined ? { script: input.script } : {}),
        ...(input.checklistItems !== undefined ? { checklistItems: input.checklistItems } : {}),
      })
      .where(eq(playbookPhases.id, phaseId));
    await touch(tx, playbookId);
    return loadDetail(tx, playbookId);
  });
}

export async function deletePhase(auth: AuthContext, playbookId: string, phaseId: string): Promise<PlaybookDetail> {
  assertId(phaseId);
  await requireDraft(auth, playbookId);
  return getDb().transaction(async (tx) => {
    const removed = await tx
      .delete(playbookPhases)
      .where(and(eq(playbookPhases.id, phaseId), eq(playbookPhases.playbookId, playbookId)))
      .returning({ id: playbookPhases.id });
    if (removed.length === 0) throw new ApiError(404, "not_found", "Phase not found.");
    await touch(tx, playbookId);
    return loadDetail(tx, playbookId);
  });
}

export async function reorderPhases(
  auth: AuthContext,
  playbookId: string,
  orderedIds: string[],
): Promise<PlaybookDetail> {
  await requireDraft(auth, playbookId);
  return getDb().transaction(async (tx) => {
    await reorder(tx, "phase", playbookId, orderedIds);
    await touch(tx, playbookId);
    return loadDetail(tx, playbookId);
  });
}

export async function createObjection(
  auth: AuthContext,
  playbookId: string,
  input: { label: string; signals: string[]; suggestedResponse: string },
): Promise<PlaybookDetail> {
  await requireDraft(auth, playbookId);
  return getDb().transaction(async (tx) => {
    const [maxRow] = await tx
      .select({ maxOrder: sql<number>`coalesce(max(${playbookObjections.sortOrder}), -1)::int` })
      .from(playbookObjections)
      .where(eq(playbookObjections.playbookId, playbookId));
    await tx.insert(playbookObjections).values({
      playbookId,
      sortOrder: Number(maxRow?.maxOrder ?? -1) + 1,
      label: input.label,
      signals: input.signals,
      suggestedResponse: input.suggestedResponse,
    });
    await touch(tx, playbookId);
    return loadDetail(tx, playbookId);
  });
}

export async function updateObjection(
  auth: AuthContext,
  playbookId: string,
  objectionId: string,
  input: { label?: string; signals?: string[]; suggestedResponse?: string },
): Promise<PlaybookDetail> {
  assertId(objectionId);
  await requireDraft(auth, playbookId);
  return getDb().transaction(async (tx) => {
    const [item] = await tx
      .select()
      .from(playbookObjections)
      .where(and(eq(playbookObjections.id, objectionId), eq(playbookObjections.playbookId, playbookId)));
    if (!item) throw new ApiError(404, "not_found", "Objection not found.");
    await tx
      .update(playbookObjections)
      .set({
        ...(input.label !== undefined ? { label: input.label } : {}),
        ...(input.signals !== undefined ? { signals: input.signals } : {}),
        ...(input.suggestedResponse !== undefined ? { suggestedResponse: input.suggestedResponse } : {}),
      })
      .where(eq(playbookObjections.id, objectionId));
    await touch(tx, playbookId);
    return loadDetail(tx, playbookId);
  });
}

export async function deleteObjection(
  auth: AuthContext,
  playbookId: string,
  objectionId: string,
): Promise<PlaybookDetail> {
  assertId(objectionId);
  await requireDraft(auth, playbookId);
  return getDb().transaction(async (tx) => {
    const removed = await tx
      .delete(playbookObjections)
      .where(and(eq(playbookObjections.id, objectionId), eq(playbookObjections.playbookId, playbookId)))
      .returning({ id: playbookObjections.id });
    if (removed.length === 0) throw new ApiError(404, "not_found", "Objection not found.");
    await touch(tx, playbookId);
    return loadDetail(tx, playbookId);
  });
}

export async function reorderObjections(
  auth: AuthContext,
  playbookId: string,
  orderedIds: string[],
): Promise<PlaybookDetail> {
  await requireDraft(auth, playbookId);
  return getDb().transaction(async (tx) => {
    await reorder(tx, "objection", playbookId, orderedIds);
    await touch(tx, playbookId);
    return loadDetail(tx, playbookId);
  });
}

async function reorder(
  tx: Executor,
  kind: "phase" | "objection",
  playbookId: string,
  orderedIds: string[],
): Promise<void> {
  const table = kind === "phase" ? playbookPhases : playbookObjections;
  const existing = await tx.select({ id: table.id }).from(table).where(eq(table.playbookId, playbookId));
  const current = existing.map((row) => row.id).sort();
  const incoming = [...orderedIds].sort();
  if (current.length !== incoming.length || current.some((id, index) => id !== incoming[index])) {
    throw new ApiError(
      400,
      "reorder_mismatch",
      "orderedIds must list each item of this playbook exactly once.",
    );
  }
  await tx
    .update(table)
    .set({ sortOrder: sql`${table.sortOrder} + 1000` })
    .where(eq(table.playbookId, playbookId));
  for (let index = 0; index < orderedIds.length; index += 1) {
    await tx.update(table).set({ sortOrder: index }).where(eq(table.id, orderedIds[index]!));
  }
}
