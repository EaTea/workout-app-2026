import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { WorkoutLog } from "../log/model";
import { isSessionInProgress } from "../log/sessionProgress";
import { parseProgram } from "../program/parse";
import { buildSession } from "../program/schedule";
import type { TrainingSettings } from "../settings/model";
import type { NoEquipmentTicks } from "./model";
import { buildSwappedSession } from "./session";

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
