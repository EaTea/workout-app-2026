import { describe, expect, it } from "vitest";
import { addDaysToDate, programStatus, toDayNumber, todayLocalDate } from "./calendar";

describe("toDayNumber", () => {
  it("counts whole days across a daylight-saving change", () => {
    expect(toDayNumber("2026-11-02") - toDayNumber("2026-03-29")).toBe(218);
  });

  it("rejects malformed and impossible dates", () => {
    expect(() => toDayNumber("2026-2-3")).toThrow();
    expect(() => toDayNumber("2026-02-30")).toThrow();
  });
});

describe("programStatus", () => {
  it("reports noStartDate without a start date", () => {
    expect(programStatus(null, 8, "2026-11-02")).toEqual({ kind: "noStartDate" });
  });

  it("counts days from the start date (2 Nov start)", () => {
    expect(programStatus("2026-11-02", 8, "2026-11-02")).toEqual({ kind: "active", week: 1, dayNumber: 1 });
    expect(programStatus("2026-11-02", 8, "2026-11-08")).toEqual({ kind: "active", week: 1, dayNumber: 7 });
    expect(programStatus("2026-11-02", 8, "2026-11-09")).toEqual({ kind: "active", week: 2, dayNumber: 1 });
  });

  it("makes a mid-week start date day 1 of week 1 (4 Nov start)", () => {
    expect(programStatus("2026-11-04", 8, "2026-11-03")).toEqual({ kind: "notStarted", startsOn: "2026-11-04" });
    expect(programStatus("2026-11-04", 8, "2026-11-04")).toEqual({ kind: "active", week: 1, dayNumber: 1 });
    expect(programStatus("2026-11-04", 8, "2026-11-10")).toEqual({ kind: "active", week: 1, dayNumber: 7 });
    expect(programStatus("2026-11-04", 8, "2026-11-11")).toEqual({ kind: "active", week: 2, dayNumber: 1 });
  });

  it("is complete after the last week", () => {
    expect(programStatus("2026-11-02", 8, "2026-12-27")).toEqual({ kind: "active", week: 8, dayNumber: 7 });
    expect(programStatus("2026-11-02", 8, "2026-12-28")).toEqual({ kind: "complete" });
    // The last day of a 4 Nov start is 29 Dec.
    expect(programStatus("2026-11-04", 8, "2026-12-29")).toEqual({ kind: "active", week: 8, dayNumber: 7 });
    expect(programStatus("2026-11-04", 8, "2026-12-30")).toEqual({ kind: "complete" });
  });
});

describe("todayLocalDate", () => {
  it("formats the local calendar date with zero padding", () => {
    // Local-time constructor: month index 10 = November.
    expect(todayLocalDate(new Date(2026, 10, 9, 23, 59))).toBe("2026-11-09");
    expect(todayLocalDate(new Date(2026, 0, 5, 0, 1))).toBe("2026-01-05");
  });
});

describe("addDaysToDate", () => {
  it("moves forward and back across month and year ends", () => {
    expect(addDaysToDate("2026-11-02", 49)).toBe("2026-12-21");
    expect(addDaysToDate("2026-12-21", -49)).toBe("2026-11-02");
    expect(addDaysToDate("2026-12-30", 3)).toBe("2027-01-02");
    expect(addDaysToDate("2026-11-02", 0)).toBe("2026-11-02");
  });
});
