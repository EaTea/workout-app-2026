import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { Day, Weekday } from "./model";
import { parseProgram } from "./parse";

/** Reads the real program.json as untyped JSON, the same way the app receives it. */
function readRealProgramJson(): any {
  return JSON.parse(readFileSync("public/program.json", "utf-8"));
}

const program = parseProgram(readRealProgramJson());

/** Returns a training day or fails the test, so assertions don't need undefined checks. */
function dayOf(weekday: Weekday): Day {
  const day = program.days[weekday];
  if (!day) throw new Error(`no ${weekday} in parsed program`);
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
    expect(program.restDay).toBe("Sun");
    expect(program.sessionOrder).toEqual(["warmup", "explosive", "mainStrength", "miniDose", "core", "finisher"]);
    expect(program.rules).toHaveLength(4);
    expect(Object.keys(program.days)).toEqual(["Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]);
  });

  it("keeps Monday's blocks in file order", () => {
    expect(dayOf("Mon").blocks.map((block) => block.type)).toEqual([
      "warmup", "explosive", "mainStrength", "miniDose", "core", "finisher",
    ]);
  });

  it("parses Monday's pull-up as a 9-minute EMOM at 40% of max", () => {
    const pullUp = dayOf("Mon").blocks[2]!.items[0]!;
    expect(pullUp.exerciseId).toBe("pull_up");
    expect(pullUp.exercise.name).toBe("Pull-ups");
    expect(pullUp.exercise.maxTested).toBe(true);
    expect(pullUp.format).toBe("emom");
    expect(pullUp.minutes).toBe(9);
    expect(pullUp.reps).toEqual({ kind: "percentOfMax", min: 0.4, max: 0.4 });
    expect(pullUp.weeklyIncrease).toBe("+1 rep per minute");
  });

  it("parses Wednesday's dip EMOM as a 40-50% range", () => {
    const dip = dayOf("Wed").blocks[2]!.items[0]!;
    expect(dip.format).toBe("emom");
    expect(dip.reps).toEqual({ kind: "percentOfMax", min: 0.4, max: 0.5 });
  });

  it("expands a set count into one prescription per set", () => {
    const slams = dayOf("Mon").blocks[1]!.items[0]!;
    expect(slams.format).toBe("straight sets");
    expect(slams.sets).toHaveLength(6);
    expect(slams.sets[0]!.reps).toEqual({ kind: "fixed", count: 6 });
    expect(slams.restSec).toEqual({ min: 30, max: 45 });

    const splitSquat = dayOf("Tue").blocks[2]!.items[0]!;
    expect(splitSquat.sets).toHaveLength(3);
    expect(splitSquat.sets[2]!.reps).toEqual({ kind: "range", min: 12, max: 15 });
    expect(splitSquat.perSide).toBe(true);
    expect(splitSquat.restSec).toEqual({ min: 45, max: 45 });
  });

  it("maps Saturday's calf raise per-set list one to one", () => {
    const calfRaise = dayOf("Sat").blocks[2]!.items[0]!;
    expect(calfRaise.sets).toEqual([
      { reps: { kind: "range", min: 8, max: 10 }, load: "heavy" },
      { reps: { kind: "range", min: 15, max: 25 }, load: "moderate" },
      { reps: { kind: "range", min: 15, max: 25 }, load: "moderate" },
    ]);
    expect(calfRaise.tempo).toBe("2s pause at the bottom");
  });

  it("parses the heavy bag interval with ranges", () => {
    const heavyBag = dayOf("Mon").blocks[5]!.items[0]!;
    expect(heavyBag.format).toBe("interval");
    expect(heavyBag.rounds).toEqual({ min: 4, max: 5 });
    expect(heavyBag.workSec).toEqual({ min: 20, max: 30 });
    expect(heavyBag.restSec).toEqual({ min: 30, max: 30 });
  });

  it("keeps free-text reps as text and parses superset block fields", () => {
    const warmup = dayOf("Wed").blocks[0]!;
    expect(warmup.format).toBe("superset");
    expect(warmup.rounds).toEqual({ min: 2, max: 2 });
    expect(warmup.items[2]!.reps).toEqual({ kind: "text", text: "8 each direction" });
    expect(warmup.items[2]!.load).toBe("5-10 kg plate");

    expect(dayOf("Tue").blocks[3]!.items[0]!.sets[0]!.reps).toEqual({ kind: "text", text: "easy, ~50% effort" });
    expect(dayOf("Mon").blocks[4]!.restSecBetweenPairs).toEqual({ min: 45, max: 60 });
  });

  it("parses timed and optional items", () => {
    const sidePlank = dayOf("Mon").blocks[4]!.items[2]!;
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

  it("rejects misspelled fields instead of ignoring them", () => {
    const message = errorMessageAfter((json) => {
      json.days[0].blocks[1].items[0].restSecs = 30;
    });
    expect(message).toContain("days[0].blocks[1].items[0].restSecs: unknown field");
  });

  it("reports bad evidence, weekday and a missing required field", () => {
    expect(errorMessageAfter((json) => (json.exercises.ytwi.evidence = "trust me"))).toContain(
      "exercises.ytwi.evidence: expected a URL",
    );
    expect(errorMessageAfter((json) => (json.days[1].day = "Funday"))).toContain("days[1].day: expected one of Mon");
    expect(errorMessageAfter((json) => delete json.days[3].focus)).toBe(
      "days[3].focus: expected text but found nothing (field is missing)",
    );
  });

  it("reports a duplicate weekday and a non-object document", () => {
    expect(errorMessageAfter((json) => (json.days[1].day = "Mon"))).toBe("days[1].day: Mon appears more than once");
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
    expect(errorMessageAfter((json) => (json.program.restDay = "Mon"))).toBe(
      "program.restDay: Mon is the rest day but days has an entry for it",
    );
  });
});
