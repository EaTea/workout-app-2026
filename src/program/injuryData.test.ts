import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { TrainingSettings } from "../settings/model";
import type { BlockItem } from "./model";
import { parseProgram } from "./parse";
import { buildSession } from "./schedule";

/**
 * Data tests over the shipped public/program.json for the shoulder
 * (PLAN.md, "Plan: train around an injury", milestone Injury 1). They pin
 * the `loads` tags, the `injury.shoulder` stand-ins and the shoulder-free
 * session to the plan's tables, so an accidental edit to the file fails here.
 * Today and the log screen don't read these fields yet; the last test proves that.
 */

const rawJson = JSON.parse(readFileSync("public/program.json", "utf-8"));
const program = parseProgram(rawJson).program;

/** One item of the shipped program with where it sits: "<day>:<block type>:<exercise id>". */
interface LocatedItem {
  key: string;
  item: BlockItem;
}

/** Walks every item of every day in file order. */
function allItems(): LocatedItem[] {
  const located: LocatedItem[] = [];
  for (const day of Object.values(program.days)) {
    if (day === undefined) continue;
    for (const block of day.blocks) {
      for (const item of block.items) located.push({ key: `${day.day}:${block.type}:${item.exerciseId}`, item });
    }
  }
  return located;
}

/** The stand-ins the plan gives, keyed like `allItems`, with the exercise id and reps (undefined = same as the original). */
const EXPECTED_STAND_INS: Record<string, { exerciseId: string; reps?: string | number }> = {
  "1:core:back_extension": { exerciseId: "bodyweight_back_extension" },
  "5:core:back_extension": { exerciseId: "bodyweight_back_extension" },
  "1:core:hanging_leg_raise": { exerciseId: "lying_leg_raise", reps: "10-15" },
  "5:core:hanging_leg_raise": { exerciseId: "lying_leg_raise", reps: "15-20" },
  "1:core:side_plank": { exerciseId: "side_plank_uninjured_side" },
  "5:core:hollow_hold": { exerciseId: "hollow_hold_arms_by_sides" },
  "1:warmup:ytwi": { exerciseId: "dead_bug_legs_only", reps: "8 per side" },
  "5:warmup:ytwi": { exerciseId: "dead_bug_legs_only", reps: "8 per side" },
  "4:explosive:kettlebell_swing": { exerciseId: "broad_jump", reps: 5 },
  "2:mainStrength:zercher_bulgarian_split_squat": { exerciseId: "suitcase_bulgarian_split_squat" },
  "6:miniDose:zercher_bulgarian_split_squat": { exerciseId: "suitcase_bulgarian_split_squat" },
  "2:miniDose:single_leg_rdl": { exerciseId: "one_hand_single_leg_rdl" },
  "4:mainStrength:single_leg_rdl": { exerciseId: "one_hand_single_leg_rdl" },
  "4:miniDose:single_leg_calf_raise": { exerciseId: "one_hand_single_leg_calf_raise" },
  "6:mainStrength:single_leg_calf_raise": { exerciseId: "one_hand_single_leg_calf_raise" },
};

/**
 * Items tagged "avoid" or "caution" that the plan leaves with no stand-in
 * (avoid: left out; caution: kept as pain-free only). Everything tagged and
 * not listed here must have a stand-in.
 */
const EXPECTED_TAGGED_WITHOUT_STAND_IN = [
  "1:warmup:pallof_press", "3:warmup:pallof_press",
  "3:warmup:lateral_raise", "5:warmup:lateral_raise",
  "3:warmup:plate_halo",
  "1:explosive:med_ball_slam",
  "3:explosive:plyo_push_up",
  "3:explosive:rotational_wall_throw",
  "5:explosive:db_push_press",
  "1:mainStrength:pull_up", "5:miniDose:pull_up",
  "1:miniDose:dip", "3:mainStrength:dip",
  "3:miniDose:overhead_press", "5:mainStrength:overhead_press",
  "3:core:crab_knee_to_elbow", "3:core:crab_base_switch_sprawl",
  "3:finisher:on_the_spot_crawl",
  "1:finisher:heavy_bag", "5:finisher:heavy_bag",
  "4:warmup:single_leg_hip_thrust", "6:warmup:single_leg_hip_thrust",
];

const NEW_EXERCISE_IDS = [
  "bodyweight_back_extension", "hollow_hold_arms_by_sides", "side_plank_uninjured_side", "broad_jump",
  "suitcase_bulgarian_split_squat", "one_hand_single_leg_rdl", "one_hand_single_leg_calf_raise",
  "dead_bug_legs_only", "prone_back_extension_arms_by_sides",
];

