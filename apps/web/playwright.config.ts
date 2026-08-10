import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  // Playwright defaults to a single worker under CI, which cancels out
  // fullyParallel above. The runner has 4 cores and shares them with other CI
  // jobs, so 2 rather than the local default of one-per-core.
  workers: process.env.CI ? 2 : undefined,
  // open: "never" so a local failure doesn't try to launch a browser from the
  // terminal; junit feeds the CI merge-request widget.
  reporter: [["list"], ["html", { open: "never" }], ["junit", { outputFile: "junit-e2e.xml" }]],
  webServer: {
    command: "pnpm run dev",
    url: "http://localhost:5173",
    reuseExistingServer: !process.env.CI,
  },
  use: {
    baseURL: "http://localhost:5173",
    trace: "on-first-retry",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
    {
      name: "mobile-chromium",
      use: { ...devices["Pixel 7"] },
    },
    {
      name: "mobile-webkit",
      use: { ...devices["iPhone 15"] },
    },
  ],
});
