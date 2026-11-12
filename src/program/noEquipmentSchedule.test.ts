import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { TrainingSettings } from "../settings/model";
import type { BlockItem } from "./model";
import { parseProgram } from "./parse";
import type { ItemView, SessionView } from "./schedule";
import { applyNoEquipmentSwap, buildSession } from "./schedule";

/**
 * Unit tests for the schedule's "No equipment" swap views (PLAN.md section 6,
 * "No-equipment swaps (PR 17)" worked examples, minus the logging row, which
 * belongs to PR 19). Each test reads the swap's view from `ItemView.noEquipment`
 * on a session built from the shipped public/program.json.
 */

const program = parseProgram(JSON.parse(readFileSync("public/program.json", "utf-8"))).program;

/** Start 2 Nov 2026, max pull-ups 12, max dips 15, with a matching one-entry history each (as a real load gives). */
function settingsWith(overrides: Partial<TrainingSettings> = {}): TrainingSettings {
  const base: TrainingSettings = {
    startDate: "2026-11-02",
    maxReps: { pull_up: 12, dip: 15 },
    maxSavedOn: {},
    maxHistory: {},
    ...overrides,
  };
  const maxHistory = { ...base.maxHistory };
  for (const [exerciseId, reps] of Object.entries(base.maxReps)) {
    maxHistory[exerciseId] ??= [{ savedOn: base.maxSavedOn[exerciseId] ?? null, reps }];
  }
  return { ...base, maxHistory };
}

/** Builds a session and asserts it is a training day. */
function trainingOn(date: string, overrides: Partial<TrainingSettings> = {}) {
  const session: SessionView = buildSession(program, settingsWith(overrides), date);
  if (session.kind !== "training") throw new Error(`expected training on ${date}, got ${session.kind}`);
  return session;
}

/** Finds the (normal) item for an original exercise id in a block type of the session on `date`, or fails. */
function itemOn(date: string, blockType: string, exerciseId: string, overrides: Partial<TrainingSettings> = {}): ItemView {
  const session = trainingOn(date, overrides);
  const found = session.blocks.filter((candidate) => candidate.type === blockType).flatMap((candidate) => candidate.items).find((entry) => entry.exercise.id === exerciseId);
  if (!found) throw new Error(`no ${exerciseId} in ${blockType} on ${date}`);
  return found;
}

/** The swap's view of an item, or fails when the item has none. */
function swapOn(date: string, blockType: string, exerciseId: string, overrides: Partial<TrainingSettings> = {}): ItemView {
  const swapView = itemOn(date, blockType, exerciseId, overrides).noEquipment;
  if (!swapView) throw new Error(`${exerciseId} has no swap view on ${date}`);
  return swapView;
}

