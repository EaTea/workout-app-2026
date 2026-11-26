import { describe, expect, it } from "vitest";
import type { TrainingBreak } from "../break/model";
import { addDaysToDate, dateOfProgramDay, programStatus, toDayNumber, todayLocalDate } from "./calendar";

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

// ---------------------------------------------------------------------------
// Breaks from training (Break 1, step 2)
// ---------------------------------------------------------------------------

const START = "2026-11-02";
const weekBreak: TrainingBreak = { from: "2026-11-26", to: "2026-12-03" }; // 7 days; to = first day back

describe("programStatus with breaks (worked example: start 2 Nov, break 26 Nov to 3 Dec)", () => {
  it("is unchanged the day before the break (week 4, day 3)", () => {
    expect(programStatus(START, 8, "2026-11-25", [weekBreak])).toEqual({ kind: "active", week: 4, dayNumber: 3 });
  });

  it("is on a break from 26 Nov to 2 Dec, resuming on week 4 day 4 on 3 Dec", () => {
    const onBreak = { kind: "onBreak", until: "2026-12-03", week: 4, dayNumber: 4 };

    expect(programStatus(START, 8, "2026-11-26", [weekBreak])).toEqual(onBreak);
    expect(programStatus(START, 8, "2026-12-02", [weekBreak])).toEqual(onBreak);
  });

  it("resumes on week 4 day 4 on the first day back", () => {
    expect(programStatus(START, 8, "2026-12-03", [weekBreak])).toEqual({ kind: "active", week: 4, dayNumber: 4 });
  });

  it("starts week 5 seven days later than without the break (7 Dec instead of 30 Nov)", () => {
    expect(programStatus(START, 8, "2026-11-30")).toEqual({ kind: "active", week: 5, dayNumber: 1 });
    expect(programStatus(START, 8, "2026-12-06", [weekBreak])).toEqual({ kind: "active", week: 4, dayNumber: 7 });
    expect(programStatus(START, 8, "2026-12-07", [weekBreak])).toEqual({ kind: "active", week: 5, dayNumber: 1 });
  });

  it("moves the last program day and completion 7 days later", () => {
    expect(programStatus(START, 8, "2026-12-27")).toEqual({ kind: "active", week: 8, dayNumber: 7 });
    expect(programStatus(START, 8, "2026-12-28")).toEqual({ kind: "complete" });

    expect(programStatus(START, 8, "2027-01-03", [weekBreak])).toEqual({ kind: "active", week: 8, dayNumber: 7 });
    expect(programStatus(START, 8, "2027-01-04", [weekBreak])).toEqual({ kind: "complete" });
  });

  it("ignores a break before the start date", () => {
    const earlier: TrainingBreak = { from: "2026-10-01", to: "2026-10-20" };

    expect(programStatus(START, 8, "2026-11-09", [earlier])).toEqual({ kind: "active", week: 2, dayNumber: 1 });
    expect(programStatus(START, 8, "2026-10-25", [earlier])).toEqual({ kind: "notStarted", startsOn: START });
  });

  it("counts only the part of a break after the start date when it spans the start date", () => {
    const spanning: TrainingBreak = { from: "2026-10-30", to: "2026-11-05" };

    expect(programStatus(START, 8, "2026-11-03", [spanning])).toEqual({ kind: "onBreak", until: "2026-11-05", week: 1, dayNumber: 1 });
    expect(programStatus(START, 8, "2026-11-05", [spanning])).toEqual({ kind: "active", week: 1, dayNumber: 1 });
    expect(programStatus(START, 8, "2026-11-06", [spanning])).toEqual({ kind: "active", week: 1, dayNumber: 2 });
  });

  it("adds up two breaks", () => {
    const secondBreak: TrainingBreak = { from: "2026-12-10", to: "2026-12-13" }; // 3 days
    const breaks = [weekBreak, secondBreak];

    expect(programStatus(START, 8, "2026-12-09", breaks)).toEqual({ kind: "active", week: 5, dayNumber: 3 });
    expect(programStatus(START, 8, "2026-12-11", breaks)).toEqual({ kind: "onBreak", until: "2026-12-13", week: 5, dayNumber: 4 });
    expect(programStatus(START, 8, "2026-12-13", breaks)).toEqual({ kind: "active", week: 5, dayNumber: 4 });
    expect(programStatus(START, 8, "2027-01-06", breaks)).toEqual({ kind: "active", week: 8, dayNumber: 7 });
    expect(programStatus(START, 8, "2027-01-07", breaks)).toEqual({ kind: "complete" });
  });

  it("treats touching breaks as one long break", () => {
    const breaks: TrainingBreak[] = [{ from: "2026-11-26", to: "2026-11-28" }, { from: "2026-11-28", to: "2026-12-03" }];

    expect(programStatus(START, 8, "2026-11-26", breaks)).toEqual({ kind: "onBreak", until: "2026-12-03", week: 4, dayNumber: 4 });
  });

  it("resumes inside the last week when a break starts in it and runs past the end", () => {
    const lateBreak: TrainingBreak = { from: "2026-12-26", to: "2027-01-10" };

    expect(programStatus(START, 8, "2026-12-25", [lateBreak])).toEqual({ kind: "active", week: 8, dayNumber: 5 });
    expect(programStatus(START, 8, "2027-01-02", [lateBreak])).toEqual({ kind: "onBreak", until: "2027-01-10", week: 8, dayNumber: 6 });
    expect(programStatus(START, 8, "2027-01-10", [lateBreak])).toEqual({ kind: "active", week: 8, dayNumber: 6 });
  });

  it("is complete (not on a break) when the break starts after the last program day", () => {
    const afterTheEnd: TrainingBreak = { from: "2026-12-28", to: "2027-01-10" };

    expect(programStatus(START, 8, "2026-12-27", [afterTheEnd])).toEqual({ kind: "active", week: 8, dayNumber: 7 });
    expect(programStatus(START, 8, "2026-12-30", [afterTheEnd])).toEqual({ kind: "complete" });
  });

  it("does not change a date before a break or a break after the program", () => {
    const farFuture: TrainingBreak = { from: "2027-06-01", to: "2027-06-08" };

    expect(programStatus(START, 8, "2026-12-20", [farFuture])).toEqual(programStatus(START, 8, "2026-12-20"));
    expect(programStatus(START, 8, "2026-12-28", [farFuture])).toEqual({ kind: "complete" });
  });

  it("is exactly as before with no breaks, for every date of the program and around it", () => {
    for (let offset = -3; offset <= 62; offset++) {
      const date = addDaysToDate(START, offset);

      expect(programStatus(START, 8, date, [])).toEqual(programStatus(START, 8, date));
    }
  });

  it("still reports no start date with breaks", () => {
    expect(programStatus(null, 8, "2026-11-26", [weekBreak])).toEqual({ kind: "noStartDate" });
  });
});

