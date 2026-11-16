import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { countSetsForItem } from "../log/itemSets";
import type { LoggedSet, WorkoutLog } from "../log/model";
import { isSessionInProgress } from "../log/sessionProgress";
import { buildSwappedCombinedSession, buildSwappedSession, buildSwappedSessionFor } from "../noEquipment/session";
import { blockSlotsOf } from "../program/combine";
import { parseProgram } from "../program/parse";
import { buildSession, type BlockView, type SessionView } from "../program/schedule";
import type { TrainingSettings } from "../settings/model";
import { optionalBlockKey } from "./model";
import { applySkippedBlocks, blockCountOf, estimatedBlockMinutes } from "./session";

const program = parseProgram(JSON.parse(readFileSync("public/program.json", "utf-8"))).program;
const settings: TrainingSettings = { startDate: "2026-11-02", maxReps: { pull_up: 12, dip: 15 }, maxSavedOn: {}, maxHistory: {} };
const noSets: WorkoutLog = { sessions: {} };

/** W2 D1 (9 Nov) and W5 D1 (30 Nov): both have the boxing finisher at block 6. */
const WEEK_2_DAY_1 = "2026-11-09";
const WEEK_5_DAY_1 = "2026-11-30";
const BOXING_KEY = optionalBlockKey(1, 6);

/** The training session for `date`, with the given skipped keys applied to the plain session. */
function trainingOn(date: string, skippedKeys: string[] = []): Extract<SessionView, { kind: "training" }> {
  const session = applySkippedBlocks(buildSession(program, settings, date), new Set(skippedKeys));
  if (session.kind !== "training") throw new Error("expected a training day");
  return session;
}

/** The finisher block of a session. */
function finisherOf(session: Extract<SessionView, { kind: "training" }>): BlockView {
  const finisher = session.blocks.find((block) => block.type === "finisher");
  if (finisher === undefined) throw new Error("no finisher");
  return finisher;
}

describe("estimatedBlockMinutes", () => {
  it("is a 2:00 gear-up + 5 x 30s work + 4 x 30s rest = 390s, so 7 minutes, in week 2", () => {
    expect(estimatedBlockMinutes(finisherOf(trainingOn(WEEK_2_DAY_1)))).toBe(7);
  });

  it("is 120s + 5 x 35s + 4 x 30s = 415s, so 7 minutes, in week 5", () => {
    expect(estimatedBlockMinutes(finisherOf(trainingOn(WEEK_5_DAY_1)))).toBe(7);
  });

  it("is 0 for a block with no interval item", () => {
    const warmup = trainingOn(WEEK_2_DAY_1).blocks[0]!;
    expect(estimatedBlockMinutes(warmup)).toBe(0);
  });
});

describe("applySkippedBlocks", () => {
  it("changes nothing when nothing is skipped", () => {
    const plain = buildSession(program, settings, WEEK_2_DAY_1);
    expect(applySkippedBlocks(plain, new Set())).toBe(plain);
  });

  it("W2 D1: marks the boxing block, keeps its position, drops 7 minutes and one block (50 to 43, 6 to 5)", () => {
    const plain = trainingOn(WEEK_2_DAY_1);
    const skipped = trainingOn(WEEK_2_DAY_1, [BOXING_KEY]);

    expect(plain.targetMinutes).toBe(50);
    expect(blockCountOf(plain)).toBe(6);
    expect(skipped.targetMinutes).toBe(43);
    expect(blockCountOf(skipped)).toBe(5);
    expect(skipped.blocks).toHaveLength(6);
    expect(finisherOf(skipped).skipped).toBe(true);
    expect(finisherOf(skipped).position).toBe(6);
    expect(skipped.blocks.filter((block) => block.skipped)).toHaveLength(1);
  });

  it("W5 D1: drops the 5 minute estimate as well", () => {
    expect(trainingOn(WEEK_5_DAY_1).targetMinutes - trainingOn(WEEK_5_DAY_1, [BOXING_KEY]).targetMinutes).toBe(7);
  });

  it("ignores a key for a block that is not optional, a block of another day, or a nonsense key", () => {
    const plain = trainingOn(WEEK_2_DAY_1);

    const ignored = trainingOn(WEEK_2_DAY_1, [optionalBlockKey(1, 5), optionalBlockKey(5, 6), "bogus"]);

    expect(ignored.targetMinutes).toBe(plain.targetMinutes);
    expect(ignored.blocks.some((block) => block.skipped)).toBe(false);
  });

  it("does not change the session it was given", () => {
    const plain = buildSession(program, settings, WEEK_2_DAY_1);
    applySkippedBlocks(plain, new Set([BOXING_KEY]));
    expect(finisherOf(plain as Extract<SessionView, { kind: "training" }>).skipped).toBeUndefined();
  });

  it("leaves a rest day as it is", () => {
    const rest = buildSession(program, settings, "2026-11-08");
    expect(applySkippedBlocks(rest, new Set([BOXING_KEY]))).toBe(rest);
  });
});

