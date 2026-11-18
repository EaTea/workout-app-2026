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

describe("buildLongLogWire", () => {
  it("covers each program day once in a week and skips the rest day", () => {
    const log = buildLongLogWire(program, { days: 7, lastDate: "2026-11-08" });

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
    const [firstSession] = buildLongLogWire(program, { days: 1, lastDate: "2026-11-02" }).sessions;

    expect(firstSession?.programWeek).toBe(1);
    const firstSet = firstSession?.sets[0];
    expect(firstSet).toMatchObject({
      day: 1, blockPosition: 1, setNumber: 1, reps: 6, loadKg: 8, loggedAt: "2026-11-02T18:00:00.000Z",
    });
    expect(firstSession?.sets.length).toBe(expectedSetsForDay(1));
  });

  it("numbers program weeks from 1, advancing every 7 days", () => {
    const log = buildLongLogWire(program, { days: 15, lastDate: "2026-11-15" });

    expect(log.sessions[0]?.programWeek).toBe(1);
    expect(log.sessions.at(-1)?.date).toBe("2026-11-15");
    // 15 days: index 14 is the first day of week 3 (day number 1).
    expect(log.sessions.at(-1)).toMatchObject({ programWeek: 3, day: 1 });
  });

  it("orders oldest first and crosses month and year boundaries", () => {
    const log = buildLongLogWire(program, { days: 6, lastDate: "2027-01-02" });
    const dates = log.sessions.map((session) => session.date);

    // Starts 2026-12-28 (program day 1), so all six days have sessions.
    expect(dates).toEqual(["2026-12-28", "2026-12-29", "2026-12-30", "2026-12-31", "2027-01-01", "2027-01-02"]);
    expect([...dates].sort()).toEqual(dates);
  });

  it("handles a leap day", () => {
    const log = buildLongLogWire(program, { days: 3, lastDate: "2028-03-01" });

    expect(log.sessions.map((session) => session.date)).toEqual(["2028-02-28", "2028-02-29", "2028-03-01"]);
  });

  it("produces a log that logFromWire accepts without problems", () => {
    const days = 100;
    const log = buildLongLogWire(program, { days, lastDate: "2026-11-18" });
    const { log: readLog, problems } = logFromWire(JSON.parse(JSON.stringify(log)));

    expect(problems.messages).toEqual([]);
    expect(problems.setAsideSetCount).toBe(0);
    const expectedSessions = Array.from({ length: days }, (_, index) => (index % 7) + 1).filter((dayNumber) => dayNumber !== 7).length;
    expect(Object.keys(readLog.sessions)).toHaveLength(expectedSessions);
    expect(log.sessions).toHaveLength(expectedSessions);
  });

  it("gives an empty sessions list for zero days", () => {
    expect(buildLongLogWire(program, { days: 0, lastDate: "2026-11-18" })).toEqual({ version: 1, sessions: [] });
  });
});
