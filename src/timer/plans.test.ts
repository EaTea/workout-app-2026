import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parseProgram } from "../program/parse";
import { buildSession, type ItemView } from "../program/schedule";
import type { TrainingSettings } from "../settings/model";
import { buildEmomPlan } from "./plans";

const program = parseProgram(JSON.parse(readFileSync("public/program.json", "utf-8"))).program;
const settings: TrainingSettings = { startDate: "2026-11-02", maxReps: { pull_up: 12, dip: 15 }, maxSavedOn: {} };

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
