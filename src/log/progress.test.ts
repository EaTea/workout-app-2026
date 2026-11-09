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
      { exerciseId: "dip", name: "Dips", lastLoggedDate: "2026-11-02" },
      { exerciseId: "med_ball_slam", name: "Med ball slams", lastLoggedDate: "2026-11-02" },
      { exerciseId: "pull_up", name: "Pull-ups", lastLoggedDate: "2026-11-09" },
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

describe("progressSeries", () => {
  it("gives the best reps and heaviest load per session, oldest first", () => {
    const log = makeLog(
      makeSession("2026-11-09", 2, 1, [makeSet("pull_up", 3, 1, 6)]),
      makeSession("2026-11-02", 1, 1, [makeSet("pull_up", 3, 1, 5, 8), makeSet("pull_up", 3, 2, 7, 10), makeSet("pull_up", 3, 3, 4, 8)]),
    );

    expect(progressSeries(log, program, "pull_up")).toEqual([
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

    expect(progressSeries(log, program, "pull_up")).toEqual([]);
  });

  it("treats a zero load as no load", () => {
    const log = makeLog(makeSession("2026-11-02", 1, 1, [makeSet("dip", 4, 1, 7, 0)]));

    expect(progressSeries(log, program, "dip")[0]?.heaviestKg).toBeUndefined();
  });
});

describe("deloadWeeks", () => {
  it("is weeks 4 and 8 in the shipped program", () => {
    expect(deloadWeeks(program)).toEqual([4, 8]);
  });
});
