import { describe, expect, it } from "vitest";
import {
  backOnText,
  breakRangeText,
  historyBreakLine,
  parseBreakDays,
  pastBreakLine,
  runningBreakTitleLine,
} from "./breakText";

describe("break wording", () => {
  const weekOff = { from: "2026-11-26", to: "2026-12-03", note: "Physio: rest the neck" };

  it("shows a break's first and last day off, last day inclusive", () => {
    expect(breakRangeText(weekOff)).toBe("26 Nov to 2 Dec");
  });

  it("shows a one-day break as a single date", () => {
    expect(breakRangeText({ from: "2026-11-26", to: "2026-11-27" })).toBe("26 Nov");
  });

  it("says when training resumes with the first day back", () => {
    expect(backOnText("2026-12-03")).toBe("Back on 3 Dec");
    expect(runningBreakTitleLine(weekOff)).toBe("On a break · Back on 3 Dec");
  });

  it("writes a past break with its note, or without one", () => {
    expect(pastBreakLine(weekOff)).toBe("26 Nov to 2 Dec · Physio: rest the neck");
    expect(pastBreakLine({ from: "2026-11-26", to: "2026-12-03" })).toBe("26 Nov to 2 Dec");
  });

  it("writes History's line", () => {
    expect(historyBreakLine(weekOff)).toBe("On a break · 26 Nov to 2 Dec");
  });

  it("parses typed days: whole numbers only, anything else is NaN for startBreak to refuse", () => {
    expect(parseBreakDays(" 7 ")).toBe(7);
    expect(parseBreakDays("")).toBeNaN();
    expect(parseBreakDays("2.5")).toBeNaN();
    expect(parseBreakDays("abc")).toBeNaN();
    expect(parseBreakDays("-3")).toBeNaN();
  });
});
