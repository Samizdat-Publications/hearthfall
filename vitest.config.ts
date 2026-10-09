import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["packages/*/test/**/*.test.ts", "apps/*/test/**/*.test.ts", "tools/**/*.test.mjs"],
    environment: "node",
    pool: "threads",
    testTimeout: 20000,
  },
});
