import { ensureDatabase } from "../src/lib/db/create-database";
import { loadEnvFile } from "../src/lib/env";

loadEnvFile();

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.error("DATABASE_URL is required. Copy .env.example to .env.");
  process.exit(1);
}

ensureDatabase(databaseUrl)
  .then(() => {
    console.info(JSON.stringify({ level: "info", msg: "database", result: "ready" }));
  })
  .catch((error: unknown) => {
    console.error(error);
    process.exit(1);
  });
