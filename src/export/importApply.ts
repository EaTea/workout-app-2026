import { loadFatigueHistory, saveFatigueHistory, FATIGUE_STORAGE_KEY } from "../fatigue/storage";
import { loadLog, saveLog, LOG_STORAGE_KEY } from "../log/storage";
import { MAX_HISTORY_STORAGE_KEY } from "../settings/maxHistoryStorage";
import { loadSettings, saveSettings, SETTINGS_STORAGE_KEY } from "../settings/storage";
import type { ImportedData } from "./import";
import { importBackupKey } from "./importBackup";
import { exportToWire, serializeExport } from "./wire";

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
 *   3. BACKUP FIRST: write the current data as a whole export file under
 *      `explosive-endurance.import-backup-<ISO timestamp>`. If this fails, stop;
 *      nothing was changed.
 *   4. Write the new data key by key with the existing savers, in this order:
 *      log, check-ins, max history, settings. Each `setItem` either stores the
 *      whole new value or leaves the old one, so every key is old or new.
 *   5. If any write fails, put every key that was already replaced back to the
 *      text noted in step 2, so the result is all old data, and say so. If
 *      even that fails for a key, the message says the backup holds the old
 *      data (it is in the next JSON export under `importBackups`).
 *
 * The loaders also copy unreadable stored text to their own `.corrupt-` keys
 * as a side effect (step 1), the same as at startup, so a damaged log is
 * never lost to an import.
 */

/** Outcome of `applyImport`: the backup key on success, or a readable reason (nothing half-written). */
export type ApplyImportResult = { ok: true; backupKey: string } | { ok: false; error: string };

/** The four keys an import replaces, in the order they are written (settings last; `saveSettings` writes max history before it). */
const REPLACED_KEYS = [LOG_STORAGE_KEY, FATIGUE_STORAGE_KEY, MAX_HISTORY_STORAGE_KEY, SETTINGS_STORAGE_KEY] as const;

/** Describes a caught value for a message. */
function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Replaces the stored log, check-ins, settings and max history with `data`
 * after backing the current ones up (see the file comment for the steps).
 * `storage` and `now` are injectable for tests. Never throws.
 */
export function applyImport(storage: Storage, data: ImportedData, now: Date = new Date()): ApplyImportResult {
  // Step 1: what is stored now.
  const currentLog = loadLog(storage, now);
  if (currentLog.saveRefusedReason !== undefined) {
    return { ok: false, error: `${currentLog.saveRefusedReason} Nothing was changed.` };
  }
  const currentFatigue = loadFatigueHistory(storage, now);
  if (currentFatigue.saveRefusedReason !== undefined) {
    return { ok: false, error: `${currentFatigue.saveRefusedReason} Nothing was changed.` };
  }
  const currentSettings = loadSettings(storage);

  // Step 2: raw text per key, to restore on failure.
  const previousTexts = new Map<string, string | null>();
  try {
    for (const key of REPLACED_KEYS) {
      previousTexts.set(key, storage.getItem(key));
    }
  } catch (error) {
    return { ok: false, error: `Couldn't read your current data (${describeError(error)}), so nothing was changed.` };
  }

  // Step 3: backup first.
  const backupKey = importBackupKey(now);
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
    storage.setItem(backupKey, serializeExport(backupWire));
  } catch (error) {
    return { ok: false, error: `Couldn't keep a backup of your current data (${describeError(error)}), so nothing was changed.` };
  }

  // Step 4: write the new data.
  try {
    const logResult = saveLog(storage, data.log);
    if (!logResult.ok) throw new Error(logResult.error);

    const fatigueResult = saveFatigueHistory(storage, data.fatigueHistory);
    if (!fatigueResult.ok) throw new Error(fatigueResult.error);

    saveSettings(data.settings, storage); // max history, then settings; throws on failure
  } catch (error) {
    return { ok: false, error: restorePreviousTexts(storage, previousTexts, backupKey, describeError(error)) };
  }

  return { ok: true, backupKey };
}

/**
 * Step 5: puts each data key whose stored text changed back to its text from
 * before the import. Returns the message to show, saying whether everything
 * was put back. Used only by `applyImport` after a failed write.
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
    return `Couldn't save the imported data (${writeError}). Your previous data was put back. A backup of it is kept under "${backupKey}".`;
  }
  return `Couldn't save the imported data (${writeError}), and some of your previous data (${keysNotRestored.join(", ")}) could not be put back. All of your previous data is in the backup under "${backupKey}"; export as JSON to keep it.`;
}
