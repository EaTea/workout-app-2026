import { describe, expect, it } from "vitest";
import { dropWarningForShownDate, checkInWeekToAsk } from "../ui/checkin";
import { parseProgram } from "./parse";
import { applyRotationToBlocks, performedAsName, rotationBlockStartWeek } from "./rotation";
import { buildSession } from "./schedule";

/**
 * A deliberately small program file, written inline as untyped JSON the way
 * the app receives it: no `fatigueCheck`, `warmupRotation` or
 * `coreProgressions`, no max-tested exercise, a straight-sets item and an
 * interval hold. Proves a second program can leave those sections out
 * (PLAN.md PR 15 step 4).
 */
function cutDownProgramJson(): any {
  return {
    program: {
      name: "Cut-down test program",
      goal: "Exercise the optional sections",
      lengthWeeks: 4,
      restDay: 7,
      sessionOrder: ["warmup", "strength", "finisher"],
      rules: ["Keep it simple."],
    },
    exercises: {
      arm_circles: { name: "Arm circles", category: "warmup", evidence: "coaching practice" },
      squat: { name: "Squat", category: "strength", evidence: "coaching practice" },
      plank: { name: "Plank", category: "finisher", evidence: "coaching practice" },
    },
    days: [1, 3, 5].map((day) => ({
      day,
      focus: "Full body",
      targetMinutes: 30,
      blocks: [
        { type: "warmup", items: [{ exercise: "arm_circles", sets: 1, reps: 10 }] },
        { type: "strength", items: [{ exercise: "squat", sets: 3, reps: 8, restSec: 90 }] },
        { type: "finisher", items: [{ exercise: "plank", format: "interval", rounds: 3, workSec: 45, restSec: 30, sameEveryWeek: true }] },
      ],
    })),
    progression: [{ weeks: [1, 2, 3, 4], phase: "Base", changes: ["Add a rep"] }],
  };
}

const settings = { startDate: "2026-11-02", maxReps: {}, maxSavedOn: {}, maxHistory: {} };
const noChecks = { checks: {} } as any;

describe("a program without fatigueCheck, warmupRotation or coreProgressions", () => {
  const { program, warnings } = parseProgram(cutDownProgramJson());

  it("parses with no warnings and represents the absent sections explicitly", () => {
    expect(warnings).toEqual([]);
    expect(program.fatigueCheck).toBeUndefined();
    expect(program.warmupRotation).toBeUndefined();
    expect(program.coreProgressions).toEqual({});
  });

  it("has no max-tested exercise", () => {
    expect(Object.values(program.exercises).some((exercise) => exercise.maxTested)).toBe(false);
  });

  it("still validates a section that is present", () => {
    const json = cutDownProgramJson();
    json.warmupRotation = { everyWeeks: "four", swaps: [] };
    expect(() => parseProgram(json)).toThrow(/warmupRotation/);
  });

  it("parses an item's noEquipment swap and leaves the session unchanged", () => {
    const json = cutDownProgramJson();
    json.exercises.wall_squat = { name: "Wall squat", category: "strength", evidence: "coaching practice" };
    json.days[0].blocks[1].items[0].noEquipment = { exercise: "wall_squat", reps: "12-15", tempo: "2s pause" };

    const swapped = parseProgram(json);
    expect(swapped.warnings).toEqual([]);
    expect(swapped.program.days[1]!.blocks[1]!.items[0]!.noEquipment).toMatchObject({
      exercise: { id: "wall_squat" },
      reps: { kind: "range", min: 12, max: 15 },
      tempo: "2s pause",
    });
    expect(program.days[1]!.blocks[1]!.items[0]!.noEquipment).toBeUndefined();

    // The swap only adds a swap view next to the item; the item itself is identical.
    const swappedSession = buildSession(swapped.program, settings, "2026-11-02");
    const plainSession = buildSession(program, settings, "2026-11-02");
    if (swappedSession.kind !== "training" || plainSession.kind !== "training") throw new Error("expected training");
    const swappedItem = swappedSession.blocks[1]!.items[0]!;
    expect(swappedItem.noEquipment?.exercise.id).toBe("wall_squat");
    expect({ ...swappedItem, noEquipment: undefined }).toEqual({ ...plainSession.blocks[1]!.items[0]!, noEquipment: undefined });
  });

  it("builds sessions on several dates, with the warm-up unrotated in every week", () => {
    for (const date of ["2026-11-02", "2026-11-04", "2026-11-09", "2026-11-18", "2026-11-25"]) {
      const session = buildSession(program, settings, date);
      expect(session.kind).toBe("training");
      if (session.kind !== "training") continue;

      expect(session.blocks.map((block) => block.type)).toEqual(["warmup", "strength", "finisher"]);
      expect(session.blocks[0]!.items[0]!.rotatedIn).toBeUndefined();
    }
  });

  it("builds the rest day as a non-training session", () => {
    expect(buildSession(program, settings, "2026-11-08").kind).not.toBe("training");
  });

  it("leaves warm-ups alone in rotation logic", () => {
    const session = buildSession(program, settings, "2026-11-18");
    if (session.kind !== "training") throw new Error("expected a training day");

    expect(applyRotationToBlocks(session.blocks, 3, undefined)).toBe(session.blocks);
    expect(rotationBlockStartWeek(program, session)).toBeUndefined();
    expect(performedAsName(program, "arm_circles", 3, "warmup")).toBe("Arm circles");
  });

  it("asks for no check-in and shows no drop banner", () => {
    expect(checkInWeekToAsk(program, settings, "2026-11-04", noChecks, undefined)).toBeUndefined();
    expect(dropWarningForShownDate(program, settings, "2026-11-04", noChecks)).toEqual({ week: 0, warnings: [] });
  });
});
