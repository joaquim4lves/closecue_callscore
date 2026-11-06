import { afterAll } from "vitest";
import { closeDb } from "../src/lib/db/client";

afterAll(async () => {
  await closeDb();
});
