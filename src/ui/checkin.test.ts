import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { addDaysToDate } from "../program/calendar";
import { parseProgram } from "../program/parse";
import type { TrainingSettings } from "../settings/model";
import type { FatigueCheck, FatigueHistory } from "../fatigue/model";
import {
  checkInSnoozedFromWire,
  checkInSnoozedToWire,
  checkInWeekToAsk,
  createCheckInDraft,
  describeDrops,
  dropWarningForShownDate,
  fatigueWarningDismissedFromWire,
  fatigueWarningDismissedToWire,
  formatBestRecent,
  formatPercentChange,
  parseBroadJumpInput,
  roundToTwoDecimals,
} from "./checkin";

const program = parseProgram(JSON.parse(readFileSync("public/program.json", "utf-8"))).program;

// Start Mon 2 Nov: week 1 = 2-8 Nov, week 3 = 16-22 Nov, week 8 = 21-27 Dec.
// Program day 7 is the rest day (program.restDay).
const settings: TrainingSettings = { startDate: "2026-11-02", maxReps: { pull_up: 12, dip: 15 }, maxSavedOn: {}, maxHistory: {} };
const emptyHistory: FatigueHistory = { checks: [] };

/** A stored check dated on the first day of program `week` (start 2 Nov) with the given values. */
function check(week: number, values: { broadJumpMetres?: number; maxPullUps?: number }): FatigueCheck {
  return { date: addDaysToDate("2026-11-02", 7 * (week - 1)), savedAt: new Date("2026-11-02T07:00:00.000Z"), ...values };
}

describe("checkInWeekToAsk", () => {
  it("asks on a training day of a week with no check", () => {
    expect(checkInWeekToAsk(program, settings, "2026-11-16", emptyHistory, undefined)).toBe(3);
  });

  it("does not ask when that week's check is saved, but asks again next week", () => {
    const history = { checks: [check(3, { maxPullUps: 10 })] };
    expect(checkInWeekToAsk(program, settings, "2026-11-17", history, undefined)).toBeUndefined();
    expect(checkInWeekToAsk(program, settings, "2026-11-23", history, undefined)).toBe(4);
  });

  it("does not ask on the rest day, before the start, after the end or without a start date", () => {
    const restDay = "2026-11-22";
    expect(checkInWeekToAsk(program, settings, restDay, emptyHistory, undefined)).toBeUndefined();
    expect(checkInWeekToAsk(program, settings, "2026-10-01", emptyHistory, undefined)).toBeUndefined();
    expect(checkInWeekToAsk(program, settings, "2027-02-01", emptyHistory, undefined)).toBeUndefined();
    expect(checkInWeekToAsk(program, { ...settings, startDate: null }, "2026-11-16", emptyHistory, undefined)).toBeUndefined();
  });

  it("does not ask in week 8, where the retest card replaces it", () => {
    expect(checkInWeekToAsk(program, settings, "2026-12-21", emptyHistory, undefined)).toBeUndefined();
    expect(checkInWeekToAsk(program, settings, "2026-12-14", emptyHistory, undefined)).toBe(7);
  });

  it("is snoozed on the date it was snoozed and back on a later date of the same week", () => {
    expect(checkInWeekToAsk(program, settings, "2026-11-16", emptyHistory, "2026-11-16")).toBeUndefined();
    expect(checkInWeekToAsk(program, settings, "2026-11-17", emptyHistory, "2026-11-16")).toBe(3);
  });
});

describe("checks follow the current start date", () => {
  // Checks saved with start 2 Nov: 5 Nov (week 1) and 10 Nov (week 2).
  const savedHistory: FatigueHistory = {
    checks: [
      { date: "2026-11-05", maxPullUps: 12, savedAt: new Date("2026-11-05T07:00:00.000Z") },
      { date: "2026-11-10", maxPullUps: 9, savedAt: new Date("2026-11-10T07:00:00.000Z") },
    ],
  };
  const movedStart: TrainingSettings = { ...settings, startDate: "2026-11-09" };

  it("after the start moves to 9 Nov, the 10 Nov check is week 1's, so week 1 asks nothing and week 2 asks again", () => {
    expect(checkInWeekToAsk(program, movedStart, "2026-11-11", savedHistory, undefined)).toBeUndefined();
    expect(checkInWeekToAsk(program, movedStart, "2026-11-16", savedHistory, undefined)).toBe(2);
  });

  it("the 5 Nov check is ignored: it neither answers week 1 nor counts as best recent", () => {
    expect(checkInWeekToAsk(program, settings, "2026-11-04", { checks: [savedHistory.checks[0]!] }, undefined)).toBeUndefined();
    expect(checkInWeekToAsk(program, movedStart, "2026-11-10", { checks: [savedHistory.checks[0]!] }, undefined)).toBe(1);

    // Week 2 (10 pull-ups on 17 Nov) is compared with 9 Nov-start week 1 (10 Nov, 9), not with the ignored 5 Nov 12.
    const withWeekTwo: FatigueHistory = { checks: [...savedHistory.checks, { date: "2026-11-17", maxPullUps: 9, savedAt: new Date("2026-11-17T07:00:00.000Z") }] };
    expect(dropWarningForShownDate(program, movedStart, "2026-11-17", withWeekTwo).warnings).toEqual([]);
    expect(dropWarningForShownDate(program, settings, "2026-11-10", withWeekTwo).warnings).toHaveLength(1);
  });

  it("with no start date no check counts", () => {
    expect(dropWarningForShownDate(program, { ...settings, startDate: null }, "2026-11-10", savedHistory).warnings).toEqual([]);
  });
});

