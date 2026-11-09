import type { Weekday } from "./model";
import { WEEKDAYS } from "./model";

/**
 * Calendar-date maths. Everything here works on whole calendar dates
 * ("YYYY-MM-DD"), never on clock times, so daylight-saving changes and time
 * zones cannot shift a result. Dates are converted to UTC midnight only to
 * count days between them.
 *
 *   "2026-11-02" ──parse──▶ {year, month, day} ──Date.UTC──▶ ms ──/86400000──▶ day number
 *
 * `schedule.ts` calls these to find the program week and weekday for a date.
 * The caller passes "today" in as a local calendar date string.
 */

const MILLISECONDS_PER_DAY = 24 * 60 * 60 * 1000;

/** Where a date falls relative to the program. */
export type ProgramStatus =
  | { kind: "noStartDate" }
  | { kind: "notStarted"; startsOn: string }
  | { kind: "active"; week: number; weekday: Weekday }
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

/** Returns the weekday of a "YYYY-MM-DD" date, using the program's Mon..Sun spelling. */
export function weekdayOf(calendarDate: string): Weekday {
  // Day number 0 (1970-01-01) was a Thursday; Monday-first index of Thursday is 3.
  const mondayFirstIndex = (((toDayNumber(calendarDate) + 3) % 7) + 7) % 7;
  return WEEKDAYS[mondayFirstIndex] as Weekday;
}

/**
 * Works out where `today` sits in the program: before it starts, in a given
 * week (1-based), or after the last week.
 *
 * Week 1 begins on the Monday of the week containing `startDate`. Dates
 * before `startDate` itself are still "notStarted", even if they fall in
 * week 1, because Ed has not begun yet.
 */
export function programStatus(startDate: string | null, lengthWeeks: number, today: string): ProgramStatus {
  if (startDate === null) {
    return { kind: "noStartDate" };
  }

  const startDayNumber = toDayNumber(startDate);
  const todayDayNumber = toDayNumber(today);

  if (todayDayNumber < startDayNumber) {
    return { kind: "notStarted", startsOn: startDate };
  }

  const daysSinceWeekOneMonday = todayDayNumber - mondayOfWeekContaining(startDayNumber);
  const week = Math.floor(daysSinceWeekOneMonday / 7) + 1;

  if (week > lengthWeeks) {
    return { kind: "complete" };
  }

  return { kind: "active", week, weekday: weekdayOf(today) };
}

/** Given a day number, returns the day number of the Monday on or before it. */
function mondayOfWeekContaining(dayNumber: number): number {
  const mondayFirstIndex = (((dayNumber + 3) % 7) + 7) % 7;
  return dayNumber - mondayFirstIndex;
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
