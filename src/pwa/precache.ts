/**
 * Build-time helpers that turn the list of files Vite emitted into the
 * service worker's precache list and cache name. Used by the Vite plugin in
 * vite.config.ts; pure so they can be unit tested.
 */

import { createHash } from "node:crypto";
import type { ProgramCatalogue } from "../program/catalogue.ts";

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

/** One precached file: its relative URL (as in the precache list) and its exact bytes. */
export interface PrecachedFile {
  url: string;
  contents: Uint8Array;
}

/**
 * Derives a cache name from the precached files' contents. Hashing the bytes
 * (not just the names) means that a change to a file with a stable name
 * (index.html, program.json, an icon, the manifest) still produces a new
 * cache name, so the new worker installs into a fresh cache and the old one
 * is deleted on activate. Files are sorted by URL so the order they were read
 * in doesn't matter; each URL and length is hashed too so that moving bytes
 * between files changes the name.
 *
 * @param files every precached file with its bytes
 */
export function buildCacheName(files: PrecachedFile[]): string {
  const hash = createHash("sha256");
  const sortedFiles = [...files].sort((first, second) => (first.url < second.url ? -1 : first.url > second.url ? 1 : 0));

  for (const file of sortedFiles) {
    hash.update(`${file.url}\n${file.contents.length}\n`);
    hash.update(file.contents);
  }

  return `explosive-endurance-${hash.digest("hex").slice(0, 10)}`;
}

/**
 * The plain file names of every program file the catalogue lists (e.g.
 * ["program.json", "steady-strength.json"]). The build bakes this list into
 * sw.js so the worker answers exactly these files network-first (see
 * `chooseStrategy`); programs.json itself is not in it. Each catalogue
 * `programUrl` is "./<file name>" (the catalogue parser guarantees a plain
 * file name), so this only drops the "./".
 *
 * @param catalogue the parsed public/programs.json
 */
export function programFileNames(catalogue: ProgramCatalogue): string[] {
  return catalogue.entries.map((entry) => entry.programUrl.replace(/^\.\//, ""));
}
