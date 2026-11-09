/**
 * Calendar-date maths. Everything here works on whole calendar dates
 * ("YYYY-MM-DD"), never on clock times, so daylight-saving changes and time
 * zones cannot shift a result. Dates are converted to UTC midnight only to
 * count days between them.
 *
 *   "2026-11-02" ──parse──▶ {year, month, day} ──Date.UTC──▶ ms ──/86400000──▶ day number
 *
 * `schedule.ts` calls these to find the program week and day for a date.
 * The caller passes "today" in as a local calendar date string.
 *
 * Program days count from the start date:
 *
 *   start date = day 1 of week 1; every DAYS_PER_WEEK (7) days begins a new week
 *   day 1..7 of a week run the program days numbered 1..7 in program.json
 *   (the rest day is program.restDay)
 */

import { DAYS_PER_WEEK } from "./model";

const MILLISECONDS_PER_DAY = 24 * 60 * 60 * 1000;

/** Where a date falls relative to the program. */
export type ProgramStatus =
  | { kind: "noStartDate" }
  | { kind: "notStarted"; startsOn: string }
  | { kind: "active"; week: number; dayNumber: number }
  | { kind: "complete" };

/**
 * Converts a "YYYY-MM-DD" string to a whole number of days since the Unix
 * epoch (UTC based, so there are no DST artefacts). Throws on malformed
 * input or impossible dates such as "2026-02-30".
 */
export function toDayNumber(calendarDate: string): number {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(calendarDate);
  if (!match) {
    throw new Error(`Not a calendar date (expected YYYY-MM-DD): "${calendarDate}"`);
  }

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const milliseconds = Date.UTC(year, month - 1, day);

  // Date.UTC rolls impossible dates over (Feb 30 -> Mar 2); reject those.
  const roundTrip = new Date(milliseconds);
  if (roundTrip.getUTCFullYear() !== year || roundTrip.getUTCMonth() !== month - 1 || roundTrip.getUTCDate() !== day) {
    throw new Error(`Not a real calendar date: "${calendarDate}"`);
  }

  return Math.round(milliseconds / MILLISECONDS_PER_DAY);
}

/**
 * Returns the calendar date `days` after `calendarDate` (negative = before),
 * as "YYYY-MM-DD". Whole-day UTC maths, so DST cannot shift the result.
 * Used by the schedule to find the first day of a program week.
 */
export function addDaysToDate(calendarDate: string, days: number): string {
  const shifted = new Date((toDayNumber(calendarDate) + days) * MILLISECONDS_PER_DAY);
  const year = String(shifted.getUTCFullYear()).padStart(4, "0");
  const month = String(shifted.getUTCMonth() + 1).padStart(2, "0");
  const day = String(shifted.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

/**
 * Works out where `today` sits in the program: before it starts, in a given
 * week (1-based) and day of that week (1-7), or after the last week.
 *
 * The start date is day 1 of week 1. Day number N runs the program day
 * numbered N in program.json (the rest day is program.restDay).
 *
 * Note: a start date saved by an earlier version of the app (when week 1
 * began at the start of the start date's calendar week) is now simply read as
 * day 1. The stored format is unchanged, so no migration is needed.
 */
export function programStatus(startDate: string | null, lengthWeeks: number, today: string): ProgramStatus {
  if (startDate === null) {
    return { kind: "noStartDate" };
  }

  const daysSinceStart = toDayNumber(today) - toDayNumber(startDate);

  if (daysSinceStart < 0) {
    return { kind: "notStarted", startsOn: startDate };
  }

  const week = Math.floor(daysSinceStart / DAYS_PER_WEEK) + 1;

  if (week > lengthWeeks) {
    return { kind: "complete" };
  }

  const dayNumber = (daysSinceStart % DAYS_PER_WEEK) + 1;
  return { kind: "active", week, dayNumber };
}

/**
 * Formats a JS `Date` as its LOCAL calendar date "YYYY-MM-DD" (not UTC, which
 * would give the wrong day for Ed late in the evening). Used by the app shell
 * to pass "today" to `buildSession`; `now` is injectable so tests are stable.
 */
export function todayLocalDate(now: Date = new Date()): string {
  const year = String(now.getFullYear()).padStart(4, "0");
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}
