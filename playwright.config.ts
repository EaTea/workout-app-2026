import { defineConfig, devices } from "@playwright/test";

// End-to-end tests run against the production build served by `vite preview`,
// emulating an iPhone 13 since this is a mobile-first app.
//
// On CI (the `CI` env var is set by GitHub Actions) the config is stricter:
// a stray `test.only` fails the run, nothing is retried (so flaky tests show
// up instead of being hidden), and an HTML report is written to
// playwright-report/ for the workflow to upload when a run fails.
const isCI = Boolean(process.env.CI);

const baseURL = "http://localhost:4173";

// A fresh browser (no saved data) opens the program picker, not the overview.
// Most specs are about Explosive Endurance, so by default every test starts
// with that program already chosen, exactly as if it had been picked once.
// A spec about the first visit opts out with
//   test.use({ storageState: { cookies: [], origins: [] } });
const explosiveEnduranceChosen = {
  cookies: [],
  origins: [
    {
      origin: baseURL,
      localStorage: [{ name: "workout-app.active-program", value: JSON.stringify({ version: 1, programId: "explosive-endurance" }) }],
    },
  ],
};

export default defineConfig({
  testDir: "./e2e",
  forbidOnly: isCI,
  retries: 0,
  reporter: isCI
    ? [["github"], ["html", { open: "never" }]]
    : "list",
  use: {
    ...devices["iPhone 13"],
    // The iPhone profile defaults to WebKit; use Chromium (the only browser
    // we install) with the same viewport, touch and user-agent emulation.
    defaultBrowserType: "chromium",
    baseURL,
    storageState: explosiveEnduranceChosen,
    // The production build registers a service worker; block it by default so
    // it can't cache or bypass page.route() mocks. e2e/offline.spec.ts opts in.
    serviceWorkers: "block",
  },
  webServer: {
    command: "npm run build && vite preview --port 4173 --strictPort",
    url: baseURL,
    reuseExistingServer: false,
  },
});
