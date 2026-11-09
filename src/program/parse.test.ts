import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { Day, DayNumber } from "./model";
import { parseProgram } from "./parse";

/** Reads the real program.json as untyped JSON, the same way the app receives it. */
function readRealProgramJson(): any {
  return JSON.parse(readFileSync("public/program.json", "utf-8"));
}

const program = parseProgram(readRealProgramJson()).program;

/** Returns a training day or fails the test, so assertions don't need undefined checks. */
function dayOf(dayNumber: DayNumber): Day {
  const day = program.days[dayNumber];
  if (!day) throw new Error(`no day ${dayNumber} in parsed program`);
  return day;
}

/** Parses a copy of the real JSON after `mutate` has broken it, and returns the thrown message. */
function errorMessageAfter(mutate: (json: any) => void): string {
  const json = readRealProgramJson();
  mutate(json);
  try {
    parseProgram(json);
  } catch (error) {
    return (error as Error).message;
  }
  throw new Error("expected parseProgram to throw");
}

describe("parseProgram on the real program.json", () => {
  it("reads the program-level fields", () => {
    expect(program.name).toBe("Explosive Endurance Program");
    expect(program.lengthWeeks).toBe(8);
    expect(program.restDay).toBe(7);
    expect(program.sessionOrder).toEqual(["warmup", "explosive", "mainStrength", "miniDose", "core", "finisher"]);
    expect(program.rules).toHaveLength(4);
    expect(Object.keys(program.days)).toEqual(["1", "2", "3", "4", "5", "6"]);
  });

  it("keeps day 1's blocks in file order", () => {
    expect(dayOf(1).blocks.map((block) => block.type)).toEqual([
      "warmup", "explosive", "mainStrength", "miniDose", "core", "finisher",
    ]);
  });

  it("parses day 1's pull-up as a 9-minute EMOM at 40% of max", () => {
    const pullUp = dayOf(1).blocks[2]!.items[0]!;
    expect(pullUp.exerciseId).toBe("pull_up");
    expect(pullUp.exercise.name).toBe("Pull-ups");
    expect(pullUp.exercise.maxTested).toBe(true);
    expect(pullUp.format).toBe("emom");
    expect(pullUp.minutes).toBe(9);
    expect(pullUp.reps).toEqual({ kind: "percentOfMax", min: 0.4, max: 0.4 });
    expect(pullUp.weeklyIncrease).toBe("+1 rep per minute");
  });

  it("parses day 3's dip EMOM as a 40-50% range", () => {
    const dip = dayOf(3).blocks[2]!.items[0]!;
    expect(dip.format).toBe("emom");
    expect(dip.reps).toEqual({ kind: "percentOfMax", min: 0.4, max: 0.5 });
  });

  it("expands a set count into one prescription per set", () => {
    const slams = dayOf(1).blocks[1]!.items[0]!;
    expect(slams.format).toBe("straight sets");
    expect(slams.sets).toHaveLength(6);
    expect(slams.sets[0]!.reps).toEqual({ kind: "fixed", count: 6 });
    expect(slams.restSec).toEqual({ min: 30, max: 45 });

    const splitSquat = dayOf(2).blocks[2]!.items[0]!;
    expect(splitSquat.sets).toHaveLength(3);
    expect(splitSquat.sets[2]!.reps).toEqual({ kind: "range", min: 12, max: 15 });
    expect(splitSquat.perSide).toBe(true);
    expect(splitSquat.restSec).toEqual({ min: 45, max: 45 });
  });

  it("maps day 6's calf raise per-set list one to one", () => {
    const calfRaise = dayOf(6).blocks[2]!.items[0]!;
    expect(calfRaise.sets).toEqual([
      { reps: { kind: "range", min: 8, max: 10 }, load: "heavy" },
      { reps: { kind: "range", min: 15, max: 25 }, load: "moderate" },
      { reps: { kind: "range", min: 15, max: 25 }, load: "moderate" },
    ]);
    expect(calfRaise.tempo).toBe("2s pause at the bottom");
  });

  it("parses the heavy bag interval with ranges", () => {
    const heavyBag = dayOf(1).blocks[5]!.items[0]!;
    expect(heavyBag.format).toBe("interval");
    expect(heavyBag.rounds).toEqual({ min: 4, max: 5 });
    expect(heavyBag.workSec).toEqual({ min: 20, max: 30 });
    expect(heavyBag.restSec).toEqual({ min: 30, max: 30 });
  });

  it("keeps free-text reps as text and parses superset block fields", () => {
    const warmup = dayOf(3).blocks[0]!;
    expect(warmup.format).toBe("superset");
    expect(warmup.rounds).toEqual({ min: 2, max: 2 });
    expect(warmup.items[2]!.reps).toEqual({ kind: "text", text: "8 each direction" });
    expect(warmup.items[2]!.load).toBe("5-10 kg plate");

    expect(dayOf(2).blocks[3]!.items[0]!.sets[0]!.reps).toEqual({ kind: "text", text: "easy, ~50% effort" });
    expect(dayOf(1).blocks[4]!.restSecBetweenPairs).toEqual({ min: 45, max: 60 });
  });

  it("parses timed and optional items", () => {
    const sidePlank = dayOf(1).blocks[4]!.items[2]!;
    expect(sidePlank.durationSec).toBe(30);
    expect(sidePlank.optional).toBe(true);
    expect(sidePlank.perSide).toBe(true);
    expect(sidePlank.sets).toHaveLength(2);
    expect(sidePlank.sets[0]!.reps).toBeUndefined();
  });

  it("normalises evidence to a URL or coaching practice", () => {
    expect(program.exercises.split_squat_jump!.evidence).toEqual({
      kind: "url",
      url: "https://doi.org/10.1186/s13102-025-01113-6",
    });
    expect(program.exercises.plyo_push_up!.evidence).toEqual({ kind: "coachingPractice" });
  });

  it("carries exercise cues, alternative and progression list", () => {
    expect(program.exercises.hanging_leg_raise!.progression).toHaveLength(4);
    expect(program.exercises.lateral_skater_bound!.alternative).toBe("Pogo hops, 4 x 20s");
    expect(program.exercises.plate_halo!.cues).toHaveLength(2);
    expect(program.exercises.ytwi!.cues).toEqual([]);
  });

  it("keeps progression phases, core progressions, rotation and fatigue check", () => {
    expect(program.progression[1]).toMatchObject({ weeks: [4], phase: "Deload" });
    expect(program.progression).toHaveLength(4);
    expect(Object.keys(program.coreProgressions)).toEqual(["back_extension", "hanging_leg_raise"]);
    expect(program.warmupRotation.everyWeeks).toBe(4);
    expect(program.warmupRotation.swaps[0]).toEqual({ out: "single_leg_hip_thrust", in: "Kickbacks" });
    expect(program.fatigueCheck.tests).toEqual(["Best broad jump", "Max pull-ups"]);
  });
});