describe("shoulder tags in the shipped program", () => {
  it("every shoulder avoid/caution item has a stand-in or is on the plan's no-stand-in list", () => {
    const tagged = allItems().filter(({ item }) => item.exercise.loads?.shoulder !== undefined);
    const withStandIn = tagged.filter(({ item }) => item.injury?.shoulder !== undefined).map(({ key }) => key);
    const without = tagged.filter(({ item }) => item.injury?.shoulder === undefined).map(({ key }) => key);

    expect(withStandIn.sort()).toEqual(Object.keys(EXPECTED_STAND_INS).sort());
    expect(without.sort()).toEqual([...EXPECTED_TAGGED_WITHOUT_STAND_IN].sort());
  });

  it("tags the plan's avoid and caution lists and nothing else", () => {
    const avoid = Object.values(program.exercises).filter((exercise) => exercise.loads?.shoulder === "avoid");
    const caution = Object.values(program.exercises).filter((exercise) => exercise.loads?.shoulder === "caution");

    expect(avoid).toHaveLength(28);
    expect(caution.map((exercise) => exercise.id).sort()).toEqual(
      ["pallof_press", "back_extension", "side_plank", "hollow_hold", "single_leg_hip_thrust", "single_leg_rdl", "single_leg_calf_raise", "backpack_single_leg_rdl", "stair_calf_raise", "prone_back_extension"].sort(),
    );
    for (const id of NEW_EXERCISE_IDS) expect(program.exercises[id]?.loads, id).toBeUndefined();
  });

  it("gives every stand-in the planned exercise and reps", () => {
    const byKey = new Map(allItems().map(({ key, item }) => [key, item]));

    for (const [key, expected] of Object.entries(EXPECTED_STAND_INS)) {
      const standIn = byKey.get(key)?.injury?.shoulder;
      expect(standIn?.exercise.id, key).toBe(expected.exerciseId);
      if (expected.reps === undefined) {
        expect(standIn?.reps, key).toBeUndefined();
      } else if (typeof expected.reps === "number") {
        expect(standIn?.reps, key).toEqual({ kind: "fixed", count: expected.reps });
      } else if (!/^\d+-\d+$/.test(expected.reps)) {
        expect(standIn?.reps, key).toEqual({ kind: "text", text: expected.reps });
      } else {
        const [min, max] = expected.reps.split("-").map(Number);
        expect(standIn?.reps, key).toEqual({ kind: "range", min, max });
      }
    }
  });

  it("keeps the dose text the plan says each stand-in keeps", () => {
    const byKey = new Map(allItems().map(({ key, item }) => [key, item.injury?.shoulder]));

    expect(byKey.get("1:core:back_extension")?.load).toBe("bodyweight");
    expect(byKey.get("5:core:back_extension")?.note).toBe("Slow; stays bodyweight because Day 4 loads the lower back");
    expect(byKey.get("1:core:hanging_leg_raise")?.tempo).toBe("2-3s lowering");
    expect(byKey.get("5:core:hanging_leg_raise")?.tempo).toBe("2-3s lowering");
    expect(byKey.get("1:core:side_plank")?.note).toBe("Uninjured side only");
    expect(byKey.get("1:core:side_plank")?.perSide).toBe(false);
    expect(byKey.get("4:miniDose:single_leg_calf_raise")?.load).toBe("uninjured hand");
    expect(byKey.get("6:mainStrength:single_leg_calf_raise")?.load).toBe("uninjured hand; first set heavy");
    expect(byKey.get("2:mainStrength:zercher_bulgarian_split_squat")?.note).toBe("Switch legs without rest; rest between rounds");
    expect(byKey.get("4:mainStrength:single_leg_rdl")?.tempo).toBe("3s lowering");
    expect(byKey.get("6:mainStrength:single_leg_calf_raise")?.tempo).toBe("2s pause at the bottom");
  });

  it("never points a stand-in or the shoulder-free session at a shoulder 'avoid' exercise", () => {
    const standInIds = allItems().flatMap(({ item }) => (item.injury?.shoulder ? [item.injury.shoulder.exercise.id] : []));
    const sessionIds = (program.injurySessions?.shoulder?.blocks ?? []).flatMap((block) => block.items.map((item) => item.exerciseId));

    expect(standInIds.length).toBe(Object.keys(EXPECTED_STAND_INS).length);
    for (const id of [...standInIds, ...sessionIds]) expect(program.exercises[id]?.loads?.shoulder, id).not.toBe("avoid");
  });

  it("gives the sore-shoulder cue to the single-leg hip thrust", () => {
    expect(program.exercises.single_leg_hip_thrust?.cues).toContain("With a sore shoulder, do it with the shoulders on the floor if the bench presses on it");
  });

  it("ships the nine new exercises with coaching-practice evidence and cues", () => {
    for (const id of NEW_EXERCISE_IDS) {
      expect(program.exercises[id], id).toBeDefined();
      expect(program.exercises[id]?.evidence, id).toEqual({ kind: "coachingPractice" });
      expect(program.exercises[id]?.cues.length, id).toBeGreaterThan(0);
    }
  });
});

