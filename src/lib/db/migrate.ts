import fs from "node:fs";
import path from "node:path";
import pg from "pg";

const MIGRATIONS_DIR = path.join(process.cwd(), "drizzle");

export type MigrationDirection = "up" | "down";

function migrationFiles(): string[] {
  return fs
    .readdirSync(MIGRATIONS_DIR)
    .filter((name) => /^\d+.+\.sql$/.test(name) && !name.endsWith(".down.sql"))
    .sort();
}

async function applySql(client: pg.Client, filePath: string): Promise<void> {
  const sqlText = fs.readFileSync(filePath, "utf8");
  await client.query("BEGIN");
  try {
    await client.query(sqlText);
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  }
}

export async function runMigrations(
  direction: MigrationDirection,
  connectionString: string,
  options?: { all?: boolean },
): Promise<string[]> {
  const client = new pg.Client({ connectionString });
  await client.connect();
  const appliedIds: string[] = [];
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        id text PRIMARY KEY,
        applied_at timestamptz NOT NULL DEFAULT now()
      )
    `);

    if (direction === "up") {
      for (const file of migrationFiles()) {
        const id = file.replace(/\.sql$/, "");
        const existing = await client.query("SELECT 1 FROM schema_migrations WHERE id = $1", [id]);
        if (existing.rowCount) continue;
        await applySql(client, path.join(MIGRATIONS_DIR, file));
        await client.query("INSERT INTO schema_migrations (id) VALUES ($1)", [id]);
        appliedIds.push(id);
        console.info(JSON.stringify({ level: "info", msg: "migration", direction, id }));
      }
      return appliedIds;
    }

    const applied = await client.query<{ id: string }>("SELECT id FROM schema_migrations ORDER BY id DESC");
    const targets = options?.all ? applied.rows : applied.rows.slice(0, 1);
    for (const row of targets) {
      const downFile = path.join(MIGRATIONS_DIR, `${row.id}.down.sql`);
      if (!fs.existsSync(downFile)) {
        throw new Error(`Missing down migration for ${row.id}`);
      }
      await applySql(client, downFile);
      await client.query("DELETE FROM schema_migrations WHERE id = $1", [row.id]);
      appliedIds.push(row.id);
      console.info(JSON.stringify({ level: "info", msg: "migration", direction, id: row.id }));
    }
    return appliedIds;
  } finally {
    await client.end();
  }
}
