import type { LoggedSession, LoggedSet, WorkoutLog } from "./model";
import type { DayNumber } from "../program/model";

/**
 * Pure, immutable operations on a `WorkoutLog`. The log screen calls
 * `logSet` / `editSet` / `deleteSet`; Today rows and the log screen call
 * `setsForItem` (progress such as "2/6", pre-filling); History calls
 * `sessionDates`. Each function returns a new log and never mutates its input.
 */

/** Identifies one set inside a session. */
export interface SetKey {
  exerciseId: string;
  blockPosition: number;
  setNumber: number;
}

/** Fields of a set that may be changed after logging. A key present with value `undefined` clears that field. */
export interface SetChanges {
  reps?: number;
  loadKg?: number;
  note?: string;
}

/** Optional program context stored on a session the first time it is created. */
export interface SessionContext {
  programWeek?: number;
  day?: DayNumber;
}

/** True when both sets are the same exercise, block and set number. */
function isSameSet(first: SetKey, second: SetKey): boolean {
  return (
    first.exerciseId === second.exerciseId &&
    first.blockPosition === second.blockPosition &&
    first.setNumber === second.setNumber
  );
}

/** Returns a copy of `log` with `session` stored, or with that date removed if the session has no sets. */
function withSession(log: WorkoutLog, date: string, session: LoggedSession): WorkoutLog {
  const sessions = { ...log.sessions };

  if (session.sets.length === 0) {
    delete sessions[date];
  } else {
    sessions[date] = session;
  }

  return { sessions };
}

/**
 * Records a set on `date`. If a set with the same exercise, block and set
 * number already exists it is replaced (re-logging overwrites), keeping its
 * place in the list. `context` is only used when this creates the session.
 * Called when the athlete taps "Log set".
 */
export function logSet(log: WorkoutLog, date: string, set: LoggedSet, context: SessionContext = {}): WorkoutLog {
  const existingSession = Object.hasOwn(log.sessions, date) ? log.sessions[date] : undefined;
  const session: LoggedSession = existingSession ?? { date, ...context, sets: [] };

  const existingIndex = session.sets.findIndex((candidate) => isSameSet(candidate, set));
  const sets = [...session.sets];

  if (existingIndex >= 0) {
    sets[existingIndex] = set;
  } else {
    sets.push(set);
  }

  return withSession(log, date, { ...session, sets });
}

/**
 * Changes reps, load or note of an already logged set (History edit). Keeps
 * `loggedAt`. Returns the log unchanged if no such set exists.
 */
export function editSet(log: WorkoutLog, date: string, key: SetKey, changes: SetChanges): WorkoutLog {
  const session = Object.hasOwn(log.sessions, date) ? log.sessions[date] : undefined;
  if (session === undefined || !session.sets.some((candidate) => isSameSet(candidate, key))) {
    return log;
  }

  const sets = session.sets.map((candidate) => (isSameSet(candidate, key) ? { ...candidate, ...changes } : candidate));

  return withSession(log, date, { ...session, sets });
}

/**
 * Removes one logged set (History delete). Removing the last set of a session
 * removes the session too, so History never lists an empty day. Returns the
 * log unchanged if no such set exists.
 */
export function deleteSet(log: WorkoutLog, date: string, key: SetKey): WorkoutLog {
  const session = Object.hasOwn(log.sessions, date) ? log.sessions[date] : undefined;
  if (session === undefined || !session.sets.some((candidate) => isSameSet(candidate, key))) {
    return log;
  }

  const sets = session.sets.filter((candidate) => !isSameSet(candidate, key));

  return withSession(log, date, { ...session, sets });
}

/**
 * The sets logged for one item (an exercise within a block) on `date`,
 * ordered by set number. Used for Today's "2/6" progress and to pre-fill the
 * next set. For "last time" lookups, call it with an earlier date.
 */
export function setsForItem(log: WorkoutLog, date: string, blockPosition: number, exerciseId: string): LoggedSet[] {
  const session = Object.hasOwn(log.sessions, date) ? log.sessions[date] : undefined;
  if (session === undefined) {
    return [];
  }

  return session.sets
    .filter((candidate) => candidate.blockPosition === blockPosition && candidate.exerciseId === exerciseId)
    .sort((first, second) => first.setNumber - second.setNumber);
}

/**
 * All dates that have logged sets, newest first. Program dates are
 * "YYYY-MM-DD", so plain string comparison is chronological. Used by History.
 */
export function sessionDates(log: WorkoutLog): string[] {
  return Object.keys(log.sessions).sort().reverse();
}
