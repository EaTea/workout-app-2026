/**
 * The catalogue of programs the app can run: internal type plus the parser
 * that turns the untrusted contents of programs.json into it.
 *
 * Every failure is an Error whose message starts with a path-style location,
 * like `parse.ts` does, e.g.
 *   programs[1].id: "Steady Strength" must use only lowercase letters, digits and hyphens
 * because Ed sees that message when he edits programs.json by hand.
 *
 *   unknown ──parseCatalogue──▶ ProgramCatalogue
 *   (loaded by load.ts's loadCatalogue; main.ts uses the stored choice if listed, else the first entry)
 */
import type { CatalogueEntryWire, CatalogueWire } from "./catalogueWire";

/** One program the app can run, in the shape the rest of the app uses. */
export interface CatalogueEntry {
  /** Stable id; later steps build localStorage keys from it, hence the strict format. */
  programId: string;
  /** URL of the program file, relative to the app (e.g. "./program.json"), ready for `loadProgram`. */
  programUrl: string;
}

/** All programs in the order programs.json lists them (never empty). */
export interface ProgramCatalogue {
  entries: CatalogueEntry[];
}

/** Ids are lowercase letters, digits and hyphens, e.g. "steady-strength". */
export const PROGRAM_ID_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/;

/** A plain file name (no slashes, no "..", no leading dot) ending in ".json". */
const PROGRAM_FILE_PATTERN = /^[A-Za-z0-9_][A-Za-z0-9_.-]*\.json$/;

/** Builds the "path: problem" error every catalogue failure goes through. */
function fail(path: string, problem: string): never {
  throw new Error(`${path}: ${problem}`);
}

/** Describes a value for error messages, e.g. `"abc"`, `7`, `an array`. */
function describe(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return "an array";
  if (typeof value === "object") return "an object";
  return typeof value === "string" ? JSON.stringify(value) : String(value);
}

/** Reads a required text field of a catalogue entry or fails naming its path. */
function readRequiredText(entry: Record<string, unknown>, key: string, path: string): string {
  const value = entry[key];
  if (typeof value !== "string" || value === "") {
    fail(`${path}.${key}`, `expected text but found ${value === undefined ? "nothing (field is missing)" : describe(value)}`);
  }
  return value;
}

/**
 * Maps one wire entry to a `CatalogueEntry`, validating the id format and the
 * file name. Called by `parseCatalogue` for each element of `programs`.
 *
 * @param wireEntry the untrusted entry (expected to look like `CatalogueEntryWire`)
 * @param path e.g. "programs[0]", used as the start of every error message
 */
function parseCatalogueEntry(wireEntry: unknown, path: string): CatalogueEntry {
  if (typeof wireEntry !== "object" || wireEntry === null || Array.isArray(wireEntry)) {
    fail(path, `expected an object but found ${describe(wireEntry)}`);
  }
  const record = wireEntry as Record<string, unknown>;

  const id = readRequiredText(record, "id", path);
  if (!PROGRAM_ID_PATTERN.test(id)) {
    fail(`${path}.id`, `${JSON.stringify(id)} must use only lowercase letters, digits and hyphens (like "steady-strength")`);
  }

  const file = readRequiredText(record, "file", path);
  if (!PROGRAM_FILE_PATTERN.test(file) || file.includes("..")) {
    fail(`${path}.file`, `${JSON.stringify(file)} must be a plain file name ending in .json (no folders, no "..")`);
  }

  const wire: CatalogueEntryWire = { id, file };
  return { programId: wire.id, programUrl: `./${wire.file}` };
}

/**
 * Turns the untrusted contents of programs.json into a `ProgramCatalogue`.
 * Throws a path-style Error when `programs` is missing or empty, an entry is
 * malformed, an id is badly formed, or two entries share an id.
 *
 * @param json whatever `response.json()` returned (expected to look like `CatalogueWire`)
 */
export function parseCatalogue(json: unknown): ProgramCatalogue {
  if (typeof json !== "object" || json === null || Array.isArray(json)) {
    fail("programs.json", `expected an object but found ${describe(json)}`);
  }
  const wire = json as Partial<Record<keyof CatalogueWire, unknown>>;

  if (!Array.isArray(wire.programs)) {
    fail("programs", `expected a list but found ${wire.programs === undefined ? "nothing (field is missing)" : describe(wire.programs)}`);
  }
  if (wire.programs.length === 0) {
    fail("programs", "the list is empty, so there is no program to run");
  }

  const entries: CatalogueEntry[] = [];
  const firstIndexOfId = new Map<string, number>();

  wire.programs.forEach((wireEntry, index) => {
    const entry = parseCatalogueEntry(wireEntry, `programs[${index}]`);

    const earlierIndex = firstIndexOfId.get(entry.programId);
    if (earlierIndex !== undefined) {
      fail(`programs[${index}].id`, `duplicate id ${JSON.stringify(entry.programId)} (already used by programs[${earlierIndex}])`);
    }
    firstIndexOfId.set(entry.programId, index);

    entries.push(entry);
  });

  return { entries };
}
