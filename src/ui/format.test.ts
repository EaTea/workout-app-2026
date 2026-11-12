import { describe, expect, it } from "vitest";
import type { BlockView, ItemView, RepTarget, SetView } from "../program/schedule";
import {
  blockLabel, formatBlockChange, formatBlockTitle, formatItemChange, formatPlanKicker, formatItemDetails, formatItemDose, formatPrescriptionSummary,
  formatLastTime, formatOverviewHeadline, formatSetsSummary, formatWeekRange, formatWeeklyDuration, formatTimerAdjustment, formatSessionKicker, formatSetBreakdown, formatShortDate, isAwaitingRetest,
} from "./format";
import type { LoggedSet } from "../log/model";

/** Builds an ItemView with sensible defaults; tests override what they care about. */
function item(overrides: Partial<ItemView> = {}): ItemView {
  return {
    exercise: { id: "x", name: "X", category: "strength", cues: [], evidence: { kind: "coachingPractice" }, progression: [], maxTested: false },
    format: "straight sets",
    sets: [],
    perSide: false,
    optional: false,
    ...overrides,
  };
}

/** n identical sets with the given target. */
function sets(count: number, target?: RepTarget, load?: string): SetView[] {
  return Array.from({ length: count }, () => ({ target, load }));
}

describe("dates and titles", () => {
  it("formats short dates and the kicker", () => {
    expect(formatShortDate("2026-11-09")).toBe("9 Nov");
    expect(formatSessionKicker("2026-11-09", 2, 8, 1)).toBe("9 Nov · Week 2 of 8 · Day 1");
  });

  it("maps block labels and titles", () => {
    const block = (overrides: Partial<BlockView>): BlockView => ({ position: 1, type: "warmup", format: "straight sets", items: [], ...overrides });
    expect(blockLabel("mainStrength")).toBe("Main strength");
    expect(blockLabel("mystery")).toBe("mystery");
    expect(["balance", "isometric", "strength", "walk", "cooldown"].map(blockLabel)).toEqual(["Balance", "Isometric holds", "Strength", "Walk", "Cool-down"]);
    expect(formatBlockTitle(1, block({ format: "superset", rounds: { min: 2, max: 2 } }))).toBe("1 · Warm-up · 2 rounds");
    expect(formatBlockTitle(3, block({ type: "mainStrength", minutes: 9 }))).toBe("3 · Main strength · 9 min");
    expect(formatBlockTitle(5, block({ type: "core", format: "superset" }))).toBe("5 · Core · superset");
    expect(formatBlockTitle(6, block({ type: "finisher" }))).toBe("6 · Finisher");
  });
});

describe("formatItemDose", () => {
  it("shows sets x reps", () => {
    expect(formatItemDose(item({ sets: sets(6, { kind: "fixed", count: 6 }) })).text).toBe("6 × 6");
    expect(formatItemDose(item({ sets: sets(4, { kind: "range", min: 12, max: 15 }) })).text).toBe("4 × 12–15");
  });

  it("shows an EMOM as reps per minute with the length underneath", () => {
    const dose = formatItemDose(item({ format: "emom", minutes: 9, target: { kind: "fixed", count: 5 } }));
    expect(dose).toEqual({ text: "5 / min", subtext: "9 min" });
  });

  it("shows warm-up reps as a plain range", () => {
    expect(formatItemDose(item({ target: { kind: "range", min: 12, max: 15 } })).text).toBe("12–15");
  });

  it("shows intervals and timed holds", () => {
    expect(
      formatItemDose(item({ format: "interval", rounds: { min: 4, max: 5 }, workSec: { min: 20, max: 30 } })).text,
    ).toBe("4–5 × 20–30s");
    expect(formatItemDose(item({ sets: sets(2), durationSec: 30 })).text).toBe("2 × 30s");
  });

  it("summarises per-set prescriptions as a set count", () => {
    const calf = [
      { target: { kind: "range", min: 8, max: 10 } as RepTarget, load: "heavy" },
      { target: { kind: "range", min: 15, max: 25 } as RepTarget, load: "moderate" },
      { target: { kind: "range", min: 15, max: 25 } as RepTarget, load: "moderate" },
    ];
    expect(formatItemDose(item({ sets: calf })).text).toBe("3 sets");
    expect(formatSetBreakdown(item({ sets: calf }))).toBe("8–10 heavy, then 15–25 moderate ×2");
  });

  it("links to Settings when a max is missing", () => {
    const target: RepTarget = { kind: "needsMax", exerciseId: "dip", percentMin: 0.5, percentMax: 0.5 };
    expect(formatItemDose(item({ sets: sets(2, target) }))).toEqual({ text: "Set max", needsMaxExerciseId: "dip" });
    expect(formatItemDose(item({ format: "emom", minutes: 9, target }))).toEqual({ text: "Set max", needsMaxExerciseId: "dip" });
  });
});

