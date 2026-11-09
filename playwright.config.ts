import { defineConfig, devices } from "@playwright/test";

// End-to-end tests run against the production build served by `vite preview`,
// emulating an iPhone 13 since this is a mobile-first app.
export default defineConfig({
  testDir: "./e2e",
  use: {
    ...devices["iPhone 13"],
    // The iPhone profile defaults to WebKit; use Chromium (the only browser
    // we install) with the same viewport, touch and user-agent emulation.
    defaultBrowserType: "chromium",
    baseURL: "http://localhost:4173",
  },
  webServer: {
    command: "npm run build && vite preview --port 4173 --strictPort",
    url: "http://localhost:4173",
    reuseExistingServer: false,
  },
});
