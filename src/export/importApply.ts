import { loadFatigueHistory, saveFatigueHistory } from "../fatigue/storage";
import { loadLog, saveLog } from "../log/storage";
import { loadSettings, saveSettings } from "../settings/storage";
import type { ProgramStorageKeys } from "../storage/programKeys";
import { parseImport, type ImportedData } from "./import";
import { backupToText, importBackupKey, listImportBackups, pruneImportBackups, type RawStoredText } from "./importBackup";
import { exportToWire } from "./wire";

/**
 * Writing imported data over the stored data, safely. Called by
 * `ui/importSection.ts` after the athlete's confirming tap.
 *
 * The order and failure handling, so a failure never leaves a mix of old and
 * new that the athlete cannot undo:
 *
 *   1. Read what is stored now. If the log or check-ins cannot be read safely
 *      (the loaders' `saveRefusedReason`), stop: nothing is written.
 *   2. Note the raw text of the four data keys (log, check-ins, settings, max
 *      history), for step 5.
 *   3. BACKUP FIRST: write the current data as a whole export file (compact
 *      JSON, with the raw texts of step 2 inside) under
 *      `<programId>.import-backup-<ISO timestamp>`. If this fails,
 *      stop; nothing was changed.
 *   4. Write the new data key by key with the existing savers, in this order:
 *      log, check-ins, max history, settings. Each `setItem` either stores the
 *      whole new value or leaves the old one, so every key is old or new.
 *   5. If any write fails, put every key that was already replaced back to the
 *      text noted in step 2, so the result is all old data, and say so. When
 *      that fully worked the backup is removed again (it would only be a
 *      second copy of what is stored; repeated failures must not fill the
 *      storage). If even that fails for a key, the backup is kept and the
 *      message says it holds the old data (it is in the next JSON export
 *      under `importBackups`).
 *   6. On success, only the newest 3 import backups are kept.
 *
 * `undoLastImport` runs the same steps, with "write the new data" being "put
 * the newest backup's data back" (its raw key texts when it has them), so an
 * undo is itself backed up and can be undone.
 *
 * The loaders also copy unreadable stored text to their own `.corrupt-` keys
 * as a side effect (step 1), the same as at startup, so a damaged log is
 * never lost to an import.
 */

/** Outcome of `applyImport`: the backup key on success, or a readable reason (nothing half-written). */
export type ApplyImportResult = { ok: true; backupKey: string } | { ok: false; error: string };

/** The four keys of the active program an import replaces, in the order they are written (settings last; `saveSettings` writes max history before it). */
function replacedKeys(keys: ProgramStorageKeys): string[] {
  return [keys.log, keys.fatigue, keys.maxHistory, keys.settings];
}

/** Describes a caught value for a message. */
function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Replaces the stored log, check-ins, settings and max history with `data`
 * after backing the current ones up (see the file comment for the steps).
 * `storage` and `now` are injectable for tests. Never throws.
 */
export function applyImport(storage: Storage, keys: ProgramStorageKeys, data: ImportedData, now: Date = new Date()): ApplyImportResult {
  return replaceStoredData(storage, keys, now, () => writeParsedData(storage, keys, data));
}

/**
 * Puts the newest import backup's data back (the "Undo last import" button).
 * Prefers the raw key texts stored in the backup, so even settings or history
 * the loaders could not read return exactly as they were; an older backup
 * without them is read like an import file. The current data is backed up
 * first like in any import, so an undo can itself be undone. Never throws.
 */
export function undoLastImport(storage: Storage, keys: ProgramStorageKeys, now: Date = new Date()): ApplyImportResult {
  const backups = listImportBackups(storage, keys);
  const newest = backups[backups.length - 1];
  if (newest === undefined) {
    return { ok: false, error: "There is no import to undo. Nothing was changed." };
  }

  const rawTexts = newest.rawStoredTexts?.filter((raw) => replacedKeys(keys).includes(raw.storageKey));
  if (rawTexts !== undefined && rawTexts.length > 0) {
    return replaceStoredData(storage, keys, now, () => writeRawTexts(storage, rawTexts));
  }

  const parsed = parseImport(newest.exportText);
  if (!parsed.ok) {
    return { ok: false, error: `The backup could not be read. ${parsed.error}` };
  }
  return replaceStoredData(storage, keys, now, () => writeParsedData(storage, keys, parsed.data));
}

