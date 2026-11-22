import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { WorkoutLog } from "../log/model";
import { applySkippedBlocks } from "../optionalBlocks/session";
import { buildSwappedSession } from "../noEquipment/session";
import { parseProgram } from "../program/parse";
import { buildSession } from "../program/schedule";
import type { TrainingSessionView } from "../program/combine";
import { questionText, skipButtonName, skippedLineText, undecidedOptionalBlocks, yesButtonName } from "./optionalBlockCards";

const program = parseProgram(JSON.parse(readFileSync("public/program.json", "utf-8"))).program;
const settings = { startDate: "2026-11-02", maxReps: { pull_up: 12, dip: 15 }, maxSavedOn: {}, maxHistory: {} };
const DATE = "2026-11-09";

/** W2 D1 with the given skipped keys applied. */
function sessionWithSkips(keys: string[]): TrainingSessionView {
  const session = applySkippedBlocks(buildSession(program, settings, DATE), new Set(keys));
  if (session.kind !== "training") throw new Error("expected training");
  return session;
}

describe("optional block card texts", () => {
  it("builds every text from the block's label as written", () => {
    expect(questionText("Boxing")).toBe("Boxing today?");
    expect(yesButtonName("Boxing")).toBe("Yes, Boxing today");
    expect(skipButtonName("Boxing")).toBe("Skip Boxing today");
    expect(skippedLineText("Boxing")).toBe("Boxing skipped today");
  });
});

describe("undecidedOptionalBlocks", () => {
  it("lists the boxing block of Day 1 with its key", () => {
    expect(undecidedOptionalBlocks(sessionWithSkips([]), { sessions: {} }, DATE)).toEqual([{ blockKey: "1:6", label: "Boxing", day: 1 }]);
  });

  it("lists nothing once the block is skipped (Add it back is the way back)", () => {
    expect(undecidedOptionalBlocks(sessionWithSkips(["1:6"]), { sessions: {} }, DATE)).toEqual([]);
  });

  it("lists nothing while the shoulder is flagged: the block's items are all left out (its own line shows instead)", () => {
    const flagged = buildSwappedSession(program, settings, { sessions: {} }, new Map(), DATE, new Set(), [{ area: "shoulder", side: "right", from: "2026-11-01" }]).session;
    if (flagged.kind !== "training") throw new Error("expected training");

    expect(undecidedOptionalBlocks(flagged, { sessions: {} }, DATE)).toEqual([]);
  });

  it("lists nothing on a day without an optional block", () => {
    const day2 = buildSession(program, settings, "2026-11-10");
    if (day2.kind !== "training") throw new Error("expected training");
    expect(undecidedOptionalBlocks(day2, { sessions: {} }, "2026-11-10")).toEqual([]);
  });

  it("lists nothing once a round of the block is logged", () => {
    const log: WorkoutLog = {
      sessions: { [DATE]: { date: DATE, day: 1, sets: [{ exerciseId: "heavy_bag", blockPosition: 6, setNumber: 1, reps: 1, loggedAt: new Date("2026-11-09T12:00:00Z") }] } },
    };
    expect(undecidedOptionalBlocks(sessionWithSkips([]), log, DATE)).toEqual([]);
  });

  it("still lists it when only sets of other blocks are logged", () => {
    const log: WorkoutLog = {
      sessions: { [DATE]: { date: DATE, day: 1, sets: [{ exerciseId: "pull_up", blockPosition: 3, setNumber: 1, reps: 5, loggedAt: new Date("2026-11-09T12:00:00Z") }] } },
    };
    expect(undecidedOptionalBlocks(sessionWithSkips([]), log, DATE)).toHaveLength(1);
  });
});
