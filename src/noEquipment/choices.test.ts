import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { findLastTime } from "../log/lastTime";
import type { LoggedSet, WorkoutLog } from "../log/model";
import { applyNoEquipmentChoices } from "../program/noEquipment";
import { parseProgram } from "../program/parse";
import { buildSession } from "../program/schedule";
import type { TrainingSettings } from "../settings/model";
import { lockedItemKeys, noEquipmentChoices, swappedItemKeys } from "./choices";

/** Worked examples (PLAN.md section 6, "Logging"), against the shipped program starting 2 Nov 2026. */
const program = parseProgram(JSON.parse(readFileSync("public/program.json", "utf-8"))).program;
const settings: TrainingSettings = {
  startDate: "2026-11-02",
  maxReps: { pull_up: 12, dip: 15 },
  maxSavedOn: {},
  maxHistory: { pull_up: [{ savedOn: null, reps: 12 }], dip: [{ savedOn: null, reps: 15 }] },
};

/** W1 D4 (Thu 5 Nov): single-leg RDL is block 3 (main strength). */
const THURSDAY = "2026-11-05";
const RDL_KEY = "3:single_leg_rdl";
const CALF_KEY = "4:single_leg_calf_raise";

/** A logged set at a block position. */
function makeSet(exerciseId: string, blockPosition: number, setNumber = 1): LoggedSet {
  return { exerciseId, blockPosition, setNumber, reps: 12, loggedAt: new Date("2026-11-05T10:00:00Z") };
}

/** A log with the given sets on `date` (day 4 of week 1 unless stated). */
function logWith(date: string, ...sets: LoggedSet[]): WorkoutLog {
  return { sessions: { [date]: { date, programWeek: 1, day: 4, sets } } };
}

const noSets: WorkoutLog = { sessions: {} };
const thursday = buildSession(program, settings, THURSDAY);

describe("noEquipmentChoices (the decision per item)", () => {
  it("is not swapped and not locked with nothing logged and nothing ticked", () => {
    const choices = noEquipmentChoices(thursday, noSets, THURSDAY, new Set());
    expect(choices.swapped.size).toBe(0);
    expect(choices.locked.size).toBe(0);
  });

  it("is swapped but not locked when only ticked", () => {
    const choices = noEquipmentChoices(thursday, noSets, THURSDAY, new Set([RDL_KEY]));
    expect([...choices.swapped]).toEqual([RDL_KEY]);
    expect(choices.locked.size).toBe(0);
  });

  it("is swapped and locked once a set is logged under the swap's id, even if the tick is gone", () => {
    const log = logWith(THURSDAY, makeSet("backpack_single_leg_rdl", 3));

    const choices = noEquipmentChoices(thursday, log, THURSDAY, new Set());

    expect([...choices.swapped]).toEqual([RDL_KEY]);
    expect([...choices.locked]).toEqual([RDL_KEY]);
  });

  it("is not swapped but locked once a set is logged under the original id, whatever the tick says", () => {
    const log = logWith(THURSDAY, makeSet("single_leg_rdl", 3));

    const choices = noEquipmentChoices(thursday, log, THURSDAY, new Set([RDL_KEY]));

    expect(choices.swapped.size).toBe(0);
    expect([...choices.locked]).toEqual([RDL_KEY]);
  });

  it("lets the swap win if both ids have sets", () => {
    const log = logWith(THURSDAY, makeSet("single_leg_rdl", 3), makeSet("backpack_single_leg_rdl", 3, 2));
    expect([...swappedItemKeys(thursday, log, THURSDAY, new Set())]).toEqual([RDL_KEY]);
  });

  it("decides each item on its own", () => {
    const log = logWith(THURSDAY, makeSet("backpack_single_leg_rdl", 3));

    const choices = noEquipmentChoices(thursday, log, THURSDAY, new Set([CALF_KEY]));

    expect([...choices.swapped].sort()).toEqual([RDL_KEY, CALF_KEY]);
    expect([...choices.locked]).toEqual([RDL_KEY]);
  });

  it("ignores sets in another block position, on another date, and ticks for items with no swap", () => {
    const log = logWith(THURSDAY, makeSet("backpack_single_leg_rdl", 4));
    const otherDate = logWith("2026-11-04", makeSet("backpack_single_leg_rdl", 3));

    expect(swappedItemKeys(thursday, log, THURSDAY, new Set(["9:nonexistent", "1:nothing"])).size).toBe(0);
    expect(swappedItemKeys(thursday, otherDate, THURSDAY, new Set()).size).toBe(0);
  });

  it("is empty for a rest day", () => {
    const restDay = buildSession(program, settings, "2026-11-08");
    expect(noEquipmentChoices(restDay, noSets, "2026-11-08", new Set([RDL_KEY]))).toEqual({ swapped: new Set(), locked: new Set() });
  });

  it("exposes the two halves through swappedItemKeys and lockedItemKeys", () => {
    const log = logWith(THURSDAY, makeSet("single_leg_rdl", 3));
    expect(swappedItemKeys(thursday, log, THURSDAY, new Set([CALF_KEY]))).toEqual(new Set([CALF_KEY]));
    expect(lockedItemKeys(thursday, log, THURSDAY, new Set([CALF_KEY]))).toEqual(new Set([RDL_KEY]));
  });

  it("feeds applyNoEquipmentChoices: the locked swap becomes the backpack RDL view", () => {
    const log = logWith(THURSDAY, makeSet("backpack_single_leg_rdl", 3));

    const swappedSession = applyNoEquipmentChoices(thursday, swappedItemKeys(thursday, log, THURSDAY, new Set()));

    const ids = swappedSession.kind === "training" ? swappedSession.blocks[2]!.items.map((item) => item.exercise.id) : [];
    expect(ids).toEqual(["backpack_single_leg_rdl"]);
  });
});

describe("worked example: backpack RDL logged on 5 Nov, then 12 Nov", () => {
  const log = logWith(THURSDAY, makeSet("backpack_single_leg_rdl", 3, 1), makeSet("backpack_single_leg_rdl", 3, 2));

  it("shows the set as Last time (5 Nov) on the ticked row only", () => {
    const query = { dayNumber: 4 as const, blockType: "mainStrength" };

    const ticked = findLastTime(log, program, { ...query, exerciseId: "backpack_single_leg_rdl" }, "2026-11-12");
    const unticked = findLastTime(log, program, { ...query, exerciseId: "single_leg_rdl" }, "2026-11-12");

    expect(ticked?.date).toBe(THURSDAY);
    expect(ticked?.sets).toHaveLength(2);
    expect(unticked).toBeUndefined();
  });

  it("keeps 5 Nov's lock on 5 Nov and leaves 12 Nov's choice open", () => {
    const nextThursday = buildSession(program, settings, "2026-11-12");

    expect(lockedItemKeys(thursday, log, THURSDAY, new Set()).has(RDL_KEY)).toBe(true);
    expect(lockedItemKeys(nextThursday, log, "2026-11-12", new Set()).size).toBe(0);
  });
});
