import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { WorkoutLog } from "../log/model";
import { isSessionInProgress } from "../log/sessionProgress";
import { parseProgram } from "../program/parse";
import { buildSession, type SessionView } from "../program/schedule";
import type { TrainingSettings } from "../settings/model";
import type { NoEquipmentTicks } from "./model";
import { buildSwappedCombinedSession, buildSwappedSession, buildSwappedSessionFor } from "./session";

const program = parseProgram(JSON.parse(readFileSync("public/program.json", "utf-8"))).program;
const settings: TrainingSettings = {
  startDate: "2026-11-02",
  maxReps: { pull_up: 12, dip: 15 },
  maxSavedOn: {},
  maxHistory: { pull_up: [{ savedOn: null, reps: 12 }], dip: [{ savedOn: null, reps: 15 }] },
};

/** W1 D4 (Thu 5 Nov): single-leg RDL is block 3. */
const THURSDAY = "2026-11-05";
const RDL_KEY = "3:single_leg_rdl";
const noSets: WorkoutLog = { sessions: {} };

/** The exercise id of the item at `blockPosition` (1-based), first item. */
function firstItemId(session: ReturnType<typeof buildSwappedSession>["session"], blockPosition: number): string | undefined {
  return session.kind === "training" ? session.blocks[blockPosition - 1]?.items[0]?.exercise.id : undefined;
}

describe("buildSwappedSession", () => {
  it("returns the plain session with nothing ticked or logged", () => {
    const result = buildSwappedSession(program, settings, noSets, new Map(), THURSDAY);

    expect(result.session).toEqual(buildSession(program, settings, THURSDAY));
    expect(result.locked.size).toBe(0);
  });

  it("swaps a ticked item on its own date only", () => {
    const ticks: NoEquipmentTicks = new Map([[THURSDAY, new Set([RDL_KEY])]]);

    const ticked = buildSwappedSession(program, settings, noSets, ticks, THURSDAY);
    expect(firstItemId(ticked.session, 3)).toBe("backpack_single_leg_rdl");
    expect(ticked.locked.size).toBe(0);

    const otherWeek = buildSwappedSession(program, settings, noSets, ticks, "2026-11-12");
    expect(firstItemId(otherWeek.session, 3)).toBe("single_leg_rdl");
  });

  it("locks the item and keeps the swap once a set is logged under the swap's id, with no tick", () => {
    const log: WorkoutLog = {
      sessions: {
        [THURSDAY]: {
          date: THURSDAY, programWeek: 1, day: 4,
          sets: [{ exerciseId: "backpack_single_leg_rdl", blockPosition: 3, setNumber: 1, reps: 12, loggedAt: new Date("2026-11-05T10:00:00Z") }],
        },
      },
    };

    const result = buildSwappedSession(program, settings, log, new Map(), THURSDAY);

    expect(firstItemId(result.session, 3)).toBe("backpack_single_leg_rdl");
    expect([...result.locked]).toEqual([RDL_KEY]);
    // The wake-lock check counts that swapped set, so the session is in progress.
    expect(isSessionInProgress(result.session, log, THURSDAY, new Date("2026-11-05T10:05:00Z"))).toBe(true);
  });
});

