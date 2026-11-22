import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { INJURY_AREAS } from "./model";
import { parseProgram } from "./parse";

/** Reads the real program.json as untyped JSON, the same way the app receives it. */
function readRealProgramJson(): any {
  return JSON.parse(readFileSync("public/program.json", "utf-8"));
}

/** Parses a copy of the real JSON after `mutate` has changed it, and returns the thrown message. */
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

const slamsPath = "days[0].blocks[1].items[0]";
const pullUpPath = "days[0].blocks[2].items[0]";
const sidePlankPath = "days[0].blocks[4].items[2]";

/** Adds library entries that stand-ins and injury sessions can point at. */
function addStandInExercises(json: any): void {
  json.exercises.lying_leg_raise = { name: "Lying leg raise", category: "core", evidence: "coaching practice", cues: ["Lower slowly"] };
  json.exercises.inverted_row = { name: "Inverted rows", category: "main strength", evidence: "coaching practice" };
  json.exercises.wall_plank = { name: "Wall plank", category: "core", evidence: "coaching practice" };
}

/** Gives day 1's slams (a reps item) the shoulder stand-in `standIn`. */
function withSlamsStandIn(json: any, standIn: unknown): void {
  addStandInExercises(json);
  json.days[0].blocks[1].items[0].injury = { shoulder: standIn };
}

/** Gives day 1's max-based pull-up EMOM the shoulder stand-in `standIn`. */
function withPullUpStandIn(json: any, standIn: unknown): void {
  addStandInExercises(json);
  json.days[0].blocks[2].items[0].injury = { shoulder: standIn };
}

/** Gives day 1's timed side plank the shoulder stand-in `standIn`. */
function withSidePlankStandIn(json: any, standIn: unknown): void {
  addStandInExercises(json);
  json.days[0].blocks[4].items[2].injury = { shoulder: standIn };
}

/** A valid shoulder-free session whose one block holds `items`. */
function sessionWith(items: unknown[]): unknown {
  return { shoulder: { name: "Shoulder-free session", blocks: [{ type: "core", items }] } };
}

describe("a program without the injury fields", () => {
  it("parses as before: no loads, stand-ins or sessions anywhere", () => {
    const { program, warnings } = parseProgram(readRealProgramJson());

    expect(warnings).toEqual([]);
    expect(program.injurySessions).toBeUndefined();
    expect(Object.values(program.exercises).every((exercise) => exercise.loads === undefined)).toBe(true);
    const allItems = Object.values(program.days).flatMap((day) => day!.blocks.flatMap((block) => block.items));
    expect(allItems.every((item) => item.injury === undefined)).toBe(true);
  });

  it("knows the shoulder as an injury area", () => {
    expect(INJURY_AREAS).toContain("shoulder");
  });
});

describe("exercises.<id>.loads", () => {
  it("maps avoid and caution to the model", () => {
    const json = readRealProgramJson();
    json.exercises.pull_up.loads = { shoulder: "avoid" };
    json.exercises.side_plank.loads = { shoulder: "caution" };
    const result = parseProgram(json);

    expect(result.warnings).toEqual([]);
    expect(result.program.exercises.pull_up!.loads).toEqual({ shoulder: "avoid" });
    expect(result.program.exercises.side_plank!.loads).toEqual({ shoulder: "caution" });
  });

  it("accepts an empty object (nothing tagged)", () => {
    const json = readRealProgramJson();
    json.exercises.pull_up.loads = {};
    expect(parseProgram(json).program.exercises.pull_up!.loads).toEqual({});
  });

  it("rejects loads that is not an object", () => {
    expect(errorMessageAfter((json) => { json.exercises.pull_up.loads = "avoid"; })).toBe(
      `exercises.pull_up.loads: expected an object but found "avoid"`,
    );
  });

  it("rejects an unknown area, naming the path", () => {
    expect(errorMessageAfter((json) => { json.exercises.pull_up.loads = { knee: "avoid" }; })).toBe(
      `exercises.pull_up.loads.knee: unknown injury area "knee" (known areas: shoulder)`,
    );
  });

  it("suggests the known area for a misspelt one", () => {
    expect(errorMessageAfter((json) => { json.exercises.pull_up.loads = { sholder: "avoid" }; })).toBe(
      `exercises.pull_up.loads.sholder: unknown injury area "sholder" (known areas: shoulder) — did you mean "shoulder"?`,
    );
  });

  it("rejects an unknown level, with a hint for a near miss", () => {
    expect(errorMessageAfter((json) => { json.exercises.pull_up.loads = { shoulder: "avoidd" }; })).toBe(
      `exercises.pull_up.loads.shoulder: expected "avoid" or "caution" but found "avoidd" — did you mean "avoid"?`,
    );
    expect(errorMessageAfter((json) => { json.exercises.pull_up.loads = { shoulder: "banned" }; })).toBe(
      `exercises.pull_up.loads.shoulder: expected "avoid" or "caution" but found "banned"`,
    );
    expect(errorMessageAfter((json) => { json.exercises.pull_up.loads = { shoulder: 3 }; })).toContain("but found 3");
  });

  it("warns, with a suggestion, about a misspelt loads key on the exercise", () => {
    const json = readRealProgramJson();
    json.exercises.pull_up.lodas = { shoulder: "avoid" };
    const { warnings } = parseProgram(json);

    expect(warnings).toEqual([expect.objectContaining({ path: "exercises.pull_up.lodas", suggestion: "loads" })]);
  });
});