describe("dateOfProgramDay", () => {
  it("with no breaks is start + (week-1)*7 + (day-1)", () => {
    expect(dateOfProgramDay(START, [], 1, 1)).toBe("2026-11-02");
    expect(dateOfProgramDay(START, [], 4, 1)).toBe("2026-11-23");
    expect(dateOfProgramDay(START, [], 8, 7)).toBe("2026-12-27");
  });

  it("gives the worked example's dates around the break", () => {
    expect(dateOfProgramDay(START, [weekBreak], 4, 3)).toBe("2026-11-25");
    expect(dateOfProgramDay(START, [weekBreak], 4, 4)).toBe("2026-12-03");
    expect(dateOfProgramDay(START, [weekBreak], 5, 1)).toBe("2026-12-07");
    expect(dateOfProgramDay(START, [weekBreak], 8, 7)).toBe("2027-01-03");
  });

  it("ignores a break before the start date and counts only the part after it", () => {
    expect(dateOfProgramDay(START, [{ from: "2026-10-01", to: "2026-10-20" }], 2, 1)).toBe("2026-11-09");
    expect(dateOfProgramDay(START, [{ from: "2026-10-30", to: "2026-11-05" }], 1, 1)).toBe("2026-11-05");
  });

  it("skips two breaks", () => {
    const breaks: TrainingBreak[] = [weekBreak, { from: "2026-12-10", to: "2026-12-13" }];

    expect(dateOfProgramDay(START, breaks, 5, 3)).toBe("2026-12-09");
    expect(dateOfProgramDay(START, breaks, 5, 4)).toBe("2026-12-13");
    expect(dateOfProgramDay(START, breaks, 8, 7)).toBe("2027-01-06");
  });

  it("is the inverse of programStatus for every program day, with breaks", () => {
    const breaks: TrainingBreak[] = [weekBreak, { from: "2026-12-10", to: "2026-12-13" }, { from: "2026-12-12", to: "2026-12-15" }];

    for (let week = 1; week <= 8; week++) {
      for (let dayNumber = 1; dayNumber <= 7; dayNumber++) {
        const date = dateOfProgramDay(START, breaks, week, dayNumber);

        expect(programStatus(START, 8, date, breaks)).toEqual({ kind: "active", week, dayNumber });
      }
    }
  });
});
