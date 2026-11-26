import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { isSessionInProgress } from "../log/sessionProgress";
import type { LoggedSet, WorkoutLog } from "../log/model";
import { buildSwappedCombinedSession, buildSwappedSession } from "../noEquipment/session";
import type { TrainingSettings } from "../settings/model";
import type { Injury, InjuryChoices } from "../injury/model";
import { standInLine } from "../ui/injuryRowText";
import { applyInjuries, estimatedSessionMinutes, type InjuryContext } from "./injury";
import { parseProgram } from "./parse";
import { buildSession, type BlockView, type ItemView, type SessionView } from "./schedule";

/**
 * Unit tests for `applyInjuries` over the shipped public/program.json, using
 * the plan's worked examples (PLAN.md, "Plan: train around an injury": start
 * 2 Nov 2026, max pull-ups 12, max dips 15, right shoulder flagged from 22 Nov).
 */

const program = parseProgram(JSON.parse(readFileSync("public/program.json", "utf-8"))).program;
const settings: TrainingSettings = {
  startDate: "2026-11-02",
  maxReps: { pull_up: 12, dip: 15 },
  maxSavedOn: {},
  maxHistory: { pull_up: [{ savedOn: null, reps: 12 }], dip: [{ savedOn: null, reps: 15 }] },
};
const noLog: WorkoutLog = { sessions: {} };
const SHOULDER = ["shoulder"] as const;
const noKeys = new Set<string>();

/** W4 D1 (deload), D2, D3, D4. */
const W4D1 = "2026-11-23";
const W4D2 = "2026-11-24";
const W4D3 = "2026-11-25";
const W4D4 = "2026-11-26";
/** W1 D1 (a normal week, 2 Nov). */
const W1D1 = "2026-11-02";
/** W1 D3 (4 Nov): the day the flag turns into the shoulder-free session. */
const W1D3 = "2026-11-04";

type Training = Extract<SessionView, { kind: "training" }>;

/** Asserts a training session. */
function training(session: SessionView): Training {
  if (session.kind !== "training") throw new Error(`expected training, got ${session.kind}`);
  return session;
}

/** buildSession then applyInjuries for the shoulder (flagged unless `areas` says otherwise). */
function injuredOn(date: string, options: { log?: WorkoutLog; addBack?: string[]; areas?: readonly "shoulder"[] } = {}): Training {
  const log = options.log ?? noLog;
  const context: InjuryContext = { program, settings, log, logDate: date, sessionDate: date };
  return training(applyInjuries(buildSession(program, settings, date), context, options.areas ?? SHOULDER, new Set(options.addBack ?? []), false));
}

/** Every item of the session with its block, in order. */
function allItems(session: Training): { block: BlockView; item: ItemView }[] {
  return session.blocks.flatMap((block) => block.items.map((item) => ({ block, item })));
}

/** A log with one set of `exerciseId` in `blockPosition` on `date`. */
function logWithSet(date: string, blockPosition: number, exerciseId: string, day = 1): WorkoutLog {
  const set: LoggedSet = { exerciseId, blockPosition, setNumber: 1, reps: 5, loggedAt: new Date("2026-11-23T10:00:00"), day };
  return { sessions: { [date]: { sets: [set] } } } as unknown as WorkoutLog;
}

describe("an unflagged session", () => {
  it("is returned unchanged when no area is flagged", () => {
    const built = buildSession(program, settings, W4D1);
    const context: InjuryContext = { program, settings, log: noLog, logDate: W4D1, sessionDate: W4D1 };

    expect(applyInjuries(built, context, [], noKeys)).toBe(built);
  });

  it("changes nothing on a lower-body day that has no tagged item (Day 2 keeps its Cossack squat rows)", () => {
    const built = training(buildSession(program, settings, "2026-11-03"));
    const context: InjuryContext = { program, settings, log: noLog, logDate: "2026-11-03", sessionDate: "2026-11-03" };
    const flagged = training(applyInjuries(built, context, SHOULDER, noKeys));

    // Untagged rows are the same objects; only the stand-in / caution rows differ.
    const untouched = allItems(flagged).filter(({ item }) => item.exercise.id === "cossack_squat");
    expect(untouched.length).toBeGreaterThan(0);
    for (const { item } of untouched) expect(allItems(built).some((original) => original.item === item)).toBe(true);
  });

  it("returns rest days and not-started dates as they are", () => {
    const rest = buildSession(program, settings, "2026-11-08");
    const context: InjuryContext = { program, settings, log: noLog, logDate: "2026-11-08", sessionDate: "2026-11-08" };

    expect(applyInjuries(rest, context, SHOULDER, noKeys)).toBe(rest);
  });
});

