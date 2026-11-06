import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./schema";

export type Database = NodePgDatabase<typeof schema>;

let pool: pg.Pool | null = null;
let database: Database | null = null;

export function getDb(): Database {
  if (!database || !pool) {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) {
      throw new Error("DATABASE_URL is required");
    }
    pool = new pg.Pool({ connectionString, max: 10 });
    database = drizzle(pool, { schema });
  }
  return database;
}

export async function closeDb(): Promise<void> {
  if (pool) {
    await pool.end();
  }
  pool = null;
  database = null;
}
