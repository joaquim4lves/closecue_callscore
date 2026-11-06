import { ensureDatabase } from "../src/lib/db/create-database";
import { runMigrations } from "../src/lib/db/migrate";

const TEST_DATABASE_URL = "postgres://closecue:closecue@127.0.0.1:5432/closecue_test";
export const MIGRATE_DATABASE_URL = "postgres://closecue:closecue@127.0.0.1:5432/closecue_migrate";

export default async function setup(): Promise<void> {
  await ensureDatabase(TEST_DATABASE_URL);
  await ensureDatabase(MIGRATE_DATABASE_URL);
  await runMigrations("up", TEST_DATABASE_URL);
  await runMigrations("up", MIGRATE_DATABASE_URL);
}
