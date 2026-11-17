import type { LoggedSession, LoggedSet, SkippedSet, WorkoutLog } from "./model";
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

/**
 * True when the stored skip `candidate` is the set named by `key`. Skips store a
 * day only on combined dates, so a missing day on either side means the
 * session's day (`session.day`), as `setDay` does for logged sets.
 */
function isSameSkip(session: LoggedSession, candidate: SkippedSet, key: SetKey): boolean {
  return (
    (candidate.day ?? session.day) === (key.day ?? session.day) &&
    candidate.exerciseId === key.exerciseId &&
    candidate.blockPosition === key.blockPosition &&
    candidate.setNumber === key.setNumber
  );
}

/**
 * Returns a copy of `log` with `session` stored, or with that date removed if
 * the session has neither logged nor skipped sets left.
 */
function withSession(log: WorkoutLog, date: string, session: LoggedSession): WorkoutLog {
  const sessions = { ...log.sessions };
  const hasSkips = (session.skippedSets?.length ?? 0) > 0;

  if (session.sets.length === 0 && !hasSkips) {
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

  // Logging a skipped set replaces the skip: the set is done now, so it no longer counts as skipped.
  const skippedSets = (session.skippedSets ?? []).filter((skip) => !isSameSkip(session, skip, set));

  return withSession(log, date, withSkippedSets({ ...session, sets }, skippedSets));
}

/** A copy of `session` holding `skippedSets`, leaving the field out entirely when there are none (keeps saved JSON unchanged for older logs). */
function withSkippedSets(session: LoggedSession, skippedSets: SkippedSet[]): LoggedSession {
  const { skippedSets: _previous, ...rest } = session;
  return skippedSets.length === 0 ? rest : { ...rest, skippedSets };
}

/**
 * Records that a set was skipped on purpose (Skip on the log screen). Nothing
 * is logged: the set just counts as done for its item. A set already logged
 * is left alone (logged wins), and skipping the same set twice keeps one skip.
 * `context` is only used when this creates the session. Logging the set later
 * (`logSet`) replaces the skip.
 */
export function skipSet(log: WorkoutLog, date: string, key: SetKey, context: SessionContext = {}): WorkoutLog {
  const existingSession = Object.hasOwn(log.sessions, date) ? log.sessions[date] : undefined;
  const session: LoggedSession = existingSession ?? { date, ...context, sets: [] };

  if (session.sets.some((candidate) => isSameSet(session, candidate, key))) return log;

  const skippedSets = session.skippedSets ?? [];
  if (skippedSets.some((candidate) => isSameSkip(session, candidate, key))) return log;

  // A skip always records its day (the row's own day, or the session's), so it stays on that day's row
  // even if the session's day later changes (a moved start date). Skips never mean "any day".
  const skip: SkippedSet = { exerciseId: key.exerciseId, blockPosition: key.blockPosition, setNumber: key.setNumber };
  const skipDay = key.day ?? session.day;
  if (skipDay !== undefined) skip.day = skipDay;

  return withSession(log, date, { ...session, skippedSets: [...skippedSets, skip] });
}

/**
 * The set numbers of one item that were skipped on `date`, in order. Used
 * with `setsForItem` to tell which sets of an item are done and which are
 * still open. `day` works as in `setsForItem`.
 */
export function skippedSetNumbersForItem(log: WorkoutLog, date: string, blockPosition: number, exerciseId: string, day?: DayNumber): number[] {
  const session = Object.hasOwn(log.sessions, date) ? log.sessions[date] : undefined;
  if (session === undefined || session.skippedSets === undefined) return [];

  return session.skippedSets
    .filter((skip) => skip.exerciseId === exerciseId && skip.blockPosition === blockPosition && (day === undefined || (skip.day ?? session.day) === day))
    .map((skip) => skip.setNumber)
    .sort((first, second) => first - second);
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
export function setsForItem(log: WorkoutLog, date: string, blockPosition: number, exerciseId: string, day?: DayNumber): LoggedSet[] {
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
