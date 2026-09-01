import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? "github" : "list",
  use: { baseURL: "http://127.0.0.1:3022", trace: "retain-on-failure", screenshot: "only-on-failure" },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
    { name: "mobile", use: { ...devices["Pixel 7"] } },
  ],
  webServer: {
    command: "./node_modules/.bin/next build --webpack && node scripts/start-standalone.mjs",
    url: "http://127.0.0.1:3022/demo",
    timeout: 120_000,
    reuseExistingServer: !process.env.CI,
    env: {
      PORT: "3022",
      HOSTNAME: "127.0.0.1",
      BETTER_AUTH_SECRET: "relay-e2e-verification-secret-1234567890",
      DATABASE_URL: "postgresql://relay:relay@127.0.0.1:65432/relay",
    },
  },
});