describe("the shoulder-free session", () => {
  const session = program.injurySessions?.shoulder;

  it("is named and has a warm-up block and a core block", () => {
    expect(session?.name).toBe("Shoulder-free session");
    expect(session?.blocks.map((block) => block.type)).toEqual(["warmup", "core"]);
  });

  it("holds the planned exercises in order", () => {
    const [warmup, core] = session?.blocks ?? [];
    if (warmup === undefined || core === undefined) throw new Error("expected a warm-up and a core block");

    expect(warmup.items.map((item) => item.exerciseId)).toEqual(["dead_bug_legs_only"]);
    expect(core.items.map((item) => item.exerciseId)).toEqual([
      "lying_leg_raise", "hollow_hold_arms_by_sides", "prone_back_extension_arms_by_sides", "side_plank_uninjured_side",
    ]);
    expect(core.items.map((item) => item.sets.length)).toEqual([3, 3, 3, 2]);
    expect(core.items[3]?.durationSec).toBe(30);
    expect(core.items[3]?.perSide).toBeFalsy();
  });
});

describe("the stand-in views on 23 Nov 2026 (W4 D1, deload; start 2 Nov)", () => {
  const settings = { startDate: "2026-11-02", maxReps: { pull_up: 12, dip: 15 }, maxSavedOn: {}, maxHistory: {} } as TrainingSettings;

  /** The shoulder stand-in view of `exerciseId` in Day 1's session on 23 Nov. */
  function standInView(exerciseId: string) {
    const session = buildSession(program, settings, "2026-11-23");
    if (session.kind !== "training") throw new Error("expected a training day");
    const item = session.blocks.flatMap((block) => block.items).find((candidate) => candidate.exercise.id === exerciseId);
    const view = item?.injury?.shoulder;
    if (view === undefined) throw new Error(`no shoulder stand-in view for ${exerciseId}`);
    return view;
  }

  it("bodyweight back extension is 2 × 12–15 at bodyweight", () => {
    const view = standInView("back_extension");

    expect(view.exercise.id).toBe("bodyweight_back_extension");
    expect(view.sets).toHaveLength(2);
    for (const set of view.sets) expect(set.target).toEqual({ kind: "range", min: 12, max: 15 });
    expect(view.load).toBe("bodyweight");
  });

  it("side plank on the uninjured side is 1 × 30s and not per side", () => {
    const view = standInView("side_plank");

    expect(view.exercise.id).toBe("side_plank_uninjured_side");
    expect(view.sets).toHaveLength(1);
    expect(view.durationSec).toBe(30);
    expect(view.perSide).toBe(false);
  });
});

describe("a program with no injury flag", () => {
  /** Removes `loads`, `injury` and `injurySessions` from a deep copy of the raw JSON, leaving the program as it was before the injury work. */
  function stripInjuryFields(node: any): any {
    if (Array.isArray(node)) return node.map(stripInjuryFields);
    if (node === null || typeof node !== "object") return node;

    const copy: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(node)) {
      if (key === "loads" || key === "injury" || key === "injurySessions") continue;
      copy[key] = stripInjuryFields(value);
    }
    return copy;
  }

  /** Deep-copies a session view without the injury fields the parser puts on exercises and items. */
  function withoutInjuryFields(view: unknown): unknown {
    return JSON.parse(JSON.stringify(view), (key, value) => (key === "loads" || key === "injury" ? undefined : value));
  }

  it("builds the same sessions as the program with the injury fields stripped, on every date of the 8 weeks", () => {
    const strippedProgram = parseProgram(stripInjuryFields(rawJson)).program;
    const settings: TrainingSettings = {
      startDate: "2026-11-02",
      maxReps: { pull_up: 12, dip: 15 },
      maxSavedOn: {},
      maxHistory: { pull_up: [{ savedOn: null, reps: 12 }], dip: [{ savedOn: null, reps: 15 }] },
    } as TrainingSettings;

    for (let dayOffset = -2; dayOffset < 60; dayOffset++) {
      const date = new Date(Date.UTC(2026, 10, 2 + dayOffset)).toISOString().slice(0, 10);

      expect(withoutInjuryFields(buildSession(program, settings, date)), date).toEqual(
        withoutInjuryFields(buildSession(strippedProgram, settings, date)),
      );
    }
  });
});
