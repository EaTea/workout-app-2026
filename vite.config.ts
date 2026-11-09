import { defineConfig } from "vitest/config";

export default defineConfig({
  // Relative base: the app is deployed to a sub-path on GitHub Pages
  // (https://eatea.github.io/workout-app-2026/), but we also want
  // `vite preview` and `vite dev` to work from "/" without any extra
  // configuration. "./" makes every asset URL relative to index.html, so
  // both locations work.
  base: "./",
  test: {
    // Only unit tests live under src/; e2e/ belongs to Playwright.
    include: ["src/**/*.test.ts"],
  },
});
