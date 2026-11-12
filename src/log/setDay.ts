import type { DayNumber } from "../program/model";
import type { LoggedSession, LoggedSet } from "./model";

/**
 * Which program day a logged set belongs to. A set may carry its own `day`
 * (needed once two days' sets share one date); older sets do not, and then
 * the session's `day` is the answer. Every place that interprets a set's
 * `blockPosition` (block type, program item, "last time", CSV, History,
 * set identity) goes through this one function instead of reading
 * `session.day`, so the fallback rule lives in a single place.
 *
 *   set.day ?? session.day      (undefined when neither is stored)
 */
export function setDay(session: Pick<LoggedSession, "day">, set: Pick<LoggedSet, "day">): DayNumber | undefined {
  return set.day ?? session.day;
}

/**
 * True when `set` may be treated as belonging to `wantedDay`. Only a day the
 * set carries itself is compared: a set logged before sets carried a day
 * matches any day, exactly as before this change, so an old log keeps its
 * Today progress and re-logging still overwrites it even if the start date
 * was moved since (and the session's stored `day` no longer matches the
 * date). Sets from a combined session always carry their own day, so they
 * never match the other day's block. `wantedDay` of undefined matches
 * everything. Used by `setsForItem` and by set identity in `operations.ts`.
 */
export function isSetOnDay(set: Pick<LoggedSet, "day">, wantedDay: number | undefined): boolean {
  return set.day === undefined || wantedDay === undefined || set.day === wantedDay;
}
