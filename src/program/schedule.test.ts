import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { TrainingSettings } from "../settings/model";
import { parseProgram } from "./parse";
import type { BlockView, ItemView, SessionView } from "./schedule";
import { buildSession } from "./schedule";

const program = parseProgram(JSON.parse(readFileSync("public/program.json", "utf-8"))).program;

/**
 * Gives every exercise that has a max but no history the one-entry history a
 * real load would give it (loadSettings reconciles settings with the history,
 * so settings with a max and no history entry never reach the schedule).
 * Histories a test spells out are kept as they are.
 */
function withMatchingHistory(raw: TrainingSettings): TrainingSettings {
  const maxHistory = { ...raw.maxHistory };
  for (const [exerciseId, reps] of Object.entries(raw.maxReps)) {
    maxHistory[exerciseId] ??= [{ savedOn: raw.maxSavedOn[exerciseId] ?? null, reps }];
  }
  return { ...raw, maxHistory };
}

const settings: TrainingSettings = withMatchingHistory({ startDate: "2026-11-02", maxReps: { pull_up: 12, dip: 15 }, maxSavedOn: {}, maxHistory: {} });

/** Builds a session and asserts it is a training day, so tests can read its fields. */
function trainingOn(date: string, overrides: Partial<TrainingSettings> = {}) {
  // An override that changes a max or its date must not keep the base history for that exercise.
  const merged: TrainingSettings = { ...settings, ...overrides, maxHistory: overrides.maxHistory ?? {} };
  const session: SessionView = buildSession(program, withMatchingHistory(merged), date);
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
  it("2 Nov (W1 D1): W1 Base, pull-up EMOM 9 min x 4, dip mini-dose 2 x 7", () => {
    const session = trainingOn("2026-11-02");
    expect(session).toMatchObject({ week: 1, dayNumber: 1, phase: "Base", isDeload: false });

    const pullUps = item(session.blocks, "pull_up");
    expect(pullUps.minutes).toBe(9);
    expect(pullUps.target).toMatchObject({ kind: "fixed", count: 4 });

    const dips = item([block(session.blocks, "miniDose")], "dip");
    expect(dips.sets).toHaveLength(2);
    expect(dips.sets.map((set) => set.target)).toMatchObject([{ kind: "fixed", count: 7 }, { kind: "fixed", count: 7 }]);
  });

  it("16 Nov (W3 D1): W3, pull-up EMOM 6 reps per minute", () => {
    const session = trainingOn("2026-11-16");
    expect(session.week).toBe(3);
    expect(item(session.blocks, "pull_up").target).toMatchObject({ kind: "fixed", count: 6 });
  });

  it("4 Nov (W1 D3): dip EMOM 6-7 reps, plyo push-ups 5 x 5", () => {
    const session = trainingOn("2026-11-04");
    expect(session).toMatchObject({ week: 1, dayNumber: 3 });
    expect(item(session.blocks, "dip").target).toMatchObject({ kind: "range", min: 6, max: 7 });

    const plyo = item(session.blocks, "plyo_push_up");
    expect(plyo.sets).toHaveLength(5);
    expect(plyo.sets.every((set) => set.target?.kind === "fixed" && set.target.count === 5)).toBe(true);
  });

  it("start 4 Nov: day numbers counted from the start date pick the session", () => {
    const startedMidWeek: Partial<TrainingSettings> = { startDate: "2026-11-04" };

    // 4 Nov is day 1 and runs the program's first session ("Upper: pull").
    const dayOne = trainingOn("2026-11-04", startedMidWeek);
    expect(dayOne).toMatchObject({ week: 1, dayNumber: 1, focus: "Upper: pull" });

    // 10 Nov is day 7: rest. 11 Nov begins week 2 at day 1.
    expect(buildSession(program, { ...settings, ...startedMidWeek }, "2026-11-10")).toEqual({
      kind: "rest", week: 1, dayNumber: 7, phase: "Base",
    });
    expect(trainingOn("2026-11-11", startedMidWeek)).toMatchObject({ week: 2, dayNumber: 1 });

    // 3 Nov is before the start date.
    expect(buildSession(program, { ...settings, ...startedMidWeek }, "2026-11-03")).toEqual({
      kind: "notStarted", startsOn: "2026-11-04",
    });
  });

  it("23 Nov (W4 D1): W4 Deload, slams 3 x 6, pull-up EMOM 5 min x 6 (week 3 held), dip 1 x 7, warm-up unchanged", () => {
    const session = trainingOn("2026-11-23");
    expect(session).toMatchObject({ week: 4, phase: "Deload", isDeload: true });

    const slams = item(session.blocks, "med_ball_slam");
    expect(slams.sets).toHaveLength(3);
    expect(slams.sets[0]?.target).toMatchObject({ kind: "fixed", count: 6 });

    const pullUps = item(session.blocks, "pull_up");
    expect(pullUps.minutes).toBe(5);
    expect(pullUps.target).toMatchObject({ kind: "fixed", count: 6 });

    expect(item(session.blocks, "dip").sets).toHaveLength(1);
    expect(item(session.blocks, "dip").sets[0]?.target).toMatchObject({ kind: "fixed", count: 7 });

    expect(block(session.blocks, "warmup").rounds).toEqual({ min: 2, max: 2 });
  });

  it("8 Nov (W1 D7): rest day", () => {
    expect(buildSession(program, settings, "2026-11-08")).toEqual({ kind: "rest", week: 1, dayNumber: 7, phase: "Base" });
  });

  it("26 Dec (W8 D6): W8 Deload + retest, skater bounds 3 x 6 per side", () => {
    const session = trainingOn("2026-12-26");
    expect(session).toMatchObject({ week: 8, dayNumber: 6, phase: "Deload + retest", isDeload: true });

    const bounds = item(session.blocks, "lateral_skater_bound");
    expect(bounds.sets).toHaveLength(3);
    expect(bounds.perSide).toBe(true);
    expect(bounds.sets[0]?.target).toMatchObject({ kind: "fixed", count: 6 });
  });
});

