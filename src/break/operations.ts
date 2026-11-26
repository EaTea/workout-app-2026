import { addDaysToDate, toDayNumber } from "../program/calendar";
import type { TrainingBreak } from "./model";

/**
 * Pure functions over a list of breaks. `storage.ts` wraps the changing ones
 * with load and save; the schedule (Break 1 step 2) uses `breakDaysBetween`,
 * Today (step 3) uses `breakOn`, and the first-session-back offer (step 4)
 * uses `lastBreakEndedBefore`. Dates are "YYYY-MM-DD"; they compare
 * correctly as strings.
 */

/** Longest break `startBreak` accepts, in days (8 weeks: a physio's rest can run longer than a month). */
export const MAX_BREAK_DAYS = 56;

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
 * `days` is not a whole number from 1 to 56 or the new break would overlap an
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
 * Ends every break covering `date`, so `date` is its first day back (to =
 * date). Normally one break covers a date (`breaksFromWire` merges overlapping
 * entries), but every covering one is ended so a stray overlap can never keep
 * the date on a break. A break ended on the day it started is removed
 * entirely. With no break covering `date` the list is returned unchanged.
 * Called by "End the break today".
 */
export function endBreak(breaks: readonly TrainingBreak[], date: string): TrainingBreak[] {
  const covers = (trainingBreak: TrainingBreak): boolean => trainingBreak.from <= date && date < trainingBreak.to;

  return breaks
    .filter((trainingBreak) => !(covers(trainingBreak) && trainingBreak.from === date))
    .map((trainingBreak) => (covers(trainingBreak) ? { ...trainingBreak, to: date } : trainingBreak));
}

/**
 * Removes the break that starts on `from`, for "Cancel" on a coming break in
 * Settings (the caller only offers it for breaks that start after today).
 * With no such break the list is returned unchanged.
 */
export function cancelBreak(breaks: readonly TrainingBreak[], from: string): TrainingBreak[] {
  return breaks.filter((trainingBreak) => trainingBreak.from !== from);
}

/**
 * True when `shownDate` and the real `realToday` are inside the same break
 * stretch. A `?date=` preview of a break day uses it to decide whether to
 * hint "Go back to today to end the break." (only then does ending it from
 * today make sense). Called by app.ts for Today's break card.
 */
export function isSameBreakRunning(breaks: readonly TrainingBreak[], shownDate: string, realToday: string): boolean {
  const shownBreak = breakOn(breaks, shownDate);
  return shownBreak !== undefined && shownBreak === breakOn(breaks, realToday);
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
 * The run of breaks that "First session back" marks on `date` come from, or
 * undefined. This is the single place that decides. It is a TrainingBreak
 * whose `from` is the first day of the run and whose `to` is the first day
 * back, so callers use `to` as "trained since" and as the window start.
 *
 *   stored:  [--5 days--)[--4 days--)      touching breaks merge into one run
 *   run:     [------- 9 days -------)      9 >= 7, so it counts
 *                                  ^ first day back (the run's `to`)
 *
 * Rules, in order:
 *  - Breaks that ended on or before `programStartDate` are ignored (the
 *    program had not started, so Day 1 is not a "return").
 *  - Breaks that touch or overlap are merged into one run; the 7-day
 *    threshold (`LONG_BREAK_MIN_DAYS`) is measured over the whole run, not
 *    per stored break.
 *  - A run counts when it ended (its `to`) on or before `date` but less than
 *    `RETURN_FROM_BREAK_WINDOW_DAYS` days before it. With two such runs the
 *    one that ended last wins.
 *
 * Called by `applyReturnToTraining` (program/injury.ts).
 */
export function returnFromBreakOn(breaks: readonly TrainingBreak[], date: string, programStartDate: string | null = null): TrainingBreak | undefined {
  const countedBreaks = breaks
    .filter((trainingBreak) => programStartDate === null || trainingBreak.to > programStartDate)
    .map((trainingBreak) => ({ from: trainingBreak.from, to: trainingBreak.to }))
    .sort((first, second) => (first.from < second.from ? -1 : first.from > second.from ? 1 : 0));

  // Merge breaks that touch (next.from <= current.to) or overlap into runs.
  const runs: { from: string; to: string }[] = [];
  for (const trainingBreak of countedBreaks) {
    const currentRun = runs[runs.length - 1];
    if (currentRun !== undefined && trainingBreak.from <= currentRun.to) {
      if (trainingBreak.to > currentRun.to) currentRun.to = trainingBreak.to;
    } else {
      runs.push(trainingBreak);
    }
  }

  let latest: TrainingBreak | undefined;
  for (const run of runs) {
    const isInWindow = run.to <= date && date < addDaysToDate(run.to, RETURN_FROM_BREAK_WINDOW_DAYS);
    if (isInWindow && isLongBreak(run) && (latest === undefined || run.to > latest.to)) latest = run;
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
