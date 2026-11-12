import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { TrainingSettings } from "../settings/model";
import { applyNoEquipmentChoices, hasNoEquipmentSwap, noEquipmentItemKey, originalExerciseIdOf } from "./noEquipment";
import { parseProgram } from "./parse";
import type { ItemView, SessionView } from "./schedule";
import { buildSession } from "./schedule";

/**
 * Unit tests for applying ticked "No equipment" swaps to a built session
 * (PLAN.md section 6 worked examples), against the shipped public/program.json.
 * Start 2 Nov 2026, max pull-ups 12, max dips 15.
 */

const program = parseProgram(JSON.parse(readFileSync("public/program.json", "utf-8"))).program;

const settings: TrainingSettings = {
  startDate: "2026-11-02",
  maxReps: { pull_up: 12, dip: 15 },
  maxSavedOn: {},
  maxHistory: { pull_up: [{ savedOn: null, reps: 12 }], dip: [{ savedOn: null, reps: 15 }] },
};

/** Builds the session for a date, with the given tick keys applied. */
function sessionWith(date: string, keys: string[]): SessionView {
  return applyNoEquipmentChoices(buildSession(program, settings, date), new Set(keys));
}

/** Finds an item by exercise id in a training session (original or swapped id), or fails. */
function findItem(session: SessionView, exerciseId: string): ItemView {
  if (session.kind !== "training") throw new Error(`expected training, got ${session.kind}`);
  const found = session.blocks.flatMap((block) => block.items).find((item) => item.exercise.id === exerciseId);
  if (!found) throw new Error(`no ${exerciseId} in session`);
  return found;
}

