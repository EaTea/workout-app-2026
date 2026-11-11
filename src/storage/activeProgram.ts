/**
 * Remembers which program the athlete is running, under one app-wide
 * localStorage key (not per program, since it says which program's keys to use).
 *
 *   main.ts ──loadActiveProgramId──▶ id? ──chooseStartup──▶ run a program / error card / picker
 *   (the program picker calls saveActiveProgramId, then the page reloads)
 */
import { VERSION_1_PROGRAM_ID } from "../export/wire";
import { logFromWire } from "../log/wire";
import type { LoadedCatalogueEntry } from "../program/load";
import { loadSettings } from "../settings/storage";
import type { ActiveProgramWire } from "./activeProgramWire";
import type { ProgramStorageKeys } from "./programKeys";

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

/** What the app does at startup, decided by `chooseStartup`. */
export type StartupChoice =
  /** Run this program (its file loaded). */
  | { kind: "run"; programId: string }
  /** The chosen program's file is broken: show its error card with a "Switch program" link. */
  | { kind: "broken"; programId: string; error: string }
  /** No usable choice: show the program picker as the whole app. */
  | { kind: "picker" };

/**
 * Decides what to open at startup. Pure, so every branch is unit tested.
 * `loadedPrograms` is every catalogue program in catalogue order, loaded or
 * broken (so "in the catalogue" means "in this list").
 *
 *   stored id, program loaded ───────────────▶ run it
 *   stored id, program broken ───────────────▶ error card + "Switch program"
 *   stored id, not in the catalogue ─────────▶ picker
 *   nothing stored:
 *       Explosive Endurance listed AND it has saved data
 *         (hasExplosiveEnduranceData)
 *            loaded ────────────────────────▶ run it (nothing is written, so
 *            broken ────────────────────────▶ error card   Ed's phone is unchanged)
 *       otherwise ───────────────────────────▶ picker
 *
 * "Nothing stored" is deliberately different from "stored id not in the
 * catalogue": the first means a fresh install or Ed's phone from before
 * programs existed, the second a program that was removed from programs.json.
 * Because of the data rule, the order of programs.json does not matter.
 *
 * @param loadedPrograms every catalogue entry with the outcome of loading its file
 * @param storedProgramId the id saved by the picker, or undefined when nothing is saved
 * @param hasExplosiveEnduranceData whether Explosive Endurance's own keys hold a start date, a logged session or a saved max
 */
export function chooseStartup(
  loadedPrograms: LoadedCatalogueEntry[],
  storedProgramId: string | undefined,
  hasExplosiveEnduranceData: boolean,
): StartupChoice {
  let programIdToOpen: string | undefined;

  if (storedProgramId !== undefined) {
    programIdToOpen = storedProgramId;
  } else if (hasExplosiveEnduranceData) {
    programIdToOpen = VERSION_1_PROGRAM_ID;
  }

  const loadedProgram = loadedPrograms.find((candidate) => candidate.entry.programId === programIdToOpen);
  if (loadedProgram === undefined) return { kind: "picker" };

  if (loadedProgram.outcome.kind === "broken") {
    return { kind: "broken", programId: loadedProgram.entry.programId, error: loadedProgram.outcome.error };
  }
  return { kind: "run", programId: loadedProgram.entry.programId };
}

/**
 * Whether a program's own storage keys hold anything the athlete made: a start
 * date, any saved max, any logged session, or a stored log that can't be read
 * (it was data once, so it must not be hidden behind the picker). main.ts asks
 * this for Explosive Endurance when no program has been chosen, so a phone
 * that used the app before programs existed keeps opening it.
 *
 * It reads the log with `logFromWire` directly rather than `loadLog`, because
 * `loadLog` copies unreadable text to a `.corrupt-` key: the real load, once
 * the program runs, should be the only one to do that. Never throws.
 */
export function hasSavedProgramData(storage: Storage, keys: ProgramStorageKeys): boolean {
  const settings = loadSettings(storage, keys);
  if (settings.startDate !== null || Object.keys(settings.maxReps).length > 0) return true;

  let storedLogText: string | null;
  try {
    storedLogText = storage.getItem(keys.log);
  } catch {
    return false; // blocked storage: nothing can be known, and nothing can be shown either
  }
  if (storedLogText === null) return false;

  try {
    const { log, problems } = logFromWire(JSON.parse(storedLogText));
    return Object.keys(log.sessions).length > 0 || problems.messages.length > 0;
  } catch {
    // Text is there but unreadable: it was somebody's data once.
    return true;
  }
}
