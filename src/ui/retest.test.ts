import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parseProgram } from "../program/parse";
import type { TrainingSettings } from "../settings/model";
import { applyRetestMax, retestDismissedFromWire, retestDismissedToWire, retestExercisesToSave } from "./retest";

const program = parseProgram(JSON.parse(readFileSync("public/program.json", "utf-8"))).program;

// Start 2 Nov: week 7 Day 1 is 14 Dec, week 8 Day 1 is 21 Dec.
const settings: TrainingSettings = { startDate: "2026-11-02", maxReps: { pull_up: 12, dip: 15 }, maxSavedOn: {}, maxHistory: {} };

/** Ids of the exercises the card would ask for. */
function idsToSave(overrides: Partial<TrainingSettings>, date: string, dismissedDate?: string): string[] {
  return retestExercisesToSave(program, { ...settings, ...overrides }, date, dismissedDate).map((exercise) => exercise.id);
}

describe("retestExercisesToSave", () => {
  it("asks for both maxes on week 8 Day 1", () => {
    expect(idsToSave({}, "2026-12-21")).toEqual(["pull_up", "dip"]);
  });

  it("asks for nothing in week 7", () => {
    expect(idsToSave({}, "2026-12-14")).toEqual([]);
  });

  it("asks for nothing before the program starts or without a start date", () => {
    expect(idsToSave({}, "2026-10-01")).toEqual([]);
    expect(idsToSave({ startDate: null }, "2026-12-21")).toEqual([]);
  });

  it("only asks for the exercise not yet saved on or after week 8 Day 1", () => {
    expect(idsToSave({ maxSavedOn: { pull_up: "2026-12-21" }, maxHistory: {} }, "2026-12-22")).toEqual(["dip"]);
  });

  it("asks for nothing once both are saved during week 8", () => {
    expect(idsToSave({ maxSavedOn: { pull_up: "2026-12-21", dip: "2026-12-23" }, maxHistory: {} }, "2026-12-24")).toEqual([]);
  });

  it("does not count a max saved before week 8 Day 1", () => {
    expect(idsToSave({ maxSavedOn: { pull_up: "2026-12-20", dip: "2026-12-14" }, maxHistory: {} }, "2026-12-21")).toEqual(["pull_up", "dip"]);
  });

  it("does not count a max saved after week 8 Day 7, so the card still asks", () => {
    expect(idsToSave({ maxSavedOn: { pull_up: "2026-12-28" }, maxHistory: {} }, "2026-12-21")).toEqual(["pull_up", "dip"]);
    expect(idsToSave({ maxSavedOn: { pull_up: "2026-12-27" }, maxHistory: {} }, "2026-12-21")).toEqual(["dip"]);
  });

  it("is hidden on the dismissed date and back on another", () => {
    expect(idsToSave({}, "2026-12-21", "2026-12-21")).toEqual([]);
    expect(idsToSave({}, "2026-12-22", "2026-12-21")).toEqual(["pull_up", "dip"]);
  });
});

describe("retest dismissal mapping", () => {
  it("round-trips a date", () => {
    expect(retestDismissedFromWire(retestDismissedToWire("2026-12-21"))).toBe("2026-12-21");
  });

  it("ignores missing or corrupt stored text", () => {
    expect(retestDismissedFromWire(null)).toBeUndefined();
    expect(retestDismissedFromWire("yesterday")).toBeUndefined();
    expect(retestDismissedFromWire("2026-02-30")).toBeUndefined();
  });
});

describe("applyRetestMax", () => {
  it("changes only the one max and its date, keeping everything else from the fresh settings", () => {
    const fresh: TrainingSettings = { startDate: "2026-11-09", maxReps: { pull_up: 12, dip: 18 }, maxSavedOn: { dip: "2026-12-29" }, maxHistory: {} };
    expect(applyRetestMax(fresh, "pull_up", 14, "2026-12-30")).toEqual({
      startDate: "2026-11-09",
      maxReps: { pull_up: 14, dip: 18 },
      maxSavedOn: { dip: "2026-12-29", pull_up: "2026-12-30" },
      maxHistory: {
        pull_up: [{ savedOn: "2026-12-30", reps: 14 }],
        dip: [{ savedOn: "2026-12-29", reps: 18 }],
      },
    });
  });

  it("appends to the max's history, and replaces an entry already dated today", () => {
    const fresh: TrainingSettings = {
      startDate: "2026-11-02",
      maxReps: { pull_up: 12 },
      maxSavedOn: { pull_up: "2026-11-02" },
      maxHistory: { pull_up: [{ savedOn: "2026-11-02", reps: 12 }] },
    };
    const first = applyRetestMax(fresh, "pull_up", 15, "2026-12-21");
    expect(first.maxHistory.pull_up).toEqual([{ savedOn: "2026-11-02", reps: 12 }, { savedOn: "2026-12-21", reps: 15 }]);

    const corrected = applyRetestMax(first, "pull_up", 16, "2026-12-21");
    expect(corrected.maxHistory.pull_up).toEqual([{ savedOn: "2026-11-02", reps: 12 }, { savedOn: "2026-12-21", reps: 16 }]);
    expect(corrected.maxReps.pull_up).toBe(16);
  });

  it("stamps the date even when the number is unchanged", () => {
    expect(applyRetestMax(settings, "dip", 15, "2026-12-21").maxSavedOn).toEqual({ dip: "2026-12-21" });
  });
});
