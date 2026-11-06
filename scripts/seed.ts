import { DEMO } from "../src/lib/dev/demo-data";
import { seedDemo } from "../src/lib/dev/seed";
import { closeDb } from "../src/lib/db/client";
import { loadEnvFile } from "../src/lib/env";

loadEnvFile();

if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL is required. Copy .env.example to .env.");
  process.exit(1);
}

seedDemo()
  .then(async (result) => {
    console.info(
      JSON.stringify({
        level: "info",
        msg: "seed",
        ...result,
        managerEmail: DEMO.manager.email,
        sellerEmail: DEMO.seller.email,
      }),
    );
    await closeDb();
  })
  .catch(async (error: unknown) => {
    console.error(error);
    await closeDb();
    process.exit(1);
  });