describe("an item's injury stand-ins", () => {
  it("maps a valid stand-in: exercise resolved, reps parsed, text copied", () => {
    const json = readRealProgramJson();
    withSlamsStandIn(json, { exercise: "lying_leg_raise", reps: "10-15", load: "Mat", note: "Slow", tempo: "3s down" });
    const result = parseProgram(json);
    const slams = result.program.days[1]!.blocks[1]!.items[0]!;

    expect(result.warnings).toEqual([]);
    expect(slams.injury).toEqual({
      shoulder: {
        exercise: result.program.exercises.lying_leg_raise,
        reps: { kind: "range", min: 10, max: 15 },
        durationSec: undefined,
        load: "Mat",
        note: "Slow",
        tempo: "3s down",
      },
    });
  });

  it("accepts a stand-in with only an exercise, and a hold swapped for a hold", () => {
    const json = readRealProgramJson();
    withSlamsStandIn(json, { exercise: "lying_leg_raise" });
    expect(parseProgram(json).program.days[1]!.blocks[1]!.items[0]!.injury!.shoulder!.reps).toBeUndefined();

    const holdJson = readRealProgramJson();
    withSidePlankStandIn(holdJson, { exercise: "wall_plank", durationSec: 45 });
    expect(parseProgram(holdJson).program.days[1]!.blocks[4]!.items[2]!.injury!.shoulder!.durationSec).toBe(45);
  });

  it("can sit next to a noEquipment swap on the same item", () => {
    const json = readRealProgramJson();
    withSlamsStandIn(json, { exercise: "lying_leg_raise" });
    json.days[0].blocks[1].items[0].noEquipment = { exercise: "inverted_row" };
    const slams = parseProgram(json).program.days[1]!.blocks[1]!.items[0]!;

    expect(slams.noEquipment!.exercise.id).toBe("inverted_row");
    expect(slams.injury!.shoulder!.exercise.id).toBe("lying_leg_raise");
  });

  it("rejects an injury that is not an object, and a stand-in that is not an object", () => {
    expect(errorMessageAfter((json) => { json.days[0].blocks[1].items[0].injury = "x"; })).toBe(`${slamsPath}.injury: expected an object but found "x"`);
    expect(errorMessageAfter((json) => withSlamsStandIn(json, "lying_leg_raise"))).toBe(`${slamsPath}.injury.shoulder: expected an object but found "lying_leg_raise"`);
  });

  it("rejects an unknown area, with a hint for a near miss", () => {
    expect(errorMessageAfter((json) => {
      addStandInExercises(json);
      json.days[0].blocks[1].items[0].injury = { sholder: { exercise: "lying_leg_raise" } };
    })).toBe(`${slamsPath}.injury.sholder: unknown injury area "sholder" (known areas: shoulder) — did you mean "shoulder"?`);
  });

  it("rejects a missing, non-string or unknown exercise", () => {
    expect(errorMessageAfter((json) => withSlamsStandIn(json, { reps: 8 }))).toBe(`${slamsPath}.injury.shoulder.exercise: expected text but found nothing (field is missing)`);
    expect(errorMessageAfter((json) => withSlamsStandIn(json, { exercise: 5 }))).toBe(`${slamsPath}.injury.shoulder.exercise: expected text but found 5`);
    expect(errorMessageAfter((json) => withSlamsStandIn(json, { exercise: "nope" }))).toBe(`${slamsPath}.injury.shoulder.exercise: unknown exercise "nope"`);
  });

  it.each([
    "sets", "restSec", "minutes", "rounds", "workSec", "format", "repsPctOfMax", "perSide", "optional", "sameEveryWeek", "weeklyIncrease", "noEquipment", "injury", "weeks",
  ])("rejects %s, which the stand-in keeps from the original", (key) => {
    const message = errorMessageAfter((json) => withSlamsStandIn(json, { exercise: "lying_leg_raise", [key]: 1 }));
    expect(message).toContain(`${slamsPath}.injury.shoulder.${key}:`);
    expect(message).toContain("from the original item");
  });

  it("rejects a gear-up break in a stand-in", () => {
    expect(errorMessageAfter((json) => withSlamsStandIn(json, { exercise: "lying_leg_raise", gearUpSec: 30 }))).toBe(
      `${slamsPath}.injury.shoulder.gearUpSec: an injury stand-in has no gear-up break, so it can't be set here`,
    );
  });

  it("rejects a max-tested stand-in and the item's own exercise", () => {
    const maxTested = errorMessageAfter((json) => {
      withSlamsStandIn(json, { exercise: "lying_leg_raise" });
      json.exercises.lying_leg_raise.maxTested = true;
    });
    expect(maxTested).toContain(`${slamsPath}.injury.shoulder.exercise:`);
    expect(maxTested).toContain("max-tested");

    const own = errorMessageAfter((json) => withSlamsStandIn(json, { exercise: json.days[0].blocks[1].items[0].exercise }));
    expect(own).toContain("own exercise");
  });

  it("needs its own reps when the original is max-based, and accepts them", () => {
    const message = errorMessageAfter((json) => withPullUpStandIn(json, { exercise: "inverted_row" }));
    expect(message).toContain(`${pullUpPath}.injury.shoulder.reps:`);
    expect(message).toContain("percentage of a tested max");

    const json = readRealProgramJson();
    withPullUpStandIn(json, { exercise: "inverted_row", reps: "6-8" });
    expect(parseProgram(json).program.days[1]!.blocks[2]!.items[0]!.injury!.shoulder!.reps).toEqual({ kind: "range", min: 6, max: 8 });
  });

  it("enforces the hold/reps type rule", () => {
    expect(errorMessageAfter((json) => withSidePlankStandIn(json, { exercise: "wall_plank", reps: 10 }))).toBe(
      `${sidePlankPath}.injury.shoulder.reps: the original item is a timed hold, so its swap is a hold too: give "durationSec", not "reps"`,
    );
    expect(errorMessageAfter((json) => withSlamsStandIn(json, { exercise: "lying_leg_raise", durationSec: 30 }))).toBe(
      `${slamsPath}.injury.shoulder.durationSec: the original item is done in reps, so its swap is too: give "reps", not "durationSec"`,
    );
  });

  it("validates field types like a noEquipment swap", () => {
    expect(errorMessageAfter((json) => withSlamsStandIn(json, { exercise: "lying_leg_raise", reps: true }))).toBe(
      `${slamsPath}.injury.shoulder.reps: expected a number or text but found true`,
    );
    expect(errorMessageAfter((json) => withSlamsStandIn(json, { exercise: "lying_leg_raise", tempo: 3 }))).toBe(
      `${slamsPath}.injury.shoulder.tempo: expected text but found 3`,
    );
  });

  it("warns, with a suggestion, about a misspelt key inside the stand-in", () => {
    const json = readRealProgramJson();
    withSlamsStandIn(json, { exercise: "lying_leg_raise", tempoo: "Fast" });
    const { warnings } = parseProgram(json);

    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatchObject({ path: `${slamsPath}.injury.shoulder.tempoo`, suggestion: "tempo" });
  });

  it("warns about a misspelt injury key on the item", () => {
    const json = readRealProgramJson();
    addStandInExercises(json);
    json.days[0].blocks[1].items[0].injurry = { shoulder: { exercise: "lying_leg_raise" } };
    expect(parseProgram(json).warnings).toEqual([expect.objectContaining({ path: `${slamsPath}.injurry`, suggestion: "injury" })]);
  });
});

