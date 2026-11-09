import type { LoggedSession, LoggedSet, WorkoutLog } from "./model";
import { toDayNumber } from "../program/calendar";
import type { DayNumber } from "../program/model";

/**
 * Stored (JSON) shape of the workout log and its mapping to the internal
 * types in `model.ts`. Only `logFromWire` / `logToWire` convert between them;
 * `storage.ts` calls them when loading and saving.
 *
 *   { "version": 1,
 *     "sessions": [ { "date": "2026-11-02", "programWeek": 1, "day": 1,
 *                     "sets": [ { "exerciseId": "pull_up", "blockPosition": 2,
 *                                 "setNumber": 1, "reps": 6, "loadKg": 6,
 *                                 "note": "...", "loggedAt": "2026-11-02T18:04:00.000Z" } ] } ] }
 */

/** Wire form of one set. `loggedAt` is an ISO 8601 string. */
export interface LoggedSetWireV1 {
  exerciseId: string;
  blockPosition: number;
  setNumber: number;
  reps?: number;
  loadKg?: number;
  note?: string;
  loggedAt: string;
}

/** Wire form of one session. */
export interface LoggedSessionWireV1 {
  date: string;
  programWeek?: number;
  day?: DayNumber;
  sets: LoggedSetWireV1[];
}

/** Format v1 of the stored log: a list of sessions. */
export interface LogWireV1 {
  version: 1;
  sessions: LoggedSessionWireV1[];
}

/** Thrown by `logFromWire` when stored data has the wrong shape. The message says where. */
export class LogWireError extends Error {}

/** Converts the internal log to the stored shape, sessions oldest first so the JSON is stable. */
export function logToWire(log: WorkoutLog): LogWireV1 {
  const sessions = Object.entries(log.sessions)
    .sort(([firstDate], [secondDate]) => firstDate.localeCompare(secondDate))
    .map(([, session]) => sessionToWire(session));

  return { version: 1, sessions };
}

/** Maps one internal session to its wire form, omitting absent optional fields. */
function sessionToWire(session: LoggedSession): LoggedSessionWireV1 {
  const wire: LoggedSessionWireV1 = { date: session.date, sets: session.sets.map(setToWire) };
  if (session.programWeek !== undefined) wire.programWeek = session.programWeek;
  if (session.day !== undefined) wire.day = session.day;
  return wire;
}

/** Maps one internal set to its wire form, omitting absent optional fields and writing the time as ISO text. */
function setToWire(set: LoggedSet): LoggedSetWireV1 {
  const wire: LoggedSetWireV1 = {
    exerciseId: set.exerciseId,
    blockPosition: set.blockPosition,
    setNumber: set.setNumber,
    loggedAt: set.loggedAt.toISOString(),
  };
  if (set.reps !== undefined) wire.reps = set.reps;
  if (set.loadKg !== undefined) wire.loadKg = set.loadKg;
  if (set.note !== undefined) wire.note = set.note;
  return wire;
}

/**
 * What `logFromWire` could not use: how many sets were set aside and one
 * readable reason per problem (path-style, e.g. "log.sessions[0].sets[1].reps:
 * expected a whole number of 0 or more"). Empty when everything was valid.
 */
export interface LogReadProblems {
  /** Sets (or, for a session that could not be read at all, the sets it held) that were left out of the log. */
  setAsideSetCount: number;
  /** One message per problem found, in file order. */
  messages: string[];
}

/** Result of `logFromWire`: the readable log plus whatever had to be left out of it. */
export interface LogFromWireResult {
  log: WorkoutLog;
  problems: LogReadProblems;
}

/**
 * Validates untrusted parsed JSON and converts it to a `WorkoutLog`, keeping
 * every valid session and set and collecting the invalid ones in `problems`
 * (PLAN.md rule 8: a few bad sets must not hide the rest of the log, and
 * `storage.ts` copies the original text aside before anything is saved).
 *
 * Still throws `LogWireError` when the file as a whole is unusable (not an
 * object, unknown version, `sessions` not an array): nothing can be kept
 * then, and `loadLog` treats that as a corrupt log.
 */
export function logFromWire(wire: unknown): LogFromWireResult {
  const root = requireObject(wire, "log");
  if (root.version !== 1) {
    throw new LogWireError(`log.version: unsupported version ${JSON.stringify(root.version)}`);
  }
  if (!Array.isArray(root.sessions)) {
    throw new LogWireError("log.sessions: expected an array");
  }

  const problems: LogReadProblems = { setAsideSetCount: 0, messages: [] };
  const sessions: Record<string, LoggedSession> = {};

  root.sessions.forEach((rawSession, index) => {
    const path = `log.sessions[${index}]`;
    const session = sessionFromWire(rawSession, path, problems);
    if (session === undefined) return;

    if (Object.hasOwn(sessions, session.date)) {
      problems.messages.push(`${path}.date: duplicate session for ${session.date}`);
      problems.setAsideSetCount += session.sets.length;
      return;
    }
    sessions[session.date] = session;
  });

  return { log: { sessions }, problems };
}

/**
 * Maps one session, keeping its valid sets. Returns undefined when the session
 * cannot be kept at all (bad date, `sets` not an array) or has nothing left
 * (no sets, or every set invalid); what was lost is recorded in `problems`.
 * `path` names the session in messages.
 */
