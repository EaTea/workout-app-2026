import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { Injury } from "../injury/model";
import type { WorkoutLog } from "../log/model";
import { parseProgram } from "../program/parse";
import type { TrainingSettings } from "../settings/model";
import { injuryNoteForDate, leftOutSummaryLine } from "./historyInjury";

const program = parseProgram(JSON.parse(readFileSync("public/program.json", "utf-8"))).program;
const settings: TrainingSettings = {
  startDate: "2026-11-02",
  maxReps: { pull_up: 12, dip: 15 },
  maxSavedOn: {},
  maxHistory: { pull_up: [{ savedOn: null, reps: 12 }], dip: [{ savedOn: null, reps: 15 }] },
};
const noLog: WorkoutLog = { sessions: {} };

/** Right shoulder flagged 1 Nov, cleared 10 Nov. 2 Nov is week 1 Day 1; 4 Nov is Day 3 (area-free). */
const injuries: Injury[] = [{ area: "shoulder", side: "right", from: "2026-11-01", to: "2026-11-10" }];

describe("injuryNoteForDate", () => {
  it("is undefined on a day no area was flagged (before the flag, and the clearing day)", () => {
    expect(injuryNoteForDate(program, settings, noLog, injuries, "2026-10-31")).toBeUndefined();
    expect(injuryNoteForDate(program, settings, noLog, injuries, "2026-11-10")).toBeUndefined();
    expect(injuryNoteForDate(program, settings, noLog, [], "2026-11-02")).toBeUndefined();
  });

  it("tags the side and area and names what Day 1 left out and stood in", () => {
    const note = injuryNoteForDate(program, settings, noLog, injuries, "2026-11-02");

    expect(note?.tag).toBe("Right shoulder");
    expect(note?.leftOut).toEqual(expect.arrayContaining(["Pull-ups", "Dips"]));
    expect(note?.standIns).toContain("Lying leg raise instead of Hanging leg raise");
    expect(new Set(note?.leftOut).size).toBe(note?.leftOut.length);
    expect(leftOutSummaryLine(note!)).toMatch(/^Left out: /);
  });

  it("keeps an exercise with logged sets (added back that day) out of the left-out list", () => {
    const log: WorkoutLog = {
      sessions: {
        "2026-11-02": { date: "2026-11-02", programWeek: 1, day: 1, sets: [{ exerciseId: "pull_up", blockPosition: 3, setNumber: 1, reps: 3, loggedAt: new Date("2026-11-02T18:00:00.000Z") }] },
      },
    };

    expect(injuryNoteForDate(program, settings, log, injuries, "2026-11-02")?.leftOut).not.toContain("Pull-ups");
  });

  it("joins several injuries' tags and still gives the tag when no session can be built", () => {
    const both: Injury[] = [...injuries, { area: "shoulder", side: "left", from: "2026-11-01" }];
    expect(injuryNoteForDate(program, settings, noLog, both, "2026-11-02")?.tag).toBe("Right shoulder, Left shoulder");

    const beforeStart = injuryNoteForDate(program, settings, noLog, [{ area: "shoulder", side: "right", from: "2026-09-01" }], "2026-09-15");
    expect(beforeStart).toEqual({ tag: "Right shoulder", leftOut: [], standIns: [] });
  });

  it("gives no left-out line when nothing was left out", () => {
    expect(leftOutSummaryLine({ tag: "Right shoulder", leftOut: [], standIns: [] })).toBeUndefined();
  });
});
