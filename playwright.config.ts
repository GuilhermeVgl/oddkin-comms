import { defineConfig, devices } from "@playwright/test";

if (!process.env.TEST_DATABASE_URL) {
  throw new Error("TEST_DATABASE_URL is required for E2E tests");
}

export default defineConfig({
  testDir: "./tests/e2e",
  retries: 0,
  reporter: [["list"], ["html", { open: "never" }]],
  outputDir: "test-results",
  use: {
    baseURL: "http://127.0.0.1:5173",
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
  },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
    { name: "firefox", use: { ...devices["Desktop Firefox"] } },
  ],
  webServer: [
    {
      command: "go run ./cmd/api",
      url: "http://127.0.0.1:8080/api/v1/health/live",
      reuseExistingServer: false,
      env: {
        DATABASE_URL: process.env.TEST_DATABASE_URL,
        INVITATION_DELIVERY_KEY: "synthetic-e2e-invite-key-0000001",
      },
      timeout: 120_000,
    },
    {
      command:
        "corepack pnpm --filter @oddkin/web exec vite --host 127.0.0.1 --strictPort --port 5173",
      url: "http://127.0.0.1:5173",
      reuseExistingServer: false,
      timeout: 120_000,
    },
  ],
});
