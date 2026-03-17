import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["e2e/**/*.test.ts"],
    testTimeout: 30_000,
    hookTimeout: 60_000,
    globalSetup: ["e2e/global-setup.ts"],
  },
});
