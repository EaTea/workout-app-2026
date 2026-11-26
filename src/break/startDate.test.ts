import { describe, expect, it } from "vitest";
import { breakStartDate } from "./startDate";

describe("breakStartDate", () => {
  it("starts today when nothing is done today", () => {
    expect(breakStartDate("2026-11-26", false, false)).toEqual({ from: "2026-11-26", reason: "today" });
  });

  it("starts tomorrow when sets are logged today", () => {
    expect(breakStartDate("2026-11-26", true, false)).toEqual({ from: "2026-11-27", reason: "trainedToday" });
  });

  it("starts tomorrow when today is a combine's donor date", () => {
    expect(breakStartDate("2026-11-26", false, true)).toEqual({ from: "2026-11-27", reason: "donorToday" });
  });

  it("names the logged sets as the reason when both apply, and rolls over a month end", () => {
    expect(breakStartDate("2026-11-30", true, true)).toEqual({ from: "2026-12-01", reason: "trainedToday" });
  });
});