describe("formatItemDetails", () => {
  it("lists only what the data has", () => {
    expect(formatItemDetails(item({ sets: sets(6, { kind: "fixed", count: 6 }), restSec: { min: 30, max: 45 } }))).toEqual(["Rest 30–45s"]);
    expect(formatItemDetails(item({ restSec: { min: 45, max: 45 }, perSide: true, tempo: "3s lowering", optional: true, note: "Strap up" }))).toEqual([
      "Rest 45s", "per side", "tempo: 3s lowering", "Strap up", "optional",
    ]);
    // The generic program rule text is no longer repeated on every row.
    expect(formatItemDetails(item({ load: "hold a plate", weeklyIncrease: "+1 rep per minute" }))).toEqual(["Hold a plate"]);
  });

  it("explains percent-of-max targets, omitting a zero increase and labelling a held one", () => {
    const week2 = { kind: "fixed", count: 6, basis: { percentMin: 0.4, percentMax: 0.4, max: 12, weeklyIncrease: 1, heldForDeload: false, usesRetestedMax: false } } as RepTarget;
    expect(formatItemDetails(item({ format: "emom", minutes: 9, target: week2 }))).toEqual(["40% of max 12 · +1 this week"]);

    const range = { kind: "range", min: 6, max: 7, basis: { percentMin: 0.4, percentMax: 0.5, max: 15, weeklyIncrease: 0, heldForDeload: false, usesRetestedMax: false } } as RepTarget;
    expect(formatItemDetails(item({ format: "emom", minutes: 9, target: range }))).toEqual(["40–50% of max 15"]);

    const deload = { kind: "fixed", count: 6, basis: { percentMin: 0.4, percentMax: 0.4, max: 12, weeklyIncrease: 2, heldForDeload: true } } as RepTarget;
    expect(formatItemDetails(item({ format: "emom", minutes: 5, target: deload }))).toEqual(["40% of max 12 · +2, held for deload"]);
  });

  it("says a retest-week target is held until a retested max is saved, and offers the update link", () => {
    const awaiting = { kind: "fixed", count: 6, basis: { percentMin: 0.4, percentMax: 0.4, max: 12, weeklyIncrease: 2, heldForDeload: true, usesRetestedMax: false, awaitingRetest: true } } as RepTarget;
    const awaitingItem = item({ format: "emom", minutes: 5, target: awaiting });
    expect(formatItemDetails(awaitingItem)).toEqual(["40% of max 12 · +2 held until you save a retested max"]);
    expect(isAwaitingRetest(awaitingItem)).toBe(true);
  });

  it("says a retest-week target uses the retested max, with no update link", () => {
    const retest = { kind: "fixed", count: 6, basis: { percentMin: 0.4, percentMax: 0.4, max: 15, weeklyIncrease: 0, heldForDeload: false, usesRetestedMax: true, awaitingRetest: false } } as RepTarget;
    const retestItem = item({ format: "emom", minutes: 5, target: retest });
    expect(formatItemDetails(retestItem)).toEqual(["40% of your retested max 15"]);
    expect(isAwaitingRetest(retestItem)).toBe(false);
  });

  it("builds a one-line prescription summary", () => {
    expect(formatPrescriptionSummary(item({ format: "emom", minutes: 9, target: { kind: "fixed", count: 5 } }))).toBe("5 / min, 9 min");
    expect(formatPrescriptionSummary(item({ sets: sets(6, { kind: "fixed", count: 6 }), restSec: { min: 30, max: 45 } }))).toBe("6 × 6 · Rest 30–45s");
  });
});

