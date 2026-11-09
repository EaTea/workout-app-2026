import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { defineConfig, type Plugin } from "vitest/config";
import { buildCacheName, buildPrecacheList } from "./src/pwa/precache.ts";
import { renderServiceWorker } from "./src/pwa/serviceWorkerSource.ts";

/** Lists every file under a directory as paths relative to it, using "/" separators. */
function listFilesRecursively(directory: string, prefix = ""): string[] {
  return readdirSync(join(directory, prefix), { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory() ? listFilesRecursively(directory, `${prefix}${entry.name}/`) : [`${prefix}${entry.name}`],
  );
}

/**
 * Vite plugin that writes dist/sw.js once the output folder is complete.
 * It runs in writeBundle (not generateBundle) because the public/ files
 * (icons, manifest, program.json) are copied into dist only after the bundle
 * is generated, and they must be in the precache list too.
 */
function serviceWorkerPlugin(): Plugin {
  let outputDirectory = "dist";

  return {
    name: "write-service-worker",
    apply: "build",
    configResolved(config) {
      outputDirectory = resolve(config.root, config.build.outDir);
    },
    writeBundle() {
      const precacheUrls = buildPrecacheList(listFilesRecursively(outputDirectory));

      // The cache name comes from the files' bytes, so any content change
      // (even to a stable file name like program.json) makes a new cache.
      // "./" is the app shell, which lives on disk as index.html.
      const precachedFiles = precacheUrls.map((url) => ({
        url,
        contents: readFileSync(join(outputDirectory, url === "./" ? "index.html" : url)),
      }));

      writeFileSync(join(outputDirectory, "sw.js"), renderServiceWorker(buildCacheName(precachedFiles), precacheUrls));
    },
  };
}

export default defineConfig({
  // Relative base: the app is deployed to a sub-path on GitHub Pages
  // (https://eatea.github.io/workout-app-2026/), but we also want
  // `vite preview` and `vite dev` to work from "/" without any extra
  // configuration. "./" makes every asset URL relative to index.html, so
  // both locations work.
  base: "./",
  plugins: [serviceWorkerPlugin()],
  test: {
    // Only unit tests live under src/; e2e/ belongs to Playwright.
    include: ["src/**/*.test.ts"],
  },
});
