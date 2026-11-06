import { runMigrations } from "../src/lib/db/migrate";
import { loadEnvFile } from "../src/lib/env";

loadEnvFile();

const direction = process.argv[2];
if (direction !== "up" && direction !== "down") {
  console.error("Usage: tsx scripts/migrate.ts up|down [--all]");
  process.exit(1);
}

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.error("DATABASE_URL is required. Copy .env.example to .env.");
  process.exit(1);
}

runMigrations(direction, databaseUrl, { all: process.argv.includes("--all") })
  .then((ids) => {
    if (ids.length === 0) {
      console.info(JSON.stringify({ level: "info", msg: "migration", direction, result: "noop" }));
    }
  })
  .catch((error: unknown) => {
    console.error(error);
    process.exit(1);
  });
