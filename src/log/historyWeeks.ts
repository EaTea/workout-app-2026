/**
 * Groups the dates History shows a card for into "weeks", so the History
 * screen can draw a couple of weeks at a time ("Show older weeks").
 *
 * Walking the dates newest first, a new week starts when the stored
 * `programWeek` changes, or when the date is 7 or more days before the
 * newest date of the current week:
 *
 *   dates, newest first     stored week    group
 *   2026-11-18                  3          ─┐ week A (shown)
 *   2026-11-16                  3          ─┘
 *   2026-11-11                  2          ─┐ week B (shown)
 *   2026-11-09                  2          ─┘
 *   2026-11-04                  1          ── week C  ◀ "Show older weeks"
 *
 * The 7-day rule keeps two runs of the program apart (week 1 of a restart
 * next to an earlier week 1) and caps groups of old sessions that have no
 * stored week at 7 days. Days with only skipped sets have no card, so they
 * are left out.
 *
 * Break days do not count towards the 7 days: a program week with a break
 * inside it (25 Nov and 3 Dec around a 26 Nov to 2 Dec break, both stored as
 * week 4) is one group, because the program itself paused in between.
 *
 * Used by src/ui/history.ts to decide which cards to draw. Internal types
 * only: nothing here crosses a storage or network boundary.
 */

import { breakDaysBetween } from "../break/operations";
import type { TrainingBreak } from "../break/model";
import { toDayNumber } from "../program/calendar";
import { DAYS_PER_WEEK } from "../program/model";
import type { WorkoutLog } from "./model";
import { sessionDates } from "./operations";

/** One group of card dates for History: the dates, newest first. */
export interface HistoryWeek {
  dates: string[];
}

/**
 * Splits the dates that have a History card into weeks, newest week first,
 * each week's dates newest first. History calls this on every draw to learn
 * which dates fall into the weeks it should currently show.
 *
 * `breaks` (default none) are the breaks from training; the 7-day gap rule
 * ignores their days. Only sessions with at least one logged set count (skip-only days draw no
 * card). Relies on `sessionDates` for the newest-first order, and on
 * `toDayNumber` for DST-safe day differences.
 */
export function groupDatesIntoWeeks(log: WorkoutLog, breaks: readonly TrainingBreak[] = []): HistoryWeek[] {
  const weeks: HistoryWeek[] = [];

  // Both describe the week currently being filled (the last one in `weeks`).
  let currentWeekNewestDate = "";
  let currentWeekStoredProgramWeek: number | undefined;

  for (const date of sessionDates(log)) {
    const session = log.sessions[date];
    if (!session || session.sets.length === 0) {
      continue;
    }

    const currentWeek = weeks[weeks.length - 1];
    const startsNewWeek =
      currentWeek === undefined ||
      session.programWeek !== currentWeekStoredProgramWeek ||
      isSevenOrMoreDaysBefore(date, currentWeekNewestDate, breaks);

    if (startsNewWeek) {
      weeks.push({ dates: [date] });
      currentWeekNewestDate = date;
      currentWeekStoredProgramWeek = session.programWeek;
    } else {
      currentWeek.dates.push(date);
    }
  }

  return weeks;
}

/**
 * True when `earlierDate` is at least DAYS_PER_WEEK (7) calendar days before
 * `laterDate`. Used by `groupDatesIntoWeeks` to end a week 7 days after its
 * newest date even when the stored week stays the same: that keeps a restart's
 * week 1 apart from the first run's, and limits sessions with no stored week
 * to 7-day groups. Compares whole UTC day numbers, so DST cannot skew the count.
 * Days inside `breaks` are subtracted first: the program did not run then.
 */
function isSevenOrMoreDaysBefore(earlierDate: string, laterDate: string, breaks: readonly TrainingBreak[]): boolean {
  const calendarDays = toDayNumber(laterDate) - toDayNumber(earlierDate);
  const programDays = calendarDays - breakDaysBetween(breaks, earlierDate, laterDate);
  return programDays >= DAYS_PER_WEEK;
}
