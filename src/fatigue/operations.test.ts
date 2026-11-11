import { describe, expect, it } from "vitest";
import { addDaysToDate } from "../program/calendar";
import type { FatigueCheck, FatigueHistory, WeeklyFatigueCheck, WeeklyFatigueHistory } from "./model";
import { bestRecent, checkForWeek, compareToBest, fatigueWarnings, programWeekOfDate, recordCheck, weeklyChecksFor } from "./operations";

// Start Mon 2 Nov 2026: week 1 = 2-8 Nov, week 2 = 9-15 Nov, ...
const START_DATE = "2026-11-02";
const PROGRAM_LENGTH_WEEKS = 8;

/** Date of day 1 of program `week` when the program starts on START_DATE. */
function firstDayOfWeek(week: number): string {
  return addDaysToDate(START_DATE, 7 * (week - 1));
}

/** A stored check dated on the first day of `week` (for START_DATE) with the given measurements. */
function storedCheck(week: number, values: { broadJumpMetres?: number; maxPullUps?: number } = {}): FatigueCheck {
  return { date: firstDayOfWeek(week), savedAt: new Date("2026-11-09T07:00:00.000Z"), ...values };
}

/** A check already placed in `week`, as `weeklyChecksFor` would return it. */
function check(programWeek: number, values: { broadJumpMetres?: number; maxPullUps?: number } = {}): WeeklyFatigueCheck {
  return { ...storedCheck(programWeek, values), programWeek };
}

/** Wraps weekly checks into a history. */
function weekly(...checks: WeeklyFatigueCheck[]): WeeklyFatigueHistory {
  return { checks };
}

/** Saves `newCheck` into `history` with START_DATE and returns the weekly view of the result. */
function saveAndView(history: FatigueHistory, newCheck: FatigueCheck): WeeklyFatigueHistory {
  return weeklyChecksFor(recordCheck(history, newCheck, START_DATE, PROGRAM_LENGTH_WEEKS), START_DATE, PROGRAM_LENGTH_WEEKS);
}

describe("programWeekOfDate", () => {
  it("is the week of the date, or undefined before the start, after the end or with no start date", () => {
    expect(programWeekOfDate("2026-11-02", START_DATE, 8)).toBe(1);
    expect(programWeekOfDate("2026-11-10", "2026-11-09", 8)).toBe(1);
    expect(programWeekOfDate("2026-11-01", START_DATE, 8)).toBeUndefined();
    expect(programWeekOfDate("2026-12-28", START_DATE, 8)).toBeUndefined();
    expect(programWeekOfDate("2026-11-02", null, 8)).toBeUndefined();
  });
});

describe("weeklyChecksFor", () => {
  it("derives each check's week from the current start date, ignoring any stored week", () => {
    const history: FatigueHistory = { checks: [{ ...storedCheck(2, { maxPullUps: 10 }), savedProgramWeek: 5 }] };
    expect(weeklyChecksFor(history, START_DATE, 8).checks.map((entry) => entry.programWeek)).toEqual([2]);
  });

  it("re-files checks when the start date moves: saved with start 2 Nov, then start 9 Nov", () => {
    const history: FatigueHistory = {
      checks: [
        { date: "2026-11-05", savedProgramWeek: 1, maxPullUps: 12, savedAt: new Date("2026-11-05T07:00:00.000Z") },
        { date: "2026-11-10", savedProgramWeek: 2, maxPullUps: 10, savedAt: new Date("2026-11-10T07:00:00.000Z") },
      ],
    };

    const underOldStart = weeklyChecksFor(history, "2026-11-02", 8);
    expect(underOldStart.checks.map((entry) => [entry.date, entry.programWeek])).toEqual([["2026-11-05", 1], ["2026-11-10", 2]]);

    const underNewStart = weeklyChecksFor(history, "2026-11-09", 8);
    expect(underNewStart.checks.map((entry) => [entry.date, entry.programWeek])).toEqual([["2026-11-10", 1]]);
    expect(history.checks).toHaveLength(2); // the 5 Nov check is kept in the stored history
  });

  it("leaves out checks before the start, after the end, or when there is no start date", () => {
    const history: FatigueHistory = { checks: [storedCheck(1), { ...storedCheck(1), date: "2026-10-30" }, { ...storedCheck(1), date: "2027-03-01" }] };
    expect(weeklyChecksFor(history, START_DATE, 8).checks.map((entry) => entry.date)).toEqual(["2026-11-02"]);
    expect(weeklyChecksFor(history, null, 8).checks).toEqual([]);
  });

  it("keeps only the newest check when two land in the same week", () => {
    const history: FatigueHistory = { checks: [{ ...storedCheck(2), date: "2026-11-10", maxPullUps: 9 }, { ...storedCheck(2), date: "2026-11-12", maxPullUps: 11 }] };
    const view = weeklyChecksFor(history, START_DATE, 8);
    expect(view.checks).toHaveLength(1);
    expect(view.checks[0]?.maxPullUps).toBe(11);
  });
});

