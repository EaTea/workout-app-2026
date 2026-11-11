/**
 * Remembers which program the athlete is running, under one app-wide
 * localStorage key (not per program, since it says which program's keys to use).
 *
 *   main.ts ──loadActiveProgramId──▶ id? ──chooseCatalogueEntry──▶ program to load
 *   (the program picker, a later step, calls saveActiveProgramId)
 */
import type { ProgramCatalogue, CatalogueEntry } from "../program/catalogue";
import type { ActiveProgramWire } from "./activeProgramWire";

/** The app-wide key holding the active program id. */
export const ACTIVE_PROGRAM_STORAGE_KEY = "workout-app.active-program";

/** The subset of Web Storage these functions need. */
export interface ActiveProgramStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

/** Result of `saveActiveProgramId`; `error` is a readable reason (e.g. storage full). */
export type SaveActiveProgramResult = { ok: true } | { ok: false; error: string };

/** Internal to wire: builds the JSON-ready object to store. */
export function activeProgramToWire(programId: string): ActiveProgramWire {
  return { version: 1, programId };
}

/**
 * Wire to internal: reads untrusted parsed JSON and returns the program id, or
 * undefined for anything that is not a version-1 object with a non-empty text id.
 */
export function activeProgramFromWire(json: unknown): string | undefined {
  if (typeof json !== "object" || json === null || Array.isArray(json)) return undefined;

  const { version, programId } = json as Partial<Record<keyof ActiveProgramWire, unknown>>;
  if (version !== 1) return undefined;
  if (typeof programId !== "string" || programId === "") return undefined;

  return programId;
}

/**
 * Reads the stored active program id. Never throws: a missing, unreadable
 * (blocked storage), unparsable or malformed value gives undefined.
 */
export function loadActiveProgramId(storage: Pick<ActiveProgramStorage, "getItem">): string | undefined {
  try {
    const storedText = storage.getItem(ACTIVE_PROGRAM_STORAGE_KEY);
    if (storedText === null) return undefined;

    return activeProgramFromWire(JSON.parse(storedText));
  } catch {
    return undefined;
  }
}

/** Stores the active program id. Never throws: quota or blocked storage returns `{ ok: false, error }`. */
export function saveActiveProgramId(storage: Pick<ActiveProgramStorage, "setItem">, programId: string): SaveActiveProgramResult {
  try {
    storage.setItem(ACTIVE_PROGRAM_STORAGE_KEY, JSON.stringify(activeProgramToWire(programId)));
    return { ok: true };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

/**
 * Picks the catalogue entry to run: the one whose id is stored, or the first
 * entry when nothing is stored or the stored id is not in the catalogue
 * (e.g. a program removed from programs.json). Pure, so main.ts's choice is testable.
 */
export function chooseCatalogueEntry(catalogue: ProgramCatalogue, storedProgramId: string | undefined): CatalogueEntry {
  const storedEntry = catalogue.entries.find((entry) => entry.programId === storedProgramId);
  return storedEntry ?? catalogue.entries[0]!;
}
