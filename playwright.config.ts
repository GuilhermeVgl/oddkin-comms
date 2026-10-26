import { defineConfig, devices } from "@playwright/test";

if (!process.env.TEST_DATABASE_URL) {
  throw new Error("TEST_DATABASE_URL is required for E2E tests");
}

const webPort = Number(process.env.E2E_WEB_PORT ?? 5173);
const apiPort = Number(process.env.E2E_API_PORT ?? 8080);

export default defineConfig({
  testDir: "./tests/e2e",
  retries: 0,
  reporter: [["list"], ["html", { open: "never" }]],
  outputDir: "test-results",
  use: {
    baseURL: `http://127.0.0.1:${webPort}`,
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"],
        ...(process.env.E2E_CHROME_PATH
          ? { launchOptions: { executablePath: process.env.E2E_CHROME_PATH } }
          : {}),
      },
    },
    { name: "firefox", use: { ...devices["Desktop Firefox"] } },
  ],
  webServer: [
    {
      command: "go run ./cmd/api",
      url: `http://127.0.0.1:${apiPort}/api/v1/health/live`,
      reuseExistingServer: false,
      env: {
        DATABASE_URL: process.env.TEST_DATABASE_URL,
        HTTP_ADDR: `127.0.0.1:${apiPort}`,
        INVITATION_DELIVERY_KEY: "synthetic-e2e-invite-key-0000001",
      },
      timeout: 120_000,
    },
    {
      command: `corepack pnpm --filter @crewstead/web exec vite --host 127.0.0.1 --strictPort --port ${webPort}`,
      url: `http://127.0.0.1:${webPort}`,
      reuseExistingServer: false,
      env: { VITE_API_PROXY_TARGET: `http://127.0.0.1:${apiPort}` },
      timeout: 120_000,
    },
  ],
});
