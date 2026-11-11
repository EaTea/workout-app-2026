import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { TrainingSettings } from "../settings/model";
import { formatItemDose } from "../ui/format";
import { addDaysToDate as addDays, programStatus } from "./calendar";
import { buildProgramOverview } from "./overview";
import { parseProgram } from "./parse";
import type { BlockView, ItemView } from "./schedule";
import { buildSession } from "./schedule";

/**
 * Worked examples for the Steady Strength program (PLAN.md section 6,
 * "Steady Strength (PR 16)"), run against the shipped public/steady-strength.json.
 */

const parsed = parseProgram(JSON.parse(readFileSync("public/steady-strength.json", "utf-8")));
const program = parsed.program;

/** Start date 2 Nov 2026 and no maxes: the program has no max-tested exercises. */
const settings: TrainingSettings = { startDate: "2026-11-02", maxReps: {}, maxSavedOn: {}, maxHistory: {} };

/** Builds the session for a date and asserts it is a training day. */
function trainingOn(date: string) {
  const session = buildSession(program, settings, date);
  if (session.kind !== "training") throw new Error(`expected training on ${date}, got ${session.kind}`);
  return session;
}

/** Finds an item by exercise id anywhere in the blocks, or fails. */
function itemOf(blocks: BlockView[], exerciseId: string): ItemView {
  for (const block of blocks) {
    const found = block.items.find((item) => item.exercise.id === exerciseId);
    if (found) return found;
  }
  throw new Error(`no ${exerciseId} item`);
}

/** The dose text the Today row shows for an exercise ("4 × 20s"). */
function doseOf(blocks: BlockView[], exerciseId: string): string {
  return formatItemDose(itemOf(blocks, exerciseId)).text;
}

describe("the shipped steady-strength.json", () => {
  it("parses with no warnings", () => {
    expect(parsed.warnings).toEqual([]);
  });

  it("reads the program fields, the 5 rules and the 5 safety notes", () => {
    expect(program.name).toBe("Steady Strength");
    expect(program.lengthWeeks).toBe(8);
    expect(program.restDay).toBe(7);
    expect(program.sessionOrder).toEqual(["warmup", "balance", "isometric", "strength", "core", "cooldown", "walk"]);
    expect(program.rules).toHaveLength(5);
    expect(program.safety).toHaveLength(5);
    expect(program.safety[0]).toMatch(/^This is not medical advice\./);
  });

  it("has no fatigue check, warm-up rotation or core progressions, and no max-tested exercise", () => {
    expect(program.fatigueCheck).toBeUndefined();
    expect(program.warmupRotation).toBeUndefined();
    expect(program.coreProgressions).toEqual({});
    expect(Object.values(program.exercises).some((exercise) => exercise.maxTested)).toBe(false);
  });

  it("gives every exercise a DOI link as its evidence", () => {
    for (const exercise of Object.values(program.exercises)) {
      expect(exercise.evidence.kind === "url" && exercise.evidence.url.startsWith("https://doi.org/")).toBe(true);
    }
  });

  it("gives the sit-to-stand and balance exercises their support steps and the glute bridge its alternative", () => {
    expect(program.exercises.sit_to_stand!.progression).toEqual(["Two hands", "One hand", "No hands"]);
    expect(program.exercises.single_leg_stand!.progression).toHaveLength(3);
    expect(program.exercises.heel_to_toe_stand!.progression).toHaveLength(3);
    expect(program.exercises.glute_bridge_hold!.alternative).toMatch(/standing buttock squeeze/i);
  });

  it("has three phases and none of them is a deload", () => {
    expect(program.progression.map((phase) => [phase.phase, phase.weeks, phase.timerAdjustments?.intervalWorkSec])).toEqual([
      ["Settle in", [1, 2], undefined],
      ["Build", [3, 4, 5], 5],
      ["Strengthen", [6, 7, 8], 10],
    ]);
    expect(program.progression.some((phase) => phase.retest || phase.phase.toLowerCase().startsWith("deload"))).toBe(false);
  });

  it("makes every hold an interval item with a note for the timer to show", () => {
    const intervalItems = Object.values(program.days).flatMap((day) => day!.blocks.flatMap((block) => block.items.filter((item) => item.format === "interval")));

    expect(intervalItems.length).toBeGreaterThan(0);
    for (const item of intervalItems) {
      expect(item.rounds && item.workSec && item.restSec).toBeTruthy();
      expect(item.note).toBeTruthy();
    }
  });
});

