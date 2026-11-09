import { fatigueHistoryToWire, type FatigueHistoryWireV1 } from "../fatigue/wire";
import type { FatigueHistory } from "../fatigue/model";
import { logToWire, type LogWireV1 } from "../log/wire";
import type { WorkoutLog } from "../log/model";
import type { TrainingSettings } from "../settings/model";
import { settingsToWire, type SettingsWireV2 } from "../settings/storage";

/**
 * "Export everything" file format and its mapping from the internal types.
 * `ui/settings.ts` gathers an `ExportBundle` and calls `exportToWire` then
 * `JSON.stringify`; the result is handed to `download.ts`. Import is out of
 * scope, so there is deliberately no `exportFromWire`.
 *
 *   ExportBundle (internal) ──exportToWire──▶ ExportWireV1 (file)
 *       settings ─settingsToWire─▶ settings
 *       log ─────logToWire──────▶ log
 *       fatigue ─fatigueHistoryToWire─▶ fatigueChecks
 */

/** Identifies the file as ours so a future import can refuse anything else. */
export const EXPORT_FORMAT_NAME = "explosive-endurance-export";

/** What the export holds, in internal types. Never serialised directly. */
export interface ExportBundle {
  exportedAt: Date;
  settings: TrainingSettings;
  log: WorkoutLog;
  fatigueHistory: FatigueHistory;
}

/** The exported JSON file, version 1. `exportedAt` is an ISO 8601 string. */
export interface ExportWireV1 {
  format: typeof EXPORT_FORMAT_NAME;
  version: 1;
  exportedAt: string;
  settings: SettingsWireV2;
  log: LogWireV1;
  fatigueChecks: FatigueHistoryWireV1;
}

/** Maps the internal bundle to the file shape, reusing each part's own wire mapping. */
export function exportToWire(bundle: ExportBundle): ExportWireV1 {
  return {
    format: EXPORT_FORMAT_NAME,
    version: 1,
    exportedAt: bundle.exportedAt.toISOString(),
    settings: settingsToWire(bundle.settings),
    log: logToWire(bundle.log),
    fatigueChecks: fatigueHistoryToWire(bundle.fatigueHistory),
  };
}

/** Renders the wire object as the pretty-printed (2-space) text of the .json file. */
export function serializeExport(wire: ExportWireV1): string {
  return JSON.stringify(wire, null, 2) + "\n";
}
