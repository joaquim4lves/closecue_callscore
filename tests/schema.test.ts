import { sql } from "drizzle-orm";
import pg from "pg";
import { beforeEach, describe, expect, it } from "vitest";
import { getDb } from "../src/lib/db/client";
import { runMigrations } from "../src/lib/db/migrate";
import { memberships, playbooks } from "../src/lib/db/schema";
import { pgErrorCode } from "../src/lib/http/errors";
import { resetDb, seedOrg } from "./helpers";

const MIGRATE_DATABASE_URL = "postgres://closecue:closecue@127.0.0.1:5432/closecue_migrate";

async function tableExists(table: string): Promise<boolean> {
  const client = new pg.Client({ connectionString: MIGRATE_DATABASE_URL });
  await client.connect();
  try {
    const result = await client.query<{ name: string | null }>("SELECT to_regclass($1) AS name", [
      `public.${table}`,
    ]);
    return result.rows[0]?.name != null;
  } finally {
    await client.end();
  }
}

describe("schema constraints and migrations", () => {
  beforeEach(resetDb);

  it("migrates down and back up", async () => {
    await runMigrations("down", MIGRATE_DATABASE_URL, { all: true });
    expect(await tableExists("playbooks")).toBe(false);
    expect(await tableExists("calls")).toBe(false);
    expect(await tableExists("organizations")).toBe(false);

    const secondDown = await runMigrations("down", MIGRATE_DATABASE_URL, { all: true });
    expect(secondDown).toEqual([]);

    await runMigrations("up", MIGRATE_DATABASE_URL);
    expect(await tableExists("organizations")).toBe(true);
    expect(await tableExists("memberships")).toBe(true);
    expect(await tableExists("playbooks")).toBe(true);
    expect(await tableExists("playbook_phases")).toBe(true);
    expect(await tableExists("playbook_objections")).toBe(true);
    expect(await tableExists("calls")).toBe(true);
    expect(await tableExists("transcripts")).toBe(true);
    expect(await tableExists("transcript_segments")).toBe(true);
    expect(await tableExists("webhook_inbox")).toBe(true);
    expect(await tableExists("retention_policies")).toBe(true);

    const again = await runMigrations("up", MIGRATE_DATABASE_URL);
    expect(again).toEqual([]);
  });

  it("rejects a duplicate membership and a second active playbook", async () => {
    const { org, manager } = await seedOrg("constraint");
    await expectUniqueViolation(
      getDb().insert(memberships).values({ orgId: org.id, userId: manager.id, role: "seller" }),
    );

    await getDb().insert(playbooks).values({
      orgId: org.id,
      name: "Ativo A",
      version: 1,
      status: "active",
      createdBy: manager.id,
      publishedAt: new Date(),
    });
    await expectUniqueViolation(
      getDb().insert(playbooks).values({
        orgId: org.id,
        name: "Ativo B",
        version: 2,
        status: "active",
        createdBy: manager.id,
        publishedAt: new Date(),
      }),
    );

    const index = await getDb().execute<{ indexdef: string }>(
      sql`select indexdef from pg_indexes where indexname = 'playbooks_one_active_per_org'`,
    );
    expect(String(index.rows[0]?.indexdef)).toContain("UNIQUE");
    expect(String(index.rows[0]?.indexdef).toLowerCase()).toContain("active");
  });
});

async function expectUniqueViolation(promise: Promise<unknown>): Promise<void> {
  try {
    await promise;
  } catch (error) {
    expect(pgErrorCode(error)).toBe("23505");
    return;
  }
  throw new Error("Expected a unique violation");
}