describe("top-level injurySessions", () => {
  /** Adds `injurySessions` holding `sessions` after the stand-in exercises exist. */
  function withSessions(json: any, sessions: unknown): void {
    addStandInExercises(json);
    json.injurySessions = sessions;
  }

  it("parses a session's blocks like a day's blocks", () => {
    const json = readRealProgramJson();
    withSessions(json, {
      shoulder: {
        name: "Shoulder-free session",
        blocks: [
          { type: "warmup", items: [{ exercise: "lying_leg_raise", reps: 8 }] },
          { type: "core", format: "superset", rounds: 3, restSecBetweenPairs: 45, items: [{ exercise: "wall_plank", durationSec: 30 }, { exercise: "inverted_row", sets: 3, reps: "12-15" }] },
        ],
      },
    });
    const result = parseProgram(json);
    const session = result.program.injurySessions!.shoulder!;

    expect(result.warnings).toEqual([]);
    expect(session.name).toBe("Shoulder-free session");
    expect(session.blocks.map((block) => block.type)).toEqual(["warmup", "core"]);
    expect(session.blocks[1]!.format).toBe("superset");
    expect(session.blocks[1]!.rounds).toEqual({ min: 3, max: 3 });
    expect(session.blocks[1]!.restSecBetweenPairs).toEqual({ min: 45, max: 45 });
    expect(session.blocks[1]!.items[0]!.exercise).toBe(result.program.exercises.wall_plank);
    expect(session.blocks[1]!.items[1]!.sets).toHaveLength(3);
  });

  it("rejects a section or session that is not an object", () => {
    expect(errorMessageAfter((json) => { json.injurySessions = []; })).toBe("injurySessions: expected an object but found an array");
    expect(errorMessageAfter((json) => withSessions(json, { shoulder: "x" }))).toBe(`injurySessions.shoulder: expected an object but found "x"`);
  });

  it("rejects an unknown area, with a hint for a near miss", () => {
    expect(errorMessageAfter((json) => withSessions(json, { knee: { name: "N", blocks: [] } }))).toBe(
      `injurySessions.knee: unknown injury area "knee" (known areas: shoulder)`,
    );
    expect(errorMessageAfter((json) => withSessions(json, { Shoulder: { name: "N", blocks: [] } }))).toContain(`did you mean "shoulder"?`);
  });

  it("rejects a missing or blank name and missing or malformed blocks", () => {
    expect(errorMessageAfter((json) => withSessions(json, { shoulder: { blocks: [] } }))).toBe(
      "injurySessions.shoulder.name: expected text but found nothing (field is missing)",
    );
    expect(errorMessageAfter((json) => withSessions(json, { shoulder: { name: " ", blocks: [] } }))).toBe("injurySessions.shoulder.name: must not be empty");
    expect(errorMessageAfter((json) => withSessions(json, { shoulder: { name: "N" } }))).toBe("injurySessions.shoulder.blocks: field is missing");
    expect(errorMessageAfter((json) => withSessions(json, { shoulder: { name: "N", blocks: {} } }))).toBe(
      "injurySessions.shoulder.blocks: expected a list but found an object",
    );
  });

  it("reports block and item errors with the session's path", () => {
    expect(errorMessageAfter((json) => withSessions(json, sessionWith([{ exercise: "nope" }])))).toBe(
      "injurySessions.shoulder.blocks[0].items[0].exercise: unknown exercise \"nope\"",
    );
  });

  it("rejects an item that carries noEquipment or injury", () => {
    expect(errorMessageAfter((json) => withSessions(json, sessionWith([{ exercise: "wall_plank", noEquipment: { exercise: "lying_leg_raise" } }])))).toBe(
      "injurySessions.shoulder.blocks[0].items[0].noEquipment: an injury session's items can't have a no-equipment swap",
    );
    expect(errorMessageAfter((json) => withSessions(json, sessionWith([{ exercise: "wall_plank", injury: { shoulder: { exercise: "lying_leg_raise" } } }])))).toBe(
      "injurySessions.shoulder.blocks[0].items[0].injury: an injury session's items can't have injury stand-ins",
    );
  });

  it("warns about a misspelt key in the session and in the section name", () => {
    const json = readRealProgramJson();
    addStandInExercises(json);
    json.injurySessions = { shoulder: { name: "N", blocks: [], blocs: [] } };
    json.injurySession = {};
    const { warnings } = parseProgram(json);

    expect(warnings).toContainEqual(expect.objectContaining({ path: "injurySessions.shoulder.blocs", suggestion: "blocks" }));
    expect(warnings).toContainEqual(expect.objectContaining({ path: "injurySession", suggestion: "injurySessions" }));
  });
});