function sessionFromWire(raw: unknown, path: string, problems: LogReadProblems): LoggedSession | undefined {
  let record: Record<string, unknown>;
  try {
    record = requireObject(raw, path);
  } catch (error) {
    recordProblem(problems, error, 1);
    return undefined;
  }

  const rawSets: unknown[] = Array.isArray(record.sets) ? record.sets : [];

  let date: string;
  try {
    date = requireString(record.date, `${path}.date`);
    try {
      toDayNumber(date);
    } catch {
      throw new LogWireError(`${path}.date: not a valid YYYY-MM-DD date: ${JSON.stringify(date)}`);
    }
  } catch (error) {
    recordProblem(problems, error, Math.max(rawSets.length, 1));
    return undefined;
  }

  if (!Array.isArray(record.sets)) {
    recordProblem(problems, new LogWireError(`${path}.sets: expected an array`), 1);
    return undefined;
  }

  // An empty session holds no data, so dropping it loses nothing and needs no warning.
  const sets: LoggedSet[] = [];
  const seenSetIdentities = new Set<string>();
  rawSets.forEach((rawSet, index) => {
    const setPath = `${path}.sets[${index}]`;
    let set: LoggedSet;
    try {
      set = setFromWire(rawSet, setPath);
    } catch (error) {
      recordProblem(problems, error, 1);
      return;
    }

    const identity = `${set.exerciseId}|${set.blockPosition}|${set.setNumber}`;
    if (seenSetIdentities.has(identity)) {
      recordProblem(problems, new LogWireError(`${setPath}: duplicate set ${set.exerciseId} block ${set.blockPosition} set ${set.setNumber}`), 1);
      return;
    }
    seenSetIdentities.add(identity);
    sets.push(set);
  });

  if (sets.length === 0) return undefined;

  const session: LoggedSession = { date, sets };

  // programWeek and day are only History context: a bad value drops that field, not the sets.
  if (record.programWeek !== undefined) {
    try {
      session.programWeek = requirePositiveInteger(record.programWeek, `${path}.programWeek`);
    } catch (error) {
      recordProblem(problems, error, 0);
    }
  }
  if (record.day !== undefined) {
    try {
      session.day = requireDayNumber(record.day, `${path}.day`);
    } catch (error) {
      recordProblem(problems, error, 0);
    }
  }
  return session;
}

/** Adds the message of a caught `LogWireError` to `problems`, counting `setCount` sets as set aside. */
function recordProblem(problems: LogReadProblems, error: unknown, setCount: number): void {
  problems.messages.push(error instanceof Error ? error.message : String(error));
  problems.setAsideSetCount += setCount;
}

/** Validates and maps one set; `path` names it in error messages. */
function setFromWire(raw: unknown, path: string): LoggedSet {
  const record = requireObject(raw, path);

  const loggedAtText = requireString(record.loggedAt, `${path}.loggedAt`);
  const loggedAt = new Date(loggedAtText);
  if (Number.isNaN(loggedAt.getTime())) {
    throw new LogWireError(`${path}.loggedAt: not a valid timestamp: ${JSON.stringify(loggedAtText)}`);
  }

  const set: LoggedSet = {
    exerciseId: requireString(record.exerciseId, `${path}.exerciseId`),
    blockPosition: requirePositiveInteger(record.blockPosition, `${path}.blockPosition`),
    setNumber: requirePositiveInteger(record.setNumber, `${path}.setNumber`),
    loggedAt,
  };
  if (record.reps !== undefined) set.reps = requireNonNegativeNumber(record.reps, `${path}.reps`, true);
  if (record.loadKg !== undefined) set.loadKg = requireNonNegativeNumber(record.loadKg, `${path}.loadKg`, false);
  if (record.note !== undefined) set.note = requireString(record.note, `${path}.note`);
  return set;
}

/** Returns `value` as a program day number (a whole number from 1 to 7) or throws naming `path`. */
function requireDayNumber(value: unknown, path: string): DayNumber {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 1 || value > 7) {
    throw new LogWireError(`${path}: expected a day number from 1 to 7`);
  }
  return value;
}

/** Returns `value` as a plain object or throws naming `path`. */
function requireObject(value: unknown, path: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new LogWireError(`${path}: expected an object`);
  }
  return value as Record<string, unknown>;
}

/** Returns `value` as a string or throws naming `path`. */
function requireString(value: unknown, path: string): string {
  if (typeof value !== "string") {
    throw new LogWireError(`${path}: expected a string`);
  }
  return value;
}

/** Returns `value` as an integer of at least 1 or throws naming `path`. */
function requirePositiveInteger(value: unknown, path: string): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 1) {
    throw new LogWireError(`${path}: expected a whole number of at least 1`);
  }
  return value;
}

/** Returns `value` as a finite number >= 0 (a whole number if `mustBeInteger`) or throws naming `path`. */
function requireNonNegativeNumber(value: unknown, path: string, mustBeInteger: boolean): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || (mustBeInteger && !Number.isInteger(value))) {
    throw new LogWireError(`${path}: expected a ${mustBeInteger ? "whole " : ""}number of 0 or more`);
  }
  return value;
}
