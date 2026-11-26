import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { Injury, InjuryChoices } from "../injury/model";
import { recentlyClearedInjuriesOn } from "../injury/operations";
import { choicesFromWire, choicesToWire } from "../injury/wire";
import { halfSetsKeysForDate } from "../injury/storage";
import type { LoggedSet, WorkoutLog } from "../log/model";
import { buildSwappedCombinedSession, buildSwappedSession } from "../noEquipment/session";
import type { TrainingSettings } from "../settings/model";
import { parseProgram } from "./parse";
import type { ItemView, SessionView } from "./schedule";

/*
 * "First time back" and "Half sets today" (PLAN.md, Injury 3 step 1), over
 * the shipped program: start 2 Nov 2026, max pull-ups 12, shoulder flagged
 * 22 Nov and cleared 30 Nov (W5 D1, the first power-endurance Day 1).
 */

const program = parseProgram(JSON.parse(readFileSync("public/program.json", "utf-8"))).program;
const settings: TrainingSettings = {
  startDate: "2026-11-02",
  maxReps: { pull_up: 12, dip: 15 },
  maxSavedOn: {},
  maxHistory: { pull_up: [{ savedOn: null, reps: 12 }], dip: [{ savedOn: null, reps: 15 }] },
};
const noLog: WorkoutLog = { sessions: {} };
const noTicks = new Map();

const CLEAR_DATE = "2026-11-30"; // W5 D1
const W5D5 = "2026-12-04";
const W6D1 = "2026-12-07";
const clearedShoulder: Injury = { area: "shoulder", side: "right", from: "2026-11-22", to: CLEAR_DATE };

type Training = Extract<SessionView, { kind: "training" }>;

/** Builds the session for `date` the way Today does. */
function sessionOn(date: string, options: { injuries?: Injury[]; log?: WorkoutLog; choices?: InjuryChoices } = {}): Training {
  const built = buildSwappedSession(program, settings, options.log ?? noLog, noTicks, date, undefined, options.injuries ?? [clearedShoulder], options.choices);
  if (built.session.kind !== "training") throw new Error("expected a training day");
  return built.session;
}

/** The first item with this exercise id (Day 1 has the pull-up EMOM once). */
function itemOf(session: Training, exerciseId: string): ItemView {
  const found = session.blocks.flatMap((block) => block.items).find((item) => item.exercise.id === exerciseId);
  if (found === undefined) throw new Error(`no ${exerciseId}`);
  return found;
}

/** The "2026-11-30" pull-up EMOM item key: its block position and id. */
function pullUpKey(session: Training): string {
  const block = session.blocks.find((candidate) => candidate.items.some((item) => item.exercise.id === "pull_up"))!;
  return `${block.position}:pull_up`;
}

/** Day 1's block position of the pull-up EMOM in power-endurance weeks. */
const PULL_UP_BLOCK = Number(pullUpKey(sessionOn(CLEAR_DATE)).split(":")[0]);

/** A log with one pull-up set on `date`. */
function logPullUp(date: string, blockPosition = PULL_UP_BLOCK, day = 1): WorkoutLog {
  const set: LoggedSet = { exerciseId: "pull_up", blockPosition, setNumber: 1, reps: 5, loggedAt: new Date(`${date}T10:00:00`), day };
  return { sessions: { [date]: { date, day, sets: [set] } } } as unknown as WorkoutLog;
}

/** The "Half sets today" choice for one item key on one date, as the choices map the builders take. */
function choicesOf(date: string, itemKey: string): InjuryChoices {
  return new Map([[date, new Map([[itemKey, "halfSets" as const]])]]);
}

