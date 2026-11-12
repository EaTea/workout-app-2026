import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parseProgram } from "../program/parse";
import { findLastTime, lastTimeSetFor, type LastTimeQuery } from "./lastTime";
import type { LoggedSession, LoggedSet, WorkoutLog } from "./model";

/** The real program: days 4 and 6 both have the calf raise, day 1 has the pull-up EMOM and day 5 a pull-up mini-dose. */
const program = parseProgram(JSON.parse(readFileSync("public/program.json", "utf-8"))).program;

/** A logged set with only the fields these tests care about. */
function makeSet(exerciseId: string, blockPosition: number, setNumber: number, reps = 6): LoggedSet {
  return { exerciseId, blockPosition, setNumber, reps, loggedAt: new Date("2026-11-02T10:00:00Z") };
}

/** One session on `date` that was trained as program day `day` (undefined: no day stored). */
function makeSession(date: string, day: number | undefined, sets: LoggedSet[]): LoggedSession {
  return { date, day, sets };
}

/** A log from sessions. */
function makeLog(...sessions: LoggedSession[]): WorkoutLog {
  return { sessions: Object.fromEntries(sessions.map((session) => [session.date, session])) };
}

/** A query for an item in a block of `blockType` on `dayNumber`. */
function query(exerciseId: string, dayNumber: number, blockType: string): LastTimeQuery {
  return { exerciseId, dayNumber, blockType };
}

describe("findLastTime (same slot: day number and block type)", () => {
  it("picks the most recent earlier session of the same day and block type", () => {
    const log = makeLog(
      makeSession("2026-10-26", 1, [makeSet("pull_up", 3, 1, 5)]),
      makeSession("2026-11-02", 1, [makeSet("pull_up", 3, 2), makeSet("pull_up", 3, 1)]),
      makeSession("2026-11-04", 3, [makeSet("dip", 3, 1)]),
    );

    const lastTime = findLastTime(log, program, query("pull_up", 1, "mainStrength"), "2026-11-09");

    expect(lastTime?.date).toBe("2026-11-02");
    expect(lastTime?.sets.map((set) => set.setNumber)).toEqual([1, 2]);
  });

  it("ignores the same date and later dates", () => {
    const log = makeLog(
      makeSession("2026-11-09", 1, [makeSet("pull_up", 3, 1)]),
      makeSession("2026-11-16", 1, [makeSet("pull_up", 3, 1)]),
    );

    expect(findLastTime(log, program, query("pull_up", 1, "mainStrength"), "2026-11-09")).toBeUndefined();
  });

  it("is undefined for an exercise never logged", () => {
    expect(findLastTime(makeLog(makeSession("2026-11-02", 1, [makeSet("pull_up", 3, 1)])), program, query("dip", 3, "mainStrength"), "2026-11-09")).toBeUndefined();
    expect(findLastTime({ sessions: {} }, program, query("dip", 3, "mainStrength"), "2026-11-09")).toBeUndefined();
  });

  it("prefers the same day number over a more recent session of the same block type on another day", () => {
    // The real program never trains one exercise as the same block type on two days, so day 2 is
    // given day 3's content here (dips as main work in block 3).
    const programWithTwoDipDays = { ...program, days: { ...program.days, 2: program.days[3]! } };
    const log = makeLog(
      makeSession("2026-11-04", 3, [makeSet("dip", 3, 1, 7)]),
      makeSession("2026-11-05", 2, [makeSet("dip", 3, 1, 9)]),
    );

    expect(findLastTime(log, programWithTwoDipDays, query("dip", 3, "mainStrength"), "2026-11-09")?.date).toBe("2026-11-04");
    // A day with no session of its own falls back to the most recent one of the block type.
    expect(findLastTime(log, programWithTwoDipDays, query("dip", 6, "mainStrength"), "2026-11-09")?.date).toBe("2026-11-05");
  });

  it("calf raise: the heavy main lift on day 6 ignores the easy mini-dose on day 4", () => {
    const log = makeLog(
      makeSession("2026-11-04", 4, [makeSet("single_leg_calf_raise", 4, 1, 20)]),
      makeSession("2026-11-07", 6, [makeSet("single_leg_calf_raise", 3, 1, 9)]),
      makeSession("2026-11-11", 4, [makeSet("single_leg_calf_raise", 4, 1, 22)]),
    );

    const main = findLastTime(log, program, query("single_leg_calf_raise", 6, "mainStrength"), "2026-11-14");
    expect(main?.date).toBe("2026-11-07");

    const miniDose = findLastTime(log, program, query("single_leg_calf_raise", 4, "miniDose"), "2026-11-14");
    expect(miniDose?.date).toBe("2026-11-11");
  });

  it("calf raise: with only mini-dose history, the main lift has no last time", () => {
    const log = makeLog(makeSession("2026-11-04", 4, [makeSet("single_leg_calf_raise", 4, 1, 20)]));

    expect(findLastTime(log, program, query("single_leg_calf_raise", 6, "mainStrength"), "2026-11-09")).toBeUndefined();
  });

  it("pull-up EMOM ignores a pull-up mini-dose, even a more recent one", () => {
    const log = makeLog(
      makeSession("2026-11-02", 1, [makeSet("pull_up", 3, 1, 5)]),
      makeSession("2026-11-06", 5, [makeSet("pull_up", 4, 1, 3)]),
    );

    const emom = findLastTime(log, program, query("pull_up", 1, "mainStrength"), "2026-11-09");
    expect(emom?.date).toBe("2026-11-02");

    const miniDose = findLastTime(log, program, query("pull_up", 5, "miniDose"), "2026-11-09");
    expect(miniDose?.date).toBe("2026-11-06");
  });

  it("falls back to another day's session with the same block type when the same day has none", () => {
    // Day 3's dips are the main lift (block 3); day 1's dips are a mini-dose (block 4).
    const log = makeLog(
      makeSession("2026-11-04", 3, [makeSet("dip", 3, 1, 7)]),
      makeSession("2026-11-02", 1, [makeSet("dip", 4, 1, 3)]),
    );

    // Asking as a main lift on a (hypothetical) other day finds day 3's main session, not day 1's mini-dose.
    expect(findLastTime(log, program, query("dip", 6, "mainStrength"), "2026-11-09")?.date).toBe("2026-11-04");
    // Asking as a mini-dose on day 5 falls back to day 1's mini-dose.
    expect(findLastTime(log, program, query("dip", 5, "miniDose"), "2026-11-09")?.date).toBe("2026-11-02");
  });

  it("treats a session with no stored day, an unknown day or a wrong block as no match", () => {
    const log = makeLog(
      makeSession("2026-11-02", undefined, [makeSet("pull_up", 3, 1)]),
      makeSession("2026-11-03", 9, [makeSet("pull_up", 3, 1)]),
      makeSession("2026-11-04", 1, [makeSet("pull_up", 9, 1)]),
      makeSession("2026-11-05", 1, [makeSet("pull_up", 2, 1)]),
    );

    expect(findLastTime(log, program, query("pull_up", 1, "mainStrength"), "2026-11-09")).toBeUndefined();
  });

  it("takes the block with the most sets when the exercise is in two blocks of the type, and the lower block on a tie", () => {
    // Day 1 given a second main-strength pull-up block (position 7) for this test.
    const day1 = program.days[1]!;
    const programWithRepeatedBlock = { ...program, days: { ...program.days, 1: { ...day1, blocks: [...day1.blocks, day1.blocks[2]!] } } };
    const sets = (blockPosition: number, count: number) => Array.from({ length: count }, (_unused, index) => makeSet("pull_up", blockPosition, index + 1));

    const larger = makeLog(makeSession("2026-11-02", 1, [...sets(3, 2), ...sets(7, 3)]));
    expect(findLastTime(larger, programWithRepeatedBlock, query("pull_up", 1, "mainStrength"), "2026-11-09")?.sets.map((set) => set.blockPosition)).toEqual([7, 7, 7]);

    const tie = makeLog(makeSession("2026-11-02", 1, [...sets(7, 2), ...sets(3, 2)]));
    expect(findLastTime(tie, programWithRepeatedBlock, query("pull_up", 1, "mainStrength"), "2026-11-09")?.sets.map((set) => set.blockPosition)).toEqual([3, 3]);
  });
});

