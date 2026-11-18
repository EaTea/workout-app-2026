import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { logFromWire } from "../log/wire";
import type { ProgramWire } from "../program/wire";
import { buildLongLogWire } from "./longLog";

/** The shipped program, read as raw JSON (the generator works on wire types). */
const program = JSON.parse(readFileSync("public/program.json", "utf8")) as ProgramWire;

/** Independent set count for one program day, written differently from the generator. */
function expectedSetsForDay(dayNumber: number): number {
  const day = program.days.find((candidate) => candidate.day === dayNumber);
  if (day === undefined) return 0;
  let total = 0;
  for (const block of day.blocks) {
    for (const item of block.items) {
      const fromSets = typeof item.sets === "number" ? item.sets : undefined;
      const fromMinutes = typeof item.minutes === "number" ? item.minutes : undefined;
      const fromRounds = typeof block.rounds === "number" ? block.rounds : undefined;
      total += fromSets ?? fromMinutes ?? fromRounds ?? 3;
    }
  }
  return total;
}

/** Same date as the benchmark script's seeded settings (Monday, so it is program day 1). */
const START = "2026-11-02";

describe("buildLongLogWire", () => {
  it("covers each program day once in a week and skips the rest day", () => {
    const log = buildLongLogWire(program, { days: 7, lastDate: "2026-11-08", programStartDate: START });

    expect(log.version).toBe(1);
    expect(log.sessions.map((session) => session.day)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(log.sessions.map((session) => session.date)).toEqual([
      "2026-11-02", "2026-11-03", "2026-11-04", "2026-11-05", "2026-11-06", "2026-11-07",
    ]);

    const totalSets = log.sessions.reduce((sum, session) => sum + session.sets.length, 0);
    const expectedTotal = [1, 2, 3, 4, 5, 6, 7].reduce((sum, dayNumber) => sum + expectedSetsForDay(dayNumber), 0);
    expect(totalSets).toBe(expectedTotal);
  });

  it("fills in the set fields as specified", () => {
    const [firstSession] = buildLongLogWire(program, { days: 1, lastDate: "2026-11-02", programStartDate: START }).sessions;

    expect(firstSession?.programWeek).toBe(1);
    const firstSet = firstSession?.sets[0];
    expect(firstSet).toMatchObject({
      day: 1, blockPosition: 1, setNumber: 1, reps: 6, loadKg: 8, loggedAt: "2026-11-02T18:00:00.000Z",
    });
    expect(firstSession?.sets.length).toBe(expectedSetsForDay(1));
  });

  it("numbers program weeks from 1 at the log's first date, advancing every 7 days", () => {
    // 15 days from 2026-11-02 (index 0) to 2026-11-16 (index 14, a Monday: day 1 of week 3).
    const log = buildLongLogWire(program, { days: 15, lastDate: "2026-11-16", programStartDate: START });

    expect(log.sessions[0]?.programWeek).toBe(1);
    expect(log.sessions.at(-1)).toMatchObject({ date: "2026-11-16", programWeek: 3, day: 1 });
  });

  it("anchors day numbers to the program start date, including dates before it", () => {
    // Log starts 2026-10-30 (3 days before the start) and ends 2026-11-03.
    const log = buildLongLogWire(program, { days: 5, lastDate: "2026-11-03", programStartDate: START });

    // 10-30 is -3 days: day 5; 10-31: 6; 11-01 is -1: day 7 (rest, no session); 11-02: 1; 11-03: 2.
    expect(log.sessions.map((session) => [session.date, session.day])).toEqual([
      ["2026-10-30", 5], ["2026-10-31", 6], ["2026-11-02", 1], ["2026-11-03", 2],
    ]);
    // programWeek counts from the log's first date and stays a positive integer.
    expect(log.sessions.every((session) => Number.isInteger(session.programWeek) && (session.programWeek ?? 0) >= 1)).toBe(true);
  });

  it("gives the same day for the same date whatever the log length", () => {
    const short = buildLongLogWire(program, { days: 10, lastDate: "2026-11-17", programStartDate: START });
    const long = buildLongLogWire(program, { days: 400, lastDate: "2026-11-17", programStartDate: START });
    const dayByDate = new Map(long.sessions.map((session) => [session.date, session.day]));

    for (const session of short.sessions) expect(dayByDate.get(session.date)).toBe(session.day);
  });

  it("orders oldest first and crosses month and year boundaries", () => {
    const log = buildLongLogWire(program, { days: 6, lastDate: "2027-01-02", programStartDate: "2026-12-28" });
    const dates = log.sessions.map((session) => session.date);

    // Starts 2026-12-28 (program day 1), so all six days have sessions.
    expect(dates).toEqual(["2026-12-28", "2026-12-29", "2026-12-30", "2026-12-31", "2027-01-01", "2027-01-02"]);
    expect([...dates].sort()).toEqual(dates);
  });

  it("handles a leap day", () => {
    const log = buildLongLogWire(program, { days: 3, lastDate: "2028-03-01", programStartDate: "2028-02-28" });

    expect(log.sessions.map((session) => session.date)).toEqual(["2028-02-28", "2028-02-29", "2028-03-01"]);
  });

  it("produces a log that logFromWire accepts without problems", () => {
    const days = 100;
    const log = buildLongLogWire(program, { days, lastDate: "2026-11-18", programStartDate: START });
    const { log: readLog, problems } = logFromWire(JSON.parse(JSON.stringify(log)));

    expect(problems.messages).toEqual([]);
    expect(problems.setAsideSetCount).toBe(0);
    expect(Object.keys(readLog.sessions)).toHaveLength(log.sessions.length);
    // 100 consecutive days contain 14 rest days (every 7th day) or 15, never more.
    expect(log.sessions.length).toBeGreaterThanOrEqual(days - 15);
  });

  it("accepts the benchmark's 730-day log (same lastDate and start date) with zero problems", () => {
    const log = buildLongLogWire(program, { days: 730, lastDate: "2026-11-17", programStartDate: START });
    const { problems } = logFromWire(JSON.parse(JSON.stringify(log)));

    expect(problems.messages).toEqual([]);
    expect(problems.setAsideSetCount).toBe(0);
  });

  it("gives an empty sessions list for zero days", () => {
    expect(buildLongLogWire(program, { days: 0, lastDate: "2026-11-18", programStartDate: START })).toEqual({ version: 1, sessions: [] });
  });
});