describe("First time back", () => {
  it("treats the rotated-in Ab raises (week 5, hanging raises) as an avoid item", () => {
    const item = itemOf(sessionOn("2026-12-02", { injuries: [clearedShoulder] }), "pallof_press");

    expect(item.rotatedIn?.displayName).toBe("Ab raises");
    expect(item.firstTimeBack).toMatchObject({ reason: "injury", area: "shoulder" });
  });

  it("does not mark the unrotated Pallof press (caution) first time back", () => {
    const earlyClear: Injury = { ...clearedShoulder, to: "2026-11-21" };

    expect(itemOf(sessionOn("2026-11-23", { injuries: [earlyClear] }), "pallof_press").firstTimeBack).toBeUndefined();
  });

  it("marks the pull-up EMOM on its first session after the clear, pain-free only", () => {
    const item = itemOf(sessionOn(CLEAR_DATE), "pull_up");

    expect(item.firstTimeBack).toEqual({ reason: "injury", area: "shoulder", halfSetsOffered: true });
    expect(item.leftOut).toBeUndefined();
    expect(item.halvedForReturn).toBeUndefined();
  });

  it("is not shown while the flag is active (the row is left out instead)", () => {
    const stillFlagged: Injury = { area: "shoulder", side: "right", from: "2026-11-22" };
    const item = itemOf(sessionOn(CLEAR_DATE, { injuries: [stillFlagged] }), "pull_up");

    expect(item.leftOut).toEqual({ area: "shoulder" });
    expect(item.firstTimeBack).toBeUndefined();
  });

  it("marks an item that had a stand-in too, because the original returns", () => {
    const item = itemOf(sessionOn(CLEAR_DATE), "hanging_leg_raise");

    expect(item.firstTimeBack).toMatchObject({ reason: "injury", area: "shoulder" });
    expect(item.injuryStandInFor).toBeUndefined();
  });

  it("stays on the later Day 1 until the item is logged, then disappears", () => {
    expect(itemOf(sessionOn(W6D1), "pull_up").firstTimeBack).toBeDefined();
    expect(itemOf(sessionOn(W6D1, { log: logPullUp(W5D5, PULL_UP_BLOCK, 5) }), "pull_up").firstTimeBack).toBeUndefined();
  });

  it("counts a set logged on the clearing date itself", () => {
    expect(itemOf(sessionOn(W5D5, { log: logPullUp(CLEAR_DATE) }), "pull_up").firstTimeBack).toBeUndefined();
  });

  it("keeps the mark while today's own sets are logged, but stops offering Half sets", () => {
    const item = itemOf(sessionOn(CLEAR_DATE, { log: logPullUp(CLEAR_DATE) }), "pull_up");

    expect(item.firstTimeBack).toEqual({ reason: "injury", area: "shoulder", halfSetsOffered: false });
  });

  it("ignores sets logged under a stand-in's id and sets before the clear", () => {
    const earlier = logPullUp("2026-11-29");
    expect(itemOf(sessionOn(W5D5, { log: earlier }), "pull_up").firstTimeBack).toBeDefined();
  });

  it("ends the mark when sets were logged under the item's no-equipment swap id (inverted rows for pull-ups)", () => {
    const rowSet: LoggedSet = { exerciseId: "inverted_row", blockPosition: PULL_UP_BLOCK, setNumber: 1, reps: 6, loggedAt: new Date("2026-12-04T10:00:00"), day: 5 };
    const log = { sessions: { [W5D5]: { date: W5D5, day: 5, sets: [rowSet] } } } as unknown as WorkoutLog;

    expect(itemOf(sessionOn(W6D1), "pull_up").firstTimeBack).toBeDefined();
    expect(itemOf(sessionOn(W6D1, { log }), "pull_up").firstTimeBack).toBeUndefined();
  });

  it("keeps the 'first time back' line on a row swapped for its no-equipment exercise, without offering Half sets", () => {
    const ticks = new Map([[CLEAR_DATE, new Set([pullUpKey(sessionOn(CLEAR_DATE))])]]);
    const built = buildSwappedSession(program, settings, noLog, ticks, CLEAR_DATE, undefined, [clearedShoulder]);
    if (built.session.kind !== "training") throw new Error("expected a training day");
    const swapped = itemOf(built.session, "inverted_row");

    expect(swapped.swappedFrom?.id).toBe("pull_up");
    expect(swapped.firstTimeBack).toEqual({ reason: "injury", area: "shoulder", halfSetsOffered: false });
  });

  it("shows nothing for a clear older than the 14-day window", () => {
    // Cleared 30 Nov: W6 D1 (7 Dec) is inside the window; W7 D1 (14 Dec) is the 14th day, outside it.
    expect(itemOf(sessionOn(W6D1), "pull_up").firstTimeBack).toBeDefined();
    expect(itemOf(sessionOn("2026-12-14"), "pull_up").firstTimeBack).toBeUndefined();
  });

  it("changes nothing for someone who never flagged an injury", () => {
    const flagged = sessionOn(CLEAR_DATE);
    const never = sessionOn(CLEAR_DATE, { injuries: [] });

    expect(itemOf(never, "pull_up").firstTimeBack).toBeUndefined();
    expect(never).toEqual(buildSwappedSession(program, settings, noLog, noTicks, CLEAR_DATE).session);
    expect(flagged.targetMinutes).toBe(never.targetMinutes);
  });

  it("ignores an injury cleared the day it was flagged", () => {
    const neverActive: Injury = { area: "shoulder", side: "left", from: CLEAR_DATE, to: CLEAR_DATE };
    expect(itemOf(sessionOn(CLEAR_DATE, { injuries: [neverActive] }), "pull_up").firstTimeBack).toBeUndefined();
  });
});

