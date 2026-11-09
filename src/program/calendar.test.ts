import { describe, expect, it } from "vitest";
import { programStatus, toDayNumber, todayLocalDate, weekdayOf } from "./calendar";

describe("weekdayOf", () => {
  it("returns the calendar weekday", () => {
    expect(weekdayOf("2026-11-02")).toBe("Mon");
    expect(weekdayOf("2026-11-04")).toBe("Wed");
    expect(weekdayOf("2026-11-08")).toBe("Sun");
    expect(weekdayOf("1970-01-01")).toBe("Thu");
  });
});

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

  it("starts week 1 on the Monday of the start date's week", () => {
    expect(programStatus("2026-11-02", 8, "2026-11-02")).toEqual({ kind: "active", week: 1, weekday: "Mon" });
    expect(programStatus("2026-11-02", 8, "2026-11-08")).toEqual({ kind: "active", week: 1, weekday: "Sun" });
    expect(programStatus("2026-11-02", 8, "2026-11-09")).toEqual({ kind: "active", week: 2, weekday: "Mon" });
  });

  it("treats a mid-week start as week 1 of that week but not started before the start date", () => {
    expect(programStatus("2026-11-04", 8, "2026-11-02")).toEqual({ kind: "notStarted", startsOn: "2026-11-04" });
    expect(programStatus("2026-11-04", 8, "2026-11-04")).toEqual({ kind: "active", week: 1, weekday: "Wed" });
    expect(programStatus("2026-11-04", 8, "2026-11-09")).toEqual({ kind: "active", week: 2, weekday: "Mon" });
  });

  it("is complete after the last week", () => {
    expect(programStatus("2026-11-02", 8, "2026-12-27")).toEqual({ kind: "active", week: 8, weekday: "Sun" });
    expect(programStatus("2026-11-02", 8, "2026-12-28")).toEqual({ kind: "complete" });
  });
});

describe("todayLocalDate", () => {
  it("formats the local calendar date with zero padding", () => {
    // Local-time constructor: month index 10 = November.
    expect(todayLocalDate(new Date(2026, 10, 9, 23, 59))).toBe("2026-11-09");
    expect(todayLocalDate(new Date(2026, 0, 5, 0, 1))).toBe("2026-01-05");
  });
});
