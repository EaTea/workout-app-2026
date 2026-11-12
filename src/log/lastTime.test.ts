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

describe("findLastTime (sets that carry their own day)", () => {
  /** One date holding two days: pull-ups as day 1 main strength (block 3) and as day 5 mini-dose (block 4). */
  const twoDaySession = makeSession("2026-11-02", 1, [
    { ...makeSet("pull_up", 3, 1, 8), day: 1 },
    { ...makeSet("pull_up", 4, 1, 3), day: 5 },
  ]);

  it("finds each day's own sets in a session holding two days", () => {
    const log = makeLog(twoDaySession);

    const mainStrength = findLastTime(log, program, query("pull_up", 1, "mainStrength"), "2026-11-09");
    const miniDose = findLastTime(log, program, query("pull_up", 5, "miniDose"), "2026-11-09");

    expect(mainStrength?.sets.map((set) => set.reps)).toEqual([8]);
    expect(miniDose?.sets.map((set) => set.reps)).toEqual([3]);
  });

  it("counts a session for a day only if one of its sets is on that day, preferring it over a newer session of another day", () => {
    // Heavy bag is block 6 (finisher) on both Day 1 and Day 5, so the block type cannot tell the days apart: only the day can.
    const olderDayOne = makeSession("2026-11-02", 1, [makeSet("heavy_bag", 6, 1, 4)]);

    // A newer plain Day 5 session must not win the "same day" tier for a Day 1 query.
    const newerDayFive = makeLog(olderDayOne, makeSession("2026-11-04", 5, [makeSet("heavy_bag", 6, 1, 7)]));
    expect(findLastTime(newerDayFive, program, query("heavy_bag", 1, "finisher"), "2026-11-09")?.sets[0]?.reps).toBe(4);
    // ...but it is the answer for a Day 5 query, and Day 5 would otherwise fall back to it anyway.
    expect(findLastTime(newerDayFive, program, query("heavy_bag", 5, "finisher"), "2026-11-09")?.sets[0]?.reps).toBe(7);

    // A newer combined session (stored day 1) whose heavy-bag set is on Day 5 is not a Day 1 session for this exercise.
    const newerCombined = makeLog(olderDayOne, makeSession("2026-11-04", 1, [{ ...makeSet("heavy_bag", 6, 1, 7), day: 5 }]));
    expect(findLastTime(newerCombined, program, query("heavy_bag", 1, "finisher"), "2026-11-09")?.sets[0]?.reps).toBe(4);

    // And a set on Day 1 inside a session stored as Day 5 does count for Day 1.
    const dayOneSetInDayFiveSession = makeLog(
      makeSession("2026-11-02", 5, [makeSet("heavy_bag", 6, 1, 4)]),
      makeSession("2026-11-04", 5, [{ ...makeSet("heavy_bag", 6, 1, 7), day: 1 }]),
    );
    expect(findLastTime(dayOneSetInDayFiveSession, program, query("heavy_bag", 1, "finisher"), "2026-11-09")?.sets[0]?.reps).toBe(7);
  });

  it("reads an old-format log (no per-set day) exactly as before: the session's day decides", () => {
    const log = makeLog(makeSession("2026-11-02", 5, [makeSet("pull_up", 4, 1, 4)]));

    expect(findLastTime(log, program, query("pull_up", 5, "miniDose"), "2026-11-09")?.sets[0]?.reps).toBe(4);
    // Same block type on another day's query still falls back to "any day".
    expect(findLastTime(log, program, query("pull_up", 1, "miniDose"), "2026-11-09")?.sets[0]?.reps).toBe(4);
    // And a session with no stored day resolves nothing.
    expect(findLastTime(makeLog(makeSession("2026-11-02", undefined, [makeSet("pull_up", 4, 1, 4)])), program, query("pull_up", 5, "miniDose"), "2026-11-09")).toBeUndefined();
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

describe("findLastTime with a combined session (two days on one date)", () => {
  /**
   * The shipped program has no exercise at the same block type and position on
   * two days, which a combined session can produce for other programs. So make
   * one: Day 2's mini-dose (block 4) becomes Day 1's dip, so both days have a
   * dip mini-dose at block position 4.
   */
  const rawProgram = JSON.parse(readFileSync("public/program.json", "utf-8"));
  rawProgram.days[1].blocks[3].items = structuredClone(rawProgram.days[0].blocks[3].items);
  const programWithSharedSlot = parseProgram(rawProgram).program;

  /** A set of a combined session: it carries its own day. */
  function makeDaySet(day: number, setNumber: number, reps: number): LoggedSet {
    return { ...makeSet("dip", 4, setNumber, reps), day };
  }

  const log = makeLog({
    date: "2026-11-02",
    day: 1,
    sets: [makeDaySet(1, 1, 7), makeDaySet(2, 1, 9), makeDaySet(2, 2, 8)],
  });

  it("asked as Day 1, finds only Day 1's block, not Day 2's sets in the same block position", () => {
    const lastTime = findLastTime(log, programWithSharedSlot, query("dip", 1, "miniDose"), "2026-11-09");

    expect(lastTime?.sets.map((set) => [set.day, set.setNumber, set.reps])).toEqual([[1, 1, 7]]);
  });

  it("asked as Day 2, finds only Day 2's block", () => {
    const lastTime = findLastTime(log, programWithSharedSlot, query("dip", 2, "miniDose"), "2026-11-09");

    expect(lastTime?.sets.map((set) => [set.day, set.setNumber, set.reps])).toEqual([[2, 1, 9], [2, 2, 8]]);
  });

  it("asked as another day, takes the larger block (by day and position) and never blends the two", () => {
    const lastTime = findLastTime(log, programWithSharedSlot, query("dip", 5, "miniDose"), "2026-11-09");

    expect(lastTime?.sets.map((set) => [set.day, set.setNumber])).toEqual([[2, 1], [2, 2]]);
  });

  it("a tie goes to the earlier day", () => {
    const tied = makeLog({ date: "2026-11-02", day: 1, sets: [makeDaySet(2, 1, 9), makeDaySet(1, 1, 7)] });

    const lastTime = findLastTime(tied, programWithSharedSlot, query("dip", 5, "miniDose"), "2026-11-09");

    expect(lastTime?.sets.map((set) => set.day)).toEqual([1]);
  });
});

describe("findLastTime across alternating weeks (PLAN.md PR 26 rule 4)", () => {
  // Day 3's explosive block is block 2: plyo push-ups in odd weeks, wall throws in even weeks.
  const week1Day3 = "2026-11-04";
  const week2Day3 = "2026-11-11";
  const week3Day3 = "2026-11-18";
  const week4Day3 = "2026-11-25";

  it("finds a wall throws set logged in week 2 when asked in week 4", () => {
    const log = makeLog(makeSession(week2Day3, 3, [makeSet("rotational_wall_throw", 2, 1, 5), makeSet("rotational_wall_throw", 2, 2, 5)]));

    const lastTime = findLastTime(log, program, query("rotational_wall_throw", 3, "explosive"), week4Day3);

    expect(lastTime?.date).toBe(week2Day3);
    expect(lastTime?.sets.map((set) => set.setNumber)).toEqual([1, 2]);
  });

  it("finds a plyo push-up set logged in week 1 when asked in week 3", () => {
    const log = makeLog(makeSession(week1Day3, 3, [makeSet("plyo_push_up", 2, 1, 5)]));

    const lastTime = findLastTime(log, program, query("plyo_push_up", 3, "explosive"), week3Day3);

    expect(lastTime?.date).toBe(week1Day3);
    expect(lastTimeSetFor(lastTime, 1)?.reps).toBe(5);
  });

  it("does not mix the two exercises: a plyo set is not last time for the throws", () => {
    const log = makeLog(makeSession(week1Day3, 3, [makeSet("plyo_push_up", 2, 1, 5)]));

    expect(findLastTime(log, program, query("rotational_wall_throw", 3, "explosive"), week4Day3)).toBeUndefined();
  });
});