describe("23 Nov, W4 D1 (deload), shoulder flagged", () => {
  const session = injuredOn(W4D1);

  it("keeps the Pallof press as written, pain-free only, with its 2 rounds not halved", () => {
    const warmup = session.blocks.find((block) => block.type === "warmup")!;
    const pallof = warmup.items.find((item) => item.exercise.id === "pallof_press")!;

    expect(pallof.painFreeOnly).toBe(true);
    expect(pallof.leftOut).toBeUndefined();
    expect(warmup.rounds).toEqual({ min: 2, max: 2 });
  });

  it("stands the dead bug (legs only, 8 per side) in for the YTWI raises", () => {
    const standIn = allItems(session).find(({ item }) => item.exercise.id === "dead_bug_legs_only")!.item;

    expect(standIn.injuryStandInFor).toEqual({ area: "shoulder", original: expect.objectContaining({ id: "ytwi" }) });
    expect(standIn.target).toEqual({ kind: "text", text: "8 per side" });
  });

  it("leaves out the slams, the pull-up EMOM, the dip mini-dose and the boxing", () => {
    for (const exerciseId of ["med_ball_slam", "pull_up", "dip", "heavy_bag"]) {
      const item = allItems(session).find(({ item: candidate }) => candidate.exercise.id === exerciseId)!.item;
      expect(item.leftOut, exerciseId).toEqual({ area: "shoulder" });
    }
  });

  it("stands in bodyweight back extension 2 x 12-15, lying leg raise 2 x 10-15 and side plank on the uninjured side 1 x 30s", () => {
    const backExtension = allItems(session).find(({ item }) => item.exercise.id === "bodyweight_back_extension")!.item;
    expect(backExtension.sets).toHaveLength(2);
    expect(backExtension.sets[0]!.target).toEqual(expect.objectContaining({ kind: "range", min: 12, max: 15 }));
    expect(backExtension.injuryStandInFor?.original.id).toBe("back_extension");

    const legRaise = allItems(session).find(({ item }) => item.exercise.id === "lying_leg_raise")!.item;
    expect(legRaise.sets).toHaveLength(2);
    expect(legRaise.sets[0]!.target).toEqual(expect.objectContaining({ kind: "range", min: 10, max: 15 }));
    expect(legRaise.injuryStandInFor?.original.id).toBe("hanging_leg_raise");

    const sidePlank = allItems(session).find(({ item }) => item.injuryStandInFor?.original.id === "side_plank")!.item;
    expect(sidePlank.sets).toHaveLength(1);
    expect(sidePlank.durationSec).toBe(30);
    expect(sidePlank.perSide).toBe(false);
  });

  it("is not a shoulder-free session (core work is left)", () => {
    expect(session.areaFreeSession).toBeUndefined();
  });

  it("scales the file's 50 by the share of estimated work left: 21, not the 9 a whole-day estimate would give", () => {
    // Left out: slams, pull-up EMOM, dip mini-dose, heavy bag. The estimator reads 12 minutes of them
    // at their built (deload) dose; the written 50 less that is 38. Never below what remains (9).
    expect(training(buildSession(program, settings, W4D1)).targetMinutes).toBe(50);
    expect(session.targetMinutes).toBe(21);
    expect(session.targetMinutes).toBeGreaterThanOrEqual(estimatedSessionMinutes(session.blocks));
  });
});

