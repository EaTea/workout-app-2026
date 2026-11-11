import type { FatigueCheck, FatigueHistory } from "./model";
import { toDayNumber } from "../program/calendar";

/**
 * Stored (JSON) shape of the fatigue history and its mapping to the internal
 * types in `model.ts`. Only `fatigueHistoryFromWire` / `fatigueHistoryToWire`
 * convert between them; `storage.ts` calls them when loading and saving.
 *
 *   { "version": 1,
 *     "checks": [ { "date": "2026-11-09", "programWeek": 2,
 *                   "broadJumpMetres": 2.31, "maxPullUps": 10,
 *                   "savedAt": "2026-11-09T07:30:00.000Z" } ] }
 */

/**
 * Wire form of one check. `savedAt` is an ISO 8601 string. `programWeek` is
 * written for older app versions but ignored on read (the week is derived
 * from the date and the current start date); it is absent for checks that
 * were never inside the program.
 */
export interface FatigueCheckWireV1 {
  date: string;
  programWeek?: number;
  broadJumpMetres?: number;
  maxPullUps?: number;
  savedAt: string;
}

/** Format v1 of the stored fatigue history. */
export interface FatigueHistoryWireV1 {
  version: 1;
  checks: FatigueCheckWireV1[];
}

/** Thrown for stored data of the wrong shape. The message says where. */
export class FatigueWireError extends Error {}

/** What `fatigueHistoryFromWire` had to leave out: a count and one readable reason per problem. */
export interface FatigueReadProblems {
  /** Checks that were left out of the history. */
  setAsideCheckCount: number;
  /** One message per problem, in file order. */
  messages: string[];
}

/** Result of `fatigueHistoryFromWire`: the readable history plus whatever was left out. */
export interface FatigueFromWireResult {
  history: FatigueHistory;
  problems: FatigueReadProblems;
}

/** Converts the internal history to the stored shape, oldest date first so the JSON is stable. */
export function fatigueHistoryToWire(history: FatigueHistory): FatigueHistoryWireV1 {
  const checks = [...history.checks]
    .sort((first, second) => first.date.localeCompare(second.date))
    .map(checkToWire);
  return { version: 1, checks };
}

/** Maps one internal check to its wire form, omitting skipped measurements and the week when unknown, and writing the time as ISO text. */
function checkToWire(check: FatigueCheck): FatigueCheckWireV1 {
  const wire: FatigueCheckWireV1 = {
    date: check.date,
    savedAt: check.savedAt.toISOString(),
  };
  if (check.savedProgramWeek !== undefined) wire.programWeek = check.savedProgramWeek;
  if (check.broadJumpMetres !== undefined) wire.broadJumpMetres = check.broadJumpMetres;
  if (check.maxPullUps !== undefined) wire.maxPullUps = check.maxPullUps;
  return wire;
}

/**
 * Validates untrusted parsed JSON and converts it to a `FatigueHistory`,
 * keeping every valid check and listing the invalid ones in `problems`, like
 * `logFromWire`. A second check for the same date is set aside (the first
 * wins). The stored `programWeek` is kept only as `savedProgramWeek`. Throws `FatigueWireError` only when the file as a whole is unusable
 * (not an object, unknown version, `checks` not an array); `loadFatigueHistory`
 * treats that as corrupt.
 */
export function fatigueHistoryFromWire(wire: unknown): FatigueFromWireResult {
  const root = requireObject(wire, "fatigue");
  if (root.version !== 1) {
    throw new FatigueWireError(`fatigue.version: unsupported version ${JSON.stringify(root.version)}`);
  }
  if (!Array.isArray(root.checks)) {
    throw new FatigueWireError("fatigue.checks: expected an array");
  }

  const problems: FatigueReadProblems = { setAsideCheckCount: 0, messages: [] };
  const checks: FatigueCheck[] = [];
  const seenDates = new Set<string>();

  root.checks.forEach((rawCheck, index) => {
    const path = `fatigue.checks[${index}]`;
    let check: FatigueCheck;
    try {
      check = checkFromWire(rawCheck, path);
    } catch (error) {
      problems.messages.push(error instanceof Error ? error.message : String(error));
      problems.setAsideCheckCount += 1;
      return;
    }

    if (seenDates.has(check.date)) {
      problems.messages.push(`${path}.date: duplicate check for ${check.date}`);
      problems.setAsideCheckCount += 1;
      return;
    }
    seenDates.add(check.date);
    checks.push(check);
  });

  return { history: { checks }, problems };
}

/** Validates and maps one check; `path` names it in error messages. */
function checkFromWire(raw: unknown, path: string): FatigueCheck {
  const record = requireObject(raw, path);

  const date = requireString(record.date, `${path}.date`);
  try {
    toDayNumber(date);
  } catch {
    throw new FatigueWireError(`${path}.date: not a valid YYYY-MM-DD date: ${JSON.stringify(date)}`);
  }

  const savedAtText = requireString(record.savedAt, `${path}.savedAt`);
  const savedAt = new Date(savedAtText);
  if (Number.isNaN(savedAt.getTime())) {
    throw new FatigueWireError(`${path}.savedAt: not a valid timestamp: ${JSON.stringify(savedAtText)}`);
  }

  const check: FatigueCheck = {
    date,
    savedAt,
  };
  // The stored week is only remembered for writing back; a missing or odd value is simply dropped.
  if (isProgramWeek(record.programWeek)) check.savedProgramWeek = record.programWeek;
  if (record.broadJumpMetres !== undefined) {
    check.broadJumpMetres = requireBroadJumpMetres(record.broadJumpMetres, `${path}.broadJumpMetres`);
  }
  if (record.maxPullUps !== undefined) {
    check.maxPullUps = requireMaxPullUps(record.maxPullUps, `${path}.maxPullUps`);
  }
  return check;
}

/** True when `value` is a whole number from 1 to 8, the weeks an older app version could have stored. */
function isProgramWeek(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 1 && value <= 8;
}

/** Returns `value` as metres: more than 0, at most 5, at most 2 decimals; or throws naming `path`. */
function requireBroadJumpMetres(value: unknown, path: string): number {
  const hasAtMostTwoDecimals = typeof value === "number" && Math.abs(value * 100 - Math.round(value * 100)) < 1e-9;
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0 || value > 5 || !hasAtMostTwoDecimals) {
    throw new FatigueWireError(`${path}: expected metres above 0 and up to 5, with at most 2 decimals`);
  }
  return value;
}

/** Returns `value` as a whole number of pull-ups from 0 to 100 or throws naming `path`. */
function requireMaxPullUps(value: unknown, path: string): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0 || value > 100) {
    throw new FatigueWireError(`${path}: expected a whole number of pull-ups from 0 to 100`);
  }
  return value;
}

/** Returns `value` as a plain object or throws naming `path`. */
function requireObject(value: unknown, path: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new FatigueWireError(`${path}: expected an object`);
  }
  return value as Record<string, unknown>;
}

/** Returns `value` as a string or throws naming `path`. */
function requireString(value: unknown, path: string): string {
  if (typeof value !== "string") {
    throw new FatigueWireError(`${path}: expected a string`);
  }
  return value;
}