describe("logged sets win over a stored skip", () => {
  const bagRound: LoggedSet = { exerciseId: "heavy_bag", blockPosition: 6, setNumber: 1, reps: 1, loggedAt: new Date("2026-11-09T12:00:00Z") };
  const logWithBagRound: WorkoutLog = { sessions: { [WEEK_2_DAY_1]: { date: WEEK_2_DAY_1, day: 1, sets: [bagRound] } } };

  it("applySkippedBlocks does not skip a block with a set logged on that date", () => {
    const session = applySkippedBlocks(buildSession(program, settings, WEEK_2_DAY_1), new Set([BOXING_KEY]), logWithBagRound, WEEK_2_DAY_1);

    expect(session.kind === "training" && session.targetMinutes).toBe(50);
    expect(session.kind === "training" && finisherOf(session).skipped).toBeUndefined();
  });

  it("a set logged on another date does not matter", () => {
    const session = applySkippedBlocks(buildSession(program, settings, WEEK_2_DAY_1), new Set([BOXING_KEY]), logWithBagRound, "2026-11-16");

    expect(session.kind === "training" && finisherOf(session).skipped).toBe(true);
  });

  it("buildSwappedSessionFor shows the block again, with all minutes and blocks", () => {
    const skips = new Map([[WEEK_2_DAY_1, new Set([BOXING_KEY])]]);

    const { session } = buildSwappedSessionFor(program, settings, logWithBagRound, new Map(), new Map(), WEEK_2_DAY_1, WEEK_2_DAY_1, skips);

    expect(session.kind === "training" && session.targetMinutes).toBe(50);
    expect(session.kind === "training" && blockCountOf(session)).toBe(6);
  });

  it("a combined day does not skip a block of its own day that has a set logged", () => {
    const combine = { hostDay: 1, addedDay: 2, addedDate: "2026-11-10" };
    const logWithDayOneRound: WorkoutLog = { sessions: { [WEEK_2_DAY_1]: { date: WEEK_2_DAY_1, day: 1, sets: [{ ...bagRound, day: 1 }] } } };

    const { session } = buildSwappedCombinedSession(program, settings, logWithDayOneRound, new Map(), WEEK_2_DAY_1, combine, new Set([BOXING_KEY]));

    expect(blockSlotsOf(session).filter((slot) => slot.block.skipped)).toEqual([]);
    expect(blockCountOf(session)).toBe(session.blocks.length);
  });
});

describe("No equipment with a skipped block", () => {
  it("skips the shadow boxing block too, which has no gear-up, so 5 minutes come off (50 to 45)", () => {
    const ticks = new Map([[WEEK_2_DAY_1, new Set(["6:heavy_bag"])]]);

    const { session } = buildSwappedSession(program, settings, noSets, ticks, WEEK_2_DAY_1, new Set([BOXING_KEY]));

    if (session.kind !== "training") throw new Error("expected training");
    expect(finisherOf(session).items[0]!.exercise.id).toBe("shadow_boxing");
    expect(finisherOf(session).skipped).toBe(true);
    expect(session.targetMinutes).toBe(45);
  });
});