describe("further schedule rules", () => {
  it("restarts the weekly increase after the deload (7 Dec, W6 D1: 4 + 1 = 5)", () => {
    const session = trainingOn("2026-12-07");
    expect(session.week).toBe(6);
    expect(item(session.blocks, "pull_up").target).toMatchObject({ kind: "fixed", count: 5 });
  });

  it("holds the previous week's EMOM reps in the W4 plain deload (23 Nov: 5 min x 6), W5 restarts at 4", () => {
    const week4 = item(trainingOn("2026-11-23").blocks, "pull_up");
    expect(week4.minutes).toBe(5);
    expect(week4.target).toMatchObject({ kind: "fixed", count: 6 });

    expect(item(trainingOn("2026-11-30").blocks, "pull_up").target).toMatchObject({ kind: "fixed", count: 4 });
  });

  it("holds week 7's reps in W8 until a max is saved (21 Dec, W8 D1): 5 min x 6, awaiting retest", () => {
    const week8 = item(trainingOn("2026-12-21").blocks, "pull_up");
    expect(week8.minutes).toBe(5);
    expect(week8.target).toMatchObject({
      kind: "fixed", count: 6, basis: { max: 12, weeklyIncrease: 2, heldForDeload: true, usesRetestedMax: false, awaitingRetest: true },
    });
  });

  it("holds week 8 with the max in effect on the last week 7 pull-up EMOM day, not a max raised later (14 vs 18 Dec)", () => {
    // Pull-up max 12 saved 2 Nov, 14 saved 18 Dec (W7 D5). The W7 pull-up EMOM was on 14 Dec (W7 D1) with max 12.
    const raisedLate = {
      maxReps: { pull_up: 14, dip: 15 },
      maxSavedOn: { pull_up: "2026-12-18" },
      maxHistory: {
        pull_up: [
          { savedOn: "2026-11-02", reps: 12 },
          { savedOn: "2026-12-18", reps: 14 },
        ],
      },
    };

    // Current-week targets still use the latest max (14 -> 5 + 2 = 7); only the week 8 hold looks back.
    expect(item(trainingOn("2026-12-14", raisedLate).blocks, "pull_up").target).toMatchObject({ count: 7 });

    // W8 D1 holds floor(12 x 0.40) + 2 = 6, not floor(14 x 0.40) + 2 = 7.
    expect(item(trainingOn("2026-12-21", raisedLate).blocks, "pull_up").target).toMatchObject({
      kind: "fixed", count: 6, basis: { max: 12, weeklyIncrease: 2, heldForDeload: true, awaitingRetest: true },
    });
  });

  it("falls back to the earliest history entry when every entry is dated after the last week 7 EMOM day", () => {
    const savedLate = {
      maxReps: { pull_up: 14, dip: 15 },
      maxSavedOn: { pull_up: "2026-12-18" },
      maxHistory: { pull_up: [{ savedOn: "2026-12-18", reps: 14 }] },
    };
    expect(item(trainingOn("2026-12-21", savedLate).blocks, "pull_up").target).toMatchObject({ count: 7, basis: { max: 14 } });
  });

  it("a max saved inside week 8 replaces the hold even when the history held an older max", () => {
    const retested = {
      maxReps: { pull_up: 15, dip: 15 },
      maxSavedOn: { pull_up: "2026-12-21" },
      maxHistory: { pull_up: [{ savedOn: "2026-11-02", reps: 12 }, { savedOn: "2026-12-21", reps: 15 }] },
    };
    expect(item(trainingOn("2026-12-21", retested).blocks, "pull_up").target).toMatchObject({
      count: 6, basis: { max: 15, usesRetestedMax: true },
    });
  });

  it("follows a pull-up max saved on 21 Dec straight away (max 15 -> 5 min x 6 via floor(15 x 0.4), retested)", () => {
    const session = trainingOn("2026-12-21", { maxReps: { pull_up: 15, dip: 15 }, maxSavedOn: { pull_up: "2026-12-21" }, maxHistory: {} });
    expect(item(session.blocks, "pull_up").target).toMatchObject({
      kind: "fixed", count: 6, basis: { max: 15, weeklyIncrease: 0, heldForDeload: false, usesRetestedMax: true, awaitingRetest: false },
    });
  });

  it("counts a max saved on the week's first day (21 Dec) but not the day before (20 Dec, week 7)", () => {
    const saved = (date: string) => trainingOn("2026-12-21", { maxReps: { pull_up: 15, dip: 15 }, maxSavedOn: { pull_up: date }, maxHistory: {} });
    expect(item(saved("2026-12-20").blocks, "pull_up").target).toMatchObject({ count: 8, basis: { awaitingRetest: true } });
    expect(item(saved("2026-12-21").blocks, "pull_up").target).toMatchObject({ count: 6, basis: { usesRetestedMax: true } });
  });

  it("counts a max saved on the week's last day (27 Dec, Day 7) but not the day after (28 Dec)", () => {
    const saved = (date: string) => trainingOn("2026-12-21", { maxReps: { pull_up: 15, dip: 15 }, maxSavedOn: { pull_up: date }, maxHistory: {} });
    expect(item(saved("2026-12-27").blocks, "pull_up").target).toMatchObject({ count: 6, basis: { usesRetestedMax: true } });
    expect(item(saved("2026-12-28").blocks, "pull_up").target).toMatchObject({ count: 8, basis: { awaitingRetest: true } });
  });

  it("does not turn an old save into a retest when the start date moves later (21 Dec is now before week 8)", () => {
    // Start 9 Nov: week 8 is 28 Dec - 3 Jan. A max saved on 21 Dec (week 7 now) is not a retest.
    const moved = withMatchingHistory({ startDate: "2026-11-09", maxReps: { pull_up: 15, dip: 15 }, maxSavedOn: { pull_up: "2026-12-21" }, maxHistory: {} });
    expect(item(trainingOn("2026-12-28", moved).blocks, "pull_up").target).toMatchObject({ count: 8, basis: { awaitingRetest: true } });
  });

  it("does not turn an old save into a retest when the start date moves earlier (21 Dec is now after week 8)", () => {
    // Start 26 Oct: week 8 is 14-20 Dec. A max saved on 21 Dec (after the program) is not a retest.
    const moved = withMatchingHistory({ startDate: "2026-10-26", maxReps: { pull_up: 15, dip: 15 }, maxSavedOn: { pull_up: "2026-12-21" }, maxHistory: {} });
    expect(item(trainingOn("2026-12-14", moved).blocks, "pull_up").target).toMatchObject({ count: 8, basis: { awaitingRetest: true } });
  });

  it("still holds when the max was saved on 14 Dec (week 7): floor(15 x 0.4) + 2 = 8", () => {
    const session = trainingOn("2026-12-21", { maxReps: { pull_up: 15, dip: 15 }, maxSavedOn: { pull_up: "2026-12-14" }, maxHistory: {} });
    expect(item(session.blocks, "pull_up").target).toMatchObject({
      kind: "fixed", count: 8, basis: { weeklyIncrease: 2, heldForDeload: true, usesRetestedMax: false, awaitingRetest: true },
    });
  });

  it("holds when a max has no saved date (v1 data)", () => {
    const session = trainingOn("2026-12-21", { maxReps: { pull_up: 15, dip: 15 } });
    expect(item(session.blocks, "pull_up").target).toMatchObject({ count: 8, basis: { awaitingRetest: true } });
  });

  it("holds W8 D3 dips (23 Dec, max 15: 6-7 + 2 = 8-9) when only the pull-up max was saved", () => {
    const session = trainingOn("2026-12-23", { maxSavedOn: { pull_up: "2026-12-21" }, maxHistory: {} });
    expect(session.week).toBe(8);
    expect(item(session.blocks, "dip").target).toMatchObject({ kind: "range", min: 8, max: 9, basis: { weeklyIncrease: 2, awaitingRetest: true } });
  });

  it("uses the retested dip max on W8 D3 once it is saved (23 Dec: 6-7 retested)", () => {
    const session = trainingOn("2026-12-23", { maxSavedOn: { dip: "2026-12-23" }, maxHistory: {} });
    expect(item(session.blocks, "dip").target).toMatchObject({ kind: "range", min: 6, max: 7, basis: { weeklyIncrease: 0, usesRetestedMax: true, awaitingRetest: false } });
  });

  it("still holds W4's +2 for dips and pull-ups (W4 pull-ups stay 6), without any retest flags", () => {
    expect(item(trainingOn("2026-11-23").blocks, "pull_up").target).toMatchObject({ basis: { usesRetestedMax: false, awaitingRetest: false, heldForDeload: true } });
  });

  it("is not affected by saved dates outside a retest week (W4 stays held, W3 normal)", () => {
    const dated = { maxSavedOn: { pull_up: "2026-12-21" }, maxHistory: {} };
    expect(item(trainingOn("2026-11-23", dated).blocks, "pull_up").target).toMatchObject({ count: 6, basis: { heldForDeload: true } });
    expect(item(trainingOn("2026-11-16", dated).blocks, "pull_up").target).toMatchObject({ count: 6, basis: { weeklyIncrease: 2, heldForDeload: false } });
  });

  it("holds week 3's dip EMOM in the W4 deload (25 Nov, W4 D3: 6-7 + 2 = 8-9) while the mini-dose stays 1 x 7", () => {
    const session = trainingOn("2026-11-25");
    expect(session.week).toBe(4);
    expect(item(session.blocks, "dip").target).toMatchObject({ kind: "range", min: 8, max: 9 });

    expect(item(trainingOn("2026-11-23").blocks, "dip").sets[0]?.target).toMatchObject({ kind: "fixed", count: 7 });
  });

  it("does not mark W8 mini-doses as retested-max targets (21 Dec dips 1 x 7, 25 Dec pull-ups 1 x 6)", () => {
    const dips = item([block(trainingOn("2026-12-21").blocks, "miniDose")], "dip");
    expect(dips.sets).toHaveLength(1);
    expect(dips.sets[0]?.target).toMatchObject({ kind: "fixed", count: 7 });
    expect(dips.sets[0]?.target).not.toMatchObject({ basis: { usesRetestedMax: true } });

    const pullUps = item([block(trainingOn("2026-12-25").blocks, "miniDose")], "pull_up");
    expect(pullUps.sets).toHaveLength(1);
    expect(pullUps.sets[0]?.target).toMatchObject({ kind: "fixed", count: 6 });
    expect(pullUps.sets[0]?.target).not.toMatchObject({ basis: { usesRetestedMax: true } });
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

  it("halves the day 6 calf raise keeping the heavy first set", () => {
    // 28 Nov (W4 D6) is week 4 (deload).
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
    expect(buildSession(program, { startDate: null, maxReps: {}, maxSavedOn: {}, maxHistory: {} }, "2026-11-02")).toEqual({ kind: "noStartDate" });
  });

  it("reports notStarted before a mid-week start date, then week 2 seven days after the start", () => {
    const midWeek = withMatchingHistory({ startDate: "2026-11-04", maxReps: settings.maxReps, maxSavedOn: {}, maxHistory: {} });
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
  const basis = (weeklyIncrease: number, max = 12) => ({ percentMin: 0.4, percentMax: 0.4, max, weeklyIncrease, heldForDeload: false, usesRetestedMax: false, awaitingRetest: false });

  it("records the max and this week's increase (W2 D1 pull-ups: 40% of 12, +1)", () => {
    expect(item(trainingOn("2026-11-09").blocks, "pull_up").target).toEqual({ kind: "fixed", count: 5, basis: basis(1) });
  });

  it("shows no increase in week 1 of a phase", () => {
    expect(item(trainingOn("2026-11-02").blocks, "pull_up").target).toMatchObject({ basis: basis(0) });
  });

  it("shows last week's increase, flagged as held, in a deload (W4 D1 pull-ups: 40% of 12, +2)", () => {
    expect(item(trainingOn("2026-11-23").blocks, "pull_up").target).toEqual({
      kind: "fixed", count: 6, basis: { ...basis(2), heldForDeload: true },
    });
  });

  it("keeps the percentage range for dips (W1 D3: 40-50% of 15)", () => {
    expect(item(trainingOn("2026-11-04").blocks, "dip").target).toEqual({
      kind: "range",
      min: 6,
      max: 7,
      basis: { percentMin: 0.4, percentMax: 0.5, max: 15, weeklyIncrease: 0, heldForDeload: false, usesRetestedMax: false, awaitingRetest: false },
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
        json.days.find((day: any) => day.day === 1).blocks.find((b: any) => b.type === "mainStrength").items[0].repsPctOfMax = fraction;
        return json;
      })(),
    ).program;
    const session = buildSession(custom, withMatchingHistory({ startDate: "2026-11-02", maxReps: { pull_up: max, dip: 15 }, maxSavedOn: {}, maxHistory: {} }), "2026-11-02");
    if (session.kind !== "training") throw new Error("expected training");
    expect(item(session.blocks, "pull_up").target).toMatchObject({ kind: "fixed", count: expected });
  });
});

describe("deload weeks hold the last normal week's weekly increase", () => {
  /** Rebuilds the real program with a different 8-week progression layout. */
  function programWithPhases(phases: { weeks: number[]; phase: string; retest?: boolean }[]) {
    const json = JSON.parse(readFileSync("public/program.json", "utf-8"));
    json.progression = phases.map((entry) => ({ ...entry, changes: ["x"] }));
    return parseProgram(json).program;
  }

  /** The day 1 pull-up basis for program week `week` (start date 2026-11-02, so week 1 day 1 is that date). */
  function pullUpBasisInWeek(modified: ReturnType<typeof programWithPhases>, week: number, maxSavedOn: Record<string, string> = {}) {
    const mondayDate = new Date(Date.UTC(2026, 10, 2 + 7 * (week - 1))).toISOString().slice(0, 10);
    const session = buildSession(modified, { ...settings, maxSavedOn }, mondayDate);
    if (session.kind !== "training") throw new Error("expected a training day");
    const target = item(session.blocks, "pull_up").target;
    if (target?.kind !== "fixed" || !target.basis) throw new Error("expected a percent-of-max target");
    return target.basis;
  }

  it("uses an offset of 0 for a deload in week 1", () => {
    const modified = programWithPhases([
      { weeks: [1], phase: "Deload" },
      { weeks: [2, 3, 4, 5, 6, 7, 8], phase: "Base" },
    ]);
    expect(pullUpBasisInWeek(modified, 1)).toMatchObject({ weeklyIncrease: 0 });
  });

  it("holds week 3's offset through two consecutive deload weeks (4 and 5)", () => {
    const modified = programWithPhases([
      { weeks: [1, 2, 3], phase: "Base" },
      { weeks: [4, 5], phase: "Deload" },
      { weeks: [6, 7, 8], phase: "Power endurance" },
    ]);
    expect(pullUpBasisInWeek(modified, 3)).toMatchObject({ weeklyIncrease: 2, heldForDeload: false, usesRetestedMax: false });
    expect(pullUpBasisInWeek(modified, 4)).toMatchObject({ weeklyIncrease: 2, heldForDeload: true });
    expect(pullUpBasisInWeek(modified, 5)).toMatchObject({ weeklyIncrease: 2, heldForDeload: true });
  });

  it("a retest week does not hold, and a plain deload after it holds 0", () => {
    const modified = programWithPhases([
      { weeks: [1, 2, 3, 4, 5], phase: "Base" },
      { weeks: [6], phase: "Deload + retest", retest: true },
      { weeks: [7], phase: "Deload" },
      { weeks: [8], phase: "Base" },
    ]);
    expect(pullUpBasisInWeek(modified, 5)).toMatchObject({ weeklyIncrease: 4 });
    // No max saved yet: the retest week holds week 5's increase.
    expect(pullUpBasisInWeek(modified, 6)).toMatchObject({ weeklyIncrease: 4, heldForDeload: true, awaitingRetest: true });
    // Once a max is saved in week 6 (start 2 Nov + 35 days = 7 Dec) there is no hold.
    expect(pullUpBasisInWeek(modified, 6, { pull_up: "2026-12-07" })).toMatchObject({ weeklyIncrease: 0, heldForDeload: false, usesRetestedMax: true });
    expect(pullUpBasisInWeek(modified, 7)).toMatchObject({ weeklyIncrease: 0, heldForDeload: false, usesRetestedMax: false });
  });

  it("does not flag heldForDeload when the held increase is 0", () => {
    const modified = programWithPhases([
      { weeks: [1], phase: "Deload" },
      { weeks: [2, 3, 4, 5, 6, 7, 8], phase: "Base" },
    ]);
    expect(pullUpBasisInWeek(modified, 1)).toMatchObject({ weeklyIncrease: 0, heldForDeload: false, usesRetestedMax: false });
  });
});

describe("power endurance timer adjustments (weeks 5-7)", () => {
  it("30 Nov (W5 D1): heavy bag work is 25-35s (timer starts at 35s) and core rest is 30-45s", () => {
    const session = trainingOn("2026-11-30");
    expect(session.phase).toBe("Power endurance");

    const bag = item(session.blocks, "heavy_bag");
    expect(bag.workSec).toEqual({ min: 25, max: 35 });
    expect(bag.workSecAdjustment).toBe(5);
    expect(bag.rounds).toEqual({ min: 4, max: 5 });
    expect(bag.restSec).toEqual({ min: 30, max: 30 });

    const core = block(session.blocks, "core");
    expect(core.restSecBetweenPairs).toEqual({ min: 30, max: 45 });
    expect(core.restAdjustment).toBe(-15);
  });

  it("4 Dec (W5 D5): core rest 45s becomes 30s", () => {
    const core = block(trainingOn("2026-12-04").blocks, "core");
    expect(core.restSecBetweenPairs).toEqual({ min: 30, max: 30 });
  });

  it("leaves explosive rest unchanged", () => {
    expect(item(trainingOn("2026-11-30").blocks, "med_ball_slam").restSec).toEqual({ min: 30, max: 45 });
  });

  it("leaves week 4 (23 Nov) and week 8 (21 Dec) unadjusted", () => {
    for (const date of ["2026-11-23", "2026-12-21"]) {
      const session = trainingOn(date);
      expect(item(session.blocks, "heavy_bag").workSec).toEqual({ min: 20, max: 30 });
      expect(item(session.blocks, "heavy_bag").workSecAdjustment).toBeUndefined();
      expect(block(session.blocks, "core").restSecBetweenPairs).toEqual({ min: 45, max: 60 });
      expect(block(session.blocks, "core").restAdjustment).toBeUndefined();
    }
  });

  it("never goes below the timer's 5s floor", () => {
    const strict = structuredClone(program);
    strict.progression[2]!.timerAdjustments = { intervalWorkSec: -100, coreRestBetweenPairsSec: -100 };
    const session = buildSession(strict, settings, "2026-11-30");
    if (session.kind !== "training") throw new Error("expected training");
    expect(item(session.blocks, "heavy_bag").workSec).toEqual({ min: 5, max: 5 });
    expect(block(session.blocks, "core").restSecBetweenPairs).toEqual({ min: 5, max: 5 });
  });

  it("never goes above the steppers' maximums (180s interval work, 300s rest between pairs)", () => {
    const generous = structuredClone(program);
    generous.progression[2]!.timerAdjustments = { intervalWorkSec: 1000, coreRestBetweenPairsSec: 1000 };
    const session = buildSession(generous, settings, "2026-11-30");
    if (session.kind !== "training") throw new Error("expected training");
    expect(item(session.blocks, "heavy_bag").workSec).toEqual({ min: 180, max: 180 });
    expect(block(session.blocks, "core").restSecBetweenPairs).toEqual({ min: 300, max: 300 });
  });
});

describe("an item marked sameEveryWeek", () => {
  /** The real program with the heavy bag (an interval item on days 1 and 5) opted out of week-by-week changes. */
  function programWithOptedOutBag() {
    const modified = structuredClone(program);
    for (const day of Object.values(modified.days)) {
      for (const dayBlock of day?.blocks ?? []) {
        for (const blockItem of dayBlock.items) {
          if (blockItem.exerciseId === "heavy_bag") blockItem.sameEveryWeek = true;
        }
      }
    }
    return modified;
  }

  /** The heavy bag on `date` (a day 1) from the opted-out program. */
  function optedOutBagOn(date: string): ItemView {
    const session = buildSession(programWithOptedOutBag(), settings, date);
    if (session.kind !== "training") throw new Error("expected training");
    return item(session.blocks, "heavy_bag");
  }

  it.each([
    ["W1", "2026-11-02"],
    ["W4 deload", "2026-11-23"],
    ["W5 power endurance", "2026-11-30"],
    ["W8 deload + retest", "2026-12-21"],
  ])("keeps the heavy bag at 4-5 rounds of 20-30s with no adjustment in %s", (_label, date) => {
    const bag = optedOutBagOn(date);
    expect(bag.rounds).toEqual({ min: 4, max: 5 });
    expect(bag.workSec).toEqual({ min: 20, max: 30 });
    expect(bag.workSecAdjustment).toBeUndefined();
  });

  it("still lets the other items follow the phase (core rest cut in W5, sets halved in W4)", () => {
    const power = buildSession(programWithOptedOutBag(), settings, "2026-11-30");
    const deload = buildSession(programWithOptedOutBag(), settings, "2026-11-23");
    if (power.kind !== "training" || deload.kind !== "training") throw new Error("expected training");
    expect(block(power.blocks, "core").restAdjustment).toBe(-15);
    expect(item(deload.blocks, "pull_up").minutes).toBe(item(trainingOn("2026-11-23").blocks, "pull_up").minutes);
  });

  it("leaves the unmarked heavy bag adjusted and halved", () => {
    expect(item(trainingOn("2026-11-30").blocks, "heavy_bag").workSec).toEqual({ min: 25, max: 35 });
    expect(item(trainingOn("2026-11-23").blocks, "heavy_bag").rounds).toEqual({ min: 2, max: 2 });
  });
});