describe("lastTimeSetFor", () => {
  const lastTime = { date: "2026-11-02", sets: [makeSet("x", 1, 1, 8), makeSet("x", 1, 2, 7)] };

  it("gives the same set number, else the last set, else nothing", () => {
    expect(lastTimeSetFor(lastTime, 2)?.reps).toBe(7);
    expect(lastTimeSetFor(lastTime, 5)?.reps).toBe(7);
    expect(lastTimeSetFor(undefined, 1)).toBeUndefined();
  });
});

describe("findLastTime with No equipment swaps", () => {
  // Day 4: block 3 is the single-leg RDL main strength (swap: backpack_single_leg_rdl); day 2 block 4 is its mini-dose.
  const swapSets = [makeSet("backpack_single_leg_rdl", 3, 1, 12), makeSet("backpack_single_leg_rdl", 3, 2, 12)];

  it("finds the swap's earlier sets for the swap id, in the same day and block type", () => {
    const log = makeLog(makeSession("2026-11-05", 4, swapSets));

    const lastTime = findLastTime(log, program, query("backpack_single_leg_rdl", 4, "mainStrength"), "2026-11-12");

    expect(lastTime?.date).toBe("2026-11-05");
    expect(lastTime?.sets).toHaveLength(2);
  });

  it("does not show the swap's sets as last time for the original", () => {
    const log = makeLog(makeSession("2026-11-05", 4, swapSets));

    expect(findLastTime(log, program, query("single_leg_rdl", 4, "mainStrength"), "2026-11-12")).toBeUndefined();
  });

  it("does not show the original's sets as last time for the swap", () => {
    const log = makeLog(makeSession("2026-11-05", 4, [makeSet("single_leg_rdl", 3, 1)]));

    expect(findLastTime(log, program, query("backpack_single_leg_rdl", 4, "mainStrength"), "2026-11-12")).toBeUndefined();
  });

  it("keeps the main strength and mini-dose slots apart for the swap", () => {
    const log = makeLog(makeSession("2026-11-03", 2, [makeSet("backpack_single_leg_rdl", 4, 1, 8)]));

    expect(findLastTime(log, program, query("backpack_single_leg_rdl", 4, "mainStrength"), "2026-11-12")).toBeUndefined();
    expect(findLastTime(log, program, query("backpack_single_leg_rdl", 2, "miniDose"), "2026-11-12")?.date).toBe("2026-11-03");
  });

  it("falls back to the same kind of block on another day", () => {
    // Mini-dose RDL on day 2 stands in for the mini-dose on another day, not for main strength.
    const log = makeLog(makeSession("2026-11-03", 2, [makeSet("backpack_single_leg_rdl", 4, 1, 8)]));

    expect(findLastTime(log, program, query("backpack_single_leg_rdl", 5, "miniDose"), "2026-11-12")?.date).toBe("2026-11-03");
  });

  it("does not match a swap id logged at a block position whose item has no such swap", () => {
    const log = makeLog(makeSession("2026-11-05", 4, [makeSet("backpack_single_leg_rdl", 2, 1)]));

    expect(findLastTime(log, program, query("backpack_single_leg_rdl", 4, "explosive"), "2026-11-12")).toBeUndefined();
  });
});
