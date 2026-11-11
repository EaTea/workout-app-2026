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
    expect(overview.weeklyMinutes).toBe(234) // 50+30+32+30+50+42; PLAN.md says 242, which does not add up;
    expect(overview.sessionOrder).toEqual(program.sessionOrder);
    expect(overview.currentWeek).toBeUndefined();
  });
});

describe("buildProgramOverview: phases", () => {
  it("lists the four phases in order with weeks and summaries", () => {
    const phases = buildProgramOverview(program, noStartDate).phases;

    expect(phases.map((phase) => [phase.name, phase.firstWeek, phase.lastWeek])).toEqual([
      ["Base", 1, 3],
      ["Deload", 4, 4],
      ["Power endurance", 5, 7],
      ["Deload + retest", 8, 8],
    ]);
    expect(phases[0]!.weeks).toEqual([1, 2, 3]);
    expect(phases[0]!.summary).toBe("Add 1 rep per set or per EMOM minute each week");
    expect(phases[1]!.summary).toBe("Halve all sets");
    expect(phases[2]!.summary).toMatch(/^Cut explosive rest by 15s/);
    expect(phases[3]!.summary).toBe("Halve all sets");
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
  it("offers to start the first training day when there is no start date", () => {
    expect(buildProgramOverview(program, noStartDate).callToAction).toEqual({
      kind: "startToday",
      label: "Start Day 1: Upper: pull",
      firstDay: { dayNumber: 1, focus: "Upper: pull" },
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

  it("derives rest days, totals, key exercises and the first day from the program", () => {
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
      { name: "Only", weeks: [1, 2], firstWeek: 1, lastWeek: 2, summary: "", isCurrent: false },
    ]);
    expect(overview.callToAction).toMatchObject({ label: "Start Day 2: Solo", firstDay: { dayNumber: 2, focus: "Solo" } });
  });

  it("labels the program's own rest day, and a missing day, as rest", () => {
    expect(buildProgramOverview(smallProgram, { kind: "active", week: 1, dayNumber: 1 }).callToAction.label).toBe("Go to today: Rest day");
    expect(buildProgramOverview(smallProgram, { kind: "active", week: 1, dayNumber: 4 }).callToAction.label).toBe("Go to today: Rest day");
    expect(buildProgramOverview(smallProgram, { kind: "active", week: 1, dayNumber: 2 }).callToAction.label).toBe("Go to today: Week 1 · Day 2");
  });
});
