import { parseCatalogue, type CatalogueEntry, type ProgramCatalogue } from "./catalogue";
import type { Program, ProgramWarning } from "./model";
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

/** How one catalogue program's file turned out: parsed, or broken with a readable reason (which already names the file). */
export type CatalogueProgramOutcome =
  | { kind: "loaded"; program: Program; warnings: ProgramWarning[] }
  | { kind: "broken"; error: string };

/** One catalogue entry together with what loading its file gave. */
export interface LoadedCatalogueEntry {
  entry: CatalogueEntry;
  outcome: CatalogueProgramOutcome;
}

/**
 * Loads every program file the catalogue lists, in parallel, and never
 * rejects: a file that can't be fetched or parsed becomes a "broken" outcome
 * carrying the error message (which names the file), so one bad program file
 * disables only its own picker card instead of stopping the app. The result
 * keeps catalogue order.
 *
 *   catalogue.entries ──▶ loadProgram(each, in parallel) ──▶ LoadedCatalogueEntry[]
 *                                  │ throws
 *                                  ▼
 *                         { kind: "broken", error }
 *
 * Called once at startup by main.ts; the result feeds `chooseStartup`, the
 * program picker and the import messages (display names). `loadOne` is
 * injectable for tests.
 */
export async function loadAllPrograms(
  catalogue: ProgramCatalogue,
  loadOne: (url: string) => Promise<ParseResult> = loadProgram,
): Promise<LoadedCatalogueEntry[]> {
  return Promise.all(
    catalogue.entries.map(async (entry): Promise<LoadedCatalogueEntry> => {
      try {
        const { program, warnings } = await loadOne(entry.programUrl);
        return { entry, outcome: { kind: "loaded", program, warnings } };
      } catch (error) {
        return { entry, outcome: { kind: "broken", error: describeError(error) } };
      }
    }),
  );
}
