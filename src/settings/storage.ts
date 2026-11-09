import type { MaxHistoryEntry, TrainingSettings } from "./model";
import { recordMax, sortedHistory } from "./maxHistory";
import { toDayNumber } from "../program/calendar";

/**
 * Settings persistence. The wire type (`SettingsWire`) is exactly what is
 * stored in localStorage; the internal type (`TrainingSettings`) is what the
 * rest of the app uses. Only `settingsFromWire` / `settingsToWire` convert
 * between them. The app shell calls `loadSettings` at startup and the
 * settings screen calls `saveSettings`.
 */

/** localStorage key holding the JSON-encoded `SettingsWire`. */
export const SETTINGS_STORAGE_KEY = "explosive-endurance.settings";

/** Format v1: start date and maxes only. Still readable; never written any more. */
export interface SettingsWireV1 {
  version: 1;
  startDate: string | null;
  maxReps: Record<string, number>;
}

/** Format v2: v1 plus the date each max was saved. Still readable; never written any more. */
export interface SettingsWireV2 {
  version: 2;
  startDate: string | null;
  maxReps: Record<string, number>;
  maxSavedOn: Record<string, string>;
}

/** One saved max in the v3 history; `savedOn` is null when the date is unknown. */
export interface MaxHistoryEntryWire {
  savedOn: string | null;
  reps: number;
}

/**
 * Format v3 (current): the start date and, per exercise, the history of saved
 * maxes, oldest first. The latest max and its date are the last entry, so
 * v1/v2's `maxReps` and `maxSavedOn` are no longer stored separately.
 */
export interface SettingsWireV3 {
  version: 3;
  startDate: string | null;
  maxHistory: Record<string, MaxHistoryEntryWire[]>;
}

/** Every stored shape we can read. Bump `version` if the shape ever changes incompatibly. */
export type SettingsWire = SettingsWireV1 | SettingsWireV2 | SettingsWireV3;

/** What a fresh install (or unreadable stored data) looks like. */
function defaultSettings(): TrainingSettings {
  return { startDate: null, maxReps: {}, maxSavedOn: {}, maxHistory: {} };
}

/**
 * Converts untrusted stored data into internal settings. Tolerant by design:
 * anything missing, malformed or from an unknown version yields defaults for
 * that part rather than an error, so a corrupt entry never bricks the app.
 *
 *   v1  maxReps                 -> one history entry per max, date unknown (null)
 *   v2  maxReps + maxSavedOn    -> one history entry per max, dated maxSavedOn
 *                                  (null when that exercise has no date)
 *   v3  maxHistory              -> read as is (validated, sorted)
 *
 * In every case `maxReps` / `maxSavedOn` are then derived from the last
 * history entry, so the three internal fields can't disagree.
 */
export function settingsFromWire(wire: unknown): TrainingSettings {
  if (typeof wire !== "object" || wire === null) {
    return defaultSettings();
  }

  const record = wire as Record<string, unknown>;
  const startDate = validStartDate(record.startDate);

  if (record.version === 3) {
    return settingsFromHistory(startDate, validMaxHistory(record.maxHistory));
  }

  if (record.version === 1 || record.version === 2) {
    const maxReps = validMaxReps(record.maxReps);
    // v1 has no dates field, so it reads as "no max has a known save date".
    const maxSavedOn = record.version === 2 ? validMaxSavedOn(record.maxSavedOn, maxReps) : {};
    return settingsFromHistory(startDate, historyFromLatestMaxes(maxReps, maxSavedOn));
  }

  return defaultSettings();
}

/**
 * v1/v2 -> v3 mapping step: the current max becomes the only history entry,
 * dated with its `maxSavedOn` or, when none is known, marked "unknown,
 * earliest" (`savedOn: null`) so it still counts as the max in effect for any
 * past day.
 */
function historyFromLatestMaxes(
  maxReps: Record<string, number>,
  maxSavedOn: Record<string, string>,
): Record<string, MaxHistoryEntry[]> {
  const history: Record<string, MaxHistoryEntry[]> = {};
  for (const [exerciseId, reps] of Object.entries(maxReps)) {
    history[exerciseId] = [{ savedOn: maxSavedOn[exerciseId] ?? null, reps }];
  }
  return history;
}

