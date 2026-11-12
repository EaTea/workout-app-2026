import { combinesToWire, type CombinesWireV1 } from "../combine/wire";
import type { CombinesByDate } from "../combine/model";
import { fatigueHistoryToWire, type FatigueHistoryWireV1 } from "../fatigue/wire";
import type { FatigueHistory } from "../fatigue/model";
import { logToWire, type LogWireV1 } from "../log/wire";
import type { WorkoutLog } from "../log/model";
import type { CorruptLogBackup } from "../log/storage";
import type { ImportBackup } from "./importBackup";
import type { TrainingSettings } from "../settings/model";
import { settingsToWire, type SettingsWire } from "../settings/storage";
import { maxHistoryToWire, type MaxHistoryWireV1 } from "../settings/maxHistoryStorage";

/**
 * "Export everything" file format and its mapping from the internal types.
 * `ui/exportSection.ts` gathers (via `readExportSource`) an `ExportBundle` and calls `exportToWire` then
 * `JSON.stringify`; the result is handed to `download.ts`. The way back is
 * `import.ts` (`parseImport`), which has its own wire-to-internal mapping.
 *
 *   ExportBundle (internal) ──exportToWire──▶ ExportWireV2 (file)
 *       programId ─────────────▶ programId
 *       settings ─settingsToWire─▶ settings
 *       settings.maxHistory ─maxHistoryToWire─▶ maxHistory
 *       log ─────logToWire──────▶ log
 *       fatigue ─fatigueHistoryToWire─▶ fatigueChecks
 *       combines ─combinesToWire─▶ combines
 *       corrupt log backups ─▶ corruptLogBackups (only when any)
 *       import backups ─────▶ importBackups (only when any)
 */

/**
 * Identifies the file as ours so an import can refuse anything else. It is a
 * format marker checked by `parseImport`, not a program name, so it stays the
 * same for every program (changing it would make old files unreadable).
 */
export const EXPORT_FORMAT_NAME = "explosive-endurance-export";

/**
 * The program a version 1 file belongs to. Version 1 was written when
 * Explosive Endurance was the only program, so it carries no `programId`;
 * `parseImport` reads such a file as this program.
 */
export const VERSION_1_PROGRAM_ID = "explosive-endurance";

/** What the export holds, in internal types. Never serialised directly. */
export interface ExportBundle {
  /** The catalogue id of the program the data belongs to. */
  programId: string;
  exportedAt: Date;
  settings: TrainingSettings;
  log: WorkoutLog;
  fatigueHistory: FatigueHistory;

  /** The combined days (host date to the day added); empty when none. */
  combines: CombinesByDate;

  /** Backups of unreadable log text kept by the log storage; empty when none. */
  corruptLogBackups: CorruptLogBackup[];

  /** Backups of the data an import replaced (`importBackup.ts`); empty when none. */
  importBackups: ImportBackup[];
}

/**
 * The exported JSON file, version 1: it has no `programId`. The importer
 * still reads it (as `VERSION_1_PROGRAM_ID`); the app no longer writes it.
 * `exportedAt` is an ISO 8601 string.
 */
export interface ExportWireV1 {
  format: typeof EXPORT_FORMAT_NAME;
  version: 1;
  exportedAt: string;
  /** Any settings version the reader accepts (so older files still fit); this app writes v2. */
  settings: SettingsWire;
  /**
   * Every max the athlete saved, in the max-history key's own wire form. Written
   * since PR 8; optional so files from before it still fit (an import then
   * rebuilds the history from the settings' latest maxes).
   */
  maxHistory?: MaxHistoryWireV1;
  log: LogWireV1;
  fatigueChecks: FatigueHistoryWireV1;

  /**
   * Which dates had a second day combined into their session. Written since
   * PR 25; optional so files from before it still fit (an import then
   * restores no combines).
   */
  combines?: CombinesWireV1;

  /** Present only when the log storage holds backups of unreadable log text. */
  corruptLogBackups?: CorruptLogBackupWire[];

  /**
   * Present only when an earlier import replaced data: one entry per backup,
   * the text being a whole export file of what the import replaced (so it can
   * be imported again to undo it). Listed apart from `corruptLogBackups`
   * because these are complete, readable exports, not unreadable text. An
   * import ignores this field.
   */
  importBackups?: ImportBackupWire[];
}

/**
 * The exported JSON file, version 2: version 1 plus `programId`, the catalogue
 * id of the program the data belongs to, so an import can refuse a backup of
 * another program. This is what the app writes.
 */
export interface ExportWireV2 extends Omit<ExportWireV1, "version"> {
  version: 2;
  programId: string;
}

/** One import backup in the file: the localStorage key it was kept under and its export-file text. */
export interface ImportBackupWire {
  key: string;
  text: string;
}

/** One corrupt-log backup in the file: the localStorage key it was kept under and the original text. */
export interface CorruptLogBackupWire {
  key: string;
  text: string;
}

/** Maps one internal backup to its file shape. Called by `exportToWire`. */
function corruptLogBackupToWire(backup: CorruptLogBackup): CorruptLogBackupWire {
  return { key: backup.storageKey, text: backup.originalText };
}

/** Maps one internal import backup to its file shape. Called by `exportToWire`. */
function importBackupToWire(backup: ImportBackup): ImportBackupWire {
  return { key: backup.storageKey, text: backup.exportText };
}

/** Maps the internal bundle to the file shape, reusing each part's own wire mapping; `corruptLogBackups` is left out when there are none. */
export function exportToWire(bundle: ExportBundle): ExportWireV2 {
  const wire: ExportWireV2 = {
    format: EXPORT_FORMAT_NAME,
    version: 2,
    programId: bundle.programId,
    exportedAt: bundle.exportedAt.toISOString(),
    settings: settingsToWire(bundle.settings),
    maxHistory: maxHistoryToWire(bundle.settings.maxHistory),
    log: logToWire(bundle.log),
    fatigueChecks: fatigueHistoryToWire(bundle.fatigueHistory),
    combines: combinesToWire(bundle.combines),
  };

  if (bundle.corruptLogBackups.length > 0) {
    wire.corruptLogBackups = bundle.corruptLogBackups.map(corruptLogBackupToWire);
  }

  if (bundle.importBackups.length > 0) {
    wire.importBackups = bundle.importBackups.map(importBackupToWire);
  }

  return wire;
}

/** Renders the wire object as the pretty-printed (2-space) text of the .json file. */
export function serializeExport(wire: ExportWireV2): string {
  return JSON.stringify(wire, null, 2) + "\n";
}