/** Writes imported data with the normal savers (log, check-ins, then max history and settings). Throws on failure; the caller rolls back. */
function writeParsedData(storage: Storage, keys: ProgramStorageKeys, data: ImportedData): void {
  const logResult = saveLog(storage, keys, data.log);
  if (!logResult.ok) throw new Error(logResult.error);

  const fatigueResult = saveFatigueHistory(storage, keys, data.fatigueHistory);
  if (!fatigueResult.ok) throw new Error(fatigueResult.error);

  saveSettings(data.settings, storage, keys); // max history, then settings; throws on failure
}

/** Puts raw stored texts back key by key (an absent key is removed). Throws on failure; the caller rolls back. */
function writeRawTexts(storage: Storage, rawTexts: RawStoredText[]): void {
  for (const raw of rawTexts) {
    if (raw.text === null) {
      storage.removeItem(raw.storageKey);
    } else {
      storage.setItem(raw.storageKey, raw.text);
    }
  }
}

/**
 * The shared flow of `applyImport` and `undoLastImport` (file comment steps
 * 1 to 6): read, note the raw texts, back up, run `writeNewData`, roll back
 * on failure, prune old backups on success.
 */
function replaceStoredData(storage: Storage, keys: ProgramStorageKeys, now: Date, writeNewData: () => void): ApplyImportResult {
  // Step 1: what is stored now.
  const currentLog = loadLog(storage, keys, now);
  if (currentLog.saveRefusedReason !== undefined) {
    return { ok: false, error: `${currentLog.saveRefusedReason} Nothing was changed.` };
  }
  const currentFatigue = loadFatigueHistory(storage, keys, now);
  if (currentFatigue.saveRefusedReason !== undefined) {
    return { ok: false, error: `${currentFatigue.saveRefusedReason} Nothing was changed.` };
  }
  const currentSettings = loadSettings(storage, keys);

  // Step 2: raw text per key, to restore on failure and to keep in the backup.
  const previousTexts = new Map<string, string | null>();
  try {
    for (const key of replacedKeys(keys)) {
      previousTexts.set(key, storage.getItem(key));
    }
  } catch (error) {
    return { ok: false, error: `Couldn't read your current data (${describeError(error)}), so nothing was changed.` };
  }

  // Step 3: backup first.
  const backupKey = importBackupKey(keys, now);
  try {
    const backupWire = exportToWire({
      exportedAt: now,
      settings: currentSettings,
      log: currentLog.log,
      fatigueHistory: currentFatigue.history,
      // Left out so backups do not nest inside each other; those keys stay in storage untouched.
      corruptLogBackups: [],
      importBackups: [],
    });
    const rawStoredTexts = [...previousTexts].map(([storageKey, text]) => ({ storageKey, text }));
    storage.setItem(backupKey, backupToText(backupWire, rawStoredTexts));
  } catch (error) {
    return { ok: false, error: `Couldn't keep a backup of your current data (${describeError(error)}), so nothing was changed.` };
  }

  // Step 4: write the new data.
  try {
    writeNewData();
  } catch (error) {
    return { ok: false, error: restorePreviousTexts(storage, previousTexts, backupKey, describeError(error)) };
  }

  // Step 6: keep only the newest backups.
  pruneImportBackups(storage, keys);
  return { ok: true, backupKey };
}

/**
 * Step 5: puts each data key whose stored text changed back to its text from
 * before the import. Returns the message to show, saying whether everything
 * was put back; when it was, the backup is removed. Used only by
 * `replaceStoredData` after a failed write.
 */
function restorePreviousTexts(storage: Storage, previousTexts: Map<string, string | null>, backupKey: string, writeError: string): string {
  const keysNotRestored: string[] = [];

  for (const [key, previousText] of previousTexts) {
    try {
      if (storage.getItem(key) === previousText) continue; // never replaced

      if (previousText === null) {
        storage.removeItem(key);
      } else {
        storage.setItem(key, previousText);
      }
    } catch {
      keysNotRestored.push(key);
    }
  }

  if (keysNotRestored.length === 0) {
    try {
      storage.removeItem(backupKey); // everything is back, so the backup is only a duplicate
    } catch {
      return `Couldn't save the imported data (${writeError}). Your previous data was put back. A backup of it is kept under "${backupKey}".`;
    }
    return `Couldn't save the imported data (${writeError}). Your previous data was put back.`;
  }
  return `Couldn't save the imported data (${writeError}), and some of your previous data (${keysNotRestored.join(", ")}) could not be put back. All of your previous data is in the backup under "${backupKey}"; export as JSON to keep it.`;
}
