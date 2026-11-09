import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parseProgram } from "../program/parse";
import { buildSession, type SessionView } from "../program/schedule";
import type { TrainingSettings } from "../settings/model";
import { countSetsForItem } from "./itemSets";
import type { LoggedSet, WorkoutLog } from "./model";
import { isSessionInProgress } from "./sessionProgress";

const program = parseProgram(JSON.parse(readFileSync("public/program.json", "utf-8"))).program;
const settings: TrainingSettings = { startDate: "2026-11-02", maxReps: { pull_up: 12, dip: 15 }, maxSavedOn: {} };

/** A training day (W2 D1) used by most tests. */
const trainingDate = "2026-11-09";

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
    expect(isSessionInProgress(session, logWith(trainingDate, sets.slice(0, -1)), trainingDate)).toBe(true);
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
});
