import { describe, expect, it } from "vitest";
import { parseProgram } from "./parse";
import { buildSession, type SessionView } from "./schedule";

/**
 * Tests for the item field `weeks` (PLAN.md PR 27 steps 1 and 2): parsing and
 * the gap warning (rule 1 and 2), and the schedule's per-week filtering
 * (rule 3). They use a small inline program, never public/program.json, so
 * they keep working whatever the shipped data says.
 */

/**
 * A small 8-week program with the shape of Explosive Endurance's Day 3: an
 * explosive block whose plyo push-ups run in odd weeks and whose wall throws
 * run in even weeks, between an unfiltered warm-up and core block. Day 1 has
 * no `weeks` at all. `lengthWeeks` is a parameter so the range check can be
 * tried against other lengths.
 */
function weeksProgramJson(lengthWeeks = 8): any {
  return {
    program: { name: "Weeks test program", goal: "Exercise weeks", lengthWeeks, restDay: 7, sessionOrder: ["warmup", "explosive", "core"], rules: ["Keep it simple."] },
    exercises: {
      arm_circles: { name: "Arm circles", category: "warmup", evidence: "coaching practice" },
      plyo_push_up: { name: "Plyo push-ups", category: "explosive", evidence: "coaching practice" },
      rotational_wall_throw: { name: "Rotational wall throws", category: "explosive", evidence: "coaching practice" },
      plank: { name: "Plank", category: "core", evidence: "coaching practice" },
    },
    days: [
      {
        day: 1,
        focus: "No weeks anywhere",
        targetMinutes: 20,
        blocks: [{ type: "explosive", items: [{ exercise: "plyo_push_up", sets: 5, reps: 5, restSec: 45 }] }],
      },
      {
        day: 3,
        focus: "Alternating explosive",
        targetMinutes: 40,
        blocks: [
          { type: "warmup", items: [{ exercise: "arm_circles", sets: 1, reps: 10 }] },
          {
            type: "explosive",
            items: [
              { exercise: "plyo_push_up", weeks: [1, 3, 5, 7], sets: 5, reps: 5, restSec: 45 },
              { exercise: "rotational_wall_throw", weeks: [2, 4, 6, 8], sets: 4, reps: 5, perSide: true, restSec: 45 },
            ],
          },
          { type: "core", items: [{ exercise: "plank", sets: 3, reps: 10 }] },
        ],
      },
    ],
    progression: [
      { weeks: [1, 2, 3], phase: "Base", changes: ["Build"] },
      { weeks: [4], phase: "Deload", changes: ["Halve"] },
      { weeks: [5, 6, 7], phase: "Power endurance", changes: ["Faster"] },
      { weeks: [8], phase: "Deload + retest", changes: ["Halve", "Retest"], retest: true },
    ].filter((phase) => phase.weeks.every((week) => week <= lengthWeeks)),
  };
}

/** Parses a copy of the fixture after `mutate` has changed it, and returns the thrown message. */
function errorMessageAfter(mutate: (json: any) => void, lengthWeeks = 8): string {
  const json = weeksProgramJson(lengthWeeks);
  mutate(json);
  try {
    parseProgram(json);
  } catch (error) {
    return (error as Error).message;
  }
  throw new Error("expected parseProgram to throw");
}

/** The first item of the fixture's Day 3 explosive block (the plyo push-ups), for editing. */
function plyoItem(json: any): any {
  return json.days[1].blocks[1].items[0];
}

describe("the weeks item field: parsing", () => {
  it("is held as a set of weeks, and an item without it as everyWeek", () => {
    const { program, warnings } = parseProgram(weeksProgramJson());
    const [plyo, throws] = program.days[3]!.blocks[1]!.items;

    expect(plyo!.runsInWeeks).toEqual(new Set([1, 3, 5, 7]));
    expect(throws!.runsInWeeks).toEqual(new Set([2, 4, 6, 8]));
    expect(program.days[1]!.blocks[0]!.items[0]!.runsInWeeks).toBe("everyWeek");
    expect(warnings).toEqual([]);
  });

  const path = "days[1].blocks[1].items[0].weeks";

  it.each([
    ["empty", [], `${path}: expected at least one week, or leave "weeks" out to run every week`],
    ["zero", [0], `${path}[0]: week 0 is outside the program (weeks 1 to 8)`],
    ["past the program's length", [9], `${path}[0]: week 9 is outside the program (weeks 1 to 8)`],
    ["fractional", [1.5], `${path}[0]: expected a whole number but found 1.5`],
    ["text", ["2"], `${path}[0]: expected a whole number but found "2"`],
    ["repeated", [3, 1, 3], `${path}[2]: week 3 is listed more than once`],
    ["not a list", 3, `${path}: expected a list but found 3`],
    ["a text instead of a list", "odd", `${path}: expected a list but found "odd"`],
  ])("rejects a weeks value that is %s", (_name, weeks, expectedMessage) => {
    expect(errorMessageAfter((json) => (plyoItem(json).weeks = weeks))).toBe(expectedMessage);
  });

  it("checks the upper bound against this program's lengthWeeks", () => {
    // Week 5 is fine in an 8-week program but outside a 4-week one.
    const message = errorMessageAfter((json) => (plyoItem(json).weeks = [1, 5]), 4);
    expect(message).toBe(`${path}[1]: week 5 is outside the program (weeks 1 to 4)`);
  });

  it("is not set inside a noEquipment swap, because the swap keeps it from the original", () => {
    const message = errorMessageAfter((json) => (plyoItem(json).noEquipment = { exercise: "plank", reps: 5, weeks: [1] }));
    expect(message).toContain("days[1].blocks[1].items[0].noEquipment.weeks:");
  });
});