/** Builds internal settings from a validated history, deriving the "latest" views from each last entry. */
function settingsFromHistory(startDate: string | null, maxHistory: Record<string, MaxHistoryEntry[]>): TrainingSettings {
  const maxReps: Record<string, number> = {};
  const maxSavedOn: Record<string, string> = {};

  for (const [exerciseId, entries] of Object.entries(maxHistory)) {
    const latest: MaxHistoryEntry | undefined = entries[entries.length - 1];
    if (latest === undefined) {
      continue;
    }
    maxReps[exerciseId] = latest.reps;
    if (latest.savedOn !== null) {
      maxSavedOn[exerciseId] = latest.savedOn;
    }
  }

  return { startDate, maxReps, maxSavedOn, maxHistory };
}

/**
 * Converts internal settings to the stored shape. Always writes the current
 * version (v3). `maxReps` / `maxSavedOn` are the source of truth for the
 * latest max: if an exercise's history is missing or its last entry disagrees
 * (settings built without going through the save helpers), the latest max is
 * recorded as the last entry so nothing the athlete typed is lost.
 */
export function settingsToWire(settings: TrainingSettings): SettingsWireV3 {
  const maxHistory: Record<string, MaxHistoryEntryWire[]> = {};

  for (const [exerciseId, reps] of Object.entries(settings.maxReps)) {
    const savedOn = settings.maxSavedOn[exerciseId] ?? null;
    let entries = settings.maxHistory[exerciseId] ?? [];

    const latest: MaxHistoryEntry | undefined = entries[entries.length - 1];
    if (latest === undefined || latest.reps !== reps || latest.savedOn !== savedOn) {
      entries = savedOn === null ? [...entries, { savedOn, reps }] : recordMax(entries, reps, savedOn);
    }

    maxHistory[exerciseId] = entries.map((entry) => ({ savedOn: entry.savedOn, reps: entry.reps }));
  }

  return { version: 3, startDate: settings.startDate, maxHistory };
}

/**
 * Validates a stored v3 history: keeps exercises with at least one valid
 * entry (positive integer reps, a real date or null), drops bad entries,
 * keeps one entry per date (the later one in file order) and sorts oldest first.
 */
function validMaxHistory(value: unknown): Record<string, MaxHistoryEntry[]> {
  const result: Record<string, MaxHistoryEntry[]> = {};
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return result;
  }

  for (const [exerciseId, rawEntries] of Object.entries(value)) {
    if (!Array.isArray(rawEntries)) {
      continue;
    }

    let entries: MaxHistoryEntry[] = [];
    for (const raw of rawEntries) {
      const entry = validHistoryEntry(raw);
      if (entry === undefined) {
        continue;
      }
      // A later duplicate of a date replaces the earlier one.
      entries = entry.savedOn === null ? [...entries.filter((kept) => kept.savedOn !== null), entry] : recordMax(entries, entry.reps, entry.savedOn);
    }

    if (entries.length > 0) {
      result[exerciseId] = sortedHistory(entries);
    }
  }
  return result;
}

/** Returns the entry if it has a positive integer `reps` and a real date or null `savedOn`; otherwise undefined. */
function validHistoryEntry(raw: unknown): MaxHistoryEntry | undefined {
  if (typeof raw !== "object" || raw === null) {
    return undefined;
  }

  const { savedOn, reps } = raw as Record<string, unknown>;
  if (typeof reps !== "number" || !Number.isInteger(reps) || reps <= 0) {
    return undefined;
  }
  if (savedOn === null) {
    return { savedOn: null, reps };
  }

  const date = validStartDate(savedOn);
  return date === null ? undefined : { savedOn: date, reps };
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
 * Reads settings from `storage`. Never throws: missing, unparsable or
 * inaccessible storage gives defaults. `storage` is injectable for tests.
 */
export function loadSettings(storage: Storage = localStorage): TrainingSettings {
  try {
    const stored = storage.getItem(SETTINGS_STORAGE_KEY);
    if (stored === null) {
      return defaultSettings();
    }
    return settingsFromWire(JSON.parse(stored));
  } catch {
    return defaultSettings();
  }
}

/** Writes settings to `storage` as JSON. May throw if storage is full or blocked. */
export function saveSettings(settings: TrainingSettings, storage: Storage = localStorage): void {
  storage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(settingsToWire(settings)));
}
