import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { TrainingSettings } from "../settings/model";
import { parseProgram } from "./parse";
import type { BlockView, ItemView, SessionView } from "./schedule";
import { buildSession } from "./schedule";

const program = parseProgram(JSON.parse(readFileSync("public/program.json", "utf-8")));
const settings: TrainingSettings = { startDate: "2026-11-02", maxReps: { pull_up: 12, dip: 15 } };

/** Builds a session and asserts it is a training day, so tests can read its fields. */
function trainingOn(date: string, overrides: Partial<TrainingSettings> = {}) {
  const session: SessionView = buildSession(program, { ...settings, ...overrides }, date);
  if (session.kind !== "training") throw new Error(`expected training on ${date}, got ${session.kind}`);
  return session;
}

/** Finds a block by type or fails. */
function block(blocks: BlockView[], type: string): BlockView {
  const found = blocks.find((candidate) => candidate.type === type);
  if (!found) throw new Error(`no ${type} block`);
  return found;
}

/** Finds an item by exercise id anywhere in the session or fails. */
function item(blocks: BlockView[], exerciseId: string): ItemView {
  for (const candidate of blocks) {
    const found = candidate.items.find((entry) => entry.exercise.id === exerciseId);
    if (found) return found;
  }
  throw new Error(`no ${exerciseId} item`);
}

describe("worked examples from PLAN.md section 6", () => {
  it("Mon 2 Nov: W1 Base, pull-up EMOM 9 min x 4, dip mini-dose 2 x 7", () => {
    const session = trainingOn("2026-11-02");
    expect(session).toMatchObject({ week: 1, dayNumber: 1, programDay: "Mon", phase: "Base", isDeload: false });

    const pullUps = item(session.blocks, "pull_up");
    expect(pullUps.minutes).toBe(9);
    expect(pullUps.target).toMatchObject({ kind: "fixed", count: 4 });

    const dips = item([block(session.blocks, "miniDose")], "dip");
    expect(dips.sets).toHaveLength(2);
    expect(dips.sets.map((set) => set.target)).toMatchObject([{ kind: "fixed", count: 7 }, { kind: "fixed", count: 7 }]);
  });

  it("Mon 16 Nov: W3, pull-up EMOM 6 reps per minute", () => {
    const session = trainingOn("2026-11-16");
    expect(session.week).toBe(3);
    expect(item(session.blocks, "pull_up").target).toMatchObject({ kind: "fixed", count: 6 });
  });

  it("Wed 4 Nov: dip EMOM 6-7 reps, plyo push-ups 5 x 5", () => {
    const session = trainingOn("2026-11-04");
    expect(session).toMatchObject({ week: 1, dayNumber: 3, programDay: "Wed" });
    expect(item(session.blocks, "dip").target).toMatchObject({ kind: "range", min: 6, max: 7 });

    const plyo = item(session.blocks, "plyo_push_up");
    expect(plyo.sets).toHaveLength(5);
    expect(plyo.sets.every((set) => set.target?.kind === "fixed" && set.target.count === 5)).toBe(true);
  });

  it("start Wed 4 Nov: day numbers, not weekdays, pick the session", () => {
    const startedWednesday: Partial<TrainingSettings> = { startDate: "2026-11-04" };

    // Wed 4 Nov is day 1 and runs the program's first session ("Upper: pull").
    const dayOne = trainingOn("2026-11-04", startedWednesday);
    expect(dayOne).toMatchObject({ week: 1, dayNumber: 1, programDay: "Mon", focus: "Upper: pull" });

    // Tue 10 Nov is day 7: rest. Wed 11 Nov begins week 2 at day 1.
    expect(buildSession(program, { ...settings, ...startedWednesday }, "2026-11-10")).toEqual({
      kind: "rest", week: 1, dayNumber: 7, programDay: "Sun", phase: "Base",
    });
    expect(trainingOn("2026-11-11", startedWednesday)).toMatchObject({ week: 2, dayNumber: 1 });

    // Tue 3 Nov is before the start date.
    expect(buildSession(program, { ...settings, ...startedWednesday }, "2026-11-03")).toEqual({
      kind: "notStarted", startsOn: "2026-11-04",
    });
  });

  it("Mon 23 Nov: W4 Deload, slams 3 x 6, pull-up EMOM 5 min x 4, dip 1 x 7, warm-up unchanged", () => {
    const session = trainingOn("2026-11-23");
    expect(session).toMatchObject({ week: 4, phase: "Deload", isDeload: true });

    const slams = item(session.blocks, "med_ball_slam");
    expect(slams.sets).toHaveLength(3);
    expect(slams.sets[0]?.target).toMatchObject({ kind: "fixed", count: 6 });

    const pullUps = item(session.blocks, "pull_up");
    expect(pullUps.minutes).toBe(5);
    expect(pullUps.target).toMatchObject({ kind: "fixed", count: 4 });

    expect(item(session.blocks, "dip").sets).toHaveLength(1);
    expect(item(session.blocks, "dip").sets[0]?.target).toMatchObject({ kind: "fixed", count: 7 });

    expect(block(session.blocks, "warmup").rounds).toEqual({ min: 2, max: 2 });
  });

  it("Sun 8 Nov: rest day", () => {
    expect(buildSession(program, settings, "2026-11-08")).toEqual({ kind: "rest", week: 1, dayNumber: 7, programDay: "Sun", phase: "Base" });
  });

  it("Sat 26 Dec: W8 Deload + retest, skater bounds 3 x 6 per side", () => {
    const session = trainingOn("2026-12-26");
    expect(session).toMatchObject({ week: 8, dayNumber: 6, programDay: "Sat", phase: "Deload + retest", isDeload: true });

    const bounds = item(session.blocks, "lateral_skater_bound");
    expect(bounds.sets).toHaveLength(3);
    expect(bounds.perSide).toBe(true);
    expect(bounds.sets[0]?.target).toMatchObject({ kind: "fixed", count: 6 });
  });
});

