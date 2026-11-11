import { parseCatalogue, type ProgramCatalogue } from "./catalogue";
import { parseProgram, type ParseResult } from "./parse";

/** Describes a caught value for a message. */
function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Fetches `url` and returns its parsed JSON. Shared by `loadProgram` and
 * `loadCatalogue` so every failure names the file Ed has to fix: an HTTP error
 * already says `Could not load <url>: HTTP <status>`, and a syntax error
 * (a stray comma in a hand-edited file) is rethrown as `<url>: <message>`.
 */
async function fetchJson(url: string): Promise<unknown> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Could not load ${url}: HTTP ${response.status}`);
  }

  try {
    return await response.json();
  } catch (error) {
    throw new Error(`${url}: ${describeError(error)}`);
  }
}

/**
 * Runs `parse` on the contents of `url`, rethrowing its failure with the file
 * name in front (`<url>: <path-style message>`), so the startup error card
 * says which file the message is about. Used by `loadProgram` and
 * `loadCatalogue`.
 */
function parseNamingFile<Parsed>(url: string, contents: unknown, parse: (contents: unknown) => Parsed): Parsed {
  try {
    return parse(contents);
  } catch (error) {
    throw new Error(`${url}: ${describeError(error)}`);
  }
}

/**
 * Fetches a program file (whichever URL it is given, e.g. the active catalogue
 * entry's `programUrl`) and turns it into the internal `Program` plus any
 * warnings (unknown fields) for the app to show.
 *
 * Called once at app startup by `main.ts`, after `loadCatalogue` and the choice
 * of the active entry; the default URL is relative so it works both on the dev
 * server and under the GitHub Pages sub-path. Throws if the request fails, the
 * JSON is malformed or `parseProgram` rejects the contents; every message
 * names the file, so the caller can show it to Ed.
 */
export async function loadProgram(url = "./program.json"): Promise<ParseResult> {
  const contents = await fetchJson(url);
  return parseNamingFile(url, contents, parseProgram);
}

/**
 * Fetches programs.json and turns it into the internal `ProgramCatalogue`.
 *
 * Called once at app startup, before `loadProgram`, to learn which program
 * files exist. The default URL is relative for the same reason as
 * `loadProgram`'s. Throws if the request fails (including a missing file), the
 * JSON is malformed or `parseCatalogue` rejects the contents; every message
 * names the file, so the caller can show it.
 */
export async function loadCatalogue(url = "./programs.json"): Promise<ProgramCatalogue> {
  const contents = await fetchJson(url);
  return parseNamingFile(url, contents, parseCatalogue);
}
