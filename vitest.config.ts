import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    setupFiles: ["./vitest.setup.ts"],
    include: ["apps/**/*.test.{ts,tsx}", "packages/**/*.test.{ts,tsx}"],
    coverage: {
      provider: "v8",
      include: ["apps/*/src/**/*.{ts,tsx}", "packages/*/src/**/*.{ts,tsx}"],
      exclude: [
        "**/*.gen.{ts,tsx}",
        "**/*.test.{ts,tsx}",
        "apps/web/src/main.tsx",
      ],
      thresholds: {
        statements: 80,
        branches: 80,
      },
    },
  },
});