describe("the header's minutes with anything left out or added back", () => {
  it("adds an added-back row back at its halved dose: the pull-up EMOM (9 min halved to 5 in a normal week) takes a flagged Day 1 from 19 to 26 minutes", () => {
    const leftOut = injuredOn(W1D1);
    const addedBack = injuredOn(W1D1, { addBack: ["3:pull_up"] });

    // Written 50; left out: 28 (the file's figure less the estimate of the four left-out rows); added back: 28 + 5.
    expect(leftOut.targetMinutes).toBe(19);
    expect(addedBack.targetMinutes).toBe(26);
    expect(addedBack.targetMinutes).toBeGreaterThanOrEqual(estimatedSessionMinutes(addedBack.blocks));
  });

  it("adds the added-back pull-up EMOM back on the deload week too: 21 left out, 28 with the EMOM at 3 minutes", () => {
    expect(injuredOn(W4D1, { addBack: ["3:pull_up"] }).targetMinutes).toBe(28);
  });

  it("never drops below one minute or below the estimator's reading of what remains", () => {
    const floor = injuredOn(W1D1);

    expect(floor.targetMinutes).toBeGreaterThanOrEqual(estimatedSessionMinutes(floor.blocks));
    expect(floor.targetMinutes).toBeGreaterThanOrEqual(1);
  });

  it("leaves a session where nothing is left out or added back at the file's minutes (stand-ins and caution rows only)", () => {
    const session = injuredOn(W4D2);

    expect(allItems(session).some(({ item }) => item.leftOut !== undefined)).toBe(false);
    expect(session.targetMinutes).toBe(30);
  });

  it("keeps the shoulder-free session's own estimate", () => {
    const areaFree = injuredOn(W1D3);

    expect(areaFree.areaFreeSession).toBeDefined();
    expect(areaFree.targetMinutes).toBe(estimatedSessionMinutes(areaFree.blocks));
  });
});

describe("24 Nov, W4 D2 (deload), shoulder flagged", () => {
  const session = injuredOn(W4D2);

  it("stands in the suitcase Bulgarian split squat 2 x 12-15 per leg", () => {
    const item = allItems(session).find(({ item: candidate }) => candidate.exercise.id === "suitcase_bulgarian_split_squat")!.item;

    expect(item.sets).toHaveLength(2);
    expect(item.sets[0]!.target).toEqual(expect.objectContaining({ min: 12, max: 15 }));
    expect(item.injuryStandInFor?.original.id).toBe("zercher_bulgarian_split_squat");
  });

  it("stands in the single-leg RDL mini-dose with the uninjured hand, 1 set", () => {
    const item = allItems(session).find(({ item: candidate }) => candidate.injuryStandInFor?.original.id === "single_leg_rdl")!.item;

    expect(item.sets).toHaveLength(1);
    expect(item.exercise.id).not.toBe("single_leg_rdl");
  });
});

describe("25 Nov, W4 D3 (deload), shoulder flagged", () => {
  const session = injuredOn(W4D3);

  it("becomes the shoulder-free session, named and headed 'instead of' the day's focus", () => {
    expect(session.areaFreeSession).toEqual({ area: "shoulder", name: "Shoulder-free session", insteadOf: "Upper: push" });
    expect(allItems(session).some(({ item }) => item.leftOut !== undefined)).toBe(false);
  });

  it("halves the core sets for the deload (3 -> 2, side plank 2 -> 1) but not the warm-up", () => {
    const warmup = session.blocks[0]!;
    const core = session.blocks[1]!;

    expect(warmup.type).toBe("warmup");
    expect(warmup.rounds).toEqual({ min: 2, max: 2 });
    expect(core.items.map((item) => item.sets.length)).toEqual([2, 2, 2, 1]);
    expect(core.items.map((item) => item.exercise.id)).toEqual(["lying_leg_raise", "hollow_hold_arms_by_sides", "prone_back_extension_arms_by_sides", "side_plank_uninjured_side"]);
  });

  it("is about 12 minutes in a normal week", () => {
    expect(training(injuredOn("2026-11-04")).targetMinutes).toBe(12);
  });

  it("keeps the real day's week, number and phase", () => {
    expect(session.dayNumber).toBe(3);
    expect(session.week).toBe(4);
    expect(session.isDeload).toBe(true);
  });

  it("is kept as the original (mostly empty) session when a set was already logged under one of the day's items", () => {
    const log = logWithSet(W4D3, 1, "pallof_press", 3);

    expect(injuredOn(W4D3, { log }).areaFreeSession).toBeUndefined();
  });

  it("is kept as it is when the program has no session for the area", () => {
    const withoutSessions = { ...program, injurySessions: undefined };
    const built = buildSession(withoutSessions, settings, W4D3);
    const context: InjuryContext = { program: withoutSessions, settings, log: noLog, logDate: W4D3, sessionDate: W4D3 };
    const result = training(applyInjuries(built, context, SHOULDER, noKeys));

    expect(result.areaFreeSession).toBeUndefined();
    expect(allItems(result).filter(({ item }) => item.leftOut !== undefined).length).toBeGreaterThan(0);
  });
});

