import { fatigueHistoryToWire, type FatigueHistoryWireV1 } from "../fatigue/wire";
import type { FatigueHistory } from "../fatigue/model";
import { logToWire, type LogWireV1 } from "../log/wire";
import type { WorkoutLog } from "../log/model";
import type { CorruptLogBackup } from "../log/storage";
import type { TrainingSettings } from "../settings/model";
import { settingsToWire, type SettingsWire } from "../settings/storage";

/**
 * "Export everything" file format and its mapping from the internal types.
 * `ui/exportSection.ts` gathers (via `readExportSource`) an `ExportBundle` and calls `exportToWire` then
 * `JSON.stringify`; the result is handed to `download.ts`. Import is out of
 * scope, so there is deliberately no `exportFromWire`.
 *
 *   ExportBundle (internal) ──exportToWire──▶ ExportWireV1 (file)
 *       settings ─settingsToWire─▶ settings
 *       log ─────logToWire──────▶ log
 *       fatigue ─fatigueHistoryToWire─▶ fatigueChecks
 *       corrupt log backups ─▶ corruptLogBackups (only when any)
 */

/** Identifies the file as ours so a future import can refuse anything else. */
export const EXPORT_FORMAT_NAME = "explosive-endurance-export";

/** What the export holds, in internal types. Never serialised directly. */
export interface ExportBundle {
  exportedAt: Date;
  settings: TrainingSettings;
  log: WorkoutLog;
  fatigueHistory: FatigueHistory;

  /** Backups of unreadable log text kept by the log storage; empty when none. */
  corruptLogBackups: CorruptLogBackup[];
}

/** The exported JSON file, version 1. `exportedAt` is an ISO 8601 string. */
export interface ExportWireV1 {
  format: typeof EXPORT_FORMAT_NAME;
  version: 1;
  exportedAt: string;
  /** Any settings version the reader accepts (so older files still fit); this app writes v2. */
  settings: SettingsWire;
  log: LogWireV1;
  fatigueChecks: FatigueHistoryWireV1;

  /** Present only when the log storage holds backups of unreadable log text. */
  corruptLogBackups?: CorruptLogBackupWire[];
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

/** Maps the internal bundle to the file shape, reusing each part's own wire mapping; `corruptLogBackups` is left out when there are none. */
export function exportToWire(bundle: ExportBundle): ExportWireV1 {
  const wire: ExportWireV1 = {
    format: EXPORT_FORMAT_NAME,
    version: 1,
    exportedAt: bundle.exportedAt.toISOString(),
    settings: settingsToWire(bundle.settings),
    log: logToWire(bundle.log),
    fatigueChecks: fatigueHistoryToWire(bundle.fatigueHistory),
  };

  if (bundle.corruptLogBackups.length > 0) {
    wire.corruptLogBackups = bundle.corruptLogBackups.map(corruptLogBackupToWire);
  }

  return wire;
}

/** Renders the wire object as the pretty-printed (2-space) text of the .json file. */
export function serializeExport(wire: ExportWireV1): string {
  return JSON.stringify(wire, null, 2) + "\n";
}
