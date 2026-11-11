import type { ProgramStorageKeys } from "../storage/programKeys";
import type { FatigueHistory } from "./model";
import { fatigueHistoryFromWire, fatigueHistoryToWire, type FatigueFromWireResult } from "./wire";

/**
 * Fatigue-history persistence, modelled on `log/storage.ts`. PR 4 step 3's
 * check-in card calls `loadFatigueHistory` at startup and
 * `applyFatigueChange` to save a check-in. Storage is injected (a minimal
 * Storage-like object) so tests need no DOM.
 */

// Every function here takes the active program's `ProgramStorageKeys`:
//   keys.fatigue                    holds the JSON-encoded `FatigueHistoryWireV1`
//   keys.fatigueCorruptBackupPrefix prefix of the keys unreadable text is copied to
//                                   (`<prefix><ISO timestamp>`), one per incident.

/** The subset of the Web Storage API this module uses. */
export interface FatigueStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

/**
 * Result of `loadFatigueHistory`: always a usable history, plus a warning when
 * data was set aside. `saveRefusedReason` is set when saving would be unsafe
 * (storage unreadable, or an unreadable value that could not be backed up).
 */
export interface LoadFatigueHistoryResult {
  history: FatigueHistory;
  warning?: string;
  saveRefusedReason?: string;
}

/** Result of `saveFatigueHistory`; `error` is a readable reason the UI can show. */
export type SaveFatigueHistoryResult = { ok: true } | { ok: false; error: string };

/** Inline message when a check-in cannot be written to this device. */
export const FATIGUE_SAVE_FAILED_MESSAGE = "Couldn't save on this device. This check-in is kept until you reload.";

/** Outcome of `applyFatigueChange`; see there. */
export type ApplyFatigueChangeResult =
  /** The change was applied to the fresh history and saved. */
  | { saved: true; history: FatigueHistory }
  /** Saving failed. `history` is the fresh history with the change applied, or absent when the change was not applied. */
  | { saved: false; error: string; history?: FatigueHistory };

// How `loadFatigueHistory` treats what is stored:
//
//   stored text ─ getItem throws ──────────────▶ empty history, warning, saving refused
//               ─ missing ─────────────────────▶ empty history
//               ─ bad JSON / version / shape ──▶ copy to backup key ─▶ empty history + warning
//               ─ some checks invalid ─────────▶ copy to backup key ─▶ readable checks + warning
//               ─ all valid ───────────────────▶ the history
//   (backup copy fails in either "copy" case ──▶ saving refused)

/**
 * Reads the fatigue history. Never throws. Missing data gives an empty
 * history; unreadable data is copied to a `.corrupt-<timestamp>` key first and
 * gives the readable checks (or none) plus a warning; a read error gives an
 * empty history with `saveRefusedReason`. `now` is injectable for tests.
 */
export function loadFatigueHistory(storage: FatigueStorage, keys: ProgramStorageKeys, now: Date = new Date()): LoadFatigueHistoryResult {
  let storedText: string | null;
  try {
    storedText = storage.getItem(keys.fatigue);
  } catch (error) {
    const reason = describeError(error);
    return {
      history: { checks: [] },
      warning: `Could not read your weekly check-ins (${reason}). Nothing will be saved until they can be read, so your existing check-ins are not overwritten.`,
      saveRefusedReason: `Couldn't read your saved weekly check-ins (${reason}), so nothing was saved. Reload the page and try again.`,
    };
  }

  if (storedText === null) {
    return { history: { checks: [] } };
  }

  let readable: FatigueFromWireResult;
  try {
    readable = fatigueHistoryFromWire(JSON.parse(storedText));
  } catch (error) {
    return setAsideCorruptHistory(storage, keys, storedText, now, { checks: [] }, `Your saved weekly check-ins could not be read (${describeError(error)}) and start empty.`);
  }

  if (readable.problems.messages.length === 0) {
    return { history: readable.history };
  }

  const { setAsideCheckCount, messages } = readable.problems;
  const subject = `${setAsideCheckCount} weekly ${setAsideCheckCount === 1 ? "check-in" : "check-ins"} could not be read and ${setAsideCheckCount === 1 ? "was" : "were"} set aside.`;
  return setAsideCorruptHistory(storage, keys, storedText, now, readable.history, `${subject} (First problem: ${messages[0]}.)`);
}

/**
 * Copies unreadable text to a backup key and builds the load result: the
 * readable history plus a warning saying where the copy is. If the copy
 * fails, saving is refused so the original survives.
 */
function setAsideCorruptHistory(storage: FatigueStorage, keys: ProgramStorageKeys, storedText: string, now: Date, readableHistory: FatigueHistory, problemText: string): LoadFatigueHistoryResult {
  const backupKey = `${keys.fatigueCorruptBackupPrefix}${now.toISOString()}`;

  try {
    storage.setItem(backupKey, storedText);
    return { history: readableHistory, warning: `${problemText} A copy of the original was kept under "${backupKey}".` };
  } catch {
    return {
      history: readableHistory,
      warning: `${problemText} A backup copy could not be made, so nothing will be saved.`,
      saveRefusedReason: "Couldn't back up your unreadable weekly check-ins, so nothing was saved (it would overwrite them).",
    };
  }
}

/**
 * The one way the app changes stored check-ins (read-modify-write). Re-reads
 * the history, applies `operation` (e.g. `recordCheck`) to that fresh copy and
 * saves, so two open copies of the app cannot overwrite each other's checks.
 * Refuses, writing nothing, when the re-read says saving is unsafe; a write
 * failure keeps the change in the returned `history`. Called by PR 4 step 3's
 * check-in card. Never throws.
 */
export function applyFatigueChange(
  storage: FatigueStorage,
  keys: ProgramStorageKeys,
  operation: (freshHistory: FatigueHistory) => FatigueHistory,
  now: Date = new Date(),
): ApplyFatigueChangeResult {
  const freshRead = loadFatigueHistory(storage, keys, now);
  if (freshRead.saveRefusedReason !== undefined) {
    return { saved: false, error: freshRead.saveRefusedReason };
  }

  const changedHistory = operation(freshRead.history);
  const saveResult = saveFatigueHistory(storage, keys, changedHistory);
  if (!saveResult.ok) {
    return { saved: false, error: `${FATIGUE_SAVE_FAILED_MESSAGE} (${saveResult.error})`, history: changedHistory };
  }
  return { saved: true, history: changedHistory };
}

/** Writes the history as JSON. Never throws: quota or blocked storage returns `{ ok: false, error }`. */
export function saveFatigueHistory(storage: FatigueStorage, keys: ProgramStorageKeys, history: FatigueHistory): SaveFatigueHistoryResult {
  try {
    storage.setItem(keys.fatigue, JSON.stringify(fatigueHistoryToWire(history)));
    return { ok: true };
  } catch (error) {
    return { ok: false, error: describeError(error) };
  }
}

/** Short human-readable text for a caught value. */
function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
