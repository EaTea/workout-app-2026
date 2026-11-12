import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parseProgram } from "../program/parse";
import type { LoggedSession, LoggedSet, WorkoutLog } from "./model";
import { chartableExercises, deloadWeeks, progressSeries } from "./progress";

/** The real program: day 1 has slams (block 2, explosive), pull-ups (block 3, mainStrength), dips (block 4, miniDose), heavy bag (block 6, finisher). */
const program = parseProgram(JSON.parse(readFileSync("public/program.json", "utf-8"))).program;

/** A logged set; `loadKg` is optional. */
function makeSet(exerciseId: string, blockPosition: number, setNumber: number, reps: number | undefined, loadKg?: number): LoggedSet {
  return { exerciseId, blockPosition, setNumber, reps, loadKg, loggedAt: new Date("2026-11-02T10:00:00Z") };
}

/** A session with its stored week and day. */
function makeSession(date: string, programWeek: number | undefined, day: number | undefined, sets: LoggedSet[]): LoggedSession {
  return { date, programWeek, day, sets };
}

/** A log from sessions. */
function makeLog(...sessions: LoggedSession[]): WorkoutLog {
  return { sessions: Object.fromEntries(sessions.map((session) => [session.date, session])) };
}

describe("chartableExercises", () => {
  it("lists exercises from explosive, mainStrength and miniDose blocks sorted by name, with the latest date", () => {
    const log = makeLog(
      makeSession("2026-11-02", 1, 1, [makeSet("pull_up", 3, 1, 5), makeSet("med_ball_slam", 2, 1, 6), makeSet("dip", 4, 1, 7)]),
      makeSession("2026-11-09", 2, 1, [makeSet("pull_up", 3, 1, 6)]),
    );

    expect(chartableExercises(log, program)).toEqual([
      { exerciseId: "dip", blockType: "miniDose", key: "dip|miniDose", name: "Dips", label: "Dips — Mini-dose", lastLoggedDate: "2026-11-02" },
      { exerciseId: "med_ball_slam", blockType: "explosive", key: "med_ball_slam|explosive", name: "Med ball slams", label: "Med ball slams — Explosive", lastLoggedDate: "2026-11-02" },
      { exerciseId: "pull_up", blockType: "mainStrength", key: "pull_up|mainStrength", name: "Pull-ups", label: "Pull-ups — Main strength", lastLoggedDate: "2026-11-09" },
    ]);
  });

  it("leaves out warm-up, core and finisher work and sets whose block cannot be resolved", () => {
    const log = makeLog(
      makeSession("2026-11-02", 1, 1, [makeSet("ytwi", 1, 1, 12), makeSet("heavy_bag", 6, 1, undefined), makeSet("pull_up", 9, 1, 5)]),
      makeSession("2026-11-03", 1, undefined, [makeSet("pull_up", 3, 1, 5)]),
    );

    expect(chartableExercises(log, program)).toEqual([]);
  });
});

describe("progress for the same exercise in two block types", () => {
  /** Day 1 has pull-ups in main strength (block 3); find the day and block where pull-ups are a mini-dose. */
  const miniDoseDay = Object.values(program.days).find((day) => day?.blocks.some((block) => block.type === "miniDose" && block.items.some((item) => item.exerciseId === "pull_up")));
  const miniDosePosition = (miniDoseDay?.blocks.findIndex((block) => block.type === "miniDose" && block.items.some((item) => item.exerciseId === "pull_up")) ?? -1) + 1;

  const log = makeLog(
    makeSession("2026-11-02", 1, 1, [makeSet("pull_up", 3, 1, 5, 8), makeSet("pull_up", 3, 2, 7, 10)]),
    makeSession("2026-11-06", 1, miniDoseDay?.day, [makeSet("pull_up", miniDosePosition, 1, 3), makeSet("pull_up", miniDosePosition, 2, 4, 5)]),
  );

  it("lists one picker entry per block type", () => {
    expect(chartableExercises(log, program).map((entry) => entry.label)).toEqual(["Pull-ups — Main strength", "Pull-ups — Mini-dose"]);
  });

  it("builds two separate series with their own values", () => {
    expect(miniDoseDay).toBeDefined();
    expect(progressSeries(log, program, "pull_up", "mainStrength")).toEqual([{ date: "2026-11-02", week: 1, day: 1, bestReps: 7, heaviestKg: 10 }]);
    expect(progressSeries(log, program, "pull_up", "miniDose")).toEqual([{ date: "2026-11-06", week: 1, day: miniDoseDay?.day, bestReps: 4, heaviestKg: 5 }]);
  });
});

