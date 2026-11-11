import { describe, expect, it } from "vitest";
import type { ChartableExercise } from "../log/progress";
import { chooseExercise, describeTrend, niceAxis } from "./progressChart";

describe("niceAxis", () => {
  it("rounds the maximum up to at most four whole-number intervals", () => {
    expect(niceAxis(7)).toEqual({ max: 8, ticks: [0, 2, 4, 6, 8] });
    expect(niceAxis(12)).toEqual({ max: 15, ticks: [0, 5, 10, 15] });
    expect(niceAxis(4)).toEqual({ max: 4, ticks: [0, 1, 2, 3, 4] });
    expect(niceAxis(10)).toEqual({ max: 10, ticks: [0, 5, 10] });
  });

  it("scales to larger values", () => {
    expect(niceAxis(42).max).toBe(60);
    expect(niceAxis(42).ticks).toEqual([0, 20, 40, 60]);
  });
});

describe("describeTrend", () => {
  it("says rose, fell or stayed, and handles a single value", () => {
    expect(describeTrend("Pull-ups", "best reps", "", [{ week: 1, value: 5 }, { week: 2, value: 6 }, { week: 3, value: 7 }])).toBe("Pull-ups best reps rose from 5 in week 1 to 7 in week 3");
    expect(describeTrend("Dips", "heaviest load", " kg", [{ week: 1, value: 10 }, { week: 4, value: 8 }])).toBe("Dips heaviest load fell from 10 kg in week 1 to 8 kg in week 4");
    expect(describeTrend("Dips", "best reps", "", [{ week: 1, value: 7 }, { week: 2, value: 7 }])).toBe("Dips best reps stayed at 7 from week 1 to week 2");
    expect(describeTrend("Dips", "best reps", "", [{ week: 2, value: 7 }])).toBe("Dips best reps was 7 in week 2");
  });
});

describe("chooseExercise", () => {
  const exercises: ChartableExercise[] = [
    { exerciseId: "dip", blockType: "miniDose", key: "dip|miniDose", name: "Dips", label: "Dips — Mini-dose", lastLoggedDate: "2026-11-04" },
    { exerciseId: "pull_up", blockType: "mainStrength", key: "pull_up|mainStrength", name: "Pull-ups", label: "Pull-ups — Main strength", lastLoggedDate: "2026-11-09" },
  ];

  it("defaults to the most recently logged exercise", () => {
    expect(chooseExercise(exercises, undefined)?.key).toBe("pull_up|mainStrength");
  });

  it("keeps a remembered pick that is still available, and falls back otherwise", () => {
    expect(chooseExercise(exercises, "dip|miniDose")?.key).toBe("dip|miniDose");
    expect(chooseExercise(exercises, "gone")?.key).toBe("pull_up|mainStrength");
    expect(chooseExercise([], "dip")).toBeUndefined();
  });
});