describe("buildSession on Steady Strength", () => {
  it("W1 D1 (2 Nov): Legs and core, six blocks, Otago warm-up for 1 round", () => {
    const session = trainingOn("2026-11-02");

    expect([session.week, session.dayNumber, session.phase, session.focus, session.targetMinutes]).toEqual([1, 1, "Settle in", "Legs and core", 30]);
    expect(session.blocks.map((block) => block.type)).toEqual(["warmup", "balance", "isometric", "strength", "core", "cooldown"]);
    expect(session.blocks[0]!.rounds).toEqual({ min: 1, max: 1 });
    expect(session.blocks[0]!.items.map((item) => item.exercise.id)).toEqual(["head_turns", "neck_retraction", "standing_back_extension", "ankle_pumps"]);

    expect(doseOf(session.blocks, "single_leg_stand")).toBe("4 × 20s");
    expect(itemOf(session.blocks, "single_leg_stand").restSec).toEqual({ min: 20, max: 20 });
    expect(doseOf(session.blocks, "high_wall_sit")).toBe("3 × 20s");
    expect(itemOf(session.blocks, "high_wall_sit").restSec).toEqual({ min: 40, max: 40 });
    expect(doseOf(session.blocks, "sit_to_stand")).toBe("3 × 8–12");
    expect(itemOf(session.blocks, "sit_to_stand").restSec).toEqual({ min: 60, max: 60 });
  });

  it("W1 D2 (3 Nov): Balance and walk, about 15 min", () => {
    const session = trainingOn("2026-11-03");

    expect([session.focus, session.targetMinutes]).toEqual(["Balance and walk", 15]);
    expect(session.blocks.map((block) => block.type)).toEqual(["balance", "walk"]);
    expect(doseOf(session.blocks, "single_leg_stand")).toBe("4 × 20s");
    expect(doseOf(session.blocks, "heel_to_toe_stand")).toBe("4 × 20s");
    expect(doseOf(session.blocks, "sideways_walking")).toBe("2 × 10 steps each way");
    expect(doseOf(session.blocks, "sit_to_stand")).toBe("1 × 8");
    expect(doseOf(session.blocks, "comfortable_walk")).toBe("10-20 min");
  });

  it("W1 D3 (4 Nov): the shoulder and wrist holds and the band row", () => {
    const session = trainingOn("2026-11-04");

    expect(session.focus).toBe("Shoulders, wrists and core");
    expect(doseOf(session.blocks, "wall_push_hold")).toBe("3 × 15s");
    expect(itemOf(session.blocks, "wall_push_hold").restSec).toEqual({ min: 30, max: 30 });
    expect(doseOf(session.blocks, "grip_squeeze")).toBe("4 × 10s");
    expect(itemOf(session.blocks, "grip_squeeze").restSec).toEqual({ min: 15, max: 15 });
    expect(doseOf(session.blocks, "band_row")).toBe("3 × 8–12");
    expect(itemOf(session.blocks, "band_row").restSec).toEqual({ min: 60, max: 60 });
  });

  it("W1 D5 (6 Nov): Whole body", () => {
    const session = trainingOn("2026-11-06");

    expect(session.focus).toBe("Whole body");
    expect(doseOf(session.blocks, "counter_plank")).toBe("3 × 15s");
    expect(doseOf(session.blocks, "suitcase_hold")).toBe("4 × 20s");
  });

  it("W1 D7 (8 Nov) is the rest day", () => {
    expect(buildSession(program, settings, "2026-11-08")).toEqual({ kind: "rest", week: 1, dayNumber: 7, phase: "Settle in" });
  });

  it("W3 D1 (16 Nov): holds are 5s longer, the rest and the strength sets are unchanged", () => {
    const session = trainingOn("2026-11-16");

    expect(session.phase).toBe("Build");
    expect(doseOf(session.blocks, "single_leg_stand")).toBe("4 × 25s");
    expect(itemOf(session.blocks, "single_leg_stand").workSecAdjustment).toBe(5);
    expect(doseOf(session.blocks, "high_wall_sit")).toBe("3 × 25s");
    expect(itemOf(session.blocks, "high_wall_sit").restSec).toEqual({ min: 40, max: 40 });
    expect(doseOf(session.blocks, "sit_to_stand")).toBe("3 × 8–12");
  });

  it("W4 D1 (23 Nov) is the same as week 3: no easy week, nothing halved", () => {
    const week3 = trainingOn("2026-11-16");
    const week4 = trainingOn("2026-11-23");

    expect(week4.isDeload).toBe(false);
    expect(week4.phase).toBe("Build");
    expect(week4.blocks).toEqual(week3.blocks);
  });

  it("W6 D3 (9 Dec): holds are 10s longer", () => {
    const session = trainingOn("2026-12-09");

    expect([session.week, session.dayNumber, session.phase]).toEqual([6, 3, "Strengthen"]);
    expect(doseOf(session.blocks, "wall_push_hold")).toBe("3 × 25s");
    expect(doseOf(session.blocks, "grip_squeeze")).toBe("4 × 20s");
    expect(doseOf(session.blocks, "wall_side_plank")).toBe("4 × 25s");
  });

  it("W8 D1 (21 Dec): holds 10s longer, and nothing asks for a max or a retest", () => {
    const session = trainingOn("2026-12-21");

    expect(session.week).toBe(8);
    expect(doseOf(session.blocks, "single_leg_stand")).toBe("4 × 30s");
    expect(doseOf(session.blocks, "high_wall_sit")).toBe("3 × 30s");
    expect(doseOf(session.blocks, "sit_to_stand")).toBe("3 × 8–12");
    expect(session.isDeload).toBe(false);

    const allDoses = session.blocks.flatMap((block) => block.items.map((item) => formatItemDose(item)));
    expect(allDoses.some((dose) => dose.text === "Set max" || dose.needsMaxExerciseId !== undefined)).toBe(false);
  });

  it("adds the phase's seconds to every hold on every training day", () => {
    // First training day (Day 1) of week 1, plus the same weekdays of weeks 3 and 6.
    const weekStarts = [
      { firstDay: "2026-11-02", extraSeconds: 0 },
      { firstDay: "2026-11-16", extraSeconds: 5 },
      { firstDay: "2026-12-07", extraSeconds: 10 },
    ];

    /** The work seconds of every interval item on a day, in order. */
    const holdSeconds = (date: string) =>
      trainingOn(date).blocks.flatMap((block) => block.items.filter((item) => item.format === "interval").map((item) => item.workSec!.max));

    for (let dayOffset = 0; dayOffset < 6; dayOffset += 1) {
      const baseline = holdSeconds(addDays(weekStarts[0]!.firstDay, dayOffset));
      expect(baseline.length).toBeGreaterThan(0);

      for (const { firstDay, extraSeconds } of weekStarts) {
        expect(holdSeconds(addDays(firstDay, dayOffset))).toEqual(baseline.map((seconds) => seconds + extraSeconds));
      }
    }
  });
});

describe("buildProgramOverview on Steady Strength", () => {
  it("summarises 8 weeks, 6 training days and 135 minutes with three phases", () => {
    const overview = buildProgramOverview(program, programStatus(null, program.lengthWeeks, "2026-11-02"));

    expect(overview.lengthWeeks).toBe(8);
    expect(overview.trainingDaysPerWeek).toBe(6);
    expect(overview.weeklyMinutes).toBe(135);
    expect(overview.phases.map((phase) => [phase.name, phase.firstWeek, phase.lastWeek])).toEqual([
      ["Settle in", 1, 2],
      ["Build", 3, 5],
      ["Strengthen", 6, 8],
    ]);
    expect(overview.sessionOrder).toEqual(program.sessionOrder);
    expect(overview.callToAction.label).toBe("Start Day 1: Legs and core");
  });
});
