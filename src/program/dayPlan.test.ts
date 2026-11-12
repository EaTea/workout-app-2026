import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { TrainingSettings } from "../settings/model";
import { parseProgram } from "./parse";
import type { SessionView } from "./schedule";
import { buildDayPlan, compareWithPreviousWeek, planDateFor } from "./dayPlan";

const program = parseProgram(JSON.parse(readFileSync("public/program.json", "utf-8"))).program;

const TODAY = "2026-11-11";

const settings: TrainingSettings = {
  startDate: "2026-11-02",
  maxReps: { pull_up: 12, dip: 15 },
  maxSavedOn: {},
  maxHistory: { pull_up: [{ savedOn: null, reps: 12 }], dip: [{ savedOn: null, reps: 15 }] },
};

/** Changes for a day or fails, so tests can read them. */
function changesFor(week: number, dayNumber: number) {
  const changes = compareWithPreviousWeek(program, settings, week, dayNumber, TODAY);
  if (!changes) throw new Error(`expected changes for week ${week} day ${dayNumber}`);
  return changes;
}

/** The change recorded for an exercise id, if any. */
function changeFor(week: number, dayNumber: number, exerciseId: string) {
  return changesFor(week, dayNumber).items.find((change) => change.current.exercise.id === exerciseId);
}

/** Asserts a plan is a training day. */
function training(session: SessionView | undefined) {
  if (session?.kind !== "training") throw new Error(`expected training, got ${session?.kind}`);
  return session;
}

describe("planDateFor", () => {
  it("Day 1 of week 4 is 23 Nov", () => {
    expect(planDateFor("2026-11-02", 4, 1)).toBe("2026-11-23");
  });

  it("Day 6 of week 1 is 7 Nov", () => {
    expect(planDateFor("2026-11-02", 1, 6)).toBe("2026-11-07");
  });
});

describe("buildDayPlan", () => {
  it("returns the session Today would show for that week and day", () => {
    const session = training(buildDayPlan(program, settings, 4, 1, TODAY));
    expect(session).toMatchObject({ week: 4, dayNumber: 1, phase: "Deload" });
  });

  it("rejects out-of-range or non-integer week and day", () => {
    expect(buildDayPlan(program, settings, 0, 1, TODAY)).toBeUndefined();
    expect(buildDayPlan(program, settings, program.lengthWeeks + 1, 1, TODAY)).toBeUndefined();
    expect(buildDayPlan(program, settings, 1, 0, TODAY)).toBeUndefined();
    expect(buildDayPlan(program, settings, 1, 8, TODAY)).toBeUndefined();
    expect(buildDayPlan(program, settings, 1.5, 1, TODAY)).toBeUndefined();
    expect(buildDayPlan(program, settings, Number.NaN, 1, TODAY)).toBeUndefined();
  });

  it("Day 7 is a rest day", () => {
    expect(buildDayPlan(program, settings, 2, 7, TODAY)).toMatchObject({ kind: "rest", week: 2, dayNumber: 7 });
  });

  it("without a start date gives the same doses as a saved start date, and does not touch the settings", () => {
    const unstarted: TrainingSettings = { ...settings, startDate: null };
    const snapshot = JSON.stringify(unstarted);

    const preview = training(buildDayPlan(program, unstarted, 2, 1, TODAY));
    const saved = training(buildDayPlan(program, settings, 2, 1, TODAY));

    expect(preview.week).toBe(2);
    expect(preview.blocks).toEqual(saved.blocks);
    expect(JSON.stringify(unstarted)).toBe(snapshot);
    expect(unstarted.startDate).toBeNull();
  });

  it("without a start date or maxes, max-based rows ask for a max", () => {
    const bare: TrainingSettings = { startDate: null, maxReps: {}, maxSavedOn: {}, maxHistory: {} };
    const pullUps = training(buildDayPlan(program, bare, 2, 1, TODAY)).blocks.flatMap((block) => block.items).find((entry) => entry.exercise.id === "pull_up");
    expect(pullUps?.target?.kind).toBe("needsMax");
  });

  it("without a start date, saved maxes of 12 then 14 (before today) give 14-based targets in weeks 1-7 and a held week 8", () => {
    const history: TrainingSettings = {
      startDate: null,
      maxReps: { pull_up: 14 },
      maxSavedOn: { pull_up: "2026-11-10" },
      maxHistory: { pull_up: [{ savedOn: "2026-10-01", reps: 12 }, { savedOn: "2026-11-10", reps: 14 }] },
    };
    const target = (week: number) => training(buildDayPlan(program, history, week, 1, TODAY)).blocks.flatMap((block) => block.items).find((entry) => entry.exercise.id === "pull_up")?.target;

    expect(target(1)).toMatchObject({ kind: "fixed", count: 5 });
    expect(target(7)).toMatchObject({ kind: "fixed", count: 7 });
    expect(target(8)).toMatchObject({ kind: "fixed", count: 7 });
  });

  it("week 8 without a start date holds week 7's EMOM reps (6), even with a max saved after today", () => {
    const saved: TrainingSettings = { ...settings, startDate: null, maxSavedOn: { pull_up: "2026-12-21" } };
    const pullUps = training(buildDayPlan(program, saved, 8, 1, TODAY)).blocks.flatMap((block) => block.items).find((entry) => entry.exercise.id === "pull_up");
    expect(pullUps?.target).toMatchObject({ kind: "fixed", count: 6 });
  });
});