describe("swap views: worked examples (PR 17)", () => {
  it("2 Nov W1 D1: backpack slams 6 x 6 with 30-45s rest, inverted rows 9 min x 6-8, chair dips 2 x easy", () => {
    const slams = swapOn("2026-11-02", "explosive", "med_ball_slam");
    expect(slams.exercise.id).toBe("backpack_slam");
    expect(slams.sets).toHaveLength(6);
    expect(slams.sets.every((set) => set.target?.kind === "fixed" && set.target.count === 6)).toBe(true);
    expect(slams.restSec).toEqual({ min: 30, max: 45 });
    expect(slams.load).toBe("backpack with books");

    const rows = swapOn("2026-11-02", "mainStrength", "pull_up");
    expect(rows.exercise.id).toBe("inverted_row");
    expect(rows.minutes).toBe(9);
    expect(rows.target).toEqual({ kind: "range", min: 6, max: 8, basis: undefined });

    const dips = swapOn("2026-11-02", "miniDose", "dip");
    expect(dips.exercise.id).toBe("chair_dip");
    expect(dips.sets).toHaveLength(2);
    expect(dips.sets[0]!.target).toEqual({ kind: "text", text: "easy, ~50% effort" });
  });

  it("2 Nov W1 D1, nothing ticked: the normal view is unchanged (pull-up EMOM 9 min x 4) and also carries a swap view", () => {
    const pullUps = itemOn("2026-11-02", "mainStrength", "pull_up");

    expect(pullUps.exercise.id).toBe("pull_up");
    expect(pullUps.minutes).toBe(9);
    expect(pullUps.target).toMatchObject({ kind: "fixed", count: 4 });
    expect(pullUps.noEquipment).toBeDefined();
    expect(pullUps.noEquipment?.noEquipment).toBeUndefined();
  });

  it("items without a swap have no swap view", () => {
    const session = trainingOn("2026-11-02");
    const withoutSwap = session.blocks.flatMap((candidate) => candidate.items).filter((entry) => entry.noEquipment === undefined);
    expect(withoutSwap.length).toBeGreaterThan(0);
  });

  it("16 Nov W3 D1: inverted rows 9 min x 8-10", () => {
    const rows = swapOn("2026-11-16", "mainStrength", "pull_up");
    expect(rows.minutes).toBe(9);
    expect(rows.target).toMatchObject({ kind: "range", min: 8, max: 10 });
  });

  it("23 Nov W4 D1 (deload): slams 3 x 6, inverted rows 5 min x 8-10 (week 3's, held), chair dips 1 x easy", () => {
    expect(swapOn("2026-11-23", "explosive", "med_ball_slam").sets).toHaveLength(3);

    const rows = swapOn("2026-11-23", "mainStrength", "pull_up");
    expect(rows.minutes).toBe(5);
    expect(rows.target).toMatchObject({ kind: "range", min: 8, max: 10 });

    expect(swapOn("2026-11-23", "miniDose", "dip").sets).toHaveLength(1);
  });

  it("30 Nov W5 D1 (power endurance): inverted rows 9 min x 6-8; shadow boxing 4-5 rounds x 25-35s / 30s rest", () => {
    const rows = swapOn("2026-11-30", "mainStrength", "pull_up");
    expect(rows.minutes).toBe(9);
    expect(rows.target).toMatchObject({ kind: "range", min: 6, max: 8 });

    const boxing = swapOn("2026-11-30", "finisher", "heavy_bag");
    expect(boxing.exercise.id).toBe("shadow_boxing");
    expect(boxing.rounds).toEqual({ min: 4, max: 5 });
    expect(boxing.workSec).toEqual({ min: 25, max: 35 });
    expect(boxing.workSecAdjustment).toBe(5);
    expect(boxing.restSec).toEqual({ min: 30, max: 30 });
  });

  it("21 Dec W8 D1 (retest): inverted rows 5 min x 8-10 (week 7's, held) with no week-8 max saved", () => {
    const rows = swapOn("2026-12-21", "mainStrength", "pull_up");
    expect(rows.minutes).toBe(5);
    expect(rows.target).toMatchObject({ kind: "range", min: 8, max: 10 });
  });

  it("21 Dec W8 D1 (retest): inverted rows stay 5 min x 8-10 after a retested pull-up max of 15 is saved that day, while the pull-up EMOM switches to 6", () => {
    const retested = { maxReps: { pull_up: 15, dip: 15 }, maxSavedOn: { pull_up: "2026-12-21" } };

    const rows = swapOn("2026-12-21", "mainStrength", "pull_up", retested);
    expect(rows.minutes).toBe(5);
    expect(rows.target).toEqual({ kind: "range", min: 8, max: 10, basis: undefined });

    // The original is untouched by the swap's rule: floor(15 x 0.40) = 6, no hold.
    const pullUps = itemOn("2026-12-21", "mainStrength", "pull_up", retested);
    expect(pullUps.target).toMatchObject({ kind: "fixed", count: 6, basis: { usesRetestedMax: true, heldForDeload: false } });
  });

  it("21 Dec W8 D1: the original pull-up EMOM still holds week 7's 6 while awaiting a retest", () => {
    const pullUps = itemOn("2026-12-21", "mainStrength", "pull_up");
    expect(pullUps.target).toMatchObject({ kind: "fixed", count: 6, basis: { heldForDeload: true, awaitingRetest: true } });
  });

  it("4 Nov W1 D3: chair dips 9-min EMOM x 8-10; water jug halo 8 each direction; plank shoulder taps 12-15 per side", () => {
    const dips = swapOn("2026-11-04", "mainStrength", "dip");
    expect(dips.exercise.id).toBe("chair_dip");
    expect(dips.minutes).toBe(9);
    expect(dips.target).toMatchObject({ kind: "range", min: 8, max: 10 });

    const halo = swapOn("2026-11-04", "warmup", "plate_halo");
    expect(halo.exercise.id).toBe("water_jug_halo");
    expect(halo.target).toEqual({ kind: "text", text: "8 each direction" });
    expect(halo.load).toBeUndefined();

    const taps = swapOn("2026-11-04", "warmup", "pallof_press");
    expect(taps.exercise.id).toBe("plank_shoulder_tap");
    expect(taps.target).toEqual({ kind: "text", text: "12-15 per side" });
  });

  it("5 Nov W1 D4: backpack swings 8-min EMOM x 12-15; backpack single-leg RDL 3 x 12-15 per leg, 3s lowering, 3s hold at the bottom", () => {
    const swings = swapOn("2026-11-05", "explosive", "kettlebell_swing");
    expect(swings.exercise.id).toBe("backpack_swing");
    expect(swings.minutes).toBe(8);
    expect(swings.target).toMatchObject({ kind: "range", min: 12, max: 15 });

    const rdl = swapOn("2026-11-05", "mainStrength", "single_leg_rdl");
    expect(rdl.exercise.id).toBe("backpack_single_leg_rdl");
    expect(rdl.sets).toHaveLength(3);
    expect(rdl.sets.every((set) => set.target?.kind === "range" && set.target.min === 12 && set.target.max === 15)).toBe(true);
    expect(rdl.perSide).toBe(true);
    expect(rdl.tempo).toBe("3s lowering, 3s hold at the bottom");
  });

  it("26 Nov W4 D4 (deload): backpack swings 4 min x 12-15; backpack single-leg RDL 2 x 12-15 per leg", () => {
    const swings = swapOn("2026-11-26", "explosive", "kettlebell_swing");
    expect(swings.minutes).toBe(4);
    expect(swings.target).toMatchObject({ kind: "range", min: 12, max: 15 });

    const rdl = swapOn("2026-11-26", "mainStrength", "single_leg_rdl");
    expect(rdl.sets).toHaveLength(2);
    expect(rdl.sets[0]!.target).toMatchObject({ kind: "range", min: 12, max: 15 });
  });

  it("6 Nov W1 D5: push press 5 x 5 / 45s, pike push-ups 3 x 15-20 / 60s / 2s lowering, lying leg raise 4 x 15-20, prone back extension 3 x 25", () => {
    const pressItem = swapOn("2026-11-06", "explosive", "db_push_press");
    expect(pressItem.exercise.id).toBe("backpack_push_press");
    expect(pressItem.sets).toHaveLength(5);
    expect(pressItem.sets.every((set) => set.target?.kind === "fixed" && set.target.count === 5)).toBe(true);
    expect(pressItem.restSec).toEqual({ min: 45, max: 45 });
    expect(pressItem.sets.every((set) => set.load === undefined)).toBe(true);
    expect(pressItem.load).toBe("backpack with books");

    const pike = swapOn("2026-11-06", "mainStrength", "overhead_press");
    expect(pike.exercise.id).toBe("pike_push_up");
    expect(pike.sets).toHaveLength(3);
    expect(pike.sets[0]!.target).toMatchObject({ kind: "range", min: 15, max: 20 });
    expect(pike.restSec).toEqual({ min: 60, max: 60 });
    expect(pike.tempo).toBe("2s lowering");

    const legRaise = swapOn("2026-11-06", "core", "hanging_leg_raise");
    expect(legRaise.exercise.id).toBe("lying_leg_raise");
    expect(legRaise.sets).toHaveLength(4);
    expect(legRaise.sets[0]!.target).toMatchObject({ kind: "range", min: 15, max: 20 });

    const backExtension = swapOn("2026-11-06", "core", "back_extension");
    expect(backExtension.exercise.id).toBe("prone_back_extension");
    expect(backExtension.sets).toHaveLength(3);
    expect(backExtension.sets.every((set) => set.target?.kind === "fixed" && set.target.count === 25)).toBe(true);
    expect(backExtension.load).toBeUndefined();
    expect(backExtension.tempo).toBe("2s hold at the top, slow");
  });

  it("7 Nov W1 D6: stair calf raise 3 sets all 20-30 per leg with no per-set loads, backpack on, 2s pause at the bottom", () => {
    const calf = swapOn("2026-11-07", "mainStrength", "single_leg_calf_raise");
    expect(calf.exercise.id).toBe("stair_calf_raise");
    expect(calf.sets).toHaveLength(3);
    expect(calf.sets.every((set) => set.target?.kind === "range" && set.target.min === 20 && set.target.max === 30)).toBe(true);
    expect(calf.sets.every((set) => set.load === undefined)).toBe(true);
    expect(calf.load).toBe("backpack on");
    expect(calf.perSide).toBe(true);
    expect(calf.tempo).toBe("2s pause at the bottom");

    // The original keeps its own per-set loads.
    const original = itemOn("2026-11-07", "mainStrength", "single_leg_calf_raise");
    expect(original.sets.map((set) => set.load)).toEqual(["heavy", "moderate", "moderate"]);
  });

  it("28 Nov W4 D6 (deload): stair calf raise 2 sets of 20-30 per leg", () => {
    const calf = swapOn("2026-11-28", "mainStrength", "single_leg_calf_raise");
    expect(calf.sets).toHaveLength(2);
    expect(calf.sets.every((set) => set.target?.kind === "range" && set.target.min === 20 && set.target.max === 30)).toBe(true);
  });

  it("4 Dec W5 D5 and 30 Nov W5 D1: shadow boxing keeps the power-endurance work range 25-35s", () => {
    expect(swapOn("2026-12-04", "finisher", "heavy_bag").workSec).toEqual({ min: 25, max: 35 });
  });
});

