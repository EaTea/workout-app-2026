import { addDaysToDate, toDayNumber } from "../program/calendar";
import type { TrainingBreak } from "./model";

/**
 * Pure functions over a list of breaks. `storage.ts` wraps the changing ones
 * with load and save; the schedule (Break 1 step 2) uses `breakDaysBetween`,
 * Today (step 3) uses `breakOn`, and the first-session-back offer (step 4)
 * uses `lastBreakEndedBefore`. Dates are "YYYY-MM-DD"; they compare
 * correctly as strings.
 */

/** Longest break `startBreak` accepts, in days. */
export const MAX_BREAK_DAYS = 28;

/** Input to `startBreak`: the first day of the break, how many days, and an optional note. */
export interface StartBreakRequest {
  from: string;
  days: number;
  note?: string;
}

/** Result of `startBreak` and `startBreakAndSave`; `error` is a readable reason the UI can show. */
export type StartBreakResult = { ok: true; breaks: TrainingBreak[] } | { ok: false; error: string };

/** The break covering `date` (from <= date < to), or undefined. Used by Today to show "On a break until ...". */
export function breakOn(breaks: readonly TrainingBreak[], date: string): TrainingBreak | undefined {
  return breaks.find((trainingBreak) => trainingBreak.from <= date && date < trainingBreak.to);
}

/**
 * How many dates d with fromDate <= d < toDate are covered by any break. Each
 * date counts once even when breaks overlap. The schedule subtracts this from
 * the days since the start date, so it must be right for breaks that begin
 * before `fromDate` or end after `toDate` (only the part inside the range counts).
 *
 *   range:   [fromDate ........ toDate)
 *   break A:   [--------)                 counted from its overlap only
 *   break B:        [-------------)       likewise
 */
export function breakDaysBetween(breaks: readonly TrainingBreak[], fromDate: string, toDate: string): number {
  if (toDate <= fromDate) return 0;

  const rangeStart = toDayNumber(fromDate);
  const rangeEnd = toDayNumber(toDate);

  // Clip each break to the range, then merge overlapping pieces so no day counts twice.
  const clippedPieces = breaks
    .map((trainingBreak) => ({
      start: Math.max(toDayNumber(trainingBreak.from), rangeStart),
      end: Math.min(toDayNumber(trainingBreak.to), rangeEnd),
    }))
    .filter((piece) => piece.start < piece.end)
    .sort((first, second) => first.start - second.start);

  let coveredDays = 0;
  let coveredUntil = -Infinity; // end (exclusive) of what has been counted so far
  for (const piece of clippedPieces) {
    const countedStart = Math.max(piece.start, coveredUntil);
    if (piece.end > countedStart) coveredDays += piece.end - countedStart;
    coveredUntil = Math.max(coveredUntil, piece.end);
  }

  return coveredDays;
}

/**
 * Adds a break of `days` days starting on `from`. Fails (nothing added) when
 * `days` is not a whole number from 1 to 28 or the new break would overlap an
 * existing one. Called by "Take a break" in Settings and Today.
 */
export function startBreak(breaks: readonly TrainingBreak[], request: StartBreakRequest): StartBreakResult {
  const { from, days, note } = request;

  if (!Number.isInteger(days) || days < 1 || days > MAX_BREAK_DAYS) {
    return { ok: false, error: `A break must be a whole number of days from 1 to ${MAX_BREAK_DAYS}.` };
  }

  const to = addDaysToDate(from, days);
  const overlapping = breaks.find((existing) => existing.from < to && from < existing.to);
  if (overlapping) {
    return { ok: false, error: `That overlaps a break from ${overlapping.from} to ${overlapping.to}. End that one first.` };
  }

  const newBreak: TrainingBreak = { from, to };
  const trimmedNote = note?.trim() ?? "";
  if (trimmedNote !== "") newBreak.note = trimmedNote;

  const updated = [...breaks, newBreak].sort((first, second) => (first.from < second.from ? -1 : first.from > second.from ? 1 : 0));
  return { ok: true, breaks: updated };
}

/**
 * Ends the break covering `date`, so `date` is its first day back (to = date).
 * A break ended on the day it started is removed entirely. With no break
 * covering `date` the list is returned unchanged. Called by "End the break today".
 */
export function endBreak(breaks: readonly TrainingBreak[], date: string): TrainingBreak[] {
  const covering = breakOn(breaks, date);
  if (!covering) return [...breaks];

  if (covering.from === date) return breaks.filter((trainingBreak) => trainingBreak !== covering);

  return breaks.map((trainingBreak) => (trainingBreak === covering ? { ...trainingBreak, to: date } : trainingBreak));
}

/**
 * The break with the latest `to` such that to <= date, or undefined. The
 * first-session-back offer (step 4) uses it to find the break just finished.
 */
export function lastBreakEndedBefore(breaks: readonly TrainingBreak[], date: string): TrainingBreak | undefined {
  let latest: TrainingBreak | undefined;
  for (const trainingBreak of breaks) {
    if (trainingBreak.to <= date && (latest === undefined || trainingBreak.to > latest.to)) latest = trainingBreak;
  }
  return latest;
}

/** A break must last at least this many days (to − from) to mark a "First session back" or explain a check-in drop. */
export const LONG_BREAK_MIN_DAYS = 7;

/** How many days after a long break ends its "First session back" marks can still show (same as the injury return window, 14). */
export const RETURN_FROM_BREAK_WINDOW_DAYS = 14;

/** How far back (in days) a long break still explains a dip in a check-in ("expected after time off"). */
export const RECENT_BREAK_LOOKBACK_DAYS = 28;

/** True when the break lasted `LONG_BREAK_MIN_DAYS` or more (`to` is the first day back, so to − from is its length in days). */
function isLongBreak(trainingBreak: TrainingBreak): boolean {
  return toDayNumber(trainingBreak.to) - toDayNumber(trainingBreak.from) >= LONG_BREAK_MIN_DAYS;
}

/**
 * The long break that "First session back" marks on `date` come from, or
 * undefined. A break counts when it lasted 7 days or more and ended (its
 * `to`) on or before `date` but less than `RETURN_FROM_BREAK_WINDOW_DAYS`
 * days before it. With two such breaks the one that ended last wins (a short
 * break in between does not hide an earlier long one, unlike
 * `lastBreakEndedBefore`). Called by `applyReturnToTraining` (program/injury.ts).
 */
export function returnFromBreakOn(breaks: readonly TrainingBreak[], date: string): TrainingBreak | undefined {
  let latest: TrainingBreak | undefined;
  for (const trainingBreak of breaks) {
    const isInWindow = trainingBreak.to <= date && date < addDaysToDate(trainingBreak.to, RETURN_FROM_BREAK_WINDOW_DAYS);
    if (isInWindow && isLongBreak(trainingBreak) && (latest === undefined || trainingBreak.to > latest.to)) latest = trainingBreak;
  }
  return latest;
}

/**
 * True when a long break (7 days or more) is under way on `date` or ended
 * within the `RECENT_BREAK_LOOKBACK_DAYS` days before it (the end date
 * counts, 28 days earlier does too). Used by the weekly check-in to add "A
 * drop is common after time off." to any drop warning; pure.
 */
export function wasOnLongBreakRecently(breaks: readonly TrainingBreak[], date: string): boolean {
  const windowStart = addDaysToDate(date, -RECENT_BREAK_LOOKBACK_DAYS);
  return breaks.some((trainingBreak) => isLongBreak(trainingBreak) && trainingBreak.from <= date && trainingBreak.to >= windowStart);
}