describe("compareWithPreviousWeek", () => {
  it("week 1 has nothing to compare with", () => {
    expect(compareWithPreviousWeek(program, settings, 1, 1, TODAY)).toBeUndefined();
  });

  it("a rest day has no plan to compare", () => {
    expect(compareWithPreviousWeek(program, settings, 3, 7, TODAY)).toBeUndefined();
  });

  it("Day 1 W1 to W2: pull-up EMOM 4 becomes 5; med ball slams unchanged", () => {
    const pullUps = changeFor(2, 1, "pull_up");
    expect(pullUps?.current.target).toMatchObject({ kind: "fixed", count: 5 });
    expect(pullUps?.previous.target).toMatchObject({ kind: "fixed", count: 4 });
    expect(changeFor(2, 1, "med_ball_slam")).toBeUndefined();
  });

  it("Day 1 W3 to W4: slams, EMOM minutes and dip mini-dose change", () => {
    const slams = changeFor(4, 1, "med_ball_slam");
    expect(slams?.previous.sets).toHaveLength(6);
    expect(slams?.current.sets).toHaveLength(3);

    const pullUps = changeFor(4, 1, "pull_up");
    expect(pullUps?.previous.minutes).toBe(9);
    expect(pullUps?.current.minutes).toBe(5);

    const dips = changeFor(4, 1, "dip");
    expect(dips?.previous.sets).toHaveLength(2);
    expect(dips?.current.sets).toHaveLength(1);
  });

  it("Day 6 W4 to W5: the same-every-week wall sit is not reported", () => {
    expect(changeFor(5, 6, "wall_sit")).toBeUndefined();
  });

  it("Day 1 W5 vs W4: the warm-up swap is a change; W6 vs W5 is not", () => {
    const swapped = changesFor(5, 1).items.find((change) => change.previous.rotatedIn === undefined && change.current.rotatedIn !== undefined);
    expect(swapped).toBeDefined();
    expect(changesFor(6, 1).items.filter((change) => change.current.rotatedIn !== undefined || change.previous.rotatedIn !== undefined)).toEqual([]);
  });

  it("reports the previous week number", () => {
    expect(changesFor(4, 1).previousWeek).toBe(3);
  });
});

describe("Day 3 plans by week (PLAN.md PR 26)", () => {
  /** The exercise ids of the explosive block in a week's Day 3 plan. */
  function explosiveExercisesOf(week: number): string[] {
    const plan = training(buildDayPlan(program, settings, week, 3, TODAY));
    return plan.blocks.find((block) => block.type === "explosive")!.items.map((item) => item.exercise.id);
  }

  it("shows the wall throws in week 2 and the plyo push-ups in week 3", () => {
    expect(explosiveExercisesOf(2)).toEqual(["rotational_wall_throw"]);
    expect(explosiveExercisesOf(3)).toEqual(["plyo_push_up"]);
  });

  it("compares an alternating item with the most recent earlier week it ran", () => {
    // Week 2 throws are the first time they run: nothing to compare with.
    expect(changeFor(2, 3, "rotational_wall_throw")).toBeUndefined();

    // Week 3 plyo push-ups vs week 1 (week 2 had the throws): same figures, no change.
    expect(changeFor(3, 3, "plyo_push_up")).toBeUndefined();

    // Week 4 throws (deload) vs week 2.
    const deloadThrows = changeFor(4, 3, "rotational_wall_throw");
    expect(deloadThrows?.previousWeek).toBe(2);
    expect(deloadThrows?.previous.sets).toHaveLength(4);
    expect(deloadThrows?.current.sets).toHaveLength(2);

    // Week 6 throws come back up from week 4's two sets.
    const recoveredThrows = changeFor(6, 3, "rotational_wall_throw");
    expect(recoveredThrows?.previousWeek).toBe(4);
    expect(recoveredThrows?.previous.sets).toHaveLength(2);
    expect(recoveredThrows?.current.sets).toHaveLength(4);
  });

  it("gives items that ran the week before a previousWeek of week - 1", () => {
    expect(changeFor(2, 1, "pull_up")?.previousWeek).toBe(1);
  });

  it("reports no explosive block change in a swap week", () => {
    expect(changesFor(2, 3).blocks.filter((change) => change.current.type === "explosive")).toEqual([]);
  });
});
