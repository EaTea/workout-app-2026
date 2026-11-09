import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parseProgram } from "../program/parse";
import { buildSession, type SessionView } from "../program/schedule";
import type { TrainingSettings } from "../settings/model";
import { countSetsForItem } from "./itemSets";
import type { LoggedSet, WorkoutLog } from "./model";
import { isSessionInProgress as isInProgressAt, SESSION_IDLE_TIMEOUT_MILLISECONDS } from "./sessionProgress";

const program = parseProgram(JSON.parse(readFileSync("public/program.json", "utf-8"))).program;
const settings: TrainingSettings = { startDate: "2026-11-02", maxReps: { pull_up: 12, dip: 15 }, maxSavedOn: {} };

/** A training day (W2 D1) used by most tests. */
const trainingDate = "2026-11-09";

/** Ten minutes after the sets built by `allSetsOf` were logged: well inside the idle timeout. */
const shortlyAfterLogging = new Date("2026-11-09T18:10:00Z");

/** `isSessionInProgress` at `shortlyAfterLogging` unless a time is given. */
function isSessionInProgress(session: SessionView, log: WorkoutLog, date: string, now: Date = shortlyAfterLogging): boolean {
  return isInProgressAt(session, log, date, now);
}

/** Builds the session for `date` with the shared settings. */
function sessionOn(date: string): SessionView {
  return buildSession(program, settings, date);
}

/** Every set of every item of a training session, as logged sets (what "everything logged" looks like). */
function allSetsOf(session: SessionView): LoggedSet[] {
  if (session.kind !== "training") throw new Error("expected a training day");

  const sets: LoggedSet[] = [];
  session.blocks.forEach((block, blockIndex) => {
    for (const item of block.items) {
      for (let setNumber = 1; setNumber <= countSetsForItem(item, block); setNumber++) {
        sets.push({ exerciseId: item.exercise.id, blockPosition: blockIndex + 1, setNumber, loggedAt: new Date("2026-11-09T18:00:00Z") });
      }
    }
  });
  return sets;
}

/** A log holding `sets` on `date`. */
function logWith(date: string, sets: LoggedSet[]): WorkoutLog {
  return { sessions: sets.length === 0 ? {} : { [date]: { date, sets } } };
}