describe("parseProgram errors", () => {
  it("names the path of an unknown exercise id", () => {
    const message = errorMessageAfter((json) => {
      json.days[2].blocks[1].items[0].exercise = "foo";
    });
    expect(message).toBe('days[2].blocks[1].items[0].exercise: unknown exercise "foo"');
  });

  it("reports a missing days section", () => {
    expect(errorMessageAfter((json) => delete json.days)).toBe("days: section is missing");
  });

  it("reports days that are not a list", () => {
    expect(errorMessageAfter((json) => (json.days = {}))).toBe("days: expected a list but found an object");
  });

  it("reports a bad range tuple", () => {
    const message = errorMessageAfter((json) => {
      json.days[0].blocks[1].items[0].restSec = [30, 45, 60];
    });
    expect(message).toBe(
      "days[0].blocks[1].items[0].restSec: expected a number or a [min, max] pair of numbers but found [30,45,60]",
    );
  });

  it("rejects a range whose minimum exceeds its maximum", () => {
    const message = errorMessageAfter((json) => {
      json.days[0].blocks[5].items[0].workSec = [30, 20];
    });
    expect(message).toBe("days[0].blocks[5].items[0].workSec: range minimum 30 is larger than maximum 20");
  });

  it("reports bad evidence, day number and a missing required field", () => {
    expect(errorMessageAfter((json) => (json.exercises.ytwi.evidence = "trust me"))).toContain(
      "exercises.ytwi.evidence: expected a URL",
    );
    expect(errorMessageAfter((json) => (json.days[1].day = "Wed"))).toBe(
      'days[1].day: expected a whole number from 1 to 7 but found "Wed"',
    );
    expect(errorMessageAfter((json) => delete json.days[3].focus)).toBe(
      "days[3].focus: expected text but found nothing (field is missing)",
    );
  });

  it("rejects day numbers outside 1..7 or not whole", () => {
    for (const bad of [0, 8, 2.5, -1]) {
      expect(errorMessageAfter((json) => (json.days[1].day = bad))).toBe(
        `days[1].day: expected a whole number from 1 to 7 but found ${bad}`,
      );
    }
    expect(errorMessageAfter((json) => delete json.days[1].day)).toBe("days[1].day: field is missing");
  });

  it("rejects a restDay that is not a day number", () => {
    expect(errorMessageAfter((json) => (json.program.restDay = "Sun"))).toBe(
      'program.restDay: expected a whole number from 1 to 7 but found "Sun"',
    );
    expect(errorMessageAfter((json) => (json.program.restDay = 8))).toBe(
      "program.restDay: expected a whole number from 1 to 7 but found 8",
    );
  });

  it("reports a duplicate day number and a non-object document", () => {
    expect(errorMessageAfter((json) => (json.days[1].day = 1))).toBe("days[1].day: day 1 appears more than once");
    expect(() => parseProgram(null)).toThrow("program.json: expected an object but found null");
  });
});