describe("26 Nov, W4 D4 (deload), shoulder flagged", () => {
  it("replaces the kettlebell swings with broad jumps, a 4-minute EMOM of 5 (8 minutes halved)", () => {
    const session = injuredOn(W4D4);
    const broadJumps = allItems(session).find(({ item }) => item.injuryStandInFor?.original.id === "kettlebell_swing")!.item;

    expect(broadJumps.minutes).toBe(4);
    expect(broadJumps.target).toEqual(expect.objectContaining({ kind: "fixed", count: 5 }));
    expect(session.areaFreeSession).toBeUndefined();
  });
});

describe("Add it back", () => {
  it("23 Nov: the pull-up EMOM comes back as 3 min x 6 reps/min, pain-free only", () => {
    const session = injuredOn(W4D1, { addBack: ["3:pull_up"] });
    const pullUps = allItems(session).find(({ item }) => item.exercise.id === "pull_up")!.item;

    expect(pullUps.leftOut).toBeUndefined();
    expect(pullUps.addedBack).toBe(true);
    expect(pullUps.painFreeOnly).toBe(true);
    expect(pullUps.minutes).toBe(3);
    expect(pullUps.target).toEqual(expect.objectContaining({ kind: "fixed", count: 6 }));
  });

  it("halves a normal week's sets with the deload rounding (round up) and adds the minutes back", () => {
    const session = injuredOn(W1D1, { addBack: ["2:med_ball_slam"] });
    const slams = allItems(session).find(({ item }) => item.exercise.id === "med_ball_slam")!.item;

    expect(slams.sets).toHaveLength(3); // 6 sets halved
    expect(slams.addedBack).toBe(true);

    const emom = allItems(injuredOn(W1D1, { addBack: ["3:pull_up"] })).find(({ item }) => item.exercise.id === "pull_up")!.item;
    expect(emom.minutes).toBe(5); // 9 halved, rounded up
  });

  it("an item that is only a stand-in or untagged ignores an add-back key", () => {
    const session = injuredOn(W4D1, { addBack: ["1:ytwi", "5:back_extension"] });

    expect(allItems(session).some(({ item }) => item.addedBack)).toBe(false);
  });

  it("stays added back once its first set is logged (the lock does not undo the choice)", () => {
    const log = logWithSet(W4D1, 3, "pull_up");
    const pullUps = allItems(injuredOn(W4D1, { addBack: ["3:pull_up"], log })).find(({ item }) => item.exercise.id === "pull_up")!.item;

    expect(pullUps.addedBack).toBe(true);
    expect(pullUps.minutes).toBe(3);
  });

  it("a day with nothing else left is still not shoulder-free once an item is added back (W1 D3: the dip EMOM, block 3)", () => {
    const session = injuredOn("2026-11-04", { addBack: ["3:dip"] });

    expect(allItems(session).find(({ item }) => item.exercise.id === "dip")!.item.addedBack).toBe(true);
    expect(session.areaFreeSession).toBeUndefined();
  });
});

