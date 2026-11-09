/**
 * Build-time helpers that turn the list of files Vite emitted into the
 * service worker's precache list and cache name. Used by the Vite plugin in
 * vite.config.ts; pure so they can be unit tested.
 */

import { createHash } from "node:crypto";

/** Files that are never precached: the worker itself and source maps. */
function isPrecachable(fileName: string): boolean {
  return fileName !== "sw.js" && !fileName.endsWith(".map");
}

/**
 * Builds the precache list from the emitted bundle file names (paths
 * relative to dist). The app shell "index.html" is listed as "./" because
 * that is the URL a launch from the home screen requests. URLs are relative
 * so the worker resolves them against its own location, which works under
 * the GitHub Pages sub-path.
 *
 * @param emittedFileNames file names relative to the output directory
 * @returns sorted, de-duplicated relative URLs
 */
export function buildPrecacheList(emittedFileNames: string[]): string[] {
  const urls = emittedFileNames.filter(isPrecachable).map((fileName) => (fileName === "index.html" ? "./" : fileName));
  return [...new Set(urls)].sort();
}

/**
 * Derives a cache name from the precache list. Hashed assets change name
 * when their content changes, so a new build gets a new cache name and the
 * old cache is deleted on activate. program.json and the icons have stable
 * names, but they are refreshed by network-first / the next precache, so
 * the name only needs to track the hashed assets.
 *
 * @param precacheUrls the list from `buildPrecacheList`
 */
export function buildCacheName(precacheUrls: string[]): string {
  const digest = createHash("sha256").update(precacheUrls.join("\n")).digest("hex").slice(0, 10);
  return `explosive-endurance-${digest}`;
}
