import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { TrainingBreak } from "../break/model";
import type { CombinesByDate } from "../combine/model";
import type { WorkoutLog } from "../log/model";
import type { TrainingSettings } from "../settings/model";
import { addDaysToDate } from "./calendar";
import { activeCombineOn, combineOffersFor } from "./combineOffers";
import { buildDayPlan, planDateFor } from "./dayPlan";
import { buildProgramOverview } from "./overview";
import { programStatus } from "./calendar";
import { parseProgram } from "./parse";
import { buildSession, retestWeekStartDate, wasMaxSavedDuringWeek, type SessionView } from "./schedule";

/**
 * Break 1 step 2: the schedule skips break days. Worked example: start
 * 2 Nov 2026, break 26 Nov to 3 Dec (7 days, `to` is the first day back).
 * The pure calendar maths is tested in calendar.test.ts; this file checks the
 * functions built on it (buildSession, the day plan, the combine offers and
 * the retest week).
 */

const program = parseProgram(JSON.parse(readFileSync("public/program.json", "utf-8"))).program;

const START = "2026-11-02";
const weekBreak: TrainingBreak = { from: "2026-11-26", to: "2026-12-03" };

const baseSettings: TrainingSettings = {
  startDate: START,
  maxReps: { pull_up: 12, dip: 15 },
  maxSavedOn: {},
  maxHistory: { pull_up: [{ savedOn: null, reps: 12 }], dip: [{ savedOn: null, reps: 15 }] },
};
const settingsWithBreak: TrainingSettings = { ...baseSettings, breaks: [weekBreak] };

describe("buildSession on a break", () => {
  it("gives an onBreak view, with the week and day training resumes on, for each date of the break", () => {
    const expected: SessionView = { kind: "onBreak", until: "2026-12-03", resumesWeek: 4, resumesDayNumber: 4 };

    expect(buildSession(program, settingsWithBreak, "2026-11-26")).toEqual(expected);
    expect(buildSession(program, settingsWithBreak, "2026-12-02")).toEqual(expected);
  });

  it("gives the day before the break and the first day back their normal sessions", () => {
    expect(buildSession(program, settingsWithBreak, "2026-11-25")).toMatchObject({ kind: "training", week: 4, dayNumber: 3 });
    expect(buildSession(program, settingsWithBreak, "2026-12-03")).toMatchObject({ kind: "training", week: 4, dayNumber: 4 });
  });

  it("gives week 5 day 1 on 7 Dec, with week 5's targets", () => {
    const afterBreak = buildSession(program, settingsWithBreak, "2026-12-07");
    const noBreakWeekFive = buildSession(program, baseSettings, "2026-11-30");

    expect(afterBreak).toMatchObject({ kind: "training", week: 5, dayNumber: 1 });
    expect(afterBreak).toEqual(noBreakWeekFive);
  });

  it("builds exactly the same sessions with breaks = [] or absent, for every date from before the start to after the end", () => {
    const withEmptyBreaks: TrainingSettings = { ...baseSettings, breaks: [] };

    for (let offset = -2; offset <= 60; offset++) {
      const date = addDaysToDate(START, offset);

      expect(buildSession(program, withEmptyBreaks, date)).toEqual(buildSession(program, baseSettings, date));
    }
  });
});

describe("the retest week with a break", () => {
  it("starts week 8 on 28 Dec (not 21 Dec) and counts a max saved from then to Day 7 (3 Jan) as retested", () => {
    expect(retestWeekStartDate(program, settingsWithBreak, "2026-12-28")).toBe("2026-12-28");
    expect(retestWeekStartDate(program, baseSettings, "2026-12-21")).toBe("2026-12-21");

    const savedOn = (date: string): TrainingSettings => ({ ...settingsWithBreak, maxSavedOn: { pull_up: date } });

    expect(wasMaxSavedDuringWeek(savedOn("2026-12-27"), "pull_up", "2026-12-28", "2027-01-03")).toBe(false);
    expect(wasMaxSavedDuringWeek(savedOn("2026-12-28"), "pull_up", "2026-12-28", "2027-01-03")).toBe(true);
    expect(wasMaxSavedDuringWeek(savedOn("2027-01-03"), "pull_up", "2026-12-28", "2027-01-03")).toBe(true);
    expect(wasMaxSavedDuringWeek(savedOn("2027-01-04"), "pull_up", "2026-12-28", "2027-01-03")).toBe(false);
  });

  it("uses the schedule's week 8 window when building the session (a save on 21 Dec is not a retest with the break)", () => {
    const savedOn21Dec: TrainingSettings = {
      ...settingsWithBreak,
      maxReps: { pull_up: 15, dip: 15 },
      maxSavedOn: { pull_up: "2026-12-21" },
      maxHistory: { pull_up: [{ savedOn: "2026-12-21", reps: 15 }], dip: [{ savedOn: null, reps: 15 }] },
    };
    const week8Day1 = buildSession(program, savedOn21Dec, "2026-12-28");
    if (week8Day1.kind !== "training") throw new Error("expected a training day");
    const pullUp = week8Day1.blocks.flatMap((block) => block.items).find((entry) => entry.exercise.id === "pull_up");

    expect(pullUp?.target).toMatchObject({ basis: { awaitingRetest: true } });
  });
});