describe("Half sets today", () => {
  it("halves the pull-up EMOM's minutes and re-estimates the header", () => {
    const plain = sessionOn(CLEAR_DATE);
    const key = pullUpKey(plain);
    const halved = sessionOn(CLEAR_DATE, { choices: choicesOf(CLEAR_DATE, key) });
    const before = itemOf(plain, "pull_up");
    const after = itemOf(halved, "pull_up");

    expect(after.halvedForReturn).toBe(true);
    expect(after.firstTimeBack).toBeDefined();
    expect(after.minutes).toBe(Math.ceil(before.minutes! / 2));
    // W5 D1: the file's 50 less the 4 minutes halving the 9-minute EMOM to 5 saves.
    expect(plain.targetMinutes).toBe(50);
    expect(halved.targetMinutes).toBe(44);
  });

  it("is not offered, and does not mark the row halved, where halving changes nothing (a warm-up, a one-set item)", () => {
    const plain = sessionOn(CLEAR_DATE);
    const warmup = plain.blocks.find((block) => block.type === "warmup")!;
    expect(itemOf(plain, "ytwi").firstTimeBack).toEqual({ reason: "injury", area: "shoulder", halfSetsOffered: false });

    const halved = sessionOn(CLEAR_DATE, { choices: choicesOf(CLEAR_DATE, `${warmup.position}:ytwi`) });
    expect(itemOf(halved, "ytwi").halvedForReturn).toBeUndefined();
    expect(halved.targetMinutes).toBe(plain.targetMinutes);

    // Every row that offers the button is one halving really changes.
    const offered = plain.blocks.flatMap((block) => block.items.filter((item) => item.firstTimeBack?.halfSetsOffered === true));
    expect(offered.length).toBeGreaterThan(0);
    for (const item of offered) expect(item.sets.length > 1 || (item.minutes ?? 0) > 1 || (item.rounds?.min ?? 0) > 1).toBe(true);
  });

  it("never halves a warm-up", () => {
    // Day 1's warm-up has a YTWI stand-in for the shoulder only while flagged; a cleared flag shows the original.
    const plain = sessionOn(CLEAR_DATE);
    const warmup = plain.blocks.find((block) => block.type === "warmup")!;
    const ytwi = warmup.items.find((item) => item.exercise.id === "ytwi");
    expect(ytwi).toBeDefined();
    const halved = sessionOn(CLEAR_DATE, { choices: choicesOf(CLEAR_DATE, `${warmup.position}:ytwi`) });
    const after = halved.blocks.find((block) => block.type === "warmup")!.items.find((item) => item.exercise.id === "ytwi")!;

    expect(after.sets).toEqual(ytwi!.sets);
    expect(after.halvedForReturn).toBeUndefined();
    expect(after.firstTimeBack?.halfSetsOffered).toBe(false);
  });

  it("applies to that date only", () => {
    const key = pullUpKey(sessionOn(CLEAR_DATE));
    const choices = choicesOf(CLEAR_DATE, key);

    expect(itemOf(sessionOn(W6D1, { choices }), "pull_up").halvedForReturn).toBeUndefined();
  });

  it("stays halved after its first set is logged today", () => {
    const key = pullUpKey(sessionOn(CLEAR_DATE));
    const halvedWithSet = itemOf(sessionOn(CLEAR_DATE, { choices: choicesOf(CLEAR_DATE, key), log: logPullUp(CLEAR_DATE) }), "pull_up");

    expect(halvedWithSet.halvedForReturn).toBe(true);
  });
});

