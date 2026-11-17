import { describe, expect, it } from "vitest";
import { rowToScrollTo, todayRowKey, type TodayRowState } from "./returnScroll";

/** Builds rows with the given completion, keyed r0, r1, ... */
function rows(...complete: boolean[]): TodayRowState[] {
  return complete.map((isComplete, index) => ({ key: `r${index}`, isComplete }));
}

describe("todayRowKey", () => {
  it("tells a row apart by block, exercise and, on a combined date, day", () => {
    expect(todayRowKey(2, "pull_up", undefined)).toBe("2:pull_up:");
    expect(todayRowKey(2, "pull_up", 1)).not.toBe(todayRowKey(2, "pull_up", 2));
    expect(todayRowKey(2, "pull_up", undefined)).not.toBe(todayRowKey(3, "pull_up", undefined));
  });
});

describe("rowToScrollTo", () => {
  it("goes to the next unfinished row after the one just worked on", () => {
    expect(rowToScrollTo(rows(false, false, false, false), "r1")).toBe(2);
  });

  it("skips finished rows after the worked row", () => {
    expect(rowToScrollTo(rows(false, false, true, true, false), "r1")).toBe(4);
  });

  it("falls back to the first unfinished row of the day when none is left after it", () => {
    expect(rowToScrollTo(rows(false, true, true), "r2")).toBe(0);
  });

  it("stays put when every row is finished", () => {
    expect(rowToScrollTo(rows(true, true, true), "r1")).toBeUndefined();
  });

  it("does nothing when the worked row is not on the screen", () => {
    expect(rowToScrollTo(rows(false, false), "missing")).toBeUndefined();
  });

  it("the worked row itself is not picked even if it is still unfinished", () => {
    expect(rowToScrollTo(rows(false), "r0")).toBeUndefined();
  });
});