describe("logged sets lock a row", () => {
  it("keeps the original as written when sets are logged under its id (YTWI warm-up, block 1)", () => {
    const log = logWithSet(W4D1, 1, "ytwi");
    const session = injuredOn(W4D1, { log });

    expect(allItems(session).some(({ item }) => item.exercise.id === "ytwi")).toBe(true);
    expect(allItems(session).some(({ item }) => item.exercise.id === "dead_bug_legs_only")).toBe(false);
  });

  it("keeps a left-out item as written when its sets are logged (the person did it)", () => {
    const log = logWithSet(W4D1, 3, "pull_up");
    const pullUps = allItems(injuredOn(W4D1, { log })).find(({ item }) => item.exercise.id === "pull_up")!.item;

    expect(pullUps.leftOut).toBeUndefined();
    expect(pullUps.addedBack).toBeUndefined();
    expect(pullUps.minutes).toBe(5);
  });

  it("keeps the stand-in when sets are logged under the stand-in's id", () => {
    const log = logWithSet(W4D1, 1, "dead_bug_legs_only");
    const session = injuredOn(W4D1, { log });

    expect(allItems(session).some(({ item }) => item.injuryStandInFor?.original.id === "ytwi")).toBe(true);
  });

  it("with no area flagged and nothing logged, the session is returned exactly as built", () => {
    const built = buildSession(program, settings, W4D1);
    const context: InjuryContext = { program, settings, log: noLog, logDate: W4D1, sessionDate: W4D1 };

    expect(applyInjuries(built, context, [], noKeys)).toBe(built);
  });

  it("keeps the stand-in after the flag is cleared when its sets are logged (26 Nov: broad jumps with the set)", () => {
    const log = logWithSet(W4D4, 2, "broad_jump", 4);
    const session = injuredOn(W4D4, { log, areas: [] });

    const row = allItems(session).find(({ item }) => item.exercise.id === "broad_jump")!.item;
    expect(row.injuryStandInFor?.original.id).toBe("kettlebell_swing");
    expect(allItems(session).some(({ item }) => item.exercise.id === "kettlebell_swing")).toBe(false);
  });

  it("with the flag cleared and no stand-in sets logged, the item is as written again", () => {
    const session = injuredOn(W4D4, { areas: [] });

    expect(allItems(session).some(({ item }) => item.exercise.id === "kettlebell_swing")).toBe(true);
    expect(allItems(session).some(({ item }) => item.injuryStandInFor !== undefined)).toBe(false);
  });

  it("keeps the shoulder-free session after the flag is cleared when it was started (25 Nov, a leg raise logged)", () => {
    const log = logWithSet(W4D3, 2, "lying_leg_raise", 3);
    const session = injuredOn(W4D3, { log, areas: [] });

    expect(session.areaFreeSession).toEqual({ area: "shoulder", name: "Shoulder-free session", insteadOf: "Upper: push" });
    expect(session.blocks[1]!.items.map((item) => item.exercise.id)).toContain("lying_leg_raise");
  });

  it("does not turn a day into the shoulder-free session when only the original's sets are logged and nothing is flagged", () => {
    const log = logWithSet(W4D3, 1, "pallof_press", 3);

    expect(injuredOn(W4D3, { log, areas: [] }).areaFreeSession).toBeUndefined();
  });

  it("a Day 1 stand-in dead bug (block 1) never turns Day 1 into the shoulder-free session once the flag is cleared", () => {
    const log = logWithSet(W4D1, 1, "dead_bug_legs_only", 1);
    const session = injuredOn(W4D1, { log, areas: [] });

    expect(session.areaFreeSession).toBeUndefined();
    expect(allItems(session).some(({ item }) => item.injuryStandInFor?.original.id === "ytwi")).toBe(true);
  });

  it("does not count a left-out item toward progress: the session is not 'in progress' once everything else is logged", () => {
    const session = injuredOn(W4D1);
    // Log every non-warm-up item that is not left out, in full.
    const sets: LoggedSet[] = [];
    for (const block of session.blocks) {
      if (block.type === "warmup") continue;
      for (const item of block.items) {
        if (item.leftOut !== undefined) continue;
        const count = Math.max(1, item.sets.length);
        for (let setNumber = 1; setNumber <= count; setNumber++) {
          sets.push({ exerciseId: item.exercise.id, blockPosition: block.position, setNumber, reps: 5, loggedAt: new Date("2026-11-23T10:00:00"), day: 1 } as unknown as LoggedSet);
        }
      }
    }
    const log = { sessions: { [W4D1]: { sets } } } as unknown as WorkoutLog;

    expect(isSessionInProgress(session, log, W4D1, new Date("2026-11-23T10:05:00"))).toBe(false);
  });
});

