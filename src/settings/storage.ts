import type { TrainingSettings } from "./model";
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

/** The stored shape. Bump `version` if the shape ever changes incompatibly. */
export interface SettingsWire {
  version: 1;
  startDate: string | null;
  maxReps: Record<string, number>;
}

/** What a fresh install (or unreadable stored data) looks like. */
function defaultSettings(): TrainingSettings {
  return { startDate: null, maxReps: {} };
}

/**
 * Converts untrusted stored data into internal settings. Tolerant by design:
 * anything missing, malformed or from an unknown version yields defaults for
 * that part rather than an error, so a corrupt entry never bricks the app.
 */
export function settingsFromWire(wire: unknown): TrainingSettings {
  if (typeof wire !== "object" || wire === null) {
    return defaultSettings();
  }

  const record = wire as Record<string, unknown>;
  if (record.version !== 1) {
    return defaultSettings();
  }

  return {
    startDate: validStartDate(record.startDate),
    maxReps: validMaxReps(record.maxReps),
  };
}

/** Converts internal settings to the stored shape. */
export function settingsToWire(settings: TrainingSettings): SettingsWire {
  return {
    version: 1,
    startDate: settings.startDate,
    maxReps: { ...settings.maxReps },
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