describe("planDateFor and buildDayPlan with breaks", () => {
  it("returns the date the schedule really puts the day on", () => {
    expect(planDateFor(START, [weekBreak], 4, 3)).toBe("2026-11-25");
    expect(planDateFor(START, [weekBreak], 4, 4)).toBe("2026-12-03");
    expect(planDateFor(START, [weekBreak], 5, 1)).toBe("2026-12-07");
    expect(planDateFor(START, [], 5, 1)).toBe("2026-11-30");
  });

  it("builds the plan for a day after the break as that week and day, never an onBreak view", () => {
    expect(buildDayPlan(program, settingsWithBreak, 4, 4, "2026-11-11")).toMatchObject({ kind: "training", week: 4, dayNumber: 4 });
    expect(buildDayPlan(program, settingsWithBreak, 5, 1, "2026-11-11")).toMatchObject({ kind: "training", week: 5, dayNumber: 1 });
  });
});

describe("combine offers with breaks", () => {
  const EMPTY_LOG: WorkoutLog = { sessions: {} };
  const NO_COMBINES: CombinesByDate = new Map();

  it("offers nothing on a break day", () => {
    expect(combineOffersFor(program, START, [weekBreak], "2026-11-27", EMPTY_LOG, NO_COMBINES, "2026-11-27")).toEqual([]);
  });

  it("does not offer tomorrow's day when tomorrow starts a break (23 Nov, W4 D1, day 2 would be 24 Nov)", () => {
    const breakFromTomorrow: TrainingBreak = { from: "2026-11-24", to: "2026-12-01" };
    const withoutBreak = combineOffersFor(program, START, [], "2026-11-23", EMPTY_LOG, NO_COMBINES, "2026-11-23");
    const withBreak = combineOffersFor(program, START, [breakFromTomorrow], "2026-11-23", EMPTY_LOG, NO_COMBINES, "2026-11-23");

    expect(withoutBreak.map((offer) => offer.kind)).toContain("addNext");
    expect(withBreak).toEqual([]);
  });

  it("gives the same offers with no breaks as before", () => {
    expect(combineOffersFor(program, START, [], "2026-11-09", EMPTY_LOG, NO_COMBINES, "2026-11-09").map((offer) => offer.kind)).toEqual(["addNext"]);
  });

  it("finds a combine by the day the schedule puts it on (7 Dec is W5 D1 after the break)", () => {
    const combines: CombinesByDate = new Map([["2026-12-07", { hostDay: 1, addedDay: 2, addedDate: "2026-12-08" }]]);

    expect(activeCombineOn(program, START, [weekBreak], "2026-12-07", combines, EMPTY_LOG, "2026-12-07")).toBeDefined();

    // Without the break 30 Nov is W5 D1; with it, 30 Nov is a break day and has no active combine.
    const oldHost: CombinesByDate = new Map([["2026-11-30", { hostDay: 1, addedDay: 2, addedDate: "2026-12-01" }]]);

    expect(activeCombineOn(program, START, [], "2026-11-30", oldHost, EMPTY_LOG, "2026-11-30")).toBeDefined();
    expect(activeCombineOn(program, START, [weekBreak], "2026-11-30", oldHost, EMPTY_LOG, "2026-11-30")).toBeUndefined();
  });
});

describe("buildProgramOverview on a break", () => {
  it("still leads to Today, naming the break", () => {
    const status = programStatus(START, 8, "2026-11-27", [weekBreak]);
    const overview = buildProgramOverview(program, status);

    expect(overview.callToAction).toMatchObject({ kind: "goToToday", label: "Go to today: On a break", week: 4, dayNumber: 4 });
  });
});
