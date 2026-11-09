import type { WorkoutLog } from "./model";
import { logFromWire, logToWire, type LogFromWireResult } from "./wire";

/**
 * Log persistence. `loadLog` runs at app startup; every later change from the
 * log screen or History goes through `applyLogChange` (re-read, apply, save).
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

/**
 * Result of `loadLog`: always a usable log, plus a message when stored data
 * had to be set aside.
 *
 * `saveRefusedReason` is set when it would be unsafe to save over what is
 * stored: the stored text could not be read at all, or it was unreadable and
 * no backup copy could be made. `applyLogChange` then refuses to save and
 * shows this text, so the athlete's real log is never overwritten.
 */
export interface LoadLogResult {
  log: WorkoutLog;
  warning?: string;
  saveRefusedReason?: string;
}

/** Result of `saveLog`; `error` is a readable reason (e.g. storage full) the UI can show. */
export type SaveLogResult = { ok: true } | { ok: false; error: string };

// How `loadLog` treats what is stored:
//
//   stored text ─ getItem throws ──────────────▶ empty log, warning, saving refused
//               ─ missing ─────────────────────▶ empty log
//               ─ bad JSON / version / shape ──▶ copy to backup key ─▶ empty log + warning
//               ─ some sets invalid ───────────▶ copy to backup key ─▶ readable sets + warning
//               ─ all valid ───────────────────▶ the log
//   (backup copy fails in either "copy" case ──▶ saving refused)

/**
 * Reads the log. Never throws. Missing data gives an empty log. A log with
 * some unreadable sets gives the readable ones plus a warning saying how many
 * sets were set aside; a log that is unreadable as a whole (bad JSON, unknown
 * version, wrong shape) gives an empty log and a warning. In both cases the
 * original text is first copied to a `.corrupt-<timestamp>` key, so the next
 * save cannot destroy it. A read error (storage blocked) gives an empty log
 * with `saveRefusedReason` set. `now` is injectable for tests.
 */
export function loadLog(storage: LogStorage, now: Date = new Date()): LoadLogResult {
  let storedText: string | null;
  try {
    storedText = storage.getItem(LOG_STORAGE_KEY);
  } catch (error) {
    const reason = describeError(error);
    return {
      log: { sessions: {} },
      warning: `Could not read the workout log (${reason}). Nothing will be saved until it can be read, so your existing log is not overwritten.`,
      saveRefusedReason: `Couldn't read your saved workout log (${reason}), so nothing was saved. Reload the page and try again.`,
    };
  }

  if (storedText === null) {
    return { log: { sessions: {} } };
  }

  let readable: LogFromWireResult;
  try {
    readable = logFromWire(JSON.parse(storedText));
  } catch (error) {
    return setAsideCorruptLog(storage, storedText, now, { sessions: {} }, `Your saved workout log could not be read (${describeError(error)}) and starts empty.`);
  }

  if (readable.problems.messages.length === 0) {
    return { log: readable.log };
  }

  const { setAsideSetCount, messages } = readable.problems;
  const subject = setAsideSetCount === 0
    ? "Some unreadable details of your saved workout log were set aside."
    : `${setAsideSetCount} ${setAsideSetCount === 1 ? "set" : "sets"} of your saved workout log could not be read and ${setAsideSetCount === 1 ? "was" : "were"} set aside.`;
  return setAsideCorruptLog(storage, storedText, now, readable.log, `${subject} (First problem: ${messages[0]}.)`);
}

/**
 * Copies unreadable text to a backup key and builds the `loadLog` result for
 * it: `readableLog` plus a warning that says what happened and where the copy
 * is. If the copy cannot be made, saving is refused so the original survives.
 */