describe("recordCheck / checkForWeek", () => {
  it("adds a check, stamps the week it was saved in, and finds it by week", () => {
    const history = recordCheck({ checks: [] }, storedCheck(1, { maxPullUps: 12 }), START_DATE, 8);
    expect(history.checks[0]?.savedProgramWeek).toBe(1);

    const view = weeklyChecksFor(history, START_DATE, 8);
    expect(checkForWeek(view, 1)?.maxPullUps).toBe(12);
    expect(checkForWeek(view, 2)).toBeUndefined();
  });

  it("keeps an older check of the same derived week in storage; the newest one wins on read; the input is not mutated", () => {
    const original: FatigueHistory = { checks: [storedCheck(1, { maxPullUps: 12 }), storedCheck(2, { maxPullUps: 11 })] };
    const updated = recordCheck(original, { ...storedCheck(2, { maxPullUps: 9 }), date: "2026-11-12" }, START_DATE, 8);

    expect(updated.checks).toHaveLength(3);
    const view = weeklyChecksFor(updated, START_DATE, 8);
    expect(checkForWeek(view, 2)?.maxPullUps).toBe(9);
    expect(checkForWeek(view, 1)?.maxPullUps).toBe(12);
    expect(original.checks).toHaveLength(2);
    expect(original.checks[1]?.maxPullUps).toBe(11);
    expect(updated.checks.find((entry) => entry.date === firstDayOfWeek(2))?.maxPullUps).toBe(11);
  });

  it("re-derives every stored check's week from the current start date, dropping it outside the program", () => {
    const history: FatigueHistory = {
      checks: [
        { date: "2026-11-05", savedProgramWeek: 1, maxPullUps: 12, savedAt: new Date("2026-11-05T07:00:00.000Z") },
        { date: "2026-11-10", savedProgramWeek: 2, maxPullUps: 10, savedAt: new Date("2026-11-10T07:00:00.000Z") },
      ],
    };

    // The start moved from 2 Nov to 9 Nov: 5 Nov is now before the program, 10 Nov is week 1.
    const updated = recordCheck(history, { date: "2026-11-17", maxPullUps: 9, savedAt: new Date("2026-11-17T07:00:00.000Z") }, "2026-11-09", 8);

    expect(updated.checks.map((entry) => [entry.date, entry.savedProgramWeek])).toEqual([
      ["2026-11-05", undefined],
      ["2026-11-10", 1],
      ["2026-11-17", 2],
    ]);
    expect("savedProgramWeek" in (updated.checks[0] as FatigueCheck)).toBe(false);
    expect(history.checks[0]?.savedProgramWeek).toBe(1);
  });

  it("replaces a check with the very same date, and keeps checks dated before the start untouched", () => {
    const early: FatigueCheck = { date: "2026-10-20", maxPullUps: 14, savedAt: new Date("2026-10-20T07:00:00.000Z") };
    const updated = recordCheck({ checks: [early, storedCheck(1, { maxPullUps: 12 })] }, storedCheck(1, { maxPullUps: 8 }), START_DATE, 8);

    expect(updated.checks).toHaveLength(2);
    expect(updated.checks).toContainEqual(early);
    expect(checkForWeek(weeklyChecksFor(updated, START_DATE, 8), 1)?.maxPullUps).toBe(8);
  });

  it("saves a check dated outside the program without replacing anything in it", () => {
    const updated = recordCheck({ checks: [storedCheck(1)] }, { ...storedCheck(1), date: "2026-10-20" }, START_DATE, 8);
    expect(updated.checks).toHaveLength(2);
    expect(updated.checks.find((entry) => entry.date === "2026-10-20")?.savedProgramWeek).toBeUndefined();
  });
});

describe("best recent after a start date change", () => {
  it("does not count checks dated before the new start date", () => {
    const history: FatigueHistory = { checks: [{ ...storedCheck(1), date: "2026-11-05", maxPullUps: 20 }, { ...storedCheck(1), date: "2026-11-10", maxPullUps: 10 }] };
    const view = weeklyChecksFor(history, "2026-11-09", 8);
    expect(bestRecent(view, "maxPullUps", 2)).toBe(10);
  });
});

