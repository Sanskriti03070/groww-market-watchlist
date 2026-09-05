import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const rootDir = fileURLToPath(new URL(".", import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      "@": rootDir,
    },
  },
  test: {
    environment: "node",
    include: ["lib/**/*.test.ts", "app/**/*.test.ts"],
    globalSetup: ["./lib/__tests__/global-setup.ts"],
    // Tests exercise real concurrent Postgres transactions within a test;
    // running test files themselves one at a time keeps that deterministic
    // and keeps everything on one shared embedded Postgres instance.
    fileParallelism: false,
    testTimeout: 20_000,
    hookTimeout: 60_000,
  },
});