describe("applyNoEquipmentChoices", () => {
  it("with nothing ticked returns a session equal to the input", () => {
    const built = buildSession(program, settings, "2026-11-02");

    expect(applyNoEquipmentChoices(built, new Set())).toEqual(built);
  });

  it("2 Nov W1 D1 with slams and pull-ups ticked: backpack slams 6 x 6, inverted rows 9 min x 6-8, others unchanged", () => {
    const built = buildSession(program, settings, "2026-11-02");
    const session = sessionWith("2026-11-02", [noEquipmentItemKey(2, "med_ball_slam"), noEquipmentItemKey(3, "pull_up")]);

    const slams = findItem(session, "backpack_slam");
    expect(slams.sets).toHaveLength(6);
    expect(slams.sets.every((set) => set.target?.kind === "fixed" && set.target.count === 6)).toBe(true);
    expect(slams.swappedFrom?.id).toBe("med_ball_slam");

    const rows = findItem(session, "inverted_row");
    expect(rows.minutes).toBe(9);
    expect(rows.target).toEqual({ kind: "range", min: 6, max: 8, basis: undefined });
    expect(rows.swappedFrom?.id).toBe("pull_up");

    // Every other item is the very same view as in the unticked session.
    if (built.kind !== "training" || session.kind !== "training") throw new Error("expected training");
    session.blocks.forEach((block, blockIndex) => {
      block.items.forEach((item, itemIndex) => {
        const original = built.blocks[blockIndex]!.items[itemIndex]!;
        if (item.swappedFrom === undefined) expect(item).toEqual(original);
      });
    });
  });

  it("does not mutate the input session", () => {
    const built = buildSession(program, settings, "2026-11-02");
    const snapshot = structuredClone(built);

    applyNoEquipmentChoices(built, new Set([noEquipmentItemKey(3, "pull_up")]));

    expect(built).toEqual(snapshot);
  });

  it("23 Nov W4 D1 (deload) ticked rows: 5 min x 8-10", () => {
    const rows = findItem(sessionWith("2026-11-23", [noEquipmentItemKey(3, "pull_up")]), "inverted_row");

    expect(rows.minutes).toBe(5);
    expect(rows.target).toMatchObject({ kind: "range", min: 8, max: 10 });
  });

  it("21 Dec W8 D1 (deload + retest) ticked rows: 5 min x 8-10", () => {
    const rows = findItem(sessionWith("2026-12-21", [noEquipmentItemKey(3, "pull_up")]), "inverted_row");

    expect(rows.minutes).toBe(5);
    expect(rows.target).toMatchObject({ kind: "range", min: 8, max: 10 });
  });

  it("5 Nov W1 D4 ticked RDL: 3 x 12-15 with the swap's tempo", () => {
    const session = sessionWith("2026-11-05", [noEquipmentItemKey(3, "single_leg_rdl")]);
    const rdl = findItem(session, "backpack_single_leg_rdl");

    expect(rdl.sets).toHaveLength(3);
    expect(rdl.sets.every((set) => set.target?.kind === "range" && set.target.min === 12 && set.target.max === 15)).toBe(true);
    expect(rdl.tempo).toBeDefined();
    expect(rdl.tempo).toBe(findItem(buildSession(program, settings, "2026-11-05"), "single_leg_rdl").noEquipment?.tempo);
    expect(rdl.swappedFrom?.id).toBe("single_leg_rdl");
  });

  it("a key for an item with no swap changes nothing", () => {
    // 3 Nov W1 D2: split squat jump has no swap.
    const built = buildSession(program, settings, "2026-11-03");

    expect(findItem(built, "split_squat_jump").noEquipment).toBeUndefined();
    expect(applyNoEquipmentChoices(built, new Set([noEquipmentItemKey(2, "split_squat_jump")]))).toEqual(built);
  });

  it("day-qualified keys: builds them with the day and matches them only when asked to", () => {
    expect(noEquipmentItemKey(3, "pull_up")).toBe("3:pull_up");
    expect(noEquipmentItemKey(3, "pull_up", 1)).toBe("1.3:pull_up");

    // 2 Nov is Day 1: the pull-up (block 3) has a swap. A qualified key only counts in qualified mode.
    const built = buildSession(program, settings, "2026-11-02");
    const qualified = new Set([noEquipmentItemKey(3, "pull_up", 1)]);
    expect(applyNoEquipmentChoices(built, qualified)).toEqual(built);
    expect(applyNoEquipmentChoices(built, qualified, true)).not.toEqual(built);
    // The other day's qualified key does not match this day's block.
    expect(applyNoEquipmentChoices(built, new Set([noEquipmentItemKey(3, "pull_up", 2)]), true)).toEqual(built);
  });

  it("a key with the wrong block position changes nothing", () => {
    const built = buildSession(program, settings, "2026-11-02");

    expect(applyNoEquipmentChoices(built, new Set([noEquipmentItemKey(1, "pull_up")]))).toEqual(built);
  });

  it("a rest day and a not-started session are returned unchanged", () => {
    const keys = new Set([noEquipmentItemKey(3, "pull_up")]);
    const rest = buildSession(program, settings, "2026-11-08");
    const notStarted = buildSession(program, settings, "2026-11-01");

    expect(rest.kind).toBe("rest");
    expect(notStarted.kind).toBe("notStarted");
    expect(applyNoEquipmentChoices(rest, keys)).toEqual(rest);
    expect(applyNoEquipmentChoices(notStarted, keys)).toEqual(notStarted);
  });

  it("week 5 rotated Pallof press: the rotation dropped its swap, so the key changes nothing", () => {
    const built = buildSession(program, settings, "2026-11-30");

    expect(findItem(built, "pallof_press").noEquipment).toBeUndefined();
    expect(applyNoEquipmentChoices(built, new Set([noEquipmentItemKey(1, "pallof_press")]))).toEqual(built);
  });
});

describe("noEquipmentItemKey and the item helpers", () => {
  it("builds '<position>:<original id>' keys", () => {
    expect(noEquipmentItemKey(3, "single_leg_rdl")).toBe("3:single_leg_rdl");
  });

  it("hasNoEquipmentSwap and originalExerciseIdOf work for normal and swapped views", () => {
    const normal = findItem(buildSession(program, settings, "2026-11-02"), "pull_up");
    const swapped = findItem(sessionWith("2026-11-02", [noEquipmentItemKey(3, "pull_up")]), "inverted_row");
    const plain = findItem(buildSession(program, settings, "2026-11-02"), "side_plank");

    expect(hasNoEquipmentSwap(normal)).toBe(true);
    expect(hasNoEquipmentSwap(swapped)).toBe(true);
    expect(hasNoEquipmentSwap(plain)).toBe(false);
    expect(originalExerciseIdOf(normal)).toBe("pull_up");
    expect(originalExerciseIdOf(swapped)).toBe("pull_up");
  });
});
