import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { ProgramStatus } from "./calendar";
import { programStatus } from "./calendar";
import type { Program } from "./model";
import { buildProgramOverview } from "./overview";
import { parseProgram } from "./parse";

const program = parseProgram(JSON.parse(readFileSync("public/program.json", "utf-8"))).program;

const noStartDate: ProgramStatus = { kind: "noStartDate" };

describe("buildProgramOverview: headline numbers", () => {
  it("summarises the shipped program", () => {
    const overview = buildProgramOverview(program, noStartDate);

    expect(overview.name).toBe(program.name);
    expect(overview.goal).toBe(program.goal);
    expect(overview.lengthWeeks).toBe(8);
    expect(overview.trainingDaysPerWeek).toBe(6);
    expect(overview.weeklyMinutes).toBe(242); // 50+30+40+30+50+42
    expect(overview.sessionOrder).toEqual(program.sessionOrder);
    expect(overview.currentWeek).toBeUndefined();
  });
});

describe("buildProgramOverview: phases", () => {
  it("lists the four phases in order with weeks and changes", () => {
    const phases = buildProgramOverview(program, noStartDate).phases;

    expect(phases.map((phase) => [phase.name, phase.firstWeek, phase.lastWeek])).toEqual([
      ["Base", 1, 3],
      ["Deload", 4, 4],
      ["Power endurance", 5, 7],
      ["Deload + retest", 8, 8],
    ]);
    expect(phases[0]!.weeks).toEqual([1, 2, 3]);
    expect(phases[0]!.changes).toEqual(["Add 1 rep per set or per EMOM minute each week"]);
    expect(phases[1]!.changes).toEqual(["Halve all sets", "Keep intensity", "Keep explosive reps fast"]);
    expect(phases[2]!.changes[0]).toMatch(/^Cut explosive rest by 15s/);
    expect(phases[3]!.changes).toEqual(["Halve all sets", "Retest max pull-ups and dips", "Reset EMOM targets from the new maxes"]);
    expect(phases.every((phase) => !phase.isCurrent)).toBe(true);
  });

  it("marks the current week and phase when active", () => {
    const status = programStatus("2026-11-02", 8, "2026-11-09");
    const overview = buildProgramOverview(program, status);

    expect(overview.currentWeek).toBe(2);
    expect(overview.phases.map((phase) => phase.isCurrent)).toEqual([true, false, false, false]);
  });

  it("marks a later phase current in week 8", () => {
    const overview = buildProgramOverview(program, { kind: "active", week: 8, dayNumber: 1 });

    expect(overview.phases.map((phase) => phase.isCurrent)).toEqual([false, false, false, true]);
  });
});

describe("buildProgramOverview: days", () => {
  it("returns days 1 to 7 in order with day 7 as rest", () => {
    const days = buildProgramOverview(program, noStartDate).days;

    expect(days.map((day) => day.dayNumber)).toEqual([1, 2, 3, 4, 5, 6, 7]);
    expect(days.map((day) => day.kind)).toEqual(["training", "training", "training", "training", "training", "training", "rest"]);
  });

  it("gives day 1 its focus, minutes and key exercises", () => {
    const dayOne = buildProgramOverview(program, noStartDate).days[0];

    expect(dayOne).toEqual({
      kind: "training",
      dayNumber: 1,
      focus: "Upper: pull",
      targetMinutes: 50,
      keyExercises: ["Med ball slams", "Pull-ups"],
    });
  });
});

describe("buildProgramOverview: call to action", () => {
  it("offers to start Day 1 when there is no start date", () => {
    expect(buildProgramOverview(program, noStartDate).callToAction).toEqual({
      kind: "startToday",
      label: "Start Day 1: Upper: pull",
      dayOne: { focus: "Upper: pull" },
    });
  });

  it("offers a preview before the start date", () => {
    const status = programStatus("2026-11-02", 8, "2026-11-01");

    expect(buildProgramOverview(program, status).callToAction).toEqual({
      kind: "previewFirstDay",
      label: "Preview Day 1",
      startsOn: "2026-11-02",
    });
  });

  it("goes to today on week 2 day 1", () => {
    const status = programStatus("2026-11-02", 8, "2026-11-09");

    expect(buildProgramOverview(program, status).callToAction).toEqual({
      kind: "goToToday",
      label: "Go to today: Week 2 · Day 1",
      week: 2,
      dayNumber: 1,
    });
  });

  it("says rest day on the rest day", () => {
    const status = programStatus("2026-11-02", 8, "2026-11-08");

    expect(buildProgramOverview(program, status).callToAction.label).toBe("Go to today: Rest day");
  });

  it("offers a new start date once complete", () => {
    const status = programStatus("2026-11-02", 8, "2027-01-04");

    expect(buildProgramOverview(program, status).callToAction).toEqual({
      kind: "setNewStartDate",
      label: "Set a new start date",
    });
  });
});

