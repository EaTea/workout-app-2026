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

  it("marks only the week 8 phase as a retest phase (absent means false)", () => {
    expect(program.progression.map((phase) => phase.retest)).toEqual([false, false, false, true]);
  });

  it("keeps progression phases, core progressions, rotation and fatigue check", () => {
    expect(program.progression[1]).toMatchObject({ weeks: [4], phase: "Deload" });
    expect(program.progression).toHaveLength(4);
    expect(Object.keys(program.coreProgressions)).toEqual(["back_extension", "hanging_leg_raise"]);
    expect(program.warmupRotation!.everyWeeks).toBe(4);
    expect(program.warmupRotation!.swaps[0]).toEqual({ out: "single_leg_hip_thrust", in: "Kickbacks" });
    expect(program.fatigueCheck!.tests).toEqual(["Best broad jump", "Max pull-ups"]);
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
      'days[1].day: expected a whole number from 1 to 7 but found "Wed". Days are numbered 1–7 from your start date (Day 1 is the first session).',
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
      'program.restDay: expected a whole number from 1 to 7 but found "Sun". Days are numbered 1–7 from your start date (Day 1 is the first session).',
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
  it("rejects a non-boolean retest flag", () => {
    expect(errorMessageAfter((json) => (json.progression[3].retest = "yes"))).toBe('progression[3].retest: expected true or false but found "yes"');
  });

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

describe("timerAdjustments", () => {
  it("parses the shipped weeks 5-7 adjustments and leaves other phases without any", () => {
    expect(program.progression.map((phase) => phase.timerAdjustments)).toEqual([
      undefined, undefined, { intervalWorkSec: 5, coreRestBetweenPairsSec: -15 }, undefined,
    ]);
  });

  it("treats a missing key as 0", () => {
    const json = readRealProgramJson();
    json.progression[2].timerAdjustments = { intervalWorkSec: 10 };
    expect(parseProgram(json).program.progression[2]!.timerAdjustments).toEqual({ intervalWorkSec: 10, coreRestBetweenPairsSec: 0 });
  });

  it("rejects non-whole or non-numeric values and a non-object, naming the path", () => {
    expect(errorMessageAfter((json) => (json.progression[2].timerAdjustments.intervalWorkSec = 2.5))).toBe(
      "progression[2].timerAdjustments.intervalWorkSec: expected a whole number of seconds but found 2.5",
    );
    expect(errorMessageAfter((json) => (json.progression[2].timerAdjustments.coreRestBetweenPairsSec = "-15"))).toBe(
      'progression[2].timerAdjustments.coreRestBetweenPairsSec: expected a whole number of seconds but found "-15"',
    );
    expect(errorMessageAfter((json) => (json.progression[2].timerAdjustments = 5))).toContain("progression[2].timerAdjustments:");
  });

  it("warns about an unknown key, with a suggestion for a near miss", () => {
    const json = readRealProgramJson();
    json.progression[2].timerAdjustments.intervalWorkSecs = 5;
    const { warnings } = parseProgram(json);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatchObject({ path: "progression[2].timerAdjustments.intervalWorkSecs", suggestion: "intervalWorkSec" });
  });
});

describe("the sameEveryWeek item field", () => {
  /** Finds the heavy bag item of day 1 in a program JSON object, so a test can change it before parsing. */
  function heavyBagJson(json: any): any {
    return json.days[0].blocks.flatMap((jsonBlock: any) => jsonBlock.items).find((jsonItem: any) => jsonItem.exercise === "heavy_bag");
  }

  it("defaults to false when absent", () => {
    expect(dayOf(1).blocks.flatMap((dayBlock) => dayBlock.items).find((entry) => entry.exerciseId === "heavy_bag")?.sameEveryWeek).toBe(false);
  });

  it("reads true without warning about an unknown field", () => {
    const json = readRealProgramJson();
    heavyBagJson(json).sameEveryWeek = true;
    const result = parseProgram(json);
    expect(result.warnings).toEqual([]);
    expect(result.program.days[1]?.blocks.flatMap((dayBlock) => dayBlock.items).find((entry) => entry.exerciseId === "heavy_bag")?.sameEveryWeek).toBe(true);
  });

  it("rejects an item that also has a weekly increase", () => {
    const message = errorMessageAfter((json) => {
      const pullUpEmom = json.days[0].blocks.flatMap((jsonBlock: any) => jsonBlock.items).find((jsonItem: any) => jsonItem.weeklyIncrease !== undefined);
      pullUpEmom.sameEveryWeek = true;
    });
    expect(message).toContain(`"sameEveryWeek" can't be combined with "weeklyIncrease"`);
  });

  it("rejects an item in a block that has its own rounds or minutes", () => {
    const message = errorMessageAfter((json) => {
      const warmupBlock = json.days[0].blocks.find((jsonBlock: any) => jsonBlock.rounds !== undefined);
      warmupBlock.items[0].sameEveryWeek = true;
    });
    expect(message).toContain(`"sameEveryWeek" can't be used in a block with its own "rounds" or "minutes"`);
  });

  it("rejects a value that is not true or false", () => {
    const message = errorMessageAfter((json) => (heavyBagJson(json).sameEveryWeek = "yes"));
    expect(message).toContain("sameEveryWeek: expected true or false but found");
  });
});

describe("program.safety", () => {
  it("is empty for the real program.json, which has no safety list", () => {
    expect(program.safety).toEqual([]);
  });

  it("reads a list of safety notes in order, without warnings", () => {
    const json = readRealProgramJson();
    json.program.safety = ["Check with your doctor first.", "Stop if you feel sharp pain."];

    const result = parseProgram(json);

    expect(result.program.safety).toEqual(["Check with your doctor first.", "Stop if you feel sharp pain."]);
    expect(result.warnings).toEqual([]);
  });

  it("rejects a safety value that is not a list", () => {
    expect(errorMessageAfter((json) => (json.program.safety = "Be careful"))).toBe("program.safety: expected a list but found \"Be careful\"");
  });

  it("rejects a safety note that is not text, naming its position", () => {
    expect(errorMessageAfter((json) => (json.program.safety = ["ok", 7]))).toBe("program.safety[1]: expected text but found 7");
  });

  it("rejects an empty safety note", () => {
    expect(errorMessageAfter((json) => (json.program.safety = ["ok", "  "]))).toBe("program.safety[1]: expected text but found an empty string");
  });

  it("warns about a misspelt safety field with a suggestion", () => {
    const json = readRealProgramJson();
    json.program.saftey = ["x"];

    const result = parseProgram(json);

    expect(result.program.safety).toEqual([]);
    expect(result.warnings).toEqual([expect.objectContaining({ path: "program.saftey", suggestion: "safety" })]);
  });
});

describe("an item's noEquipment swap", () => {
  const slamsPath = "days[0].blocks[1].items[0]";
  const pullUpPath = "days[0].blocks[2].items[0]";

  /** Adds two library entries a swap can point at (the shipped file has none yet). */
  function addSwapExercises(json: any): void {
    json.exercises.backpack_slam = { name: "Backpack slams", category: "explosive", evidence: "coaching practice", cues: ["Books only"] };
    json.exercises.inverted_row = { name: "Inverted rows", category: "main strength", evidence: "coaching practice" };
  }

  /** Gives day 1's slams the swap `swap` (after adding the swap exercises). */
  function withSlamsSwap(json: any, swap: unknown): void {
    addSwapExercises(json);
    json.days[0].blocks[1].items[0].noEquipment = swap;
  }

  /** Gives day 1's max-based pull-up EMOM the swap `swap`. */
  function withPullUpSwap(json: any, swap: unknown): void {
    addSwapExercises(json);
    json.days[0].blocks[2].items[0].noEquipment = swap;
  }

  it("is undefined on every item of the shipped file", () => {
    const everyItem = Object.values(program.days).flatMap((day) => day!.blocks.flatMap((block) => block.items));
    expect(everyItem.every((item) => item.noEquipment === undefined)).toBe(true);
  });

  it("maps a valid swap: exercise resolved, reps parsed, text copied", () => {
    const json = readRealProgramJson();
    withSlamsSwap(json, { exercise: "backpack_slam", reps: "8-10", durationSec: 30, load: "Loaded backpack", note: "On carpet", tempo: "Fast" });
    const result = parseProgram(json);
    const slams = result.program.days[1]!.blocks[1]!.items[0]!;

    expect(result.warnings).toEqual([]);
    expect(slams.noEquipment).toEqual({
      exercise: result.program.exercises.backpack_slam,
      reps: { kind: "range", min: 8, max: 10 },
      durationSec: 30,
      load: "Loaded backpack",
      note: "On carpet",
      tempo: "Fast",
    });
    expect(slams.noEquipment!.exercise.name).toBe("Backpack slams");
    // The original is untouched.
    expect(slams.sets).toEqual(dayOf(1).blocks[1]!.items[0]!.sets);
  });

  it("accepts a swap with only an exercise when the original is not max-based", () => {
    const json = readRealProgramJson();
    withSlamsSwap(json, { exercise: "backpack_slam" });
    const swap = parseProgram(json).program.days[1]!.blocks[1]!.items[0]!.noEquipment!;
    expect(swap.reps).toBeUndefined();
    expect(swap.load).toBeUndefined();
  });

  it("accepts a max-based original when the swap has its own reps", () => {
    const json = readRealProgramJson();
    withPullUpSwap(json, { exercise: "inverted_row", reps: "6-8" });
    const swap = parseProgram(json).program.days[1]!.blocks[2]!.items[0]!.noEquipment!;
    expect(swap.reps).toEqual({ kind: "range", min: 6, max: 8 });
  });

  it("rejects a swap that is not an object", () => {
    expect(errorMessageAfter((json) => withSlamsSwap(json, "backpack_slam"))).toBe(`${slamsPath}.noEquipment: expected an object but found "backpack_slam"`);
    expect(errorMessageAfter((json) => withSlamsSwap(json, [1]))).toContain(`${slamsPath}.noEquipment:`);
  });

  it("rejects a missing or non-string exercise", () => {
    expect(errorMessageAfter((json) => withSlamsSwap(json, { reps: 8 }))).toBe(`${slamsPath}.noEquipment.exercise: expected text but found nothing (field is missing)`);
    expect(errorMessageAfter((json) => withSlamsSwap(json, { exercise: 5 }))).toBe(`${slamsPath}.noEquipment.exercise: expected text but found 5`);
  });

  it("rejects an unknown exercise id", () => {
    expect(errorMessageAfter((json) => withSlamsSwap(json, { exercise: "nope" }))).toBe(`${slamsPath}.noEquipment.exercise: unknown exercise "nope"`);
  });

  it.each([
    "sets", "restSec", "minutes", "rounds", "workSec", "format", "repsPctOfMax", "perSide", "optional", "sameEveryWeek", "weeklyIncrease", "noEquipment",
  ])("rejects %s, which the swap keeps from the original", (key) => {
    const message = errorMessageAfter((json) => withSlamsSwap(json, { exercise: "backpack_slam", [key]: 1 }));
    expect(message).toContain(`${slamsPath}.noEquipment.${key}:`);
    expect(message).toContain("keeps");
    expect(message).toContain("from the original item");
  });

  it("rejects a swap exercise that is max-tested", () => {
    const message = errorMessageAfter((json) => {
      withSlamsSwap(json, { exercise: "backpack_slam" });
      json.exercises.backpack_slam.maxTested = true;
    });
    expect(message).toContain(`${slamsPath}.noEquipment.exercise:`);
    expect(message).toContain("max-tested");
  });

  it("rejects a swap that is the item's own exercise", () => {
    const message = errorMessageAfter((json) => withSlamsSwap(json, { exercise: json.days[0].blocks[1].items[0].exercise }));
    expect(message).toContain(`${slamsPath}.noEquipment.exercise:`);
    expect(message).toContain("own exercise");
  });

  it("rejects a swap of a max-based item that has no reps of its own", () => {
    const message = errorMessageAfter((json) => withPullUpSwap(json, { exercise: "inverted_row" }));
    expect(message).toContain(`${pullUpPath}.noEquipment.reps:`);
    expect(message).toContain("percentage of a tested max");
  });

  it("treats an item as max-based when its percentage of max ends up in its sets", () => {
    const message = errorMessageAfter((json) => {
      addSwapExercises(json);
      const item = json.days[0].blocks[1].items[0];
      delete item.reps;
      // With a set count, the percentage ends up in each set rather than on the item.
      item.sets = 2;
      item.repsPctOfMax = 0.5;
      item.noEquipment = { exercise: "inverted_row" };
    });
    expect(message).toContain("noEquipment.reps:");
  });

  it("validates reps, durationSec, load, note and tempo like the item does", () => {
    expect(errorMessageAfter((json) => withSlamsSwap(json, { exercise: "backpack_slam", reps: true }))).toBe(
      `${slamsPath}.noEquipment.reps: expected a number or text but found true`,
    );
    expect(errorMessageAfter((json) => withSlamsSwap(json, { exercise: "backpack_slam", reps: "15-10" }))).toContain("rep range minimum 15 is larger than maximum 10");
    expect(errorMessageAfter((json) => withSlamsSwap(json, { exercise: "backpack_slam", durationSec: "30" }))).toBe(
      `${slamsPath}.noEquipment.durationSec: expected a number but found "30"`,
    );
    for (const key of ["load", "note", "tempo"]) {
      expect(errorMessageAfter((json) => withSlamsSwap(json, { exercise: "backpack_slam", [key]: 3 }))).toBe(
        `${slamsPath}.noEquipment.${key}: expected text but found 3`,
      );
    }
  });

  it("warns, with a suggestion, about a misspelt key inside the swap", () => {
    const json = readRealProgramJson();
    withSlamsSwap(json, { exercise: "backpack_slam", tempoo: "Fast", colour: "red" });
    const { warnings } = parseProgram(json);

    expect(warnings).toHaveLength(2);
    expect(warnings[0]).toMatchObject({ path: `${slamsPath}.noEquipment.tempoo`, suggestion: "tempo" });
    expect(warnings[0]!.message).toContain('did you mean "tempo"');
    expect(warnings[1]).toMatchObject({ path: `${slamsPath}.noEquipment.colour`, suggestion: undefined });
  });
});
