import type { FatigueHistory } from "../fatigue/model";
import { fatigueHistoryFromWire } from "../fatigue/wire";
import type { WorkoutLog } from "../log/model";
import { logFromWire } from "../log/wire";
import type { TrainingSettings } from "../settings/model";
import { maxHistoryFromWire } from "../settings/maxHistoryStorage";
import { settingsFromWire } from "../settings/storage";
import { PROGRAM_ID_PATTERN } from "../program/catalogue";
import { EXPORT_FORMAT_NAME, VERSION_1_PROGRAM_ID } from "./wire";

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
 * that is not our format, a version other than 1 or 2, a version 2 file whose `programId` is not a valid
 * program id, and a missing or
 * wholly unreadable `settings`, `log` or `fatigueChecks` section, a
 * `settings` section of a version this app does not know and a `maxHistory`
 * block that is not version 1 (replacing the athlete's data with defaults
 * because of a file from a newer app would be the worst outcome), and files
 * over 10 MB. What is tolerated: individual bad sets or checks, which are
 * left out and listed in `problems`, exactly as the loaders do. Parsing never
 * throws: anything unexpected becomes "could not be read".
 * `corruptLogBackups` and `importBackups` in the file are ignored: they are
 * not part of the data an import restores.
 *
 * A version 1 file has no `programId` and is read as `VERSION_1_PROGRAM_ID`
 * (Explosive Endurance, the only program then). Whether the file's program
 * is the active one is NOT decided here (parsing does not know the active
 * program): `wrongProgramMessage` does, and callers use it before writing.
 *
 * Called by `ui/importSection.ts` when a file is chosen; nothing here touches
 * storage (`importApply.ts` does that after the athlete confirms).
 */

/** Files larger than this are refused before they are read (an export of years of training is well under 1 MB). */
export const MAX_IMPORT_FILE_BYTES = 10 * 1024 * 1024;

/** The message for a file over `MAX_IMPORT_FILE_BYTES`; used by the Import card before it reads the file. */
export const FILE_TOO_LARGE_MESSAGE = "This file is larger than 10 MB, so it is not an export from this app. Nothing was changed.";

/** The data an import would write, in internal types. */
export interface ImportedData {
  /** The catalogue id of the program the file belongs to (`VERSION_1_PROGRAM_ID` for a version 1 file). */
  programId: string;
  settings: TrainingSettings;
  log: WorkoutLog;
  fatigueHistory: FatigueHistory;
}

/** What the confirmation step shows about the file. Dates are "YYYY-MM-DD"; the session dates are absent for an empty log. `exportedAt` is the file's ISO timestamp, absent when the file's is not a real date. */
export interface ImportSummary {
  exportedAt?: string;
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
 * throws: the real work is in `parseImportUnguarded`, and anything it throws
 * that its own checks missed is reported as an unreadable file. See the file
 * comment for what is refused and what is tolerated.
 */
export function parseImport(fileText: string): ImportParseResult {
  try {
    return parseImportUnguarded(fileText);
  } catch (error) {
    return { ok: false, error: `This file could not be read (${describeError(error)}). Nothing was changed.` };
  }
}

/** The parsing steps of `parseImport`, which may throw on input shapes nobody thought of; only `parseImport` calls it. */
function parseImportUnguarded(fileText: string): ImportParseResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(fileText);
  } catch (error) {
    return { ok: false, error: `This file could not be read as JSON (${describeError(error)}). Nothing was changed.` };
  }

  if (!isRecord(parsed) || parsed.format !== EXPORT_FORMAT_NAME) {
    return { ok: false, error: "This is not an Explosive Endurance export file. Choose a file made by \"Export everything as JSON\". Nothing was changed." };
  }
  if (parsed.version !== 1 && parsed.version !== 2) {
    return {
      ok: false,
      error: `This export is version ${JSON.stringify(parsed.version)}, and this app can only import versions 1 and 2. Nothing was changed.`,
    };
  }

  const programIdResult = readProgramId(parsed);
  if (!programIdResult.ok) return programIdResult;

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

  const settingsResult = readSettings(parsed);
  if (!settingsResult.ok) return settingsResult;
  const settings = settingsResult.settings;

  const data: ImportedData = { programId: programIdResult.programId, settings, log, fatigueHistory };
  return { ok: true, data, summary: summarize(data, parsed.exportedAt), problems };
}

/**
 * Reads which program the file belongs to: version 1 has no `programId` and
 * means Explosive Endurance; version 2 must carry a string shaped like a
 * catalogue id, otherwise the file is refused like any other malformed field.
 */
function readProgramId(file: Record<string, unknown>): { ok: true; programId: string } | { ok: false; error: string } {
  if (file.version === 1) return { ok: true, programId: VERSION_1_PROGRAM_ID };

  const programId = file.programId;
  if (typeof programId !== "string" || !PROGRAM_ID_PATTERN.test(programId)) {
    return { ok: false, error: `This export has no readable "programId" (${JSON.stringify(programId)}), so it was not imported. Nothing was changed.` };
  }
  return { ok: true, programId };
}

/**
 * The refusal shown when a backup belongs to another program than the active
 * one, or null when they match. Used by the Import card (at the preview, so
 * the athlete is told before any confirm) and by `applyImport` (so nothing is
 * ever written for the wrong program). Program ids are shown as they are:
 * display names would need every program file loaded.
 */
export function wrongProgramMessage(backupProgramId: string, activeProgramId: string): string | null {
  if (backupProgramId === activeProgramId) return null;
  return `This backup is for "${backupProgramId}", but you're using "${activeProgramId}". Switch program first, then import it. Nothing was changed.`;
}

/**
 * Maps the file's `settings` (version 1 or 2) and optional `maxHistory` block
 * to internal settings, or refuses a section whose version is unknown (the
 * stored settings would otherwise be replaced by empty ones). A file without
 * `maxHistory` (written before PR 8) is fine: `settingsFromWire` rebuilds the
 * history from the settings' maxes.
 */
function readSettings(file: Record<string, unknown>): { ok: true; settings: TrainingSettings } | { ok: false; error: string } {
  const settingsWire = file.settings as Record<string, unknown>;
  if (settingsWire.version !== 1 && settingsWire.version !== 2) {
    return {
      ok: false,
      error: `The settings in this file are version ${JSON.stringify(settingsWire.version)}, which this app cannot read, so nothing was imported. Nothing was changed.`,
    };
  }

  const historyWire = file.maxHistory;
  if (historyWire !== undefined && (!isRecord(historyWire) || historyWire.version !== 1)) {
    return { ok: false, error: "The max history in this file is not a version this app can read, so nothing was imported. Nothing was changed." };
  }

  return { ok: true, settings: settingsFromWire(settingsWire, maxHistoryFromWire(historyWire)) };
}

/** Counts and dates for the confirmation step. */
function summarize(data: ImportedData, exportedAtWire: unknown): ImportSummary {
  const sessions = Object.values(data.log.sessions);
  const sessionDates = sessions.map((session) => session.date).sort();

  const exportedAtIsReal = typeof exportedAtWire === "string" && !Number.isNaN(new Date(exportedAtWire).getTime());

  return {
    exportedAt: exportedAtIsReal ? exportedAtWire : undefined,
    sessionCount: sessions.length,
    setCount: sessions.reduce((total, session) => total + session.sets.length, 0),
    checkCount: data.fatigueHistory.checks.length,
    firstSessionDate: sessionDates[0],
    lastSessionDate: sessionDates[sessionDates.length - 1],
    startDate: data.settings.startDate,
  };
}