describe("further schedule rules", () => {
  it("restarts the weekly increase after the deload (Mon 7 Dec, W6: 4 + 1 = 5)", () => {
    const session = trainingOn("2026-12-07");
    expect(session.week).toBe(6);
    expect(item(session.blocks, "pull_up").target).toMatchObject({ kind: "fixed", count: 5 });
  });

  it("does not raise mini-dose reps week to week", () => {
    const session = trainingOn("2026-11-16");
    expect(item(session.blocks, "dip").sets[0]?.target).toMatchObject({ kind: "fixed", count: 7 });
  });

  it("halves heavy bag rounds to the low end in a deload and keeps the range otherwise", () => {
    expect(item(trainingOn("2026-11-23").blocks, "heavy_bag").rounds).toEqual({ min: 2, max: 2 });
    expect(item(trainingOn("2026-11-02").blocks, "heavy_bag").rounds).toEqual({ min: 4, max: 5 });
  });

  it("keeps ranges as ranges", () => {
    const bag = item(trainingOn("2026-11-02").blocks, "heavy_bag");
    expect(bag.workSec).toEqual({ min: 20, max: 30 });
    const slams = item(trainingOn("2026-11-02").blocks, "med_ball_slam");
    expect(slams.restSec).toEqual({ min: 30, max: 45 });
  });

  it("halves the Saturday calf raise keeping the heavy first set", () => {
    // Sat 28 Nov is week 4 (deload).
    const deloadCalf = item(trainingOn("2026-11-28").blocks, "single_leg_calf_raise");
    expect(deloadCalf.sets).toHaveLength(2);
    expect(deloadCalf.sets[0]).toMatchObject({ load: "heavy", target: { kind: "range", min: 8, max: 10 } });
    expect(deloadCalf.sets[1]).toMatchObject({ load: "moderate", target: { kind: "range", min: 15, max: 25 } });
  });

  it("keeps block order from the program", () => {
    const types = trainingOn("2026-11-02").blocks.map((entry) => entry.type);
    expect(types).toEqual(["warmup", "explosive", "mainStrength", "miniDose", "core", "finisher"]);
  });
});

