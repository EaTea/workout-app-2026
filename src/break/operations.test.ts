import { describe, expect, it } from "vitest";
import type { TrainingBreak } from "./model";
import { breakDaysBetween, breakOn, endBreak, lastBreakEndedBefore, returnFromBreakOn, startBreak, wasOnLongBreakRecently } from "./operations";

const weekBreak: TrainingBreak = { from: "2026-11-26", to: "2026-12-03", note: "Physio" };

describe("breakOn", () => {
  it("covers from the first day up to but not including the first day back", () => {
    expect(breakOn([weekBreak], "2026-11-25")).toBeUndefined();
    expect(breakOn([weekBreak], "2026-11-26")).toBe(weekBreak);
    expect(breakOn([weekBreak], "2026-12-02")).toBe(weekBreak);
    expect(breakOn([weekBreak], "2026-12-03")).toBeUndefined();
  });

  it("returns undefined with no breaks", () => {
    expect(breakOn([], "2026-11-26")).toBeUndefined();
  });
});

describe("breakDaysBetween", () => {
  it("counts the days of a break inside the range", () => {
    expect(breakDaysBetween([weekBreak], "2026-11-01", "2026-12-31")).toBe(7);
  });

  it("counts only the part inside the range for a break starting before it", () => {
    expect(breakDaysBetween([weekBreak], "2026-11-30", "2026-12-31")).toBe(3); // 30 Nov, 1 Dec, 2 Dec
  });

  it("counts only the part inside the range for a break ending after it", () => {
    expect(breakDaysBetween([weekBreak], "2026-11-01", "2026-11-29")).toBe(3); // 26, 27, 28 Nov
  });

  it("counts a range wholly inside a break as its own length", () => {
    expect(breakDaysBetween([weekBreak], "2026-11-28", "2026-11-30")).toBe(2);
  });

  it("counts a date once when breaks overlap", () => {
    const overlapping: TrainingBreak[] = [
      { from: "2026-11-26", to: "2026-12-01" },
      { from: "2026-11-28", to: "2026-12-03" },
      { from: "2026-11-29", to: "2026-11-30" },
    ];

    expect(breakDaysBetween(overlapping, "2026-11-01", "2026-12-31")).toBe(7);
  });

  it("adds separate breaks", () => {
    const separate: TrainingBreak[] = [
      { from: "2026-11-01", to: "2026-11-03" },
      { from: "2026-11-10", to: "2026-11-13" },
    ];

    expect(breakDaysBetween(separate, "2026-11-01", "2026-12-01")).toBe(5);
  });

  it("is 0 for an empty or reversed range, or a break outside it", () => {
    expect(breakDaysBetween([weekBreak], "2026-12-03", "2026-12-03")).toBe(0);
    expect(breakDaysBetween([weekBreak], "2026-12-10", "2026-12-01")).toBe(0);
    expect(breakDaysBetween([weekBreak], "2026-12-03", "2026-12-10")).toBe(0);
    expect(breakDaysBetween([weekBreak], "2026-11-01", "2026-11-26")).toBe(0);
  });
});

describe("startBreak", () => {
  it("adds a break of the given days, with to exclusive", () => {
    const result = startBreak([], { from: "2026-11-26", days: 7, note: " Physio " });

    expect(result).toEqual({ ok: true, breaks: [{ from: "2026-11-26", to: "2026-12-03", note: "Physio" }] });
  });

  it("leaves the note out when absent or blank", () => {
    expect(startBreak([], { from: "2026-11-26", days: 1, note: "  " })).toEqual({
      ok: true,
      breaks: [{ from: "2026-11-26", to: "2026-11-27" }],
    });
  });

  it("keeps the list sorted by from", () => {
    const result = startBreak([weekBreak], { from: "2026-11-01", days: 2 });

    expect(result.ok && result.breaks.map((trainingBreak) => trainingBreak.from)).toEqual(["2026-11-01", "2026-11-26"]);
  });

  it.each([0, -1, 29, 1.5, Number.NaN])("rejects %s days", (days) => {
    const result = startBreak([], { from: "2026-11-26", days });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("1 to 28");
  });

  it("accepts the limits 1 and 28", () => {
    expect(startBreak([], { from: "2026-11-26", days: 1 }).ok).toBe(true);
    expect(startBreak([], { from: "2026-11-26", days: 28 }).ok).toBe(true);
  });

  it("rejects a break overlapping an existing one, from either side or inside it", () => {
    expect(startBreak([weekBreak], { from: "2026-11-20", days: 7 }).ok).toBe(false); // ends 27 Nov
    expect(startBreak([weekBreak], { from: "2026-12-02", days: 7 }).ok).toBe(false); // starts on its last day
    expect(startBreak([weekBreak], { from: "2026-11-27", days: 2 }).ok).toBe(false); // inside
    expect(startBreak([weekBreak], { from: "2026-11-20", days: 20 }).ok).toBe(false); // around
  });

  it("allows a break that touches an existing one without overlapping", () => {
    expect(startBreak([weekBreak], { from: "2026-12-03", days: 2 }).ok).toBe(true);
    expect(startBreak([weekBreak], { from: "2026-11-24", days: 2 }).ok).toBe(true);
  });
});

