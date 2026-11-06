import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const root = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      "@": path.join(root, "src"),
    },
  },
  test: {
    environment: "node",
    fileParallelism: false,
    maxWorkers: 1,
    globalSetup: ["./tests/global-setup.ts"],
    setupFiles: ["./tests/setup.ts"],
    env: {
      DATABASE_URL: "postgres://closecue:closecue@127.0.0.1:5432/closecue_test",
      MOCK_AUTH: "true",
    },
    hookTimeout: 30000,
    testTimeout: 20000,
  },
});