describe("injury versus the no-equipment tick", () => {
  it("a left-out row ignores its tick and loses its swap view", () => {
    // Day 1 slams (block 2) have a no-equipment swap; the injury leaves them out.
    const session = injuredOn(W4D1);
    const slams = allItems(session).find(({ item }) => item.exercise.id === "med_ball_slam")!.item;

    expect(slams.noEquipment).toBeUndefined();

    const swapped = training(buildSwappedSession(program, settings, noLog, new Map([[W4D1, new Set(["2:med_ball_slam"])]]), W4D1, new Set(), [shoulderFlag], new Map()).session);
    const slamsAfterTick = allItems(swapped).find(({ item }) => item.exercise.id === "med_ball_slam")!.item;
    expect(slamsAfterTick.leftOut).toEqual({ area: "shoulder" });
    expect(slamsAfterTick.swappedFrom).toBeUndefined();
  });

  it("a stand-in row ignores the tick of the original (single-leg RDL on D4, ticked: still the stand-in)", () => {
    const swapped = training(buildSwappedSession(program, settings, noLog, new Map([[W4D4, new Set(["3:single_leg_rdl"])]]), W4D4, new Set(), [shoulderFlag], new Map()).session);
    const rdl = allItems(swapped).find(({ item }) => item.injuryStandInFor?.original.id === "single_leg_rdl")!.item;

    expect(rdl.swappedFrom).toBeUndefined();
  });

  it("a caution row whose swap is itself tagged avoid hides its tick (note a: Pallof press -> plank shoulder taps)", () => {
    const pallof = allItems(injuredOn(W4D1)).find(({ item }) => item.exercise.id === "pallof_press")!.item;

    expect(pallof.noEquipment).toBeUndefined();

    const ticked = training(buildSwappedSession(program, settings, noLog, new Map([[W4D1, new Set(["1:pallof_press"])]]), W4D1, new Set(), [shoulderFlag], new Map()).session);
    const pallofAfterTick = allItems(ticked).find(({ item }) => item.exercise.id === "pallof_press")!.item;
    expect(pallofAfterTick.swappedFrom).toBeUndefined();
    expect(pallofAfterTick.painFreeOnly).toBe(true);
  });

  it("with no injury flagged the tick works as before", () => {
    const ticked = training(buildSwappedSession(program, settings, noLog, new Map([[W4D1, new Set(["2:med_ball_slam"])]]), W4D1).session);

    expect(allItems(ticked).find(({ item }) => item.swappedFrom?.id === "med_ball_slam")).toBeDefined();
  });
});

describe("rotated warm-ups follow the level of the item they replace (week 5)", () => {
  const session = injuredOn("2026-11-30"); // W5 D1: the rotation swaps YTWI -> Reverse fly and Pallof press -> Ab raises

  it("the rotated-in Reverse fly is still YTWI underneath, so it gets the dead bug stand-in (and loses the rotated name)", () => {
    const built = allItems(training(buildSession(program, settings, "2026-11-30")));
    expect(built.find(({ item }) => item.exercise.id === "ytwi")!.item.rotatedIn?.displayName).toBe("Reverse fly");

    const standIn = allItems(session).find(({ item }) => item.injuryStandInFor?.original.id === "ytwi")!.item;
    expect(standIn.exercise.id).toBe("dead_bug_legs_only");
    expect(standIn.rotatedIn).toBeUndefined();
  });

  it("words the stood-in rotated row 'Instead of Reverse fly', with the original's id kept", () => {
    const standIn = allItems(session).find(({ item }) => item.injuryStandInFor?.original.id === "ytwi")!.item;

    expect(standIn.injuryStandInFor?.original.name).toBe("Reverse fly");
    expect(standInLine(standIn)).toBe("Instead of Reverse fly");
  });

  it("words an unrotated stand-in with the original's own name (week 4 Day 1: Instead of YTWI raises)", () => {
    const standIn = allItems(injuredOn(W4D1)).find(({ item }) => item.injuryStandInFor?.original.id === "ytwi")!.item;

    expect(standIn.injuryStandInFor?.original.name).toBe(program.exercises["ytwi"]!.name);
  });

  it("the rotated-in Ab raises are hanging raises: left out (Day 1 and Day 3), still shown as Ab raises", () => {
    // Day 3 normally becomes the shoulder-free session; a set logged under a lateral raise keeps the original day.
    const day3Log = logWithSet("2026-12-02", 1, "lateral_raise", 3);
    const day3 = injuredOn("2026-12-02", { log: day3Log });
    expect(day3.areaFreeSession).toBeUndefined();

    for (const flagged of [session, day3]) {
      const abRaises = allItems(flagged).find(({ item }) => item.exercise.id === "pallof_press")!.item;

      expect(abRaises.rotatedIn?.displayName).toBe("Ab raises");
      expect(abRaises.leftOut).toEqual({ area: "shoulder" });
      expect(abRaises.painFreeOnly).toBeUndefined();
    }
  });

  it("with no log, a flagged week 5 Day 3 is the shoulder-free session, so Ab raises don't appear at all", () => {
    const day3 = injuredOn("2026-12-02");

    expect(day3.areaFreeSession).toBeDefined();
    expect(allItems(day3).some(({ item }) => item.exercise.id === "pallof_press")).toBe(false);
  });

  it("with no flag week 5 is unchanged: Ab raises are a plain rotated row", () => {
    const abRaises = allItems(training(buildSession(program, settings, "2026-11-30"))).find(({ item }) => item.exercise.id === "pallof_press")!.item;

    expect(abRaises.leftOut).toBeUndefined();
    expect(abRaises.painFreeOnly).toBeUndefined();
  });

  it("week 4 (not rotated): the Pallof press is still pain-free only", () => {
    const pallof = allItems(injuredOn(W4D1)).find(({ item }) => item.exercise.id === "pallof_press")!.item;

    expect(pallof.rotatedIn).toBeUndefined();
    expect(pallof.painFreeOnly).toBe(true);
  });
});