describe("formatLastTime", () => {
  /** Last-time sets from [reps, loadKg] pairs; undefined means not recorded. */
  function lastTime(pairs: Array<[number | undefined, number | undefined]>) {
    const loggedSets: LoggedSet[] = pairs.map(([reps, loadKg], index) => ({
      exerciseId: "x", blockPosition: 1, setNumber: index + 1, reps, loadKg, loggedAt: new Date(),
    }));
    return { date: "2026-11-02", sets: loggedSets };
  }

  it("matches the mockup: sets x reps at a load", () => {
    expect(formatLastTime(lastTime(Array.from({ length: 6 }, () => [6, 6] as [number, number])), "set")).toBe("Last time (2 Nov): 6 × 6 at 6 kg");
  });

  it("lists the reps when they differ", () => {
    expect(formatLastTime(lastTime([[6, 6], [6, 6], [5, 6]]), "set")).toBe("Last time (2 Nov): 6, 6, 5 at 6 kg");
  });

  it("gives a load range when loads differ, and no load part for bodyweight", () => {
    expect(formatLastTime(lastTime([[8, 6], [8, 8]]), "set")).toBe("Last time (2 Nov): 2 × 8 at 6–8 kg");
    expect(formatLastTime(lastTime([[5, undefined], [5, undefined]]), "set")).toBe("Last time (2 Nov): 2 × 5");
  });

  it("counts ticked-only sets in the item's own word", () => {
    expect(formatLastTime(lastTime([[undefined, undefined], [undefined, undefined]]), "round")).toBe("Last time (2 Nov): 2 rounds");
    expect(formatLastTime(lastTime([[undefined, undefined]]), "set")).toBe("Last time (2 Nov): 1 set");
  });
});

describe("formatSetsSummary", () => {
  it("has the same text as the last-time hint without its prefix", () => {
    expect(formatSetsSummary([{ reps: 6, loadKg: 6 }, { reps: 6, loadKg: 6 }], "set")).toBe("2 × 6 at 6 kg");
    expect(formatSetsSummary([{ reps: 6 }, { reps: 6 }, { reps: 5 }], "set")).toBe("6, 6, 5");
    expect(formatSetsSummary([{}, {}, {}, {}, {}], "round")).toBe("5 rounds");
  });
});

describe("formatTimerAdjustment", () => {
  it("shows a positive change with a plus sign", () => {
    expect(formatTimerAdjustment("Power endurance", 5, "work")).toBe("Power endurance: +5s work");
  });

  it("shows a negative change with a true minus sign (U+2212)", () => {
    expect(formatTimerAdjustment("Power endurance", -15, "rest")).toBe("Power endurance: \u221215s rest");
  });
});

describe("Overview wording", () => {
  it("rounds a weekly total to the nearest 15 minutes with 'about'", () => {
    expect(formatWeeklyDuration(234)).toBe("about 4 h");
    expect(formatWeeklyDuration(255)).toBe("about 4 h 15 min");
    expect(formatWeeklyDuration(242)).toBe("about 4 h");
    expect(formatWeeklyDuration(135)).toBe("about 2 h 15 min");
    expect(formatWeeklyDuration(150)).toBe("about 2 h 30 min");
    expect(formatWeeklyDuration(142)).toBe("about 2 h 15 min");
    expect(formatWeeklyDuration(59)).toBe("59 min");
    expect(formatWeeklyDuration(62)).toBe("about 1 h");
    expect(formatWeeklyDuration(68)).toBe("about 1 h 15 min");
    expect(formatWeeklyDuration(60)).toBe("about 1 h");
  });

  it("keeps exact minutes under an hour", () => {
    expect(formatWeeklyDuration(45)).toBe("45 min");
  });

  it("words the headline from the program's numbers", () => {
    expect(formatOverviewHeadline(8, 6, 234)).toBe("8 weeks · 6 training days a week · about 4 h a week");
    expect(formatOverviewHeadline(1, 1, 45)).toBe("1 week · 1 training day a week · 45 min a week");
  });

  it("labels a phase's weeks as a range or a single week", () => {
    expect(formatWeekRange(1, 3)).toBe("Weeks 1–3");
    expect(formatWeekRange(4, 4)).toBe("Week 4");
  });
});