describe("endBreak", () => {
  it("ends a break mid-way so the date is the first day back", () => {
    expect(endBreak([weekBreak], "2026-11-29")).toEqual([{ from: "2026-11-26", to: "2026-11-29", note: "Physio" }]);
  });

  it("removes a break ended on the day it started", () => {
    expect(endBreak([weekBreak], "2026-11-26")).toEqual([]);
  });

  it("returns the list unchanged when no break covers the date", () => {
    expect(endBreak([weekBreak], "2026-12-03")).toEqual([weekBreak]);
    expect(endBreak([], "2026-12-03")).toEqual([]);
  });

  it("changes only the covering break", () => {
    const earlier: TrainingBreak = { from: "2026-10-01", to: "2026-10-05" };

    expect(endBreak([earlier, weekBreak], "2026-11-27")).toEqual([earlier, { ...weekBreak, to: "2026-11-27" }]);
  });
});

describe("lastBreakEndedBefore", () => {
  const earlier: TrainingBreak = { from: "2026-10-01", to: "2026-10-05" };

  it("returns the break with the latest end on or before the date", () => {
    expect(lastBreakEndedBefore([earlier, weekBreak], "2026-12-10")).toBe(weekBreak);
    expect(lastBreakEndedBefore([earlier, weekBreak], "2026-11-20")).toBe(earlier);
  });

  it("counts a break whose first day back is the date", () => {
    expect(lastBreakEndedBefore([weekBreak], "2026-12-03")).toBe(weekBreak);
  });

  it("ignores a break still running or in the future", () => {
    expect(lastBreakEndedBefore([weekBreak], "2026-12-02")).toBeUndefined();
    expect(lastBreakEndedBefore([weekBreak], "2026-11-01")).toBeUndefined();
    expect(lastBreakEndedBefore([], "2026-12-10")).toBeUndefined();
  });
});

describe("returnFromBreakOn", () => {
  it("finds a 7-day break from its end date to 13 days after, not before or after", () => {
    expect(returnFromBreakOn([weekBreak], "2026-12-02")).toBeUndefined();
    expect(returnFromBreakOn([weekBreak], "2026-12-03")).toBe(weekBreak);
    expect(returnFromBreakOn([weekBreak], "2026-12-16")).toBe(weekBreak);
    expect(returnFromBreakOn([weekBreak], "2026-12-17")).toBeUndefined();
  });

  it("ignores a break shorter than 7 days", () => {
    expect(returnFromBreakOn([{ from: "2026-11-27", to: "2026-12-03" }], "2026-12-03")).toBeUndefined();
  });

  it("takes the long break that ended last, even when a short one ended after it", () => {
    const longEarlier = { from: "2026-11-10", to: "2026-11-24" };
    const shortLater = { from: "2026-11-30", to: "2026-12-03" };

    expect(returnFromBreakOn([longEarlier, shortLater], "2026-12-03")).toBe(longEarlier);
    expect(returnFromBreakOn([longEarlier, weekBreak], "2026-12-03")).toBe(weekBreak);
  });
});

describe("wasOnLongBreakRecently", () => {
  it("is true during the break and up to 28 days after it ended", () => {
    expect(wasOnLongBreakRecently([weekBreak], "2026-11-26")).toBe(true);
    expect(wasOnLongBreakRecently([weekBreak], "2026-12-31")).toBe(true);
    expect(wasOnLongBreakRecently([weekBreak], "2027-01-01")).toBe(false);
  });

  it("is false before the break starts and for a break under 7 days", () => {
    expect(wasOnLongBreakRecently([weekBreak], "2026-11-25")).toBe(false);
    expect(wasOnLongBreakRecently([{ from: "2026-11-27", to: "2026-12-03" }], "2026-12-03")).toBe(false);
  });
});