describe("combined days", () => {
  const hostDate = "2026-11-23"; // W4 D1
  const combine = { hostDay: 1, addedDay: 2, addedDate: "2026-11-24" }; // + W4 D2
  const injuries: Injury[] = [shoulderFlag];

  /** Every row of the combined session with its day and block position. */
  function rows(addBack: string[] = []) {
    const choices: InjuryChoices = new Map([[hostDate, new Map(addBack.map((key) => [key, "addBack" as const]))]]);
    const { session } = buildSwappedCombinedSession(program, settings, noLog, new Map(), hostDate, combine, new Set(), injuries, choices);
    return session.blocks.flatMap((block) => block.parts).flatMap((part) => part.block.items.map((item) => ({ day: part.source.day, position: part.source.blockPosition, item })));
  }

  it("filters each day the same way: Day 1's slams are left out, Day 2's split squat is its stand-in", () => {
    const combined = rows();

    expect(combined.find((row) => row.day === 1 && row.item.exercise.id === "med_ball_slam")!.item.leftOut).toEqual({ area: "shoulder" });
    expect(combined.find((row) => row.day === 2 && row.item.injuryStandInFor?.original.id === "zercher_bulgarian_split_squat")).toBeDefined();
  });

  it("adds a row back by its day-qualified key, and a plain key counts as the host day's", () => {
    for (const key of ["1.3:pull_up", "3:pull_up"]) {
      const pullUps = rows([key]).find((row) => row.item.exercise.id === "pull_up")!.item;
      expect(pullUps.addedBack, key).toBe(true);
    }
    expect(rows(["2.3:pull_up"]).find((row) => row.item.exercise.id === "pull_up")!.item.addedBack).toBeUndefined();
  });

  it("takes the flag from the host (training) date for both days: a flag from 24 Nov does not touch a 23 Nov host", () => {
    const lateFlag: Injury[] = [{ ...shoulderFlag, from: "2026-11-24" }];
    const { session } = buildSwappedCombinedSession(program, settings, noLog, new Map(), hostDate, combine, new Set(), lateFlag, new Map());
    const items = session.blocks.flatMap((block) => block.parts).flatMap((part) => part.block.items.map((item) => ({ day: part.source.day, item })));

    // Host 23 Nov is before the flag, so neither day is changed (Day 2's own date, 24 Nov, no longer decides).
    expect(items.find((row) => row.day === 1 && row.item.exercise.id === "med_ball_slam")!.item.leftOut).toBeUndefined();
    expect(items.find((row) => row.day === 2 && row.item.injuryStandInFor !== undefined)).toBeUndefined();
  });

  it("a missed Day 1 added on 24 Nov (flag from 24 Nov) is trained with the shoulder flagged: its slams are left out", () => {
    const flagFrom24Nov: Injury[] = [{ ...shoulderFlag, from: "2026-11-24" }];
    const missedDay1Combine = { hostDay: 2, addedDay: 1, addedDate: "2026-11-23" }; // host: 24 Nov's Day 2, plus the missed Day 1
    const { session } = buildSwappedCombinedSession(program, settings, noLog, new Map(), "2026-11-24", missedDay1Combine, new Set(), flagFrom24Nov, new Map());
    const items = session.blocks.flatMap((block) => block.parts).flatMap((part) => part.block.items.map((item) => ({ day: part.source.day, item })));

    expect(items.find((row) => row.day === 1 && row.item.exercise.id === "med_ball_slam")!.item.leftOut).toEqual({ area: "shoulder" });
    expect(items.find((row) => row.day === 1 && row.item.injuryStandInFor?.original.id === "ytwi")).toBeDefined();
    expect(items.find((row) => row.day === 2 && row.item.injuryStandInFor !== undefined)).toBeDefined();
  });
});

/** The right shoulder, flagged from 22 Nov. */
const shoulderFlag: Injury = { area: "shoulder", side: "right", from: "2026-11-22" };