describe("buildSwappedCombinedSession and buildSwappedSessionFor", () => {
  const hostDate = "2026-11-09";
  const combine = { hostDay: 1, addedDay: 2, addedDate: "2026-11-10" };
  const combines = new Map([[hostDate, combine]]);

  it("merges the two days the way Today builds them (73 minutes, Day 2's rows keep their own block positions)", () => {
    const { session } = buildSwappedCombinedSession(program, settings, noSets, new Map(), hostDate, combine);

    expect(session.days).toEqual([1, 2]);
    expect(session.targetMinutes).toBe(73);
    const rows = session.blocks.flatMap((block) => block.parts.map((part) => `D${part.source.day}#${part.source.blockPosition}`));
    expect(rows).toEqual(["D1#1", "D2#1", "D1#2", "D2#2", "D1#3", "D2#3", "D1#4", "D2#4", "D1#5", "D1#6"]);
  });

  it("swaps a ticked row by its day-qualified key only: Day 2's RDL (2.4) and not a plain 4:", () => {
    const rdlKey = "2.4:single_leg_rdl";
    const ticked = buildSwappedCombinedSession(program, settings, noSets, new Map([[hostDate, new Set([rdlKey])]]), hostDate, combine);
    const plainKey = buildSwappedCombinedSession(program, settings, noSets, new Map([[hostDate, new Set(["4:single_leg_rdl"])]]), hostDate, combine);

    const idsOfDayTwoMiniDose = (session: typeof ticked.session) => session.blocks.flatMap((block) => block.parts).filter((part) => part.source.day === 2 && part.source.blockPosition === 4).flatMap((part) => part.block.items.map((item) => item.exercise.id));
    expect(idsOfDayTwoMiniDose(ticked.session)).toEqual(["backpack_single_leg_rdl"]);
    expect(idsOfDayTwoMiniDose(plainKey.session)).toEqual(["single_leg_rdl"]);
  });

  it("locks a row from sets logged under its own day only", () => {
    const log: WorkoutLog = {
      sessions: {
        [hostDate]: {
          date: hostDate, programWeek: 2, day: 1,
          sets: [{ exerciseId: "backpack_single_leg_rdl", day: 2, blockPosition: 4, setNumber: 1, reps: 10, loggedAt: new Date("2026-11-09T10:00:00Z") }],
        },
      },
    };

    const result = buildSwappedCombinedSession(program, settings, log, new Map(), hostDate, combine);

    expect([...result.locked]).toEqual(["2.4:single_leg_rdl"]);
    expect(isSessionInProgress(result.session, log, hostDate, new Date("2026-11-09T10:05:00Z"))).toBe(true);
  });

  it("buildSwappedSessionFor gives the combined session for a host date and the normal one otherwise", () => {
    expect(buildSwappedSessionFor(program, settings, noSets, new Map(), combines, hostDate, hostDate).session.kind).toBe("combined");
    expect(buildSwappedSessionFor(program, settings, noSets, new Map(), combines, "2026-11-11", hostDate).session.kind).toBe("training");
    expect(buildSwappedSessionFor(program, settings, noSets, new Map(), new Map(), hostDate, hostDate).session).toEqual(buildSession(program, settings, hostDate));
  });

  it("ignores a stale combine instead of failing (the start date moved)", () => {
    const moved: TrainingSettings = { ...settings, startDate: "2026-11-05" };

    expect(buildSwappedSessionFor(program, moved, noSets, new Map(), combines, hostDate, hostDate).session.kind).toBe("training"); // 9 Nov is now Day 5
  });
  it("reads a plain tick saved on the single-day screen as the host day's tick (Day 1's pull-up swap)", () => {
    const pullUpBlock3 = (session: ReturnType<typeof buildSwappedCombinedSession>["session"]) => session.blocks.flatMap((block) => block.parts).find((part) => part.source.day === 1 && part.source.blockPosition === 3)!.block.items.map((item) => item.exercise.id);
    const plain = buildSwappedCombinedSession(program, settings, noSets, new Map([[hostDate, new Set(["3:pull_up"])]]), hostDate, combine);
    const qualified = buildSwappedCombinedSession(program, settings, noSets, new Map([[hostDate, new Set(["1.3:pull_up"])]]), hostDate, combine);
    const both = buildSwappedCombinedSession(program, settings, noSets, new Map([[hostDate, new Set(["3:pull_up", "1.3:pull_up"])]]), hostDate, combine);
    const none = buildSwappedCombinedSession(program, settings, noSets, new Map(), hostDate, combine);

    expect(pullUpBlock3(none.session)).toEqual(["pull_up"]);
    expect(pullUpBlock3(plain.session)).not.toEqual(["pull_up"]);
    expect(pullUpBlock3(plain.session)).toEqual(pullUpBlock3(qualified.session));
    expect(pullUpBlock3(both.session)).toEqual(pullUpBlock3(qualified.session));
  });

  it("does not turn a plain tick into a swap of Day 2's row with the same position and exercise", () => {
    // Day 2's block 4 is the single-leg RDL; a plain "4:single_leg_rdl" is about the HOST day (Day 1 has no such row).
    const session = buildSwappedCombinedSession(program, settings, noSets, new Map([[hostDate, new Set(["4:single_leg_rdl"])]]), hostDate, combine).session;
    const dayTwoMini = session.blocks.flatMap((block) => block.parts).find((part) => part.source.day === 2 && part.source.blockPosition === 4)!;
    expect(dayTwoMini.block.items.map((item) => item.exercise.id)).toEqual(["single_leg_rdl"]);
  });

  it("after Undo (no combine) the plain tick still swaps the single-day session", () => {
    const ticks: NoEquipmentTicks = new Map([[hostDate, new Set(["3:pull_up"])]]);
    const withCombine = buildSwappedSessionFor(program, settings, noSets, ticks, combines, hostDate, hostDate).session;
    const undone = buildSwappedSessionFor(program, settings, noSets, ticks, new Map(), hostDate, hostDate).session;

    expect(withCombine.kind).toBe("combined");
    expect(undone.kind).toBe("training");
    expect(firstItemId(undone as SessionView, 3)).not.toBe("pull_up");
  });

  it("a lapsed combine (host date passed, nothing logged) gives the normal session on both dates", () => {
    const realToday = "2026-11-10";

    expect(buildSwappedSessionFor(program, settings, noSets, new Map(), combines, hostDate, realToday).session).toEqual(buildSession(program, settings, hostDate));
    expect(buildSwappedSessionFor(program, settings, noSets, new Map(), combines, "2026-11-10", realToday).session.kind).toBe("training");
  });

  it("builds a combined deload day (23 Nov, Day 1 + Day 2) with both days' sets halved", () => {
    const deloadCombine = { hostDay: 1, addedDay: 2, addedDate: "2026-11-24" };
    const { session } = buildSwappedCombinedSession(program, settings, noSets, new Map(), "2026-11-23", deloadCombine);

    expect(session.isDeload).toBe(true);
    expect(session.days).toEqual([1, 2]);
    const hostSlams = session.blocks.flatMap((block) => block.parts).find((part) => part.source.day === 1 && part.source.blockPosition === 2)!.block.items[0]!;
    expect(hostSlams.exercise.id).toBe("med_ball_slam");
    expect(hostSlams.sets).toHaveLength(3); // 3 x 6 on W4 D1, per the worked examples
  });
});
