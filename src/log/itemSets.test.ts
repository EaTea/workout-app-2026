import { describe, expect, it } from "vitest";
import type { BlockView, ItemView, RepTarget } from "../program/schedule";
import {
  choosePrefill, countSetsForItem, formatLoggedSet, formatProgress, itemTracksReps, nextSetNumber, plannedRepsForSet,
  setNeedsMax, setWord,
} from "./itemSets";

/** Builds an item with only the fields these helpers read; everything else is filled with harmless defaults. */
function makeItem(overrides: Partial<ItemView>): ItemView {
  return {
    exercise: { id: "x", name: "X", category: "c", cues: [], evidence: { kind: "coachingPractice" }, progression: [], maxTested: false },
    format: "straight sets",
    sets: [],
    perSide: false,
    optional: false,
    ...overrides,
  };
}

const plainBlock: BlockView = { type: "explosive", format: "straight sets", items: [] };

/** n identical sets with the given target. */
function setsOf(count: number, target?: RepTarget) {
  return Array.from({ length: count }, () => ({ target }));
}

describe("countSetsForItem", () => {
  it("uses the number of sets (already halved by the schedule)", () => {
    expect(countSetsForItem(makeItem({ sets: setsOf(6, { kind: "fixed", count: 6 }) }), plainBlock)).toBe(6);
    expect(countSetsForItem(makeItem({ sets: setsOf(3, { kind: "fixed", count: 6 }) }), plainBlock)).toBe(3);
  });

  it("uses the EMOM minutes", () => {
    expect(countSetsForItem(makeItem({ format: "emom", minutes: 9 }), plainBlock)).toBe(9);
    expect(countSetsForItem(makeItem({ format: "emom", minutes: 5 }), plainBlock)).toBe(5);
  });

  it("uses the high end of the heavy-bag rounds, and the halved low end in a deload", () => {
    expect(countSetsForItem(makeItem({ format: "interval", rounds: { min: 4, max: 5 } }), plainBlock)).toBe(5);
    expect(countSetsForItem(makeItem({ format: "interval", rounds: { min: 2, max: 2 } }), plainBlock)).toBe(2);
  });

  it("uses the block rounds for warm-up items, else one", () => {
    const warmupBlock: BlockView = { type: "warmup", format: "superset", rounds: { min: 2, max: 2 }, items: [] };
    expect(countSetsForItem(makeItem({ target: { kind: "range", min: 12, max: 15 } }), warmupBlock)).toBe(2);
    expect(countSetsForItem(makeItem({}), plainBlock)).toBe(1);
  });
});

describe("itemTracksReps and setWord", () => {
  it("is false for heavy-bag rounds and timed holds only", () => {
    expect(itemTracksReps(makeItem({ format: "interval" }))).toBe(false);
    expect(itemTracksReps(makeItem({ durationSec: 30, sets: setsOf(2) }))).toBe(false);
    expect(itemTracksReps(makeItem({ sets: setsOf(2, { kind: "fixed", count: 5 }) }))).toBe(true);
    expect(itemTracksReps(makeItem({ format: "emom", minutes: 9 }))).toBe(true);
  });

  it("names the ticks Set, Min or Round", () => {
    expect(setWord(makeItem({ sets: setsOf(2) }))).toBe("Set");
    expect(setWord(makeItem({ format: "emom", minutes: 9 }))).toBe("Min");
    expect(setWord(makeItem({ format: "interval", rounds: { min: 4, max: 5 } }))).toBe("Round");
  });
});

describe("plannedRepsForSet and setNeedsMax", () => {
  it("gives a fixed count and the low end of a range", () => {
    const item = makeItem({ sets: setsOf(2, { kind: "fixed", count: 6 }) });
    expect(plannedRepsForSet(item, 2)).toBe(6);
    expect(plannedRepsForSet(makeItem({ sets: setsOf(3, { kind: "range", min: 12, max: 15 }) }), 1)).toBe(12);
  });

  it("uses each set's own target when sets differ", () => {
    const item = makeItem({ sets: [{ target: { kind: "range", min: 8, max: 10 } }, { target: { kind: "range", min: 15, max: 25 } }] });
    expect(plannedRepsForSet(item, 1)).toBe(8);
    expect(plannedRepsForSet(item, 2)).toBe(15);
  });

  it("falls back to the item-level target (EMOM)", () => {
    expect(plannedRepsForSet(makeItem({ format: "emom", minutes: 9, target: { kind: "fixed", count: 5 } }), 4)).toBe(5);
  });

  it("has no number for free text, a missing max or no target, and flags the missing max", () => {
    const text = makeItem({ sets: setsOf(2, { kind: "text", text: "easy" }) });
    const needsMax = makeItem({ sets: setsOf(2, { kind: "needsMax", exerciseId: "dip", percentMin: 0.5, percentMax: 0.5 }) });
    expect(plannedRepsForSet(text, 1)).toBeUndefined();
    expect(plannedRepsForSet(needsMax, 1)).toBeUndefined();
    expect(plannedRepsForSet(makeItem({ durationSec: 30, sets: setsOf(2) }), 1)).toBeUndefined();
    expect(setNeedsMax(needsMax, 1)).toBe(true);
    expect(setNeedsMax(text, 1)).toBe(false);
  });
});

describe("choosePrefill", () => {
  it("prefers the previous set this session, including its load", () => {
    expect(choosePrefill({ reps: 7, loadKg: 6 }, 6)).toEqual({ reps: 7, loadKg: 6 });
  });

  it("treats a previous set with no load as 0 kg", () => {
    expect(choosePrefill({ reps: 7 }, 6)).toEqual({ reps: 7, loadKg: 0 });
  });

  it("falls back to the plan, with no load", () => {
    expect(choosePrefill(undefined, 6)).toEqual({ reps: 6, loadKg: 0 });
  });

  it("leaves reps blank when there is neither", () => {
    expect(choosePrefill(undefined, undefined)).toEqual({ reps: undefined, loadKg: 0 });
  });
});

describe("nextSetNumber", () => {
  it("moves to the next unlogged set", () => {
    expect(nextSetNumber(1, 6, [1])).toBe(2);
    expect(nextSetNumber(2, 6, [1, 2, 3])).toBe(4);
  });

  it("wraps back to an earlier skipped set, and gives undefined when nothing is left", () => {
    expect(nextSetNumber(3, 3, [3])).toBe(1);
    expect(nextSetNumber(3, 3, [1, 2, 3])).toBeUndefined();
    expect(nextSetNumber(1, 1, [])).toBeUndefined();
  });

  it("skipping goes to another open set but not to itself", () => {
    expect(nextSetNumber(2, 3, [])).toBe(3);
    expect(nextSetNumber(3, 3, [])).toBe(1);
  });
});

describe("formatProgress", () => {
  it("shows nothing before the first set, n/total in progress and a tick when complete", () => {
    expect(formatProgress(0, 6)).toBeUndefined();
    expect(formatProgress(2, 6)).toBe("2/6");
    expect(formatProgress(6, 6)).toBe("✓ 6/6");
  });
});

describe("formatLoggedSet", () => {
  it("lists reps and load, or Done for a ticked-only set", () => {
    expect(formatLoggedSet({ reps: 6, loadKg: 6 })).toBe("6 reps · 6 kg");
    expect(formatLoggedSet({ reps: 1 })).toBe("1 rep");
    expect(formatLoggedSet({})).toBe("Done");
  });
});
