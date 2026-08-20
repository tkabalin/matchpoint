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
  // Both halves of the app, because the suite runs against the real API rather than
  // against mocked routes (docs/testing.md § E2E tests). Vite's /api proxy already
  // points at port 8000, so nothing in the app is configured differently for a test.
  webServer: [
    {
      command: "../../scripts/e2e-api.sh",
      url: "http://localhost:8000/health",
      // Never reused, unlike Vite below: an API already on this port is a dev one, and
      // it has a different database, a different mail sender and production-sized rate
      // limits. Playwright then fails naming the busy port, which is the honest answer.
      reuseExistingServer: false,
      // The script recreates a database and migrates it before uvicorn binds, and on a
      // cold checkout `uv run` installs the API's dependencies first.
      timeout: 180_000,
    },
    {
      command: "pnpm run dev",
      url: "http://localhost:5173",
      reuseExistingServer: !process.env.CI,
    },
    {
      // The production build, for the offline project below: `vite dev` never
      // registers a service worker, so the offline shell only exists here.
      // --strictPort because a drifted port would silently retarget the specs.
      command: "pnpm run build && pnpm run preview -- --strictPort --port 4173",
      url: "http://localhost:4173",
      // Never reused, unlike Vite above: reuse would skip the build as well as the
      // server, so a preview left over from an older checkout would serve a stale
      // service worker to the one project that exists to exercise it.
      reuseExistingServer: false,
      timeout: 180_000,
    },
  ],
  use: {
    baseURL: "http://localhost:5173",
    trace: "on-first-retry",
  },
  projects: [
    // One sign-up for the whole run rather than one per test: the flow costs an Argon2
    // hash and a round trip through three endpoints, and every spec that needs a coach
    // needs the same one. `dependencies` is what makes it finish before they start.
    {
      name: "setup",
      testMatch: /.*\.setup\.ts/,
    },
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
      dependencies: ["setup"],
      testIgnore: /offline\.spec\.ts/,
    },
    {
      name: "mobile-chromium",
      use: { ...devices["Pixel 7"] },
      dependencies: ["setup"],
      testIgnore: /offline\.spec\.ts/,
    },
    {
      name: "mobile-webkit",
      use: { ...devices["iPhone 15"] },
      dependencies: ["setup"],
      testIgnore: /offline\.spec\.ts/,
    },
    // The offline suite runs against the production build (port 4173), the only
    // place the service worker exists, and only in Chromium: the offline shell is
    // one implementation, and setOffline emulation is most faithful there. The
    // setup coach's cookie is host-scoped, so the session works on this port too.
    {
      name: "offline-chromium",
      testMatch: /offline\.spec\.ts/,
      use: { ...devices["Desktop Chrome"], baseURL: "http://localhost:4173" },
      dependencies: ["setup"],
    },
  ],
});