describe("dropWarningForShownDate", () => {
  const history = { checks: [check(1, { broadJumpMetres: 2.34, maxPullUps: 12 }), check(2, { maxPullUps: 12 }), check(3, { broadJumpMetres: 2.31, maxPullUps: 10 })] };

  it("reports the drop for any day of the week of the check, including the rest day", () => {
    for (const date of ["2026-11-16", "2026-11-22"]) {
      const result = dropWarningForShownDate(program, settings, date, history);
      expect(result.week).toBe(3);
      expect(result.warnings.map((warning) => warning.field)).toEqual(["maxPullUps"]);
    }
  });

  it("is empty the next week, outside the program, and when there is no drop", () => {
    expect(dropWarningForShownDate(program, settings, "2026-11-23", history).warnings).toEqual([]);
    expect(dropWarningForShownDate(program, settings, "2026-10-01", history).warnings).toEqual([]);
    expect(dropWarningForShownDate(program, settings, "2026-11-16", { checks: [check(3, { maxPullUps: 12 })] }).warnings).toEqual([]);
  });
});

describe("createCheckInDraft", () => {
  it("starts with both fields blank, whatever the history holds (a blank is never saved as a number)", () => {
    expect(createCheckInDraft(3)).toEqual({ week: 3 });
  });
});

describe("parseBroadJumpInput", () => {
  it("accepts up to two decimals within 0.01 to 5 and a comma", () => {
    expect(parseBroadJumpInput("2.31")).toBe(2.31);
    expect(parseBroadJumpInput(" 2,3 ")).toBe(2.3);
    expect(parseBroadJumpInput("5")).toBe(5);
    expect(parseBroadJumpInput("0.01")).toBe(0.01);
  });

  it("rejects 0, above 5, three decimals, negatives and text", () => {
    for (const text of ["0", "0.00", "5.01", "2.345", "-1", "abc", "", "2."]) {
      expect(parseBroadJumpInput(text), text).toBeUndefined();
    }
  });
});

describe("formatting", () => {
  it("rounds repeated 0.01 steps cleanly", () => {
    expect(roundToTwoDecimals(2.31 + 0.01)).toBe(2.32);
    expect(roundToTwoDecimals(0.1 + 0.2)).toBe(0.3);
  });

  it("formats best recent, percentages and drop headlines", () => {
    expect(formatBestRecent("broadJumpMetres", 2.3)).toBe("Best recent: 2.30 m");
    expect(formatBestRecent("maxPullUps", 12)).toBe("Best recent: 12 reps");
    expect(formatPercentChange(-17)).toBe("−17%");
    expect(formatPercentChange(-10.3)).toBe("−10.3%");
    expect(formatPercentChange(3)).toBe("+3%");
    expect(formatPercentChange(0)).toBe("0%");

    const jump = { field: "broadJumpMetres" as const, value: 2, best: 2.3, percentChange: -13 };
    const pullUps = { field: "maxPullUps" as const, value: 10, best: 12, percentChange: -17 };
    expect(describeDrops([pullUps])).toBe("Pull-ups are down more than 10% this week.");
    expect(describeDrops([jump])).toBe("Broad jump is down more than 10% this week.");
    expect(describeDrops([jump, pullUps])).toBe("Broad jump and pull-ups are down more than 10% this week.");
  });
});

describe("storage mapping", () => {
  it("round-trips the snoozed date and ignores corrupt text", () => {
    expect(checkInSnoozedFromWire(checkInSnoozedToWire("2026-11-16"))).toBe("2026-11-16");
    expect(checkInSnoozedFromWire(null)).toBeUndefined();
    expect(checkInSnoozedFromWire("2026-02-30")).toBeUndefined();
  });

  it("round-trips the dismissed week and ignores corrupt text", () => {
    expect(fatigueWarningDismissedFromWire(fatigueWarningDismissedToWire(3))).toBe(3);
    for (const text of [null, "x", "{}", '{"week":"3"}', '{"week":0}', '{"week":1.5}', "null"]) {
      expect(fatigueWarningDismissedFromWire(text), String(text)).toBeUndefined();
    }
  });
});
