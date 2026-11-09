import type { LoggedSession, LoggedSet, WorkoutLog } from "./model";
import { toDayNumber } from "../program/calendar";

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
  day?: number;
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
 * Validates untrusted parsed JSON and converts it to a `WorkoutLog`. Strict:
 * throws `LogWireError` with a path-style message on any problem (unknown
 * version, wrong field type, bad date, duplicate set), because silently
 * dropping logged workouts would lose the athlete's data.
 */
export function logFromWire(wire: unknown): WorkoutLog {
  const root = requireObject(wire, "log");
  if (root.version !== 1) {
    throw new LogWireError(`log.version: unsupported version ${JSON.stringify(root.version)}`);
  }
  if (!Array.isArray(root.sessions)) {
    throw new LogWireError("log.sessions: expected an array");
  }

  const sessions: Record<string, LoggedSession> = {};
  root.sessions.forEach((rawSession, index) => {
    const session = sessionFromWire(rawSession, `log.sessions[${index}]`);
    if (Object.hasOwn(sessions, session.date)) {
      throw new LogWireError(`log.sessions[${index}].date: duplicate session for ${session.date}`);
    }
    sessions[session.date] = session;
  });

  return { sessions };
}

/** Validates and maps one session; `path` names it in error messages. */
function sessionFromWire(raw: unknown, path: string): LoggedSession {
  const record = requireObject(raw, path);

  const date = requireString(record.date, `${path}.date`);
  try {
    toDayNumber(date);
  } catch {
    throw new LogWireError(`${path}.date: not a valid YYYY-MM-DD date: ${JSON.stringify(date)}`);
  }

  if (!Array.isArray(record.sets) || record.sets.length === 0) {
    throw new LogWireError(`${path}.sets: expected a non-empty array`);
  }

  const sets: LoggedSet[] = record.sets.map((rawSet, index) => setFromWire(rawSet, `${path}.sets[${index}]`));
  rejectDuplicateSets(sets, path);

  const session: LoggedSession = { date, sets };
  if (record.programWeek !== undefined) {
    session.programWeek = requirePositiveInteger(record.programWeek, `${path}.programWeek`);
  }
  if (record.day !== undefined) {
    session.day = requirePositiveInteger(record.day, `${path}.day`);
  }
  return session;
}

/** Throws if two sets in one session share exercise, block and set number. */
function rejectDuplicateSets(sets: LoggedSet[], path: string): void {
  const seen = new Set<string>();
  for (const set of sets) {
    const identity = `${set.exerciseId}|${set.blockPosition}|${set.setNumber}`;
    if (seen.has(identity)) {
      throw new LogWireError(`${path}.sets: duplicate set ${set.exerciseId} block ${set.blockPosition} set ${set.setNumber}`);
    }
    seen.add(identity);
  }
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