describe("edge cases", () => {
  it("reports noStartDate", () => {
    expect(buildSession(program, { startDate: null, maxReps: {} }, "2026-11-02")).toEqual({ kind: "noStartDate" });
  });

  it("reports notStarted before a mid-week start date, then week 2 seven days after the start", () => {
    const midWeek = { startDate: "2026-11-04", maxReps: settings.maxReps };
    expect(buildSession(program, midWeek, "2026-11-02")).toEqual({ kind: "notStarted", startsOn: "2026-11-04" });
    expect(buildSession(program, midWeek, "2026-11-11")).toMatchObject({ kind: "training", week: 2 });
  });

  it("reports complete after week 8", () => {
    expect(buildSession(program, settings, "2026-12-28")).toEqual({ kind: "complete" });
  });

  it("asks for a missing max instead of guessing", () => {
    const session = trainingOn("2026-11-04", { maxReps: { pull_up: 12 } });
    expect(item(session.blocks, "dip").target).toMatchObject({
      kind: "needsMax",
      exerciseId: "dip",
      percentMin: 0.4,
      percentMax: 0.5,
    });
  });

  it("never goes below 1 rep (max 1 x 0.40)", () => {
    const session = trainingOn("2026-11-02", { maxReps: { pull_up: 1, dip: 1 } });
    expect(item(session.blocks, "pull_up").target).toMatchObject({ kind: "fixed", count: 1 });
  });
});

describe("percent-of-max basis", () => {
  const basis = (weeklyIncrease: number, max = 12) => ({ percentMin: 0.4, percentMax: 0.4, max, weeklyIncrease });

  it("records the max and this week's increase (W2 Mon pull-ups: 40% of 12, +1)", () => {
    expect(item(trainingOn("2026-11-09").blocks, "pull_up").target).toEqual({ kind: "fixed", count: 5, basis: basis(1) });
  });

  it("shows no increase in week 1 of a phase", () => {
    expect(item(trainingOn("2026-11-02").blocks, "pull_up").target).toMatchObject({ basis: basis(0) });
  });

  it("shows no increase in a deload (W4 Mon pull-ups: 40% of 12, +0)", () => {
    expect(item(trainingOn("2026-11-23").blocks, "pull_up").target).toEqual({ kind: "fixed", count: 4, basis: basis(0) });
  });

  it("keeps the percentage range for dips (Wed W1: 40-50% of 15)", () => {
    expect(item(trainingOn("2026-11-04").blocks, "dip").target).toEqual({
      kind: "range",
      min: 6,
      max: 7,
      basis: { percentMin: 0.4, percentMax: 0.5, max: 15, weeklyIncrease: 0 },
    });
  });

  it("gives plain program reps no basis", () => {
    expect(item(trainingOn("2026-11-02").blocks, "med_ball_slam").sets[0]?.target).toEqual({ kind: "fixed", count: 6 });
  });
});

describe("percent-of-max rounding survives floating point", () => {
  // 100 * 0.57 is 56.99999999999999 in binary floating point; a bare floor gives 56.
  it.each([
    [100, 0.57, 57],
    [180, 0.35, 63],
    [90, 0.7, 63],
  ])("max %i x %f gives %i reps", (max, fraction, expected) => {
    const custom = parseProgram(
      (() => {
        const json = JSON.parse(readFileSync("public/program.json", "utf-8"));
        json.days.find((day: any) => day.day === "Mon").blocks.find((b: any) => b.type === "mainStrength").items[0].repsPctOfMax = fraction;
        return json;
      })(),
    );
    const session = buildSession(custom, { startDate: "2026-11-02", maxReps: { pull_up: max, dip: 15 } }, "2026-11-02");
    if (session.kind !== "training") throw new Error("expected training");
    expect(item(session.blocks, "pull_up").target).toMatchObject({ kind: "fixed", count: expected });
  });
});
