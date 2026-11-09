import type { WorkoutLog } from "./model";
import { logFromWire, logToWire } from "./wire";

/**
 * Log persistence. `loadLog` runs at app startup; the log screen calls
 * `saveLog` after each change (and later History after edits/deletes).
 * Storage is injected (a minimal Storage-like object) so tests need no DOM.
 */

/** localStorage key holding the JSON-encoded `LogWireV1`. */
export const LOG_STORAGE_KEY = "explosive-endurance.log";

/**
 * Prefix of the keys unreadable log text is copied to. One key per incident
 * (`<prefix><ISO timestamp>`), so a second corruption never overwrites the
 * first backup.
 */
export const LOG_CORRUPT_BACKUP_PREFIX = "explosive-endurance.log.corrupt-";

/** The subset of the Web Storage API this module uses. */
export interface LogStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

/** Result of `loadLog`: always a usable log, plus a message when stored data had to be set aside. */
export interface LoadLogResult {
  log: WorkoutLog;
  warning?: string;
}

/** Result of `saveLog`; `error` is a readable reason (e.g. storage full) the UI can show. */
export type SaveLogResult = { ok: true } | { ok: false; error: string };

/**
 * Reads the log. Never throws. Missing data gives an empty log. Corrupt data
 * (bad JSON, unknown version, wrong shape) gives an empty log, a warning, and
 * a copy of the raw text under a `.corrupt-<timestamp>` key so the next save
 * cannot destroy it. `now` is injectable for tests.
 */
export function loadLog(storage: LogStorage, now: Date = new Date()): LoadLogResult {
  let storedText: string | null;
  try {
    storedText = storage.getItem(LOG_STORAGE_KEY);
  } catch (error) {
    return { log: { sessions: {} }, warning: `Could not read the workout log: ${describeError(error)}` };
  }

  if (storedText === null) {
    return { log: { sessions: {} } };
  }

  try {
    return { log: logFromWire(JSON.parse(storedText)) };
  } catch (error) {
    return { log: { sessions: {} }, warning: setAsideCorruptLog(storage, storedText, now, error) };
  }
}

/** Copies unreadable text to a backup key and returns the warning to show. */
function setAsideCorruptLog(storage: LogStorage, storedText: string, now: Date, cause: unknown): string {
  const backupKey = `${LOG_CORRUPT_BACKUP_PREFIX}${now.toISOString()}`;
  const reason = describeError(cause);

  try {
    storage.setItem(backupKey, storedText);
    return `Your saved workout log could not be read (${reason}). A copy was kept under "${backupKey}" and the log starts empty.`;
  } catch {
    return `Your saved workout log could not be read (${reason}) and a backup copy could not be made. It will be overwritten by the next save.`;
  }
}

/** Writes the log as JSON. Never throws: quota or blocked storage returns `{ ok: false, error }`. */
export function saveLog(storage: LogStorage, log: WorkoutLog): SaveLogResult {
  try {
    storage.setItem(LOG_STORAGE_KEY, JSON.stringify(logToWire(log)));
    return { ok: true };
  } catch (error) {
    return { ok: false, error: describeError(error) };
  }
}

/** Short human-readable text for a caught value. */
function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