describe("bestRecent", () => {
  it("is undefined with no earlier checks", () => {
    expect(bestRecent(weekly(), "maxPullUps", 2)).toBeUndefined();
    expect(bestRecent(weekly(check(2, { maxPullUps: 9 })), "maxPullUps", 2)).toBeUndefined();
  });

  it("uses what there is when fewer than 3 earlier checks exist", () => {
    const history = { checks: [check(1, { maxPullUps: 10 }), check(2, { maxPullUps: 12 })] };
    expect(bestRecent(history, "maxPullUps", 3)).toBe(12);
  });

  it("looks only at the previous 3 checks, so an older high value no longer counts", () => {
    const history = {
      checks: [check(1, { maxPullUps: 20 }), check(2, { maxPullUps: 10 }), check(3, { maxPullUps: 11 }), check(4, { maxPullUps: 9 })],
    };
    expect(bestRecent(history, "maxPullUps", 5)).toBe(11);
    expect(bestRecent(history, "maxPullUps", 4)).toBe(20);
  });

  it("ignores checks that skipped the field, which do not use up a slot", () => {
    const history = {
      checks: [check(1, { maxPullUps: 12 }), check(2, { broadJumpMetres: 2.3 }), check(3, { broadJumpMetres: 2.34 }), check(4, { maxPullUps: 10 }), check(5, { maxPullUps: 11 })],
    };
    expect(bestRecent(history, "maxPullUps", 6)).toBe(12);
    expect(bestRecent(history, "broadJumpMetres", 6)).toBe(2.34);
  });

  it("ignores later weeks and works whatever the order of the checks", () => {
    const history = { checks: [check(5, { maxPullUps: 30 }), check(2, { maxPullUps: 10 }), check(1, { maxPullUps: 8 })] };
    expect(bestRecent(history, "maxPullUps", 3)).toBe(10);
  });
});

describe("compareToBest", () => {
  it("rounds to a whole percent and flags the mockup's pull-up drop but not its jump", () => {
    expect(compareToBest(2.31, 2.34)).toEqual({ percentChange: -1, isDropOverThreshold: false });
    expect(compareToBest(10, 12)).toEqual({ percentChange: -17, isDropOverThreshold: true });
  });

  it("does not flag exactly 10% but flags 10.1%", () => {
    expect(compareToBest(9, 10).isDropOverThreshold).toBe(false);
    expect(compareToBest(10.8, 12).isDropOverThreshold).toBe(false);
    expect(compareToBest(8.99, 10).isDropOverThreshold).toBe(true);
  });

  it("shows one decimal for a flagged drop that would round to -10%, so the pill never contradicts the warning", () => {
    expect(compareToBest(89.7, 100)).toEqual({ percentChange: -10.3, isDropOverThreshold: true });
    expect(compareToBest(89.9, 100)).toEqual({ percentChange: -10.1, isDropOverThreshold: true });
    expect(compareToBest(8.99, 10)).toEqual({ percentChange: -10.1, isDropOverThreshold: true });
    // From 10.5% down a whole number reads -11 (or more) and is already honest.
    expect(compareToBest(89, 100)).toEqual({ percentChange: -11, isDropOverThreshold: true });
  });

  it("never shows more than -10% for a drop that is not flagged (exactly 10%)", () => {
    expect(compareToBest(9, 10)).toEqual({ percentChange: -10, isDropOverThreshold: false });
    expect(compareToBest(10.8, 12)).toEqual({ percentChange: -10, isDropOverThreshold: false });
  });

  it("reports improvements as positive and never flags them", () => {
    expect(compareToBest(13, 12)).toEqual({ percentChange: 8, isDropOverThreshold: false });
  });

  it("reports 0% (not -0) for no change and copes with a best of 0", () => {
    expect(Object.is(compareToBest(12, 12).percentChange, 0)).toBe(true);
    expect(compareToBest(0, 0)).toEqual({ percentChange: 0, isDropOverThreshold: false });
  });
});

describe("fatigueWarnings", () => {
  const earlier: FatigueHistory = { checks: [storedCheck(1, { broadJumpMetres: 2.34, maxPullUps: 12 })] };

  it("flags only the fields down by more than 10% (mockup example)", () => {
    const view = saveAndView(earlier, storedCheck(2, { broadJumpMetres: 2.31, maxPullUps: 10 }));
    expect(fatigueWarnings(view, 2)).toEqual([{ field: "maxPullUps", value: 10, best: 12, percentChange: -17 }]);
  });

  it("is empty when there is no check for the week, nothing to compare with, or no drop", () => {
    const view = weeklyChecksFor(earlier, START_DATE, 8);
    expect(fatigueWarnings(view, 2)).toEqual([]);
    expect(fatigueWarnings(view, 1)).toEqual([]);
    expect(fatigueWarnings(saveAndView(earlier, storedCheck(2, { maxPullUps: 11 })), 2)).toEqual([]);
  });

  it("skips a field the week's check left blank", () => {
    expect(fatigueWarnings(saveAndView(earlier, storedCheck(2, { broadJumpMetres: 1.5 })), 2).map((warning) => warning.field)).toEqual(["broadJumpMetres"]);
  });

  it("compares against checks that are before the new week only, using the new start date", () => {
    // Under start 9 Nov, the 5 Nov check (pull-ups 20) is before the program and must not cause a warning.
    const history: FatigueHistory = { checks: [{ ...storedCheck(1, { maxPullUps: 20 }), date: "2026-11-05" }, { ...storedCheck(1, { maxPullUps: 10 }), date: "2026-11-10" }, { ...storedCheck(2, { maxPullUps: 10 }), date: "2026-11-17" }] };
    expect(fatigueWarnings(weeklyChecksFor(history, "2026-11-09", 8), 2)).toEqual([]);
    expect(fatigueWarnings(weeklyChecksFor(history, "2026-11-02", 8), 3)).toHaveLength(1);
  });
});