describe("session progress with a skipped block", () => {
  /** Every set of every item except those of the finisher, as logged on `WEEK_2_DAY_1`. */
  function allSetsExceptBoxing(session: Extract<SessionView, { kind: "training" }>): LoggedSet[] {
    const sets: LoggedSet[] = [];
    for (const block of session.blocks) {
      if (block.type === "finisher") continue;
      for (const item of block.items) {
        const count = countSetsForItem(item, block);
        for (let setNumber = 1; setNumber <= count; setNumber++) {
          sets.push({ exerciseId: item.exercise.id, blockPosition: block.position, setNumber, loggedAt: new Date("2026-11-09T18:00:00Z") });
        }
      }
    }
    return sets;
  }

  const shortlyAfter = new Date("2026-11-09T18:05:00Z");

  it("stays in progress without the skip (the bag is still to do) and completes with it", () => {
    const sets = allSetsExceptBoxing(trainingOn(WEEK_2_DAY_1));
    const log: WorkoutLog = { sessions: { [WEEK_2_DAY_1]: { date: WEEK_2_DAY_1, programWeek: 2, day: 1, sets } } };

    expect(isSessionInProgress(trainingOn(WEEK_2_DAY_1), log, WEEK_2_DAY_1, shortlyAfter)).toBe(true);
    expect(isSessionInProgress(trainingOn(WEEK_2_DAY_1, [BOXING_KEY]), log, WEEK_2_DAY_1, shortlyAfter)).toBe(false);
  });
});

describe("through the builders", () => {
  const combine = { hostDay: 1, addedDay: 2, addedDate: "2026-11-10" };

  it("buildSwappedSession applies the date's skipped keys", () => {
    const { session } = buildSwappedSession(program, settings, noSets, new Map(), WEEK_2_DAY_1, new Set([BOXING_KEY]));

    expect(session.kind === "training" && session.targetMinutes).toBe(43);
    expect(session.kind === "training" && finisherOf(session).skipped).toBe(true);
  });

  it("buildSwappedSessionFor reads the skips of the shown date only", () => {
    const skips = new Map([[WEEK_2_DAY_1, new Set([BOXING_KEY])]]);

    const onSkippedDate = buildSwappedSessionFor(program, settings, noSets, new Map(), new Map(), WEEK_2_DAY_1, WEEK_2_DAY_1, skips).session;
    const onOtherDate = buildSwappedSessionFor(program, settings, noSets, new Map(), new Map(), WEEK_5_DAY_1, WEEK_5_DAY_1, skips).session;

    expect(onSkippedDate.kind === "training" && onSkippedDate.targetMinutes).toBe(43);
    expect(onOtherDate.kind === "training" && onOtherDate.targetMinutes).toBe(trainingOn(WEEK_5_DAY_1).targetMinutes);
  });

  it("a combined day applies each day's skips to that day's block and drops the same minutes", () => {
    const plain = buildSwappedCombinedSession(program, settings, noSets, new Map(), WEEK_2_DAY_1, combine).session;
    const skipped = buildSwappedCombinedSession(program, settings, noSets, new Map(), WEEK_2_DAY_1, combine, new Set([BOXING_KEY])).session;

    expect(plain.targetMinutes).toBe(73);
    expect(skipped.targetMinutes).toBe(66);
    expect(blockCountOf(plain)).toBe(plain.blocks.length);
    expect(blockCountOf(skipped)).toBe(plain.blocks.length - 1);

    const skippedSlots = blockSlotsOf(skipped).filter((slot) => slot.block.skipped);
    expect(skippedSlots.map((slot) => `D${slot.source.day}#${slot.source.blockPosition}`)).toEqual(["D1#6"]);
  });

  it("a combined day ignores a key for the other day's non-optional block", () => {
    const plain = buildSwappedCombinedSession(program, settings, noSets, new Map(), WEEK_2_DAY_1, combine).session;
    const ignored = buildSwappedCombinedSession(program, settings, noSets, new Map(), WEEK_2_DAY_1, combine, new Set([optionalBlockKey(2, 6)])).session;

    expect(ignored.targetMinutes).toBe(plain.targetMinutes);
  });
});