describe("progression and rest day validation", () => {
  it("rejects a week with no phase", () => {
    expect(errorMessageAfter((json) => (json.progression[0].weeks = [1, 2]))).toBe("progression: week 3 is not covered by any phase");
  });

  it("rejects a week listed in two phases", () => {
    expect(errorMessageAfter((json) => json.progression[1].weeks.push(2))).toBe(
      "progression[1].weeks[1]: week 2 is already covered by progression[0]",
    );
  });

  it("rejects weeks outside 1..lengthWeeks", () => {
    expect(errorMessageAfter((json) => json.progression[1].weeks.push(9))).toBe(
      "progression[1].weeks[1]: week 9 is outside the program (weeks 1 to 8)",
    );
    expect(errorMessageAfter((json) => json.progression[0].weeks.push(0))).toContain("week 0 is outside the program");
  });

  it("rejects a rest day that also has training", () => {
    expect(errorMessageAfter((json) => (json.program.restDay = 1))).toBe(
      "program.restDay: day 1 is the rest day but days has an entry for it",
    );
  });
});

describe("unknown fields warn instead of blocking", () => {
  /** Parses a copy of the real JSON after `mutate` and returns the whole result. */
  function resultAfter(mutate: (json: any) => void) {
    const json = readRealProgramJson();
    mutate(json);
    return parseProgram(json);
  }

  it("gives no warnings for the real program.json", () => {
    expect(parseProgram(readRealProgramJson()).warnings).toEqual([]);
  });

  it("warns about an unknown field on an exercise and still parses the same program", () => {
    const result = resultAfter((json) => (json.exercises.pull_up.notes = "x"));
    expect(result.warnings.map((warning) => warning.path)).toEqual(["exercises.pull_up.notes"]);
    expect(result.warnings[0]?.message).toContain("unknown field, ignored");
    expect(result.program).toEqual(program);
  });

  it("warns about a misspelled field on an item (typo is ignored, not applied)", () => {
    const result = resultAfter((json) => (json.days[0].blocks[1].items[0].restSecs = 30));
    expect(result.warnings.map((warning) => warning.path)).toEqual(["days[0].blocks[1].items[0].restSecs"]);
    expect(result.program).toEqual(program);
  });

  it("warns about an unknown field at the root", () => {
    const result = resultAfter((json) => (json.comment = "hi"));
    expect(result.warnings.map((warning) => warning.path)).toEqual(["comment"]);
    expect(result.program).toEqual(program);
  });

  it("reports every unknown field, and real errors still throw", () => {
    const result = resultAfter((json) => {
      json.comment = "hi";
      json.days[1].mood = "good";
    });
    expect(result.warnings.map((warning) => warning.path)).toEqual(["comment", "days[1].mood"]);

    expect(
      errorMessageAfter((json) => {
        json.comment = "hi";
        json.days[0].focus = 5;
      }),
    ).toBe("days[0].focus: expected text but found 5");
  });

  it.each([
    ["a per-set entry in sets", (json: any) => (json.days[5].blocks[2].items[0].sets[0].extraNote = "x"), "days[5].blocks[2].items[0].sets[0].extraNote"],
    ["a block", (json: any) => (json.days[0].blocks[0].extraNote = "x"), "days[0].blocks[0].extraNote"],
    ["a progression phase", (json: any) => (json.progression[0].extraNote = "x"), "progression[0].extraNote"],
    ["a warm-up rotation swap", (json: any) => (json.warmupRotation.swaps[0].extraNote = "x"), "warmupRotation.swaps[0].extraNote"],
    ["the warm-up rotation", (json: any) => (json.warmupRotation.extraNote = "x"), "warmupRotation.extraNote"],
    ["the fatigue check", (json: any) => (json.fatigueCheck.extraNote = "x"), "fatigueCheck.extraNote"],
    ["the program info", (json: any) => (json.program.extraNote = "x"), "program.extraNote"],
  ])("warns with the full path about an unknown field in %s", (_where, mutate, expectedPath) => {
    const result = resultAfter(mutate);
    expect(result.warnings.map((warning) => warning.path)).toEqual([expectedPath]);
    expect(result.program).toEqual(program);
  });
});
