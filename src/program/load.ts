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