describe("the weeks item field: a week with none of the block's items", () => {
  it("warns naming the day, block and weeks, and still loads the program", () => {
    const { program, warnings } = parseProgram(
      (() => {
        const json = weeksProgramJson();
        plyoItem(json).weeks = [1, 3];
        json.days[1].blocks[1].items[1].weeks = [2, 4, 6];
        return json;
      })(),
    );

    expect(program.days[3]).toBeDefined();
    expect(warnings).toHaveLength(1);
    expect(warnings[0]!.path).toBe("days[1].blocks[1]");
    expect(warnings[0]!.message).toBe('Day 3 "explosive" block has no items in weeks 5, 7, 8, so it is left out of those weeks');
  });

  it("uses singular wording for a single week", () => {
    const json = weeksProgramJson();
    json.days[1].blocks[1].items[1].weeks = [2, 4, 6];
    const { warnings } = parseProgram(json);

    expect(warnings.map((warning) => warning.message)).toEqual(['Day 3 "explosive" block has no items in week 8, so it is left out of that week']);
  });

  it("does not warn when the items together cover every week, or when an item runs every week", () => {
    expect(parseProgram(weeksProgramJson()).warnings).toEqual([]);

    const json = weeksProgramJson();
    delete json.days[1].blocks[1].items[1].weeks;
    expect(parseProgram(json).warnings).toEqual([]);
  });
});

describe("buildSession with the weeks item field", () => {
  const { program } = parseProgram(weeksProgramJson());
  const settings = { startDate: "2026-11-02", maxReps: {}, maxSavedOn: {}, maxHistory: {} };

  /** The explosive block of Day 3's session on `date`, or a failure. */
  function explosiveBlockOn(date: string) {
    const session = buildSession(program, settings, date);
    if (session.kind !== "training") throw new Error(`expected a training session on ${date}`);
    const block = session.blocks.find((candidate) => candidate.type === "explosive");
    if (block === undefined) throw new Error(`no explosive block on ${date}`);
    return { session, block };
  }

  /** Reduces an explosive block to the figures the worked examples list. */
  function summary(date: string) {
    const { block } = explosiveBlockOn(date);
    return block.items.map((item) => ({
      exercise: item.exercise.id,
      sets: item.sets.length,
      reps: item.sets[0]!.target,
      perSide: item.perSide,
      restSec: item.restSec,
    }));
  }

  const plyo = (sets: number) => ({ exercise: "plyo_push_up", sets, reps: { kind: "fixed", count: 5 }, perSide: false, restSec: { min: 45, max: 45 } });
  const throws = (sets: number) => ({ exercise: "rotational_wall_throw", sets, reps: { kind: "fixed", count: 5 }, perSide: true, restSec: { min: 45, max: 45 } });

  // PLAN.md PR 26 worked examples (start date 2 Nov, so Week 1 Day 3 is 4 Nov).
  it.each([
    ["4 Nov, week 1 (Base)", "2026-11-04", [plyo(5)]],
    ["11 Nov, week 2 (Base)", "2026-11-11", [throws(4)]],
    ["25 Nov, week 4 (Deload): throws halved", "2026-11-25", [throws(2)]],
    ["9 Dec, week 6 (Power endurance)", "2026-12-09", [throws(4)]],
    ["16 Dec, week 7 (Power endurance)", "2026-12-16", [plyo(5)]],
    ["23 Dec, week 8 (Deload + retest): throws halved", "2026-12-23", [throws(2)]],
  ])("%s shows only that week's explosive exercise", (_name, date, expected) => {
    expect(summary(date)).toEqual(expected);
  });

  it("leaves the other blocks of the day, and a day without weeks, as they are", () => {
    const { session } = explosiveBlockOn("2026-11-11");
    expect(session.blocks.map((block) => block.type)).toEqual(["warmup", "explosive", "core"]);
    expect(session.blocks.map((block) => block.position)).toEqual([1, 2, 3]);

    const dayOne = buildSession(program, settings, "2026-11-09") as Extract<SessionView, { kind: "training" }>;
    expect(dayOne.blocks.map((block) => block.items.map((item) => item.exercise.id))).toEqual([["plyo_push_up"]]);
  });

  describe("when a week has none of a block's items (after the parse warning)", () => {
    // Plyo push-ups run in weeks 1 and 3 and throws in weeks 2 and 4, so weeks 5-8 have no explosive items (2 Dec is week 5 day 3).
    const json = weeksProgramJson();
    plyoItem(json).weeks = [1, 3];
    json.days[1].blocks[1].items[1].weeks = [2, 4];
    const { program: gappedProgram, warnings } = parseProgram(json);

    it("drops the empty block but keeps the later blocks' original positions", () => {
      expect(warnings).toHaveLength(1);

      const emptyWeek = buildSession(gappedProgram, settings, "2026-12-02") as Extract<SessionView, { kind: "training" }>;
      expect(emptyWeek.week).toBe(5);
      expect(emptyWeek.blocks.map((block) => [block.type, block.position])).toEqual([
        ["warmup", 1],
        ["core", 3],
      ]);

      const fullWeek = buildSession(gappedProgram, settings, "2026-11-04") as Extract<SessionView, { kind: "training" }>;
      expect(fullWeek.blocks.map((block) => [block.type, block.position])).toEqual([
        ["warmup", 1],
        ["explosive", 2],
        ["core", 3],
      ]);
    });
  });
});
