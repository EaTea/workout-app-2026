import type { MaxHistoryEntry, TrainingSettings } from "./model";
import { withLatestMax } from "./maxHistory";
import { loadMaxHistory, saveMaxHistory } from "./maxHistoryStorage";
import { toDayNumber } from "../program/calendar";
import type { ProgramStorageKeys } from "../storage/programKeys";

/**
 * Settings persistence. The wire type (`SettingsWire`) is exactly what is
 * stored in localStorage; the internal type (`TrainingSettings`) is what the
 * rest of the app uses. Only `settingsFromWire` / `settingsToWire` convert
 * between them. The app shell calls `loadSettings` at startup and the
 * settings screen calls `saveSettings`.
 */

// The settings JSON (`SettingsWire`) lives under `keys.settings` of the active
// program's `ProgramStorageKeys`; the max history under `keys.maxHistory`.

/** Format v1: start date and maxes only. Still readable; never written any more. */
export interface SettingsWireV1 {
  version: 1;
  startDate: string | null;
  maxReps: Record<string, number>;
}

/** Format v2 (current): v1 plus the date each max was saved. */
export interface SettingsWireV2 {
  version: 2;
  startDate: string | null;
  maxReps: Record<string, number>;
  maxSavedOn: Record<string, string>;
}

/**
 * Every settings shape we can read. v2 is the current (and only written)
 * format; the max history is NOT part of it, it has its own storage key (see
 * maxHistoryStorage.ts), so older copies of the app keep reading settings
 * correctly. Bump `version` if the shape ever changes incompatibly.
 */
export type SettingsWire = SettingsWireV1 | SettingsWireV2;

/** What a fresh install (or unreadable stored data) looks like. */
function defaultSettings(): TrainingSettings {
  return { startDate: null, maxReps: {}, maxSavedOn: {}, maxHistory: {} };
}

/**
 * Converts untrusted stored settings, plus the separately stored max history,
 * into internal settings. Tolerant by design: anything missing, malformed or
 * from an unknown version yields defaults for that part rather than an error,
 * so a corrupt entry never bricks the app.
 *
 *   settings key (v1/v2) --settingsFromWire--+
 *                                            +--> TrainingSettings
 *   history key (already parsed) ------------+
 *
 * The settings' latest max per exercise (`maxReps` + `maxSavedOn`) is
 * reconciled into the history: if it is not already an entry, it is added
 * (an older copy of the app may have saved a max without knowing the history).
 * Nothing in the history is ever removed here, and a cleared max keeps its
 * history. With no history at all (v1, or a v2 written before the history key
 * existed) each max becomes the only entry, dated `maxSavedOn` or unknown.
 */
export function settingsFromWire(wire: unknown, storedHistory: Record<string, MaxHistoryEntry[]> = {}): TrainingSettings {
  if (typeof wire !== "object" || wire === null) {
    return { ...defaultSettings(), maxHistory: storedHistory };
  }

  const record = wire as Record<string, unknown>;
  if (record.version !== 1 && record.version !== 2) {
    return { ...defaultSettings(), maxHistory: storedHistory };
  }

  const maxReps = validMaxReps(record.maxReps);
  // v1 has no dates field, so it reads as "no max has a known save date".
  const maxSavedOn = record.version === 2 ? validMaxSavedOn(record.maxSavedOn, maxReps) : {};

  return {
    startDate: validStartDate(record.startDate),
    maxReps,
    maxSavedOn,
    maxHistory: reconcileHistory(storedHistory, maxReps, maxSavedOn),
  };
}

/**
 * Returns a copy of `history` in which every exercise that has a max also has
 * that max (and its date) as an entry. Exercises without a max keep their
 * history untouched (rule: clearing a max never discards its history).
 */
function reconcileHistory(
  history: Record<string, MaxHistoryEntry[]>,
  maxReps: Record<string, number>,
  maxSavedOn: Record<string, string>,
): Record<string, MaxHistoryEntry[]> {
  const reconciled: Record<string, MaxHistoryEntry[]> = {};
  for (const [exerciseId, entries] of Object.entries(history)) {
    reconciled[exerciseId] = [...entries];
  }

  for (const [exerciseId, reps] of Object.entries(maxReps)) {
    // Own-property checks: an exercise id like "constructor" must not find Object.prototype members.
    const existingEntries = Object.hasOwn(reconciled, exerciseId) ? (reconciled[exerciseId] as MaxHistoryEntry[]) : [];
    const savedOn = Object.hasOwn(maxSavedOn, exerciseId) ? (maxSavedOn[exerciseId] as string) : null;
    reconciled[exerciseId] = withLatestMax(existingEntries, reps, savedOn);
  }
  return reconciled;
}

/**
 * Converts internal settings to the stored settings shape. Always writes the
 * current version (v2); the history is written separately by `saveSettings`.
 */
export function settingsToWire(settings: TrainingSettings): SettingsWireV2 {
  return {
    version: 2,
    startDate: settings.startDate,
    maxReps: { ...settings.maxReps },
    maxSavedOn: { ...settings.maxSavedOn },
  };
}

/** Returns the value if it is a real "YYYY-MM-DD" date, otherwise null. */
function validStartDate(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  try {
    toDayNumber(value);
    return value;
  } catch {
    return null;
  }
}

/** Keeps only entries whose value is a positive integer. */
function validMaxReps(value: unknown): Record<string, number> {
  const result: Record<string, number> = {};
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return result;
  }

  for (const [exerciseId, reps] of Object.entries(value)) {
    if (typeof reps === "number" && Number.isInteger(reps) && reps > 0) {
      result[exerciseId] = reps;
    }
  }
  return result;
}

/**
 * Keeps only entries that are real "YYYY-MM-DD" dates for an exercise that
 * actually has a max (a date without a max is meaningless).
 */
function validMaxSavedOn(value: unknown, maxReps: Record<string, number>): Record<string, string> {
  const result: Record<string, string> = {};
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return result;
  }

  for (const [exerciseId, date] of Object.entries(value)) {
    if (Object.hasOwn(maxReps, exerciseId) && validStartDate(date) !== null) {
      result[exerciseId] = date as string;
    }
  }
  return result;
}

/**
 * Reads settings from `storage`: the settings key and the max-history key,
 * merged by `settingsFromWire`. Never throws: missing, unparsable or
 * inaccessible storage gives defaults (the history is read independently, so
 * a damaged settings entry doesn't lose it). `storage` is injectable for tests.
 */
export function loadSettings(storage: Storage, keys: ProgramStorageKeys): TrainingSettings {
  const storedHistory = loadMaxHistory(storage, keys);

  try {
    const stored = storage.getItem(keys.settings);
    if (stored === null) {
      return settingsFromWire(null, storedHistory);
    }
    return settingsFromWire(JSON.parse(stored), storedHistory);
  } catch {
    return settingsFromWire(null, storedHistory);
  }
}

/**
 * Writes settings (v2) and the max history (its own key) to `storage`. The
 * history is written first and includes the current maxes, so if the second
 * write fails nothing is lost. May throw if storage is full or blocked.
 */
export function saveSettings(settings: TrainingSettings, storage: Storage, keys: ProgramStorageKeys): void {
  saveMaxHistory(reconcileHistory(settings.maxHistory, settings.maxReps, settings.maxSavedOn), storage, keys);
  storage.setItem(keys.settings, JSON.stringify(settingsToWire(settings)));
}