describe("applyNoEquipmentSwap", () => {
  /** The shipped Day 6 calf raise item, which has per-set loads and a swap. */
  function shippedItem(day: number, blockType: string, exerciseId: string): BlockItem {
    const found = program.days[day]!.blocks.filter((candidate) => candidate.type === blockType).flatMap((candidate) => candidate.items).find((entry) => entry.exerciseId === exerciseId);
    if (!found) throw new Error(`no ${exerciseId}`);
    return found;
  }

  it("keeps the original's structure and takes the swap's exercise, reps, load and tempo", () => {
    const original = shippedItem(4, "mainStrength", "single_leg_rdl");
    const effective = applyNoEquipmentSwap(original);

    expect(effective.exerciseId).toBe("backpack_single_leg_rdl");
    expect(effective.exercise.id).toBe("backpack_single_leg_rdl");
    expect(effective.sets).toHaveLength(original.sets.length);
    expect(effective.sets[0]!.reps).toEqual({ kind: "range", min: 12, max: 15 });
    expect(effective.perSide).toBe(original.perSide);
    expect(effective.format).toBe(original.format);
    expect(effective.load).toBe("backpack or full water jug");
    expect(effective.tempo).toBe("3s lowering, 3s hold at the bottom");
    expect(effective.noEquipment).toBeUndefined();
  });

  it("keeps the original's reps when the swap gives none, and does not carry the original's text over", () => {
    const original = shippedItem(1, "core", "hanging_leg_raise");
    expect(original.note).toBe("Wrist straps are fine");

    const effective = applyNoEquipmentSwap(original);
    expect(effective.note).toBeUndefined();

    const slams = applyNoEquipmentSwap(shippedItem(1, "explosive", "med_ball_slam"));
    expect(slams.sets.map((set) => set.reps)).toEqual(shippedItem(1, "explosive", "med_ball_slam").sets.map((set) => set.reps));
    expect(slams.restSec).toEqual({ min: 30, max: 45 });
  });

  it("replaces every set's reps with the swap's and drops per-set loads", () => {
    const original = shippedItem(6, "mainStrength", "single_leg_calf_raise");
    const effective = applyNoEquipmentSwap(original);

    expect(effective.sets.map((set) => set.reps)).toEqual(Array(3).fill({ kind: "range", min: 20, max: 30 }));
    expect(effective.sets.every((set) => set.load === undefined)).toBe(true);
    expect(original.sets[0]!.load).toBe("heavy");
  });

  it("keeps an EMOM's minutes and weekly increase and swaps its max-based reps for the swap's", () => {
    const effective = applyNoEquipmentSwap(shippedItem(1, "mainStrength", "pull_up"));

    expect(effective.minutes).toBe(9);
    expect(effective.weeklyIncrease).toBe("+1 rep per minute");
    expect(effective.reps).toEqual({ kind: "range", min: 6, max: 8 });
  });

  it("does not change the original item and returns an item without a swap unchanged", () => {
    const original = shippedItem(4, "mainStrength", "single_leg_rdl");
    const before = JSON.stringify(original);
    applyNoEquipmentSwap(original);
    expect(JSON.stringify(original)).toBe(before);

    const withoutSwap = { ...original, noEquipment: undefined };
    expect(applyNoEquipmentSwap(withoutSwap)).toBe(withoutSwap);
  });
});
