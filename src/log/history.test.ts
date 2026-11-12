import { describe, expect, it } from "vitest";
import { groupSetsByExercise } from "./history";
import type { LoggedSession, LoggedSet } from "./model";

/** A logged set with only the fields these tests care about. */
function makeSet(exerciseId: string, blockPosition: number, setNumber: number): LoggedSet {
  return { exerciseId, blockPosition, setNumber, reps: 6, loggedAt: new Date("2026-11-02T10:00:00Z") };
}

describe("groupSetsByExercise", () => {
  it("groups by exercise and orders groups by block position, not logging order", () => {
    const session: LoggedSession = {
      date: "2026-11-02",
      sets: [makeSet("pull_up", 3, 1), makeSet("med_ball_slam", 2, 1), makeSet("pull_up", 3, 2), makeSet("med_ball_slam", 2, 2)],
    };

    const groups = groupSetsByExercise(session);

    expect(groups.map((group) => [group.blockPosition, group.exerciseId])).toEqual([[2, "med_ball_slam"], [3, "pull_up"]]);
    expect(groups[1]?.sets.map((set) => set.setNumber)).toEqual([1, 2]);
  });

  it("orders sets within a group by set number", () => {
    const session: LoggedSession = { date: "2026-11-02", sets: [makeSet("dip", 4, 3), makeSet("dip", 4, 1), makeSet("dip", 4, 2)] };

    expect(groupSetsByExercise(session)[0]?.sets.map((set) => set.setNumber)).toEqual([1, 2, 3]);
  });

  it("keeps the same exercise in two blocks as two groups", () => {
    const session: LoggedSession = { date: "2026-11-02", sets: [makeSet("dip", 5, 1), makeSet("dip", 3, 1)] };

    expect(groupSetsByExercise(session).map((group) => group.blockPosition)).toEqual([3, 5]);
  });

  it("keeps first-logged order inside one block (superset)", () => {
    const session: LoggedSession = { date: "2026-11-02", sets: [makeSet("b", 2, 1), makeSet("a", 2, 1), makeSet("b", 2, 2)] };

    expect(groupSetsByExercise(session).map((group) => group.exerciseId)).toEqual(["b", "a"]);
  });
});

describe("groupSetsByExercise with per-set days", () => {
  it("keeps the same block position of two days as two groups", () => {
    const session: LoggedSession = {
      date: "2026-11-09",
      day: 1,
      sets: [
        { exerciseId: "pull_up", day: 1, blockPosition: 3, setNumber: 1, loggedAt: new Date("2026-11-09T10:00:00Z") },
        { exerciseId: "pull_up", day: 5, blockPosition: 3, setNumber: 1, loggedAt: new Date("2026-11-09T10:01:00Z") },
        { exerciseId: "pull_up", blockPosition: 3, setNumber: 2, loggedAt: new Date("2026-11-09T10:02:00Z") },
      ],
    };

    // The set without its own day belongs to the session's day 1, so it joins the first group.
    expect(groupSetsByExercise(session).map((group) => [group.day, group.sets.length])).toEqual([[1, 2], [5, 1]]);
  });
});

describe("groupSetsByExercise for a combined session", () => {
  /** A set of a combined session: it carries its own day. */
  function makeDaySet(day: number, exerciseId: string, blockPosition: number, setNumber: number): LoggedSet {
    return { ...makeSet(exerciseId, blockPosition, setNumber), day };
  }

  it("lists one day's blocks, then the other's, whatever order they were logged in", () => {
    const session: LoggedSession = {
      date: "2026-11-09",
      day: 1,
      sets: [
        makeDaySet(2, "split_squat_jump", 2, 1),
        makeDaySet(1, "pull_up", 3, 1),
        makeDaySet(2, "zercher_bulgarian_split_squat", 3, 1),
        makeDaySet(1, "med_ball_slam", 2, 1),
      ],
    };

    expect(groupSetsByExercise(session).map((group) => [group.day, group.blockPosition, group.exerciseId])).toEqual([
      [1, 2, "med_ball_slam"],
      [1, 3, "pull_up"],
      [2, 2, "split_squat_jump"],
      [2, 3, "zercher_bulgarian_split_squat"],
    ]);
  });

  it("keeps the same exercise in the same block position of two days as two groups", () => {
    const session: LoggedSession = { date: "2026-11-09", day: 1, sets: [makeDaySet(2, "dip", 3, 1), makeDaySet(1, "dip", 3, 1)] };

    expect(groupSetsByExercise(session).map((group) => group.day)).toEqual([1, 2]);
  });
});
