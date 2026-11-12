import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { BlockItem, Reps } from "./model";
import { parseProgram } from "./parse";

/**
 * Data tests over the shipped public/program.json for the no-equipment swaps
 * (PLAN.md, "PR 17 - Plan: no-equipment swaps for Explosive Endurance"). They
 * pin every swap to the plan's tables, so an accidental edit to the file (a
 * wrong exercise id, a swap that gains reps it shouldn't have) fails here
 * rather than on Ed's phone.
 */

const parsed = parseProgram(JSON.parse(readFileSync("public/program.json", "utf-8")));
const program = parsed.program;

/** One expected swap: reps and tempo are undefined when the swap sets none of its own. */
interface ExpectedSwap {
  swapExerciseId: string;
  reps?: string;
  tempo?: string;
}

const EASY = "easy, ~50% effort";

/**
 * Every swap the plan's tables give, keyed "<day>:<block type>:<original exercise id>".
 * Anything in the file that is not in this table must not have a swap.
 */
const EXPECTED_SWAPS: Record<string, ExpectedSwap> = {
  // Day 1
  "1:warmup:pallof_press": { swapExerciseId: "plank_shoulder_tap", reps: "12–15 per side" },
  "1:explosive:med_ball_slam": { swapExerciseId: "backpack_slam" },
  "1:mainStrength:pull_up": { swapExerciseId: "inverted_row", reps: "6-8" },
  "1:miniDose:dip": { swapExerciseId: "chair_dip", reps: EASY },
  "1:core:back_extension": { swapExerciseId: "prone_back_extension", reps: "15-20", tempo: "2s hold at the top" },
  "1:core:hanging_leg_raise": { swapExerciseId: "lying_leg_raise", reps: "10-15", tempo: "2-3s lowering" },
  "1:finisher:heavy_bag": { swapExerciseId: "shadow_boxing" },
  // Day 2
  "2:warmup:hip_abduction_adduction": { swapExerciseId: "side_lying_hip_raise", reps: "12–15 each way" },
  "2:mainStrength:zercher_bulgarian_split_squat": {
    swapExerciseId: "backpack_bulgarian_split_squat",
    reps: "15-20",
    tempo: "2s pause at the bottom",
  },
  "2:miniDose:single_leg_rdl": { swapExerciseId: "backpack_single_leg_rdl" },
  // Day 3
  "3:warmup:pallof_press": { swapExerciseId: "plank_shoulder_tap", reps: "12–15 per side" },
  "3:warmup:lateral_raise": { swapExerciseId: "bottle_lateral_raise" },
  "3:warmup:plate_halo": { swapExerciseId: "water_jug_halo" },
  "3:mainStrength:dip": { swapExerciseId: "chair_dip", reps: "8-10" },
  "3:miniDose:overhead_press": { swapExerciseId: "pike_push_up" },
  // Day 4
  "4:warmup:hip_abduction_adduction": { swapExerciseId: "side_lying_hip_raise", reps: "12–15 each way" },
  "4:explosive:kettlebell_swing": { swapExerciseId: "backpack_swing" },
  "4:mainStrength:single_leg_rdl": {
    swapExerciseId: "backpack_single_leg_rdl",
    reps: "12-15",
    tempo: "3s lowering, 3s hold at the bottom",
  },
  "4:miniDose:single_leg_calf_raise": { swapExerciseId: "stair_calf_raise" },
  // Day 5
  "5:warmup:lateral_raise": { swapExerciseId: "bottle_lateral_raise" },
  "5:explosive:db_push_press": { swapExerciseId: "backpack_push_press" },
  "5:mainStrength:overhead_press": { swapExerciseId: "pike_push_up", reps: "15-20", tempo: "2s lowering" },
  "5:miniDose:pull_up": { swapExerciseId: "inverted_row", reps: EASY },
  "5:core:hanging_leg_raise": { swapExerciseId: "lying_leg_raise", reps: "15-20", tempo: "2-3s lowering" },
  "5:core:back_extension": { swapExerciseId: "prone_back_extension", reps: "25", tempo: "2s hold at the top, slow" },
  "5:finisher:heavy_bag": { swapExerciseId: "shadow_boxing" },
  // Day 6
  "6:mainStrength:single_leg_calf_raise": {
    swapExerciseId: "stair_calf_raise",
    reps: "20-30",
    tempo: "2s pause at the bottom",
  },
  "6:miniDose:zercher_bulgarian_split_squat": { swapExerciseId: "backpack_bulgarian_split_squat" },
};

/** The 16 swap exercises the plan's "Library" bullet lists. */
const SWAP_EXERCISE_IDS = [
  "backpack_slam",
  "backpack_swing",
  "backpack_push_press",
  "inverted_row",
  "chair_dip",
  "pike_push_up",
  "backpack_bulgarian_split_squat",
  "backpack_single_leg_rdl",
  "stair_calf_raise",
  "prone_back_extension",
  "lying_leg_raise",
  "shadow_boxing",
  "plank_shoulder_tap",
  "bottle_lateral_raise",
  "water_jug_halo",
  "side_lying_hip_raise",
];

