import { describe, expect, it } from "vitest";
import { findLastTime, lastTimeSetFor } from "./lastTime";
import type { LoggedSet, WorkoutLog } from "./model";

/** A logged set with only the fields these tests care about. */
function makeSet(exerciseId: string, blockPosition: number, setNumber: number, reps = 6): LoggedSet {
  return { exerciseId, blockPosition, setNumber, reps, loggedAt: new Date("2026-11-02T10:00:00Z") };
}

/** A log with one session per entry of `setsByDate`. */
function makeLog(setsByDate: Record<string, LoggedSet[]>): WorkoutLog {
  const sessions: WorkoutLog["sessions"] = {};
  for (const [date, sets] of Object.entries(setsByDate)) sessions[date] = { date, sets };
  return { sessions };
}

describe("findLastTime", () => {
  it("picks the most recent earlier session with the exercise", () => {
    const log = makeLog({
      "2026-10-26": [makeSet("med_ball_slam", 2, 1, 5)],
      "2026-11-02": [makeSet("med_ball_slam", 2, 2), makeSet("med_ball_slam", 2, 1)],
      "2026-11-04": [makeSet("pull_up", 3, 1)],
    });

    const lastTime = findLastTime(log, "med_ball_slam", "2026-11-09");

    expect(lastTime?.date).toBe("2026-11-02");
    expect(lastTime?.sets.map((set) => set.setNumber)).toEqual([1, 2]);
  });

  it("ignores the same date and later dates", () => {
    const log = makeLog({
      "2026-11-09": [makeSet("med_ball_slam", 2, 1)],
      "2026-11-16": [makeSet("med_ball_slam", 2, 1)],
    });

    expect(findLastTime(log, "med_ball_slam", "2026-11-09")).toBeUndefined();
  });

  it("is undefined for an exercise never logged", () => {
    expect(findLastTime(makeLog({ "2026-11-02": [makeSet("pull_up", 1, 1)] }), "dip", "2026-11-09")).toBeUndefined();
    expect(findLastTime({ sessions: {} }, "dip", "2026-11-09")).toBeUndefined();
  });

  it("takes the block with the most sets when the exercise is in two blocks", () => {
    const log = makeLog({
      "2026-11-02": [
        makeSet("pull_up", 2, 1), makeSet("pull_up", 2, 2),
        makeSet("pull_up", 4, 1), makeSet("pull_up", 4, 2), makeSet("pull_up", 4, 3),
      ],
    });

    expect(findLastTime(log, "pull_up", "2026-11-09")?.sets.map((set) => set.blockPosition)).toEqual([4, 4, 4]);
  });

  it("breaks a tie between blocks in favour of the lower block position", () => {
    const log = makeLog({
      "2026-11-02": [makeSet("pull_up", 4, 1), makeSet("pull_up", 2, 1)],
    });

    expect(findLastTime(log, "pull_up", "2026-11-09")?.sets[0]?.blockPosition).toBe(2);
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
