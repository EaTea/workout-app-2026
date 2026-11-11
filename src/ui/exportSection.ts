import "./export.css";
import { logToCsv } from "../export/csv";
import { exportFileName, saveExportFile } from "../export/download";
import { exportToWire, serializeExport } from "../export/wire";
import type { FatigueHistory } from "../fatigue/model";
import type { WorkoutLog } from "../log/model";
import type { CorruptLogBackup } from "../log/storage";
import type { Program } from "../program/model";
import type { TrainingSettings } from "../settings/model";
import { element } from "./dom";

/**
 * The "Export" card on the Settings screen: two buttons that turn the saved
 * data into a CSV or JSON file and hand it to `saveExportFile`. Built by
 * `renderSettingsScreen`; the data is read when a button is pressed, so the
 * file always reflects the latest log.
 */

/** The data an export reads, read fresh from storage at click time (`export/source.ts` `readExportSource`, supplied by `app.ts`). */
export interface ExportSource {
  settings: TrainingSettings;
  log: WorkoutLog;
  fatigueHistory: FatigueHistory;
  corruptLogBackups: CorruptLogBackup[];
}

/** True when the log holds no sets (the CSV would be only a header). */
export function isLogEmpty(log: WorkoutLog): boolean {
  return Object.values(log.sessions).every((session) => session.sets.length === 0);
}

/**
 * Builds the Export card. CSV is disabled with a short note while the log is
 * empty; JSON stays available because it also carries the settings. The
 * "empty" check happens at render time, which is enough: logging happens on
 * other screens, and Settings re-renders when it is opened.
 */
export function renderExportSection(program: Program, getSource: () => ExportSource): HTMLElement {
  const section = element("section", "card export-section");
  section.append(element("h2", "card-title", "Export"));

  const csvButton = element("button", "primary-button", "Export log as CSV");
  csvButton.type = "button";
  const jsonButton = element("button", "primary-button", "Export everything as JSON");
  jsonButton.type = "button";

  const logIsEmpty = isLogEmpty(getSource().log);
  csvButton.disabled = logIsEmpty;

  csvButton.addEventListener("click", () => {
    const csv = logToCsv(getSource().log, program);
    void saveExportFile(exportFileName("csv"), csv, "text/csv;charset=utf-8");
  });

  jsonButton.addEventListener("click", () => {
    const source = getSource();
    const wire = exportToWire({
      exportedAt: new Date(),
      settings: source.settings,
      log: source.log,
      fatigueHistory: source.fatigueHistory,
      corruptLogBackups: source.corruptLogBackups,
    });
    void saveExportFile(exportFileName("json"), serializeExport(wire), "application/json");
  });

  section.append(csvButton);
  if (logIsEmpty) {
    section.append(element("p", "export-note", "Nothing logged yet, so there is no log to export as CSV."));
  }
  section.append(jsonButton);
  section.append(element("p", "export-note", "Nothing leaves your phone except the file you choose to share."));
  return section;
}
