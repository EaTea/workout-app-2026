import { describe, expect, it } from "vitest";
import type { BlockView, ItemView, RepTarget } from "../program/schedule";
import {
  choosePrefill, countSetsForItem, formatLoggedSet, formatProgress, itemTracksReps, nextSetNumber, planTargetDiffers,
  plannedRepsForSet, prefillForSet, setNeedsMax, setNounFor, setWord,
} from "./itemSets";
import type { LoggedSet } from "./model";

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

const plainBlock: BlockView = { position: 1, type: "explosive", format: "straight sets", items: [] };

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
    const warmupBlock: BlockView = { position: 1, type: "warmup", format: "superset", rounds: { min: 2, max: 2 }, items: [] };
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
    expect(choosePrefill({ previousSetThisSession: { reps: 7, loadKg: 6 }, lastTimeSet: { reps: 5, loadKg: 4 }, plannedReps: 6, planTargetChanged: false }))
      .toEqual({ reps: 7, loadKg: 6 });
  });

  it("treats a previous set with no load as 0 kg", () => {
    expect(choosePrefill({ previousSetThisSession: { reps: 7 }, plannedReps: 6, planTargetChanged: false })).toEqual({ reps: 7, loadKg: 0 });
  });

  it("takes reps from the plan (this week's increase) and load from last time when nothing is logged yet", () => {
    expect(choosePrefill({ lastTimeSet: { reps: 5, loadKg: 4 }, plannedReps: 6, planTargetChanged: false })).toEqual({ reps: 6, loadKg: 4 });
  });

  it("uses last time's reps only when the plan has no number", () => {
    expect(choosePrefill({ lastTimeSet: { reps: 5, loadKg: 4 }, planTargetChanged: false })).toEqual({ reps: 5, loadKg: 4 });
  });

  it("falls back to the plan, with no load", () => {
    expect(choosePrefill({ plannedReps: 6, planTargetChanged: false })).toEqual({ reps: 6, loadKg: 0 });
  });

  it("falls back to the plan's reps when last time's set had none", () => {
    expect(choosePrefill({ lastTimeSet: { loadKg: 4 }, plannedReps: 6, planTargetChanged: false })).toEqual({ reps: 6, loadKg: 4 });
  });

  it("leaves reps blank when there is nothing", () => {
    expect(choosePrefill({ planTargetChanged: false })).toEqual({ reps: undefined, loadKg: 0 });
  });

  it("when the plan's target changed, ignores the previous set: the plan's reps, last time's load, else no load", () => {
    const previousSetThisSession = { reps: 9, loadKg: 20 };
    expect(choosePrefill({ previousSetThisSession, lastTimeSet: { reps: 18, loadKg: 10 }, plannedReps: 15, planTargetChanged: true }))
      .toEqual({ reps: 15, loadKg: 10 });
    expect(choosePrefill({ previousSetThisSession, plannedReps: 15, planTargetChanged: true })).toEqual({ reps: 15, loadKg: 0 });
  });
});

describe("planTargetDiffers and prefillForSet (calf raise: heavy 8-10, then moderate 15-25)", () => {
  /** Day 6's single-leg calf raise as the schedule builds it (public/program.json). */
  const calfRaise = makeItem({
    sets: [
      { target: { kind: "range", min: 8, max: 10 }, load: "heavy" },
      { target: { kind: "range", min: 15, max: 25 }, load: "moderate" },
      { target: { kind: "range", min: 15, max: 25 }, load: "moderate" },
    ],
    perSide: true,
  });

  /** A logged set of the calf raise. */
  function logged(setNumber: number, reps: number, loadKg?: number): LoggedSet {
    return { exerciseId: "x", blockPosition: 3, setNumber, reps, loadKg, loggedAt: new Date() };
  }

  it("sees a change between set 1 and 2 but not between 2 and 3", () => {
    expect(planTargetDiffers(calfRaise, 2, 1)).toBe(true);
    expect(planTargetDiffers(calfRaise, 3, 2)).toBe(false);
  });

  it("does not carry the heavy set's kg into set 2, but does into set 3", () => {
    const afterHeavy = [logged(1, 9, 20)];
    expect(prefillForSet(calfRaise, 2, afterHeavy, undefined)).toEqual({ reps: 15, loadKg: 0 });

    const afterModerate = [logged(1, 9, 20), logged(2, 18, 10)];
    expect(prefillForSet(calfRaise, 3, afterModerate, undefined)).toEqual({ reps: 18, loadKg: 10 });
  });

  it("uses the plan's reps and last time's same-set load when the target changes", () => {
    const lastTime = { date: "2026-11-02", sets: [logged(1, 10, 22), logged(2, 20, 12), logged(3, 18, 12)] };
    expect(prefillForSet(calfRaise, 2, [logged(1, 9, 20)], lastTime)).toEqual({ reps: 15, loadKg: 12 });
  });

  it("starts set 1 with the plan's reps and last time's load, using last time's last set when it had fewer sets", () => {
    const lastTime = { date: "2026-11-02", sets: [logged(1, 10, 22), logged(2, 20, 12)] };
    expect(prefillForSet(calfRaise, 1, [], lastTime)).toEqual({ reps: 8, loadKg: 22 });
    expect(prefillForSet(calfRaise, 3, [], lastTime)).toEqual({ reps: 15, loadKg: 12 });
  });
});

describe("setNounFor", () => {
  it("names one tick of the item", () => {
    expect(setNounFor(makeItem({ sets: setsOf(2) }))).toBe("set");
    expect(setNounFor(makeItem({ format: "interval", rounds: { min: 4, max: 5 } }))).toBe("round");
    expect(setNounFor(makeItem({ format: "emom", minutes: 9 }))).toBe("minute");
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