function setAsideCorruptLog(storage: LogStorage, storedText: string, now: Date, readableLog: WorkoutLog, problemText: string): LoadLogResult {
  const backupKey = `${LOG_CORRUPT_BACKUP_PREFIX}${now.toISOString()}`;

  try {
    storage.setItem(backupKey, storedText);
    return { log: readableLog, warning: `${problemText} A copy of the original was kept under "${backupKey}".` };
  } catch {
    return {
      log: readableLog,
      warning: `${problemText} A backup copy could not be made, so nothing will be saved.`,
      saveRefusedReason: "Couldn't back up your unreadable workout log, so nothing was saved (it would overwrite it).",
    };
  }
}

/** The subset of the Web Storage API needed to find the backup keys. */
export interface KeyListingStorage extends Pick<LogStorage, "getItem"> {
  readonly length: number;
  key(index: number): string | null;
}

/** One corrupt-log backup kept by `loadLog`: the key it lives under and the original text. */
export interface CorruptLogBackup {
  storageKey: string;
  originalText: string;
}

/**
 * Finds every `.corrupt-<timestamp>` backup of the log in storage, oldest
 * first (the key ends in an ISO timestamp, so key order is time order). Used
 * by the JSON export so a backup of unreadable log text travels with the
 * file instead of being stranded in localStorage. Never throws: a storage
 * error gives what was found so far.
 */
export function listCorruptLogBackups(storage: KeyListingStorage): CorruptLogBackup[] {
  const backups: CorruptLogBackup[] = [];

  try {
    for (let index = 0; index < storage.length; index++) {
      const storageKey = storage.key(index);
      if (storageKey === null || !storageKey.startsWith(LOG_CORRUPT_BACKUP_PREFIX)) continue;

      const originalText = storage.getItem(storageKey);
      if (originalText !== null) backups.push({ storageKey, originalText });
    }
  } catch {
    // Blocked storage: export what could be read.
  }

  return backups.sort((first, second) => first.storageKey.localeCompare(second.storageKey));
}

/** Inline message when a log change cannot be written to this device. */
export const LOG_SAVE_FAILED_MESSAGE = "Couldn't save on this device. This change is kept until you reload.";

/** Outcome of `applyLogChange`; see there. */
export type ApplyLogChangeResult =
  /** The change was applied to the fresh log and saved. */
  | { saved: true; log: WorkoutLog }
  /** Saving failed. `log` is the fresh log with the change applied (kept in memory), or undefined when the change was not applied at all. */
  | { saved: false; error: string; log?: WorkoutLog };

/**
 * The one way the app changes the stored log (read-modify-write). Re-reads the
 * log from storage, applies the single `operation` (a `logSet` / `editSet` /
 * `deleteSet` call) to that fresh copy, and saves the result, so two open
 * copies of the app (home-screen app and a Safari tab) cannot wipe each
 * other's sets: each change is applied to what is stored now, not to what
 * this tab loaded at startup.
 *
 *   tab A ─ logSet(slams) ──▶ [re-read ▶ apply ▶ save] ─┐   storage: slams
 *   tab B ─ logSet(pull-up) ▶ [re-read ▶ apply ▶ save] ─┘   storage: slams + pull-up
 *
 * Refuses (no write, `log` absent) when the re-read says saving is unsafe
 * (`saveRefusedReason`); a storage write failure keeps the change in the
 * returned `log` so the screen can still show it. Called by app.ts for every
 * change from the log screen and History. Never throws.
 */
export function applyLogChange(
  storage: LogStorage,
  operation: (freshLog: WorkoutLog) => WorkoutLog,
  now: Date = new Date(),
): ApplyLogChangeResult {
  const freshRead = loadLog(storage, now);
  if (freshRead.saveRefusedReason !== undefined) {
    return { saved: false, error: freshRead.saveRefusedReason };
  }

  const changedLog = operation(freshRead.log);
  const saveResult = saveLog(storage, changedLog);
  if (!saveResult.ok) {
    return { saved: false, error: `${LOG_SAVE_FAILED_MESSAGE} (${saveResult.error})`, log: changedLog };
  }
  return { saved: true, log: changedLog };
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
