import type { DayNumber } from "../program/model";
import type { LoggedSession, LoggedSet } from "./model";

/**
 * Which program day a logged set belongs to, for READING it. A set may carry
 * its own `day` (needed once two days' sets share one date); older sets do
 * not, and then the session's `day` is the answer. Every place that
 * interprets a set's `blockPosition` (block type, program item, "last time",
 * CSV, History) goes through this one function instead of reading
 * `session.day`.
 *
 * Reading and matching follow different rules, on purpose:
 *
 *                      set has its own day    set has no day (old set)
 *   READING  (setDay)  its own day            the session's day
 *   MATCHING (isSetOnDay,
 *     identity,
 *     setsForItem)     compared to wanted day matches any day
 *
 *   setDay = set.day ?? session.day      (undefined when neither is stored)
 */
export function setDay(session: Pick<LoggedSession, "day">, set: Pick<LoggedSet, "day">): DayNumber | undefined {
  return set.day ?? session.day;
}

/**
 * MATCHING rule (see the table on `setDay`): true when `set` may be treated
 * as belonging to `wantedDay`. Only a day the set carries itself is compared:
 * a set logged before sets carried a day matches any day, exactly as before
 * this change, so an old log keeps its Today progress and re-logging still
 * overwrites it even if the start date was moved since (and the session's
 * stored `day` no longer matches the date). Sets from a combined session
 * always carry their own day, so they never match the other day's block.
 * `wantedDay` of undefined matches everything. Used by `setsForItem`, by set
 * identity in `operations.ts` and by duplicate detection in `wire.ts`.
 */
export function isSetOnDay(set: Pick<LoggedSet, "day">, wantedDay: DayNumber | undefined): boolean {
  return set.day === undefined || wantedDay === undefined || set.day === wantedDay;
}