describe("First time back with Half sets today on a combined day", () => {
  it("marks and halves Day 1's pull-up EMOM by its day-qualified key, and leaves the added Day 2 alone", () => {
    const combine = { hostDay: 1, addedDay: 2, addedDate: "2026-12-01" }; // 30 Nov W5 D1 + W5 D2
    const choices = choicesOf(CLEAR_DATE, `1.${PULL_UP_BLOCK}:pull_up`);
    const { session } = buildSwappedCombinedSession(program, settings, noLog, noTicks, CLEAR_DATE, combine, new Set(), [clearedShoulder], choices);
    const rows = session.blocks.flatMap((block) => block.parts).flatMap((part) => part.block.items.map((item) => ({ day: part.source.day, item })));

    const pullUps = rows.find((row) => row.day === 1 && row.item.exercise.id === "pull_up")!.item;
    expect(pullUps.firstTimeBack).toEqual({ reason: "injury", area: "shoulder", halfSetsOffered: true });
    expect(pullUps.halvedForReturn).toBe(true);
    expect(pullUps.minutes).toBe(5);

    expect(rows.filter((row) => row.day === 2).every((row) => row.item.halvedForReturn === undefined)).toBe(true);
  });
});

describe("the halfSets choice kind", () => {
  it("round-trips through the wire and is read separately from addBack", () => {
    const choices: InjuryChoices = new Map([[CLEAR_DATE, new Map([["2:pull_up", "halfSets" as const], ["3:dip", "addBack" as const]])]]);
    const reloaded = choicesFromWire(JSON.parse(JSON.stringify(choicesToWire(choices))));

    expect(reloaded).toEqual(choices);
    expect([...halfSetsKeysForDate(reloaded, CLEAR_DATE)]).toEqual(["2:pull_up"]);
  });

  it("still drops an unknown kind", () => {
    expect(choicesFromWire({ version: 1, choices: { [CLEAR_DATE]: { "2:pull_up": "bogus" } } }).size).toBe(0);
  });
});

describe("recentlyClearedInjuriesOn", () => {
  it("covers the clearing date and the 13 days after it, not before or after", () => {
    expect(recentlyClearedInjuriesOn([clearedShoulder], "2026-11-29")).toEqual([]);
    expect(recentlyClearedInjuriesOn([clearedShoulder], CLEAR_DATE)).toHaveLength(1);
    expect(recentlyClearedInjuriesOn([clearedShoulder], "2026-12-13")).toHaveLength(1);
    expect(recentlyClearedInjuriesOn([clearedShoulder], "2026-12-14")).toEqual([]);
  });
});
