import { parseCatalogue, type ProgramCatalogue } from "./catalogue";
import { parseProgram, type ParseResult } from "./parse";

/**
 * Fetches program.json and turns it into the internal `Program` plus any
 * warnings (unknown fields) for the app to show.
 *
 * Called once at app startup; the default URL is relative so it works both on
 * the dev server and under the GitHub Pages sub-path. Throws if the request
 * fails or if `parseProgram` rejects the contents, so the caller can show the
 * message to Ed.
 */
export async function loadProgram(url = "./program.json"): Promise<ParseResult> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Could not load ${url}: HTTP ${response.status}`);
  }
  return parseProgram(await response.json());
}

/**
 * Fetches programs.json and turns it into the internal `ProgramCatalogue`.
 *
 * Called once at app startup, before `loadProgram`, to learn which program
 * files exist. The default URL is relative for the same reason as
 * `loadProgram`'s. Throws if the request fails (including a missing file) or
 * `parseCatalogue` rejects the contents, so the caller can show the message.
 */
export async function loadCatalogue(url = "./programs.json"): Promise<ProgramCatalogue> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Could not load ${url}: HTTP ${response.status}`);
  }
  return parseCatalogue(await response.json());
}