describe("progressSeries", () => {
  it("gives the best reps and heaviest load per session, oldest first", () => {
    const log = makeLog(
      makeSession("2026-11-09", 2, 1, [makeSet("pull_up", 3, 1, 6)]),
      makeSession("2026-11-02", 1, 1, [makeSet("pull_up", 3, 1, 5, 8), makeSet("pull_up", 3, 2, 7, 10), makeSet("pull_up", 3, 3, 4, 8)]),
    );

    expect(progressSeries(log, program, "pull_up", "mainStrength")).toEqual([
      { date: "2026-11-02", week: 1, day: 1, bestReps: 7, heaviestKg: 10 },
      { date: "2026-11-09", week: 2, day: 1, bestReps: 6, heaviestKg: undefined },
    ]);
  });

  it("skips sessions without a stored week, out-of-program weeks, other exercises and non-charted blocks", () => {
    const log = makeLog(
      makeSession("2026-11-02", undefined, 1, [makeSet("pull_up", 3, 1, 5)]),
      makeSession("2026-11-09", 9, 1, [makeSet("pull_up", 3, 1, 5)]),
      makeSession("2026-11-16", 3, 1, [makeSet("dip", 4, 1, 5), makeSet("pull_up", 1, 1, 5)]),
    );

    expect(progressSeries(log, program, "pull_up", "mainStrength")).toEqual([]);
  });

  it("treats a zero load as no load", () => {
    const log = makeLog(makeSession("2026-11-02", 1, 1, [makeSet("dip", 4, 1, 7, 0)]));

    expect(progressSeries(log, program, "dip", "miniDose")[0]?.heaviestKg).toBeUndefined();
  });
});

describe("deloadWeeks", () => {
  it("is weeks 4 and 8 in the shipped program", () => {
    expect(deloadWeeks(program)).toEqual([4, 8]);
  });
});

describe("chartableExercises: Steady Strength", () => {
  const steadyStrength = parseProgram(JSON.parse(readFileSync("public/steady-strength.json", "utf-8"))).program;

  it("offers strength-block exercises but not isometric holds", () => {
    // Day 1: block 3 is isometric (high wall sit), block 4 is strength (sit-to-stand).
    const log = makeLog(makeSession("2026-11-02", 1, 1, [makeSet("high_wall_sit", 3, 1, undefined), makeSet("sit_to_stand", 4, 1, 10)]));

    expect(chartableExercises(log, steadyStrength).map((entry) => entry.label)).toEqual(["Sit-to-stand from a chair — Strength"]);
  });
});

describe("progress for sessions whose sets carry their own day", () => {
  /** One date holding day 1 (pull-ups as main strength, block 3) and day 5 (pull-ups as a mini-dose, block 4). */
  const twoDayLog = makeLog(
    makeSession("2026-11-09", 2, 1, [
      { ...makeSet("pull_up", 3, 1, 8), day: 1 },
      { ...makeSet("pull_up", 4, 1, 3), day: 5 },
    ]),
  );

  it("picks the block type of each set from the set's own day", () => {
    expect(chartableExercises(twoDayLog, program).map((exercise) => exercise.key)).toEqual(["pull_up|mainStrength", "pull_up|miniDose"]);
    expect(progressSeries(twoDayLog, program, "pull_up", "mainStrength").map((point) => point.bestReps)).toEqual([8]);
    expect(progressSeries(twoDayLog, program, "pull_up", "miniDose").map((point) => point.bestReps)).toEqual([3]);
  });

  it("reads an old-format log (no per-set day) from the session's day, exactly as before", () => {
    const oldLog = makeLog(makeSession("2026-11-02", 1, 1, [makeSet("pull_up", 3, 1, 5), makeSet("dip", 4, 1, 7)]));

    expect(chartableExercises(oldLog, program).map((exercise) => exercise.key)).toEqual(["dip|miniDose", "pull_up|mainStrength"]);
  });
});

describe("No equipment swaps", () => {
  // Day 4 block 3 is the single-leg RDL (main strength) with the backpack RDL as its swap.
  const log = makeLog(
    makeSession("2026-11-05", 1, 4, [makeSet("backpack_single_leg_rdl", 3, 1, 12), makeSet("backpack_single_leg_rdl", 3, 2, 14, 5)]),
    makeSession("2026-11-12", 2, 4, [makeSet("single_leg_rdl", 3, 1, 10, 8)]),
  );

  it("lists the swap as its own exercise in the original's block type, next to the original", () => {
    const listed = chartableExercises(log, program).map((exercise) => ({ key: exercise.key, label: exercise.label }));

    expect(listed).toEqual([
      { key: "backpack_single_leg_rdl|mainStrength", label: "Backpack single-leg RDL — Main strength" },
      { key: "single_leg_rdl|mainStrength", label: "Single-leg RDL — Main strength" },
    ]);
  });

  it("charts the swap's sets as their own series and leaves the original's unchanged", () => {
    expect(progressSeries(log, program, "backpack_single_leg_rdl", "mainStrength")).toEqual([
      { date: "2026-11-05", week: 1, day: 4, bestReps: 14, heaviestKg: 5 },
    ]);
    expect(progressSeries(log, program, "single_leg_rdl", "mainStrength").map((point) => point.date)).toEqual(["2026-11-12"]);
  });

  it("does not chart the swap's id where its item is not (a swap logged in the wrong block)", () => {
    const stray = makeLog(makeSession("2026-11-05", 1, 4, [makeSet("backpack_single_leg_rdl", 1, 1, 12)]));

    expect(chartableExercises(stray, program)).toEqual([]);
  });
});
