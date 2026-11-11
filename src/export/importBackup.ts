import type { KeyListingStorage } from "../log/storage";
import type { ProgramStorageKeys } from "../storage/programKeys";
import type { ExportWireV1 } from "./wire";

/**
 * Import backups: before an import replaces anything, the current data is
 * saved under its own localStorage key so the import can be undone.
 *
 *   key   <programId>.import-backup-<ISO timestamp>   (keys.importBackupPrefix + timestamp)
 *   value a whole export file (`ExportWireV1`, written compactly) of what was
 *         there, plus `rawStoredTexts`: the exact stored text of the four data
 *         keys, so an undo puts back even settings or history the loaders
 *         could not read. Importing the file again also puts everything back
 *         (an import ignores `rawStoredTexts`).
 *
 * Written by `importApply.ts` (`applyImport`, `undoLastImport`). Read by
 * `source.ts`, so the next JSON export carries them in its `importBackups`
 * list. They are kept apart from `corruptLogBackups` on purpose: those hold
 * text the app could not read, these hold complete, readable exports. Only
 * the newest `MAX_IMPORT_BACKUPS` are kept (`pruneImportBackups`, run after a
 * successful import or undo); a failed import whose rollback worked removes
 * its own backup, so repeated failures never pile up copies of the data.
 */

/** How many import backups are kept; older ones are deleted after a successful import or undo. */
export const MAX_IMPORT_BACKUPS = 3;

/** The raw stored text of one data key at backup time; `null` when the key was absent. Internal form. */
export interface RawStoredText {
  storageKey: string;
  text: string | null;
}

/** One import backup in storage: its key, the export-file text it holds, and the raw texts when it has them (backups from before they were added do not). */
export interface ImportBackup {
  storageKey: string;
  exportText: string;
  rawStoredTexts?: RawStoredText[];
}

/** Wire form of one raw text inside the backup text. Kept apart from `RawStoredText` (CLAUDE.md section 6). */
interface RawStoredTextWire {
  key: string;
  text: string | null;
}

/** The backup's stored text: an export file plus the raw texts. Only `importBackup.ts` reads and writes it. */
type ImportBackupFileWire = ExportWireV1 & { rawStoredTexts?: RawStoredTextWire[] };

/**
 * Builds the text stored under a backup key: the export wire of the current
 * data plus the raw texts, as compact JSON (a backup is a second copy of
 * everything, so it must not be pretty-printed). Used by `applyImport`.
 */
export function backupToText(exportWire: ExportWireV1, rawStoredTexts: RawStoredText[]): string {
  const wire: ImportBackupFileWire = {
    ...exportWire,
    rawStoredTexts: rawStoredTexts.map((raw) => ({ key: raw.storageKey, text: raw.text })),
  };
  return JSON.stringify(wire);
}

/**
 * Reads the raw texts out of a stored backup text, or undefined when there
 * are none (an older backup) or they are malformed. Never throws. Used by
 * `listImportBackups`, so an undo can put the exact old text back.
 */
export function rawStoredTextsFromBackupText(backupText: string): RawStoredText[] | undefined {
  try {
    const parsed: unknown = JSON.parse(backupText);
    if (typeof parsed !== "object" || parsed === null) return undefined;

    const rawWires = (parsed as { rawStoredTexts?: unknown }).rawStoredTexts;
    if (!Array.isArray(rawWires)) return undefined;

    const rawTexts: RawStoredText[] = [];
    for (const rawWire of rawWires) {
      if (typeof rawWire !== "object" || rawWire === null) return undefined;
      const { key, text } = rawWire as { key?: unknown; text?: unknown };
      if (typeof key !== "string" || (text !== null && typeof text !== "string")) return undefined;
      rawTexts.push({ storageKey: key, text });
    }
    return rawTexts;
  } catch {
    return undefined;
  }
}

/** The key a backup taken at `now` is kept under; one per moment, so a second import never overwrites the first backup. */
export function importBackupKey(keys: ProgramStorageKeys, now: Date): string {
  return `${keys.importBackupPrefix}${now.toISOString()}`;
}

/**
 * Finds every import backup in storage, oldest first (the key ends in an ISO
 * timestamp, so key order is time order). Used by `readExportSource` so the
 * JSON export carries them. Never throws: a storage error gives what was
 * found so far.
 */
export function listImportBackups(storage: KeyListingStorage, keys: ProgramStorageKeys): ImportBackup[] {
  const backups: ImportBackup[] = [];

  try {
    for (let index = 0; index < storage.length; index++) {
      const storageKey = storage.key(index);
      if (storageKey === null || !storageKey.startsWith(keys.importBackupPrefix)) continue;

      const exportText = storage.getItem(storageKey);
      if (exportText !== null) backups.push({ storageKey, exportText, rawStoredTexts: rawStoredTextsFromBackupText(exportText) });
    }
  } catch {
    // Blocked storage: export what could be read.
  }

  return backups.sort((first, second) => first.storageKey.localeCompare(second.storageKey));
}

/**
 * Deletes all but the newest `keep` import backups. Called by `applyImport`
 * and `undoLastImport` after a successful write. Never throws: a key that
 * cannot be removed is simply left.
 */
export function pruneImportBackups(storage: Storage, keys: ProgramStorageKeys, keep: number = MAX_IMPORT_BACKUPS): void {
  const backups = listImportBackups(storage, keys); // oldest first
  const surplusCount = Math.max(0, backups.length - keep);

  for (const backup of backups.slice(0, surplusCount)) {
    try {
      storage.removeItem(backup.storageKey);
    } catch {
      // Blocked storage: keep the backup.
    }
  }
}
