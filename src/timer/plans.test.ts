import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parseProgram } from "../program/parse";
import { buildSession, type ItemView } from "../program/schedule";
import type { TrainingSettings } from "../settings/model";
import { buildEmomPlan, buildIntervalPlan, buildRestPlan, defaultIntervalSettings, defaultRestSeconds, INTERVAL_LIMITS } from "./plans";

const program = parseProgram(JSON.parse(readFileSync("public/program.json", "utf-8"))).program;
const settings: TrainingSettings = { startDate: "2026-11-02", maxReps: { pull_up: 12, dip: 15 }, maxSavedOn: {}, maxHistory: {} };

/** Finds the EMOM item for an exercise on a date (the first matching item in the session). */
function emomItem(date: string, exerciseId: string, overrides: Partial<TrainingSettings> = {}): ItemView {
  const session = buildSession(program, { ...settings, ...overrides }, date);
  if (session.kind !== "training") throw new Error(`expected training on ${date}`);
  for (const block of session.blocks) {
    const found = block.items.find((candidate) => candidate.exercise.id === exerciseId && candidate.format === "emom");
    if (found) return found;
  }
  throw new Error(`no ${exerciseId} EMOM on ${date}`);
}

describe("buildEmomPlan", () => {
  it("W1 D1 pull-ups: 9 one-minute segments, each 'Target 4 reps'", () => {
    const plan = buildEmomPlan(emomItem("2026-11-02", "pull_up"));

    expect(plan.title).toBe("Pull-ups EMOM · 9 min");
    expect(plan.segments).toHaveLength(9);
    expect(plan.segments.every((segment) => segment.phase === "minute" && segment.durationSec === 60)).toBe(true);
    expect(plan.segments.every((segment) => segment.label === "Target 4 reps")).toBe(true);
    expect(plan.segments.map((segment) => segment.round)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
    expect(plan.segments.every((segment) => segment.totalRounds === 9)).toBe(true);
  });

  it("titles the plan with the rotated-in name when the item is rotated in", () => {
    const item = { ...emomItem("2026-11-02", "pull_up"), rotatedIn: { displayName: "Chin-ups", originalName: "Pull-ups" } };

    expect(buildEmomPlan(item).title).toBe("Chin-ups EMOM · 9 min");
  });

  it("W4 D1 (deload): minutes are already halved, 5 segments", () => {
    const plan = buildEmomPlan(emomItem("2026-11-23", "pull_up"));

    expect(plan.title).toBe("Pull-ups EMOM · 5 min");
    expect(plan.segments).toHaveLength(5);
  });

  it("Day 4 kettlebell swings: 8 segments of 'Target 12–15 reps'", () => {
    const plan = buildEmomPlan(emomItem("2026-11-05", "kettlebell_swing"));

    expect(plan.segments).toHaveLength(8);
    expect(plan.segments.every((segment) => segment.label === "Target 12–15 reps")).toBe(true);
  });

  it("deload Day 4: 4 swing segments", () => {
    expect(buildEmomPlan(emomItem("2026-11-26", "kettlebell_swing")).segments).toHaveLength(4);
  });

  it("asks for a max when the target needs one", () => {
    const plan = buildEmomPlan(emomItem("2026-11-02", "pull_up", { maxReps: {} }));

    expect(plan.segments.every((segment) => segment.label === "Set your max for a target")).toBe(true);
  });

  it("rejects an item that is not an EMOM", () => {
    const session = buildSession(program, settings, "2026-11-02");
    if (session.kind !== "training") throw new Error("expected training");
    const straightSets = session.blocks.flatMap((block) => block.items).find((candidate) => candidate.format !== "emom");
    expect(() => buildEmomPlan(straightSets as ItemView)).toThrow();
  });
});

/** Finds the heavy bag interval item on a date. */
function heavyBagItem(date: string): ItemView {
  const session = buildSession(program, settings, date);
  if (session.kind !== "training") throw new Error(`expected training on ${date}`);
  const found = session.blocks.flatMap((block) => block.items).find((candidate) => candidate.format === "interval");
  if (!found) throw new Error(`no interval item on ${date}`);
  return found;
}

describe("interval plans", () => {
  it("W1 D1 defaults: 5 rounds, 30s work (top of 20-30), 30s rest", () => {
    expect(defaultIntervalSettings(heavyBagItem("2026-11-02"))).toEqual({ rounds: 5, workSec: 30, restSec: 30, gearUpSec: 120 });
  });

  it("W1 D1 plan: 9 segments alternating work and rest, ending on work, 270s in total", () => {
    const item = heavyBagItem("2026-11-02");
    const plan = buildIntervalPlan(item, { ...defaultIntervalSettings(item), gearUpSec: 0 });

    expect(plan.title).toBe("Heavy bag · 5 rounds");
    expect(plan.segments.map((segment) => segment.phase)).toEqual(
      ["work", "rest", "work", "rest", "work", "rest", "work", "rest", "work"],
    );
    expect(plan.segments.reduce((total, segment) => total + segment.durationSec, 0)).toBe(270);
    expect(plan.segments[0]?.label).toBe("Hard combinations");
    expect(plan.segments[1]?.label).toBe("Rest");
    expect(plan.segments.map((segment) => segment.round)).toEqual([1, 1, 2, 2, 3, 3, 4, 4, 5]);
    expect(plan.segments.every((segment) => segment.totalRounds === 5)).toBe(true);
  });

  it("W4 D1 (deload) defaults to 2 rounds", () => {
    const item = heavyBagItem("2026-11-23");

    expect(defaultIntervalSettings(item).rounds).toBe(2);
    expect(defaultIntervalSettings(item).gearUpSec).toBe(120);
    expect(buildIntervalPlan(item, { ...defaultIntervalSettings(item), gearUpSec: 0 }).segments).toHaveLength(3);
  });

  it("respects custom settings", () => {
    const plan = buildIntervalPlan(heavyBagItem("2026-11-02"), { rounds: 3, workSec: 20, restSec: 45, gearUpSec: 0 });

    expect(plan.title).toBe("Heavy bag · 3 rounds");
    expect(plan.segments.map((segment) => segment.durationSec)).toEqual([20, 45, 20, 45, 20]);
  });

  it("a single round has no rest", () => {
    const plan = buildIntervalPlan(heavyBagItem("2026-11-02"), { rounds: 1, workSec: 30, restSec: 30, gearUpSec: 0 });

    expect(plan.title).toBe("Heavy bag · 1 round");
    expect(plan.segments).toHaveLength(1);
  });

  it("rejects fewer than 1 round and under 5 seconds", () => {
    const item = heavyBagItem("2026-11-02");

    expect(() => buildIntervalPlan(item, { rounds: 0, workSec: 30, restSec: 30, gearUpSec: 0 })).toThrow();
    expect(() => buildIntervalPlan(item, { rounds: 3, workSec: 4, restSec: 30, gearUpSec: 0 })).toThrow();
    expect(() => buildIntervalPlan(item, { rounds: 3, workSec: 30, restSec: 4, gearUpSec: 0 })).toThrow();
  });

  it("the shipped heavy bag defaults to a 120s gear-up that opens the plan", () => {
    const item = heavyBagItem("2026-11-02");
    const settings = defaultIntervalSettings(item);
    const plan = buildIntervalPlan(item, settings);

    expect(settings.gearUpSec).toBe(120);
    expect(plan.segments[0]).toEqual({ phase: "gearUp", durationSec: 120, round: 1, totalRounds: 5, label: "Wrap hands, gloves on" });
    expect(plan.segments[1]?.phase).toBe("work");
    expect(plan.segments).toHaveLength(10);
    expect(plan.title).toBe("Heavy bag · 5 rounds");
  });

  it("a gear-up of 0 adds no segment, and a negative one is rejected", () => {
    const item = heavyBagItem("2026-11-02");
    const plan = buildIntervalPlan(item, { ...defaultIntervalSettings(item), gearUpSec: 0 });

    expect(plan.segments.some((segment) => segment.phase === "gearUp")).toBe(false);
    expect(plan.segments).toHaveLength(9);
    expect(() => buildIntervalPlan(item, { ...defaultIntervalSettings(item), gearUpSec: -15 })).toThrow();
  });

  it("an item without gearUpSec defaults to 0", () => {
    const item = { ...heavyBagItem("2026-11-02"), gearUpSec: undefined };

    expect(defaultIntervalSettings(item).gearUpSec).toBe(0);
  });

  it("exposes the gear-up limits: 0 to 300 in steps of 15", () => {
    expect([INTERVAL_LIMITS.minGearUpSec, INTERVAL_LIMITS.maxGearUpSec, INTERVAL_LIMITS.gearUpStep]).toEqual([0, 300, 15]);
  });

  it("rejects an item that is not an interval", () => {
    const session = buildSession(program, settings, "2026-11-02");
    if (session.kind !== "training") throw new Error("expected training");
    const other = session.blocks.flatMap((block) => block.items).find((candidate) => candidate.format !== "interval");
    expect(() => defaultIntervalSettings(other as ItemView)).toThrow();
  });
});

describe("rest plans", () => {
  it("defaults to the low end of a range, or the single value", () => {
    expect(defaultRestSeconds({ min: 30, max: 45 })).toBe(30);
    expect(defaultRestSeconds({ min: 45, max: 45 })).toBe(45);
  });

  it("builds one rest segment titled with the exercise", () => {
    const plan = buildRestPlan(30, "Med ball slams");

    expect(plan.title).toBe("Rest · Med ball slams");
    expect(plan.segments).toEqual([
      { phase: "rest", durationSec: 30, round: 1, totalRounds: 1, label: "Next set when it ends" },
    ]);
  });

  it("rejects rests under 5 seconds", () => {
    expect(() => buildRestPlan(4, "Dips")).toThrow();
    expect(() => buildRestPlan(Number.NaN, "Dips")).toThrow();
    expect(buildRestPlan(5, "Dips").segments[0]?.durationSec).toBe(5);
  });
});
