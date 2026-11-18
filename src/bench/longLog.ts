import type { BlockWire, DayWire, ItemWire, ProgramWire } from "../program/wire.ts";
import type { LoggedSessionWireV1, LoggedSetWireV1, LogWireV1 } from "../log/wire.ts";

/**
 * Builds a synthetic workout log for the startup-time benchmark.
 *
 * This module deliberately has NO runtime imports (type imports only, with
 * `.ts` specifiers), so a plain Node script can load it with type stripping:
 * `scripts/benchStartup.ts` (coming in step 2) calls `buildLongLogWire`, writes
 * the JSON into the browser's localStorage, and times how long the app takes
 * to open Today with that much history.
 *
 *   program.json --(ProgramWire)--> buildLongLogWire --(LogWireV1)--> localStorage
 */

/** The number of milliseconds in one calendar day (UTC days never have DST shifts). */
const MILLISECONDS_PER_DAY = 24 * 60 * 60 * 1000;

/** Days in a program week; the benchmark cycles through program days 1 to 7. */
const DAYS_PER_WEEK = 7;

/** Sets per item when neither the item nor its block says how many. */
const FALLBACK_SET_COUNT = 3;

/** Every generated set records these values, so the log is valid but uninteresting. */
const LOGGED_REPS = 6;
const LOGGED_LOAD_KG = 8;

/** Options for `buildLongLogWire`. */
export interface LongLogOptions {
  /** How many consecutive calendar days of sessions to cover (0 gives an empty log). */
  days: number;
  /** The last date covered, inclusive, as "YYYY-MM-DD". */
  lastDate: string;
}

/**
 * Builds a log with one session per calendar day for `options.days` days,
 * ending on `options.lastDate` (inclusive), oldest first.
 *
 * Calendar day i (0-based from the first date) trains program day
 * (i % 7) + 1 in program week floor(i / 7) + 1. The program's rest day (the
 * day number with no entry in `program.days`) gets no session at all, because
 * `logFromWire` drops sessions without sets anyway.
 *
 * Called by the startup benchmark script to fill localStorage; the result is
 * in the stored wire format and is accepted by `logFromWire`.
 */
export function buildLongLogWire(program: ProgramWire, options: LongLogOptions): LogWireV1 {
  const firstDayNumber = utcDayNumber(options.lastDate) - (options.days - 1);
  const sessions: LoggedSessionWireV1[] = [];

  for (let dayIndex = 0; dayIndex < options.days; dayIndex++) {
    const programDayNumber = (dayIndex % DAYS_PER_WEEK) + 1;
    const programDay = program.days.find((candidate) => candidate.day === programDayNumber);
    if (programDay === undefined) continue; // Rest day: nothing to log.

    const date = formatUtcDayNumber(firstDayNumber + dayIndex);
    const programWeek = Math.floor(dayIndex / DAYS_PER_WEEK) + 1;
    sessions.push({ date, programWeek, day: programDayNumber, sets: buildSetsForDay(programDay, date) });
  }

  return { version: 1, sessions };
}

/**
 * Builds every set of one program day, logged as done on `date` at 18:00 UTC.
 * Used by `buildLongLogWire` once per session; blockPosition is the block's
 * 1-based index in the day, matching how the app numbers blocks.
 */
function buildSetsForDay(programDay: DayWire, date: string): LoggedSetWireV1[] {
  const sets: LoggedSetWireV1[] = [];

  programDay.blocks.forEach((block, blockIndex) => {
    for (const item of block.items) {
      const setCount = countSetsForItem(item, block);
      for (let setNumber = 1; setNumber <= setCount; setNumber++) {
        sets.push({
          exerciseId: item.exercise,
          day: programDay.day,
          blockPosition: blockIndex + 1,
          setNumber,
          reps: LOGGED_REPS,
          loadKg: LOGGED_LOAD_KG,
          loggedAt: `${date}T18:00:00.000Z`,
        });
      }
    }
  });

  return sets;
}

/**
 * How many sets to log for an item: its own `sets` count, else its `minutes`
 * (timed items log one set per minute), else its block's `rounds`, else 3.
 * Values that are not plain numbers (a per-set list, a `[min, max]` range)
 * are skipped in favour of the next option. Used by `buildSetsForDay`.
 */
function countSetsForItem(item: ItemWire, block: BlockWire): number {
  if (typeof item.sets === "number") return item.sets;
  if (typeof item.minutes === "number") return item.minutes;
  if (typeof block.rounds === "number") return block.rounds;
  return FALLBACK_SET_COUNT;
}

/**
 * Converts "YYYY-MM-DD" to a whole number of days since 1970-01-01, using UTC
 * only so the result never depends on the machine's time zone.
 */
function utcDayNumber(date: string): number {
  return Date.parse(`${date}T00:00:00.000Z`) / MILLISECONDS_PER_DAY;
}

/** Inverse of `utcDayNumber`: converts a UTC day count back to "YYYY-MM-DD". */
function formatUtcDayNumber(dayNumber: number): string {
  return new Date(dayNumber * MILLISECONDS_PER_DAY).toISOString().slice(0, 10);
}