describe("buildProgramOverview: nothing is hard-coded", () => {
  /** A small program: rest on day 1, no entry for day 4, day 2 has no explosive block, one empty-changes phase. */
  const smallProgram: Program = {
    ...program,
    name: "Tiny",
    goal: "Test",
    lengthWeeks: 2,
    restDay: 1,
    sessionOrder: ["mainStrength", "core"],
    days: {
      1: program.days[1],
      2: { day: 2, focus: "Solo", targetMinutes: 20, blocks: program.days[1]!.blocks.filter((block) => block.type === "mainStrength") },
      3: { day: 3, focus: "Other", targetMinutes: 15, blocks: [] },
    },
    progression: [{ weeks: [1, 2], phase: "Only", changes: [], retest: false }],
  };

  it("derives rest days, totals, key exercises and the start label from the program", () => {
    const overview = buildProgramOverview(smallProgram, noStartDate);

    expect(overview.name).toBe("Tiny");
    expect(overview.lengthWeeks).toBe(2);
    expect(overview.trainingDaysPerWeek).toBe(2);
    expect(overview.weeklyMinutes).toBe(35);
    expect(overview.sessionOrder).toEqual(["mainStrength", "core"]);
    expect(overview.days.map((day) => day.kind)).toEqual(["rest", "training", "training", "rest", "rest", "rest", "rest"]);
    expect(overview.days[1]).toMatchObject({ keyExercises: ["Pull-ups"] });
    expect(overview.days[2]).toMatchObject({ keyExercises: [] });
    expect(overview.phases).toEqual([
      { name: "Only", weeks: [1, 2], firstWeek: 1, lastWeek: 2, changes: [], isCurrent: false },
    ]);
    // Day 1 is this program's rest day, so the button must not promise Day 2.
    expect(overview.callToAction).toEqual({ kind: "startToday", label: "Start the program" });
  });

  it("labels the program's own rest day, and a missing day, as rest", () => {
    expect(buildProgramOverview(smallProgram, { kind: "active", week: 1, dayNumber: 1 }).callToAction.label).toBe("Go to today: Rest day");
    expect(buildProgramOverview(smallProgram, { kind: "active", week: 1, dayNumber: 4 }).callToAction.label).toBe("Go to today: Rest day");
    expect(buildProgramOverview(smallProgram, { kind: "active", week: 1, dayNumber: 2 }).callToAction.label).toBe("Go to today: Week 1 · Day 2");
  });
});

describe("buildProgramOverview: Steady Strength key exercises", () => {
  const steadyStrength = parseProgram(JSON.parse(readFileSync("public/steady-strength.json", "utf-8"))).program;

  it("lists the first isometric hold and the first strength exercise on days with those blocks, and none on walk days", () => {
    const rows = buildProgramOverview(steadyStrength, noStartDate).days;
    const keyExercisesOf = (dayNumber: number) => {
      const row = rows.find((candidate) => candidate.dayNumber === dayNumber);
      return row?.kind === "training" ? row.keyExercises : undefined;
    };

    expect(keyExercisesOf(1)).toEqual(["High wall sit", "Sit-to-stand from a chair"]);
    expect(keyExercisesOf(2)).toEqual([]);
    expect(keyExercisesOf(3)).toEqual(["Wall push hold", "Band row"]);
    expect(keyExercisesOf(4)).toEqual([]);
    expect(keyExercisesOf(5)).toEqual(["Counter plank", "Stair step-up"]);
    expect(keyExercisesOf(6)).toEqual([]);
  });
});

describe("buildProgramOverview: safety notes", () => {
  const steadyStrength = parseProgram(JSON.parse(readFileSync("public/steady-strength.json", "utf-8"))).program;

  it("carries all of Steady Strength's safety notes, in order, for the Before you start card", () => {
    const overview = buildProgramOverview(steadyStrength, noStartDate);

    expect(overview.safetyNotes).toEqual(steadyStrength.safety);
    expect(overview.safetyNotes).toHaveLength(5);
    expect(overview.safetyNotes[0]).toMatch(/^This is not medical advice\./);
  });

  it("has no safety notes (so no card) for Explosive Endurance", () => {
    expect(buildProgramOverview(program, noStartDate).safetyNotes).toEqual([]);
  });

  it("shows the notes in every status, not only before starting", () => {
    const active: ProgramStatus = { kind: "active", week: 2, dayNumber: 3 };

    expect(buildProgramOverview(steadyStrength, active).safetyNotes).toHaveLength(5);
  });
});

describe("buildProgramOverview: key exercises of alternating items", () => {
  it("lists every item of a block whose items carry weeks (Day 3 explosive)", () => {
    const dayThree = buildProgramOverview(program, noStartDate).days.find((day) => day.dayNumber === 3);
    if (dayThree?.kind !== "training") throw new Error("expected Day 3 to be a training day");

    expect(dayThree.keyExercises[0]).toBe("Plyo push-ups / Rotational med ball wall throws");
  });

  it("keeps just the first item for blocks whose items run every week", () => {
    const dayOne = buildProgramOverview(program, noStartDate).days.find((day) => day.dayNumber === 1);
    if (dayOne?.kind !== "training") throw new Error("expected Day 1 to be a training day");

    expect(dayOne.keyExercises.every((name) => !name.includes(" / "))).toBe(true);
  });
});
