import type { KeyListingStorage } from "../log/storage";

/**
 * Import backups: before an import replaces anything, the current data is
 * saved under its own localStorage key so the import can be undone.
 *
 *   key   explosive-endurance.import-backup-<ISO timestamp>
 *   value a whole export file (`ExportWireV1` text) of what was there, so
 *         importing that file again puts everything back
 *
 * Written by `importApply.ts` (`applyImport`). Read by `source.ts`, so the next
 * JSON export carries them in its `importBackups` list. They are kept apart
 * from `corruptLogBackups` on purpose: those hold text the app could not
 * read, these hold complete, readable exports. Backups are never deleted
 * automatically (an import is rare, and a backup is the only way back).
 */

/** Prefix of the keys import backups are kept under (`<prefix><ISO timestamp>`). */
export const IMPORT_BACKUP_PREFIX = "explosive-endurance.import-backup-";

/** One import backup in storage: its key and the export-file text it holds. */
export interface ImportBackup {
  storageKey: string;
  exportText: string;
}

/** The key a backup taken at `now` is kept under; one per moment, so a second import never overwrites the first backup. */
export function importBackupKey(now: Date): string {
  return `${IMPORT_BACKUP_PREFIX}${now.toISOString()}`;
}

/**
 * Finds every import backup in storage, oldest first (the key ends in an ISO
 * timestamp, so key order is time order). Used by `readExportSource` so the
 * JSON export carries them. Never throws: a storage error gives what was
 * found so far.
 */
export function listImportBackups(storage: KeyListingStorage): ImportBackup[] {
  const backups: ImportBackup[] = [];

  try {
    for (let index = 0; index < storage.length; index++) {
      const storageKey = storage.key(index);
      if (storageKey === null || !storageKey.startsWith(IMPORT_BACKUP_PREFIX)) continue;

      const exportText = storage.getItem(storageKey);
      if (exportText !== null) backups.push({ storageKey, exportText });
    }
  } catch {
    // Blocked storage: export what could be read.
  }

  return backups.sort((first, second) => first.storageKey.localeCompare(second.storageKey));
}
