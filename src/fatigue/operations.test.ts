import { describe, expect, it } from "vitest";
import type { FatigueCheck, FatigueHistory } from "./model";
import { bestRecent, checkForWeek, compareToBest, fatigueWarnings, recordCheck } from "./operations";

/** Builds a check for `programWeek` with the given measurements. */
function check(programWeek: number, values: { broadJumpMetres?: number; maxPullUps?: number } = {}): FatigueCheck {
  return { date: "2026-11-09", programWeek, savedAt: new Date("2026-11-09T07:00:00.000Z"), ...values };
}

describe("recordCheck / checkForWeek", () => {
  it("adds a check and finds it by week", () => {
    const history = recordCheck({ checks: [] }, check(1, { maxPullUps: 12 }));
    expect(checkForWeek(history, 1)?.maxPullUps).toBe(12);
    expect(checkForWeek(history, 2)).toBeUndefined();
  });

  it("replaces the check of the same week and leaves other weeks alone, without mutating the input", () => {
    const original: FatigueHistory = { checks: [check(1, { maxPullUps: 12 }), check(2, { maxPullUps: 11 })] };
    const updated = recordCheck(original, check(2, { maxPullUps: 9 }));

    expect(updated.checks).toHaveLength(2);
    expect(checkForWeek(updated, 2)?.maxPullUps).toBe(9);
    expect(checkForWeek(updated, 1)?.maxPullUps).toBe(12);
    expect(checkForWeek(original, 2)?.maxPullUps).toBe(11);
  });
});

describe("bestRecent", () => {
  it("is undefined with no earlier checks", () => {
    expect(bestRecent({ checks: [] }, "maxPullUps", 2)).toBeUndefined();
    expect(bestRecent({ checks: [check(2, { maxPullUps: 9 })] }, "maxPullUps", 2)).toBeUndefined();
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
  const earlier: FatigueHistory = { checks: [check(1, { broadJumpMetres: 2.34, maxPullUps: 12 })] };

  it("flags only the fields down by more than 10% (mockup example)", () => {
    const history = recordCheck(earlier, check(2, { broadJumpMetres: 2.31, maxPullUps: 10 }));
    expect(fatigueWarnings(history, 2)).toEqual([{ field: "maxPullUps", value: 10, best: 12, percentChange: -17 }]);
  });

  it("is empty when there is no check for the week, nothing to compare with, or no drop", () => {
    expect(fatigueWarnings(earlier, 2)).toEqual([]);
    expect(fatigueWarnings(earlier, 1)).toEqual([]);
    expect(fatigueWarnings(recordCheck(earlier, check(2, { maxPullUps: 11 })), 2)).toEqual([]);
  });

  it("skips a field the week's check left blank", () => {
    expect(fatigueWarnings(recordCheck(earlier, check(2, { broadJumpMetres: 1.5 })), 2).map((warning) => warning.field)).toEqual(["broadJumpMetres"]);
  });
});