describe("isSessionInProgress", () => {
  it("is false before anything is logged", () => {
    expect(isSessionInProgress(sessionOn(trainingDate), logWith(trainingDate, []), trainingDate)).toBe(false);
  });

  it("is true once some but not all sets are logged", () => {
    const session = sessionOn(trainingDate);
    const sets = allSetsOf(session);

    expect(isSessionInProgress(session, logWith(trainingDate, sets.slice(0, 1)), trainingDate)).toBe(true);
    // Everything but the last med ball slam set: still one set to go.
    const allButLastSlam = sets.filter((set) => !(set.exerciseId === "med_ball_slam" && set.setNumber === 6));
    expect(allButLastSlam).toHaveLength(sets.length - 1);
    expect(isSessionInProgress(session, logWith(trainingDate, allButLastSlam), trainingDate)).toBe(true);
  });

  it("is false once every set is logged", () => {
    const session = sessionOn(trainingDate);

    expect(isSessionInProgress(session, logWith(trainingDate, allSetsOf(session)), trainingDate)).toBe(false);
  });

  it("ends the session when only an untouched optional item (side plank) is left, but not a started one", () => {
    const session = sessionOn(trainingDate);
    const everything = allSetsOf(session);
    const withoutSidePlank = everything.filter((set) => set.exerciseId !== "side_plank");
    expect(withoutSidePlank.length).toBeLessThan(everything.length);
    expect(isSessionInProgress(session, logWith(trainingDate, withoutSidePlank), trainingDate)).toBe(false);

    const oneSidePlankSet = everything.filter((set) => set.exerciseId === "side_plank").slice(0, 1);
    expect(isSessionInProgress(session, logWith(trainingDate, [...withoutSidePlank, ...oneSidePlankSet]), trainingDate)).toBe(true);
  });

  it("ignores sets logged on other dates", () => {
    const session = sessionOn(trainingDate);
    const sets = allSetsOf(session).slice(0, 1);

    expect(isSessionInProgress(session, logWith("2026-11-02", sets), trainingDate)).toBe(false);
  });

  it("is false on a rest day, before the start date and without a start date", () => {
    const restDate = ["2026-11-03", "2026-11-05", "2026-11-07", "2026-11-08"].find((date) => sessionOn(date).kind === "rest");
    expect(restDate).toBeDefined();

    const strayLog = logWith(restDate!, allSetsOf(sessionOn(trainingDate)).slice(0, 1));
    expect(isSessionInProgress(sessionOn(restDate!), strayLog, restDate!)).toBe(false);

    expect(isSessionInProgress({ kind: "notStarted", startsOn: "2026-11-02" }, { sessions: {} }, "2026-11-01")).toBe(false);
    expect(isSessionInProgress({ kind: "noStartDate" }, { sessions: {} }, trainingDate)).toBe(false);
    expect(isSessionInProgress({ kind: "complete" }, { sessions: {} }, "2030-01-01")).toBe(false);
  });

  it("ends 45 minutes after the most recent logged set, and a later set restarts the clock", () => {
    const session = sessionOn(trainingDate);
    const [first, second] = allSetsOf(session);
    const early = { ...first!, loggedAt: new Date("2026-11-09T18:00:00Z") };
    const late = { ...second!, loggedAt: new Date("2026-11-09T18:30:00Z") };
    const justBefore = (loggedAt: Date) => new Date(loggedAt.getTime() + SESSION_IDLE_TIMEOUT_MILLISECONDS - 1);
    const exactly = (loggedAt: Date) => new Date(loggedAt.getTime() + SESSION_IDLE_TIMEOUT_MILLISECONDS);

    expect(isSessionInProgress(session, logWith(trainingDate, [early]), trainingDate, justBefore(early.loggedAt))).toBe(true);
    expect(isSessionInProgress(session, logWith(trainingDate, [early]), trainingDate, exactly(early.loggedAt))).toBe(false);

    // The second set (30 minutes later) keeps it open past the first set's 45 minutes.
    expect(isSessionInProgress(session, logWith(trainingDate, [early, late]), trainingDate, exactly(early.loggedAt))).toBe(true);
    expect(isSessionInProgress(session, logWith(trainingDate, [early, late]), trainingDate, exactly(late.loggedAt))).toBe(false);
  });

  it("does not need the warm-up block to be logged", () => {
    const session = sessionOn(trainingDate);
    if (session.kind !== "training") throw new Error("expected a training day");
    const warmupPositions = session.blocks.flatMap((block, index) => (block.type === "warmup" ? [index + 1] : []));
    expect(warmupPositions.length).toBeGreaterThan(0);

    const withoutWarmup = allSetsOf(session).filter((set) => !warmupPositions.includes(set.blockPosition));
    expect(isSessionInProgress(session, logWith(trainingDate, withoutWarmup), trainingDate)).toBe(false);
  });

  it("is in progress after only a warm-up set is logged", () => {
    const session = sessionOn(trainingDate);
    const warmupSet = allSetsOf(session).find((set) => set.blockPosition === 1);
    expect(isSessionInProgress(session, logWith(trainingDate, [warmupSet!]), trainingDate)).toBe(true);
  });

  it("counts a heavy-bag rounds range (4-5) as complete at its low end", () => {
    const session = sessionOn(trainingDate);
    if (session.kind !== "training") throw new Error("expected a training day");
    const bagBlock = session.blocks.findIndex((block) => block.items.some((item) => item.exercise.id === "heavy_bag")) + 1;
    const bagItem = session.blocks[bagBlock - 1]!.items.find((item) => item.exercise.id === "heavy_bag")!;
    expect(bagItem.rounds).toEqual({ min: 4, max: 5 });

    const everythingButBag = allSetsOf(session).filter((set) => set.exerciseId !== "heavy_bag");
    const bagRounds = (count: number): LoggedSet[] =>
      Array.from({ length: count }, (_unused, index) => ({ exerciseId: "heavy_bag", blockPosition: bagBlock, setNumber: index + 1, loggedAt: new Date("2026-11-09T18:00:00Z") }));

    expect(isSessionInProgress(session, logWith(trainingDate, [...everythingButBag, ...bagRounds(3)]), trainingDate)).toBe(true);
    expect(isSessionInProgress(session, logWith(trainingDate, [...everythingButBag, ...bagRounds(4)]), trainingDate)).toBe(false);
  });
});
