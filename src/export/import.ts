import type { FatigueHistory } from "../fatigue/model";
import { fatigueHistoryFromWire } from "../fatigue/wire";
import type { WorkoutLog } from "../log/model";
import { logFromWire } from "../log/wire";
import type { TrainingSettings } from "../settings/model";
import { maxHistoryFromWire } from "../settings/maxHistoryStorage";
import { settingsFromWire } from "../settings/storage";
import { EXPORT_FORMAT_NAME } from "./wire";

/**
 * Reading an "Export everything as JSON" file back in. The counterpart of
 * `exportToWire` in `wire.ts`: text in, internal types out, going through the
 * same per-part `fromWire` functions the storage loaders use, so a file is
 * judged by exactly the rules the stored data is.
 *
 *   file text ─JSON.parse─▶ unknown ─┬─ settings ─┐
 *                                    ├─ maxHistory ┴▶ settingsFromWire ─▶ TrainingSettings
 *                                    ├─ log ───────▶ logFromWire ──────▶ WorkoutLog
 *                                    └─ fatigueChecks ▶ fatigueHistoryFromWire ▶ FatigueHistory
 *
 * What is refused (nothing is read at all): text that is not JSON, a file
 * that is not our format, a version other than 1, and a missing or
 * wholly unreadable `settings`, `log` or `fatigueChecks` section (replacing
 * the athlete's data with nothing because of a damaged file would be the
 * worst outcome). What is tolerated: individual bad sets or checks, which are
 * left out and listed in `problems`, exactly as the loaders do; an unknown
 * settings version or max-history block, which falls back to defaults and is
 * listed too. `corruptLogBackups` and `importBackups` in the file are ignored:
 * they are not part of the data an import restores.
 *
 * Called by `ui/importSection.ts` when a file is chosen; nothing here touches
 * storage (`importApply.ts` does that after the athlete confirms).
 */

/** The data an import would write, in internal types. */
export interface ImportedData {
  settings: TrainingSettings;
  log: WorkoutLog;
  fatigueHistory: FatigueHistory;
}

/** What the confirmation step shows about the file. Dates are "YYYY-MM-DD"; the session dates are absent for an empty log. */
export interface ImportSummary {
  sessionCount: number;
  setCount: number;
  checkCount: number;
  firstSessionDate?: string;
  lastSessionDate?: string;
  startDate: string | null;
}

/** Outcome of `parseImport`: refused with a message for the athlete, or readable data plus anything left out. */
export type ImportParseResult =
  | { ok: false; error: string }
  | { ok: true; data: ImportedData; summary: ImportSummary; problems: string[] };

/** Describes a caught value for a message. */
function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** True for a non-null, non-array object, the only shape a section of the file may have. */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Turns the text of a chosen file into importable data or a refusal. Never
 * throws. See the file comment for what is refused and what is tolerated.
 */
export function parseImport(fileText: string): ImportParseResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(fileText);
  } catch (error) {
    return { ok: false, error: `This file could not be read as JSON (${describeError(error)}). Nothing was changed.` };
  }

  if (!isRecord(parsed) || parsed.format !== EXPORT_FORMAT_NAME) {
    return { ok: false, error: "This is not an Explosive Endurance export file. Choose a file made by \"Export everything as JSON\". Nothing was changed." };
  }
  if (parsed.version !== 1) {
    return {
      ok: false,
      error: `This export is version ${JSON.stringify(parsed.version)}, and this app can only import version 1. Nothing was changed.`,
    };
  }

  for (const section of ["settings", "log", "fatigueChecks"] as const) {
    if (!isRecord(parsed[section])) {
      return { ok: false, error: `This export has no readable "${section}" section, so it was not imported. Nothing was changed.` };
    }
  }

  const problems: string[] = [];

  let log: WorkoutLog;
  try {
    const readLog = logFromWire(parsed.log);
    log = readLog.log;
    problems.push(...readLog.problems.messages);
  } catch (error) {
    return { ok: false, error: `The log in this file could not be read (${describeError(error)}), so it was not imported. Nothing was changed.` };
  }

  let fatigueHistory: FatigueHistory;
  try {
    const readHistory = fatigueHistoryFromWire(parsed.fatigueChecks);
    fatigueHistory = readHistory.history;
    problems.push(...readHistory.problems.messages);
  } catch (error) {
    return { ok: false, error: `The weekly check-ins in this file could not be read (${describeError(error)}), so it was not imported. Nothing was changed.` };
  }

  const settings = readSettings(parsed, problems);

  const data: ImportedData = { settings, log, fatigueHistory };
  return { ok: true, data, summary: summarize(data), problems };
}

/**
 * Maps the file's `settings` (any settings version) and optional `maxHistory`
 * block to internal settings, adding a note to `problems` when either had to
 * fall back to defaults. A file without `maxHistory` (written before PR 8) is
 * fine: `settingsFromWire` rebuilds the history from the settings' maxes.
 */
function readSettings(file: Record<string, unknown>, problems: string[]): TrainingSettings {
  const settingsWire = file.settings as Record<string, unknown>;
  if (settingsWire.version !== 1 && settingsWire.version !== 2) {
    problems.push(`settings: unknown version ${JSON.stringify(settingsWire.version)}, so the start date and maxes are left empty`);
  }

  const historyWire = file.maxHistory;
  const historyIsPresent = historyWire !== undefined;
  const maxHistory = maxHistoryFromWire(historyWire);
  if (historyIsPresent && (!isRecord(historyWire) || historyWire.version !== 1)) {
    problems.push("maxHistory: not a version 1 block, so it was ignored");
  }

  return settingsFromWire(settingsWire, maxHistory);
}

/** Counts and dates for the confirmation step. */
function summarize(data: ImportedData): ImportSummary {
  const sessions = Object.values(data.log.sessions);
  const sessionDates = sessions.map((session) => session.date).sort();

  return {
    sessionCount: sessions.length,
    setCount: sessions.reduce((total, session) => total + session.sets.length, 0),
    checkCount: data.fatigueHistory.checks.length,
    firstSessionDate: sessionDates[0],
    lastSessionDate: sessionDates[sessionDates.length - 1],
    startDate: data.settings.startDate,
  };
}