/** One item of the shipped program with where it sits, for tables and filters. */
interface LocatedItem {
  key: string;
  blockType: string;
  item: BlockItem;
}

/** Walks every item of the program in file order, labelling each "<day>:<block type>:<exercise id>". */
function allItems(): LocatedItem[] {
  const located: LocatedItem[] = [];
  for (const day of Object.values(program.days)) {
    if (day === undefined) continue;
    for (const block of day.blocks) {
      for (const item of block.items) {
        located.push({ key: `${day.day}:${block.type}:${item.exerciseId}`, blockType: block.type, item });
      }
    }
  }
  return located;
}

/** Writes parsed reps back as the text used in the file ("12-15", "25", "easy, ~50% effort"). */
function repsText(reps: Reps | undefined): string | undefined {
  if (reps === undefined) return undefined;
  switch (reps.kind) {
    case "fixed":
      return String(reps.count);
    case "range":
      return `${reps.min}-${reps.max}`;
    case "text":
      return reps.text;
    case "percentOfMax":
      throw new Error("a swap never uses a percentage of a tested max");
  }
}

describe("shipped program.json no-equipment swaps", () => {
  it("parses with no warnings", () => {
    expect(parsed.warnings).toEqual([]);
  });

  it("has exactly the swaps in the plan's tables, with their reps and tempo", () => {
    const actual: Record<string, ExpectedSwap> = {};
    for (const { key, item } of allItems()) {
      if (item.noEquipment === undefined) continue;
      actual[key] = {
        swapExerciseId: item.noEquipment.exercise.id,
        reps: repsText(item.noEquipment.reps),
        tempo: item.noEquipment.tempo,
      };
    }

    expect(actual).toEqual(EXPECTED_SWAPS);
  });

  it("gives explosive and heavy bag swaps no reps of their own (same reps as the original)", () => {
    const checked = allItems().filter(({ blockType, item }) => item.noEquipment && (blockType === "explosive" || item.exerciseId === "heavy_bag"));

    // Day 1, 4 and 5 explosive items plus the Day 1 and 5 heavy bag.
    expect(checked).toHaveLength(5);
    for (const { item } of checked) {
      expect(item.noEquipment?.reps).toBeUndefined();
      expect(item.noEquipment?.durationSec).toBeUndefined();
    }
  });

  it("keeps warm-up swaps at the original's reps, except two that spell out the per-side wording", () => {
    const warmupSwaps = allItems().filter(({ blockType, item }) => blockType === "warmup" && item.noEquipment);
    expect(warmupSwaps).toHaveLength(7);

    // Only plank shoulder taps ("12–15 per side") and side-lying hip raises
    // ("12–15 each way") restate the reps, because the original's item can't
    // say "per side" for them; every other warm-up swap has no reps.
    const wordedByTheSwap = new Set(["plank_shoulder_tap", "side_lying_hip_raise"]);
    for (const { item } of warmupSwaps) {
      const swap = item.noEquipment!;
      if (wordedByTheSwap.has(swap.exercise.id)) expect(swap.reps).toBeDefined();
      else expect(swap.reps).toBeUndefined();
    }
  });

  it("gives every swap of a max-based item its own non-max reps", () => {
    const maxBased = allItems().filter(({ item }) => item.noEquipment && item.exercise.maxTested);

    // Pull-up EMOM and mini-dose, dip EMOM and mini-dose.
    expect(maxBased).toHaveLength(4);
    for (const { item } of maxBased) {
      expect(item.noEquipment?.reps).toBeDefined();
      expect(item.noEquipment?.reps?.kind).not.toBe("percentOfMax");
    }
  });

  it("defines all 16 swap exercises as untested coaching-practice entries that a swap uses", () => {
    const usedByASwap = new Set(allItems().flatMap(({ item }) => (item.noEquipment ? [item.noEquipment.exercise.id] : [])));

    expect(SWAP_EXERCISE_IDS).toHaveLength(16);
    for (const id of SWAP_EXERCISE_IDS) {
      const exercise = program.exercises[id];
      if (exercise === undefined) throw new Error(`missing swap exercise ${id}`);
      expect(exercise.evidence, id).toEqual({ kind: "coachingPractice" });
      expect(exercise.maxTested, id).toBe(false);
      expect(exercise.cues.length, id).toBeGreaterThan(0);
      expect(usedByASwap.has(id), id).toBe(true);
    }
  });

  it("keeps worked-example attribution out of the cues", () => {
    for (const id of SWAP_EXERCISE_IDS) {
      expect(program.exercises[id]?.cues.join(" ")).not.toMatch(/worked example/i);
    }
  });
});

describe("shipped steady-strength.json", () => {
  it("has no no-equipment swaps", () => {
    const steady = parseProgram(JSON.parse(readFileSync("public/steady-strength.json", "utf-8")));
    const swaps = Object.values(steady.program.days).flatMap((day) =>
      (day?.blocks ?? []).flatMap((block) => block.items.filter((item) => item.noEquipment !== undefined)),
    );

    expect(swaps).toEqual([]);
  });
});
