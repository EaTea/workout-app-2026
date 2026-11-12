import type { LoggedSession, LoggedSet, WorkoutLog } from "./model";
import type { DayNumber } from "../program/model";
import { isSetOnDay } from "./setDay";

/**
 * Pure, immutable operations on a `WorkoutLog`. The log screen calls
 * `logSet` / `editSet` / `deleteSet`; Today rows and the log screen call
 * `setsForItem` (progress such as "2/6", pre-filling); History calls
 * `sessionDates`. Each function returns a new log and never mutates its input.
 */

/**
 * Identifies one set inside a session. `day` is the program day of the set's
 * block; when absent the session's day is meant (the same fallback as
 * `setDay`), so keys of single-day sessions work without it.
 */
export interface SetKey {
  exerciseId: string;
  day?: DayNumber;
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

/**
 * True when the stored `candidate` is the set named by `key`: same exercise,
 * block and set number, and the same day. A key without a day means the
 * session's day; an old set with no day of its own matches any day
 * (`isSetOnDay`), as before sets carried one. So a Day 1 block 2 set and a
 * Day 2 block 2 set of one exercise on one date stay distinct, while old logs
 * still overwrite on re-logging. Used by `logSet`, `editSet` and `deleteSet`.
 */
function isSameSet(session: LoggedSession, candidate: LoggedSet, key: SetKey): boolean {
  return (
    isSetOnDay(candidate, key.day ?? session.day) &&
    candidate.exerciseId === key.exerciseId &&
    candidate.blockPosition === key.blockPosition &&
    candidate.setNumber === key.setNumber
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
 * Records a set on `date`. If a set with the same day, exercise, block and set
 * number already exists it is replaced (re-logging overwrites), keeping its
 * place in the list. `context` is only used when this creates the session.
 * Called when the athlete taps "Log set".
 */
export function logSet(log: WorkoutLog, date: string, set: LoggedSet, context: SessionContext = {}): WorkoutLog {
  const existingSession = Object.hasOwn(log.sessions, date) ? log.sessions[date] : undefined;
  const session: LoggedSession = existingSession ?? { date, ...context, sets: [] };

  const existingIndex = session.sets.findIndex((candidate) => isSameSet(session, candidate, set));
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
  if (session === undefined || !session.sets.some((candidate) => isSameSet(session, candidate, key))) {
    return log;
  }

  const sets = session.sets.map((candidate) => (isSameSet(session, candidate, key) ? { ...candidate, ...changes } : candidate));

  return withSession(log, date, { ...session, sets });
}

/**
 * Removes one logged set (History delete). Removing the last set of a session
 * removes the session too, so History never lists an empty day. Returns the
 * log unchanged if no such set exists.
 */
export function deleteSet(log: WorkoutLog, date: string, key: SetKey): WorkoutLog {
  const session = Object.hasOwn(log.sessions, date) ? log.sessions[date] : undefined;
  if (session === undefined || !session.sets.some((candidate) => isSameSet(session, candidate, key))) {
    return log;
  }

  const sets = session.sets.filter((candidate) => !isSameSet(session, candidate, key));

  return withSession(log, date, { ...session, sets });
}

/**
 * The sets logged for one item (an exercise within a block) on `date`,
 * ordered by set number. Used for Today's "2/6" progress and to pre-fill the
 * next set. For "last time" lookups, call it with an earlier date.
 *
 * `day` is the program day the item belongs to; sets that carry a different
 * day of their own are left out, so two days' block 2 on one date are never
 * mixed (an old set with no day of its own still counts, as before).
 * Leave it out to ignore the day.
 */
export function setsForItem(log: WorkoutLog, date: string, blockPosition: number, exerciseId: string, day?: number): LoggedSet[] {
  const session = Object.hasOwn(log.sessions, date) ? log.sessions[date] : undefined;
  if (session === undefined) {
    return [];
  }

  return session.sets
    .filter(
      (candidate) =>
        candidate.blockPosition === blockPosition &&
        candidate.exerciseId === exerciseId &&
        isSetOnDay(candidate, day),
    )
    .sort((first, second) => first.setNumber - second.setNumber);
}

/**
 * All dates that have logged sets, newest first. Program dates are
 * "YYYY-MM-DD", so plain string comparison is chronological. Used by History.
 */
export function sessionDates(log: WorkoutLog): string[] {
  return Object.keys(log.sessions).sort().reverse();
}