describe("Day plan wording", () => {
  it("builds the kicker", () => {
    expect(formatPlanKicker(1, 4, 8, "Deload")).toBe("Day 1 · Week 4 of 8 · Deload");
  });

  it("names the previous week's dose (med ball slams, Day 1 week 4)", () => {
    const slamsWeek3 = item({ sets: sets(6, { kind: "fixed", count: 6 }) });
    const slamsWeek4 = item({ sets: sets(3, { kind: "fixed", count: 6 }) });
    expect(formatItemChange(slamsWeek3, slamsWeek4, 3)).toBe("Changed: 6 × 6 in week 3");
  });

  it("shows only the EMOM parts that differ", () => {
    const emom = (count: number, minutes: number) => item({ format: "emom", minutes, target: { kind: "fixed", count } });
    expect(formatItemChange(emom(4, 9), emom(5, 9), 1)).toBe("Changed: 4 / min in week 1");
    expect(formatItemChange(emom(6, 9), emom(6, 5), 3)).toBe("Changed: 9 min in week 3");
    expect(formatItemChange(emom(6, 9), emom(5, 6), 3)).toBe("Changed: 6 / min · 9 min in week 3");
  });

  it("leaves out minutes the block line already reports, and gives no line if that was all", () => {
    const emom = (count: number, minutes: number) => item({ format: "emom", minutes, target: { kind: "fixed", count } });
    expect(formatItemChange(emom(6, 9), emom(6, 5), 3, true)).toBeUndefined();
    expect(formatItemChange(emom(6, 9), emom(5, 5), 3, true)).toBe("Changed: 6 / min in week 3");
  });

  it("describes a needs-max previous dose by structure, never as Set max", () => {
    const needsMax: RepTarget = { kind: "needsMax", exerciseId: "dip", percentMin: 60, percentMax: 70 };
    expect(formatItemChange(item({ sets: sets(2, needsMax) }), item({ sets: sets(1, needsMax) }), 3)).toBe("Changed: 2 sets in week 3");
    expect(formatItemChange(item({ sets: sets(1, needsMax) }), item({ sets: sets(2, needsMax) }), 4)).toBe("Changed: 1 set in week 4");
    const emom = (minutes: number) => item({ format: "emom", minutes, target: needsMax });
    expect(formatItemChange(emom(9), emom(5), 3)).toBe("Changed: 9 min in week 3");
  });

  it("reports a changed display name as the previous name", () => {
    const before = item({ exercise: { ...item().exercise, name: "YTWI raises" } });
    const after = item({ exercise: { ...item().exercise, name: "YTWI raises" }, rotatedIn: { displayName: "Reverse fly", originalName: "YTWI raises" } });
    expect(formatItemChange(before, after, 4)).toBe("Changed: YTWI raises in week 4");
  });

  it("falls back to the previous details when only a detail changed", () => {
    const before = item({ sets: sets(3, { kind: "fixed", count: 6 }), restSec: { min: 60, max: 60 } });
    const after = item({ sets: sets(3, { kind: "fixed", count: 6 }), restSec: { min: 30, max: 30 } });
    expect(formatItemChange(before, after, 4)).toBe("Changed: Rest 60s in week 4");
  });

  it("names the previous block figures", () => {
    const block = (overrides: Partial<BlockView>): BlockView => ({ position: 1, type: "core", format: "superset", items: [], ...overrides });
    expect(formatBlockChange(5, block({ rounds: { min: 3, max: 3 } }), 3)).toBe("Changed: 3 rounds in week 3");
    expect(formatBlockChange(5, block({ restSecBetweenPairs: { min: 30, max: 45 } }), 4)).toBe("Changed: rest 30–45s between pairs in week 4");
    expect(formatBlockChange(3, block({ type: "mainStrength", minutes: 9 }), 3)).toBe("Changed: 9 min in week 3");
  });
});
