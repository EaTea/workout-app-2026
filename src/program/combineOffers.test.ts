import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { CombinesByDate } from "../combine/model";
import type { WorkoutLog } from "../log/model";
import { activeCombineOn, activeDonorOn, combineOffersFor, donorOnDate } from "./combineOffers";
import { parseProgram } from "./parse";

/**
 * Tests for which "Add Day N" buttons Today offers (rule 2) and for donor
 * dates (rule 6), against the worked examples (start 2 Nov 2026) and the
 * rule's other conditions.
 */

const program = parseProgram(JSON.parse(readFileSync("public/program.json", "utf-8"))).program;
const steadyStrength = parseProgram(JSON.parse(readFileSync("public/steady-strength.json", "utf-8"))).program;

const START = "2026-11-02";
const NO_COMBINES: CombinesByDate = new Map();
const EMPTY_LOG: WorkoutLog = { sessions: {} };

/** A log with one logged set on each of the given dates. */
function logOn(...dates: string[]): WorkoutLog {
  const sessions: WorkoutLog["sessions"] = {};
  for (const date of dates) {
    sessions[date] = { date, sets: [{ exerciseId: "pull_up", blockPosition: 3, setNumber: 1, reps: 5, loggedAt: new Date(`${date}T10:00:00.000Z`) }] };
  }
  return { sessions };
}

/** The offers as "kind day date" text, for short assertions. */
function offers(today: string, log: WorkoutLog = EMPTY_LOG, combines: CombinesByDate = NO_COMBINES, startDate: string | null = START, forProgram = program): string[] {
  return combineOffersFor(forProgram, startDate, today, log, combines).map((offer) => `${offer.kind} ${offer.day} ${offer.date}`);
}

describe("combineOffersFor, worked examples", () => {
  it("9 Nov (W2 D1), nothing logged: Add Day 2, and no missed button", () => {
    expect(offers("2026-11-09")).toEqual(["addNext 2 2026-11-10"]);
  });

  it("gives the record to store with the offer", () => {
    expect(combineOffersFor(program, START, "2026-11-09", EMPTY_LOG, NO_COMBINES)[0]!.combine).toEqual({ hostDay: 1, addedDay: 2, addedDate: "2026-11-10" });
  });

  it("12 Nov (W2 D4), Day 3 not logged: Add missed Day 3, and no Add Day 5", () => {
    expect(offers("2026-11-12")).toEqual(["addMissed 3 2026-11-11"]);
  });

  it("14 Nov (W2 D6), Day 5 not logged: Add missed Day 5 only", () => {
    expect(offers("2026-11-14")).toEqual(["addMissed 5 2026-11-13"]);
  });

  it("shows both buttons, next first, when both apply (Day 2 or Day 3 with neighbours)", () => {
    expect(offers("2026-11-10")).toEqual(["addNext 3 2026-11-11", "addMissed 1 2026-11-09"]);
    expect(offers("2026-11-11")).toEqual(["addNext 4 2026-11-12", "addMissed 2 2026-11-10"]);
  });

  it("10 Nov after Day 1 + 2 were combined on 9 Nov: no buttons (it is a donor date)", () => {
    const combines: CombinesByDate = new Map([["2026-11-09", { hostDay: 1, addedDay: 2, addedDate: "2026-11-10" }]]);
    expect(offers("2026-11-10", EMPTY_LOG, combines)).toEqual([]);
    expect(donorOnDate(combines, "2026-11-10")).toEqual({ day: 2, hostDay: 1, hostDate: "2026-11-09" });
  });
});

describe("combineOffersFor, the other conditions", () => {
  it("offers nothing once a set is logged today", () => {
    expect(offers("2026-11-09", logOn("2026-11-09"))).toEqual([]);
  });

  it("ignores a session that exists but has no sets", () => {
    const log: WorkoutLog = { sessions: { "2026-11-09": { date: "2026-11-09", sets: [] } } };
    expect(offers("2026-11-09", log)).toEqual(["addNext 2 2026-11-10"]);
  });

  it("offers no missed day that has something logged on it", () => {
    expect(offers("2026-11-12", logOn("2026-11-11"))).toEqual([]);
  });

  it("offers nothing on the rest day", () => {
    expect(offers("2026-11-08")).toEqual([]);
  });

  it("offers no Day 6 + next week's Day 1 (the pair is not allowed, and crossing a week)", () => {
    expect(offers("2026-11-14")).not.toContain("addNext 1 2026-11-15");
    // The new week's Day 1 offers only its own Day 2: no "missed Day 6" across the week boundary.
    expect(offers("2026-11-16")).toEqual(["addNext 2 2026-11-17"]);
  });

  it("offers no Day 4 + Day 5 either way", () => {
    expect(offers("2026-11-13")).toEqual(["addNext 6 2026-11-14"]);
    expect(offers("2026-11-12").some((offer) => offer.includes(" 5 "))).toBe(false);
  });

  it("offers nothing before the start date, after week 8, or with no start date", () => {
    expect(offers("2026-11-01")).toEqual([]);
    expect(offers("2026-12-28")).toEqual([]);
    expect(offers("2026-11-09", EMPTY_LOG, NO_COMBINES, null)).toEqual([]);
  });

  it("still offers on the last training days of week 8", () => {
    expect(offers("2026-12-21")).toEqual(["addNext 2 2026-12-22"]);
  });

  it("offers nothing when today is already the host of a combine", () => {
    const combines: CombinesByDate = new Map([["2026-11-09", { hostDay: 1, addedDay: 2, addedDate: "2026-11-10" }]]);
    expect(offers("2026-11-09", EMPTY_LOG, combines)).toEqual([]);
  });

  it("does not offer a day that is already part of a combine", () => {
    const hostedElsewhere: CombinesByDate = new Map([["2026-11-11", { hostDay: 3, addedDay: 4, addedDate: "2026-11-12" }]]);
    // Day 3 (11 Nov) is a host and Day 4 (12 Nov) a donor: neither can be added to Day 2 or Day 5.
    expect(offers("2026-11-10", EMPTY_LOG, hostedElsewhere)).toEqual(["addMissed 1 2026-11-09"]);

    const donorAlready: CombinesByDate = new Map([["2026-11-09", { hostDay: 1, addedDay: 2, addedDate: "2026-11-10" }]]);
    expect(offers("2026-11-11", EMPTY_LOG, donorAlready)).toEqual(["addNext 4 2026-11-12"]);
  });

  it("offers nothing for a program without combining (Steady Strength)", () => {
    expect(offers("2026-11-09", EMPTY_LOG, NO_COMBINES, START, steadyStrength)).toEqual([]);
  });
});

describe("donorOnDate", () => {
  const combines: CombinesByDate = new Map([
    ["2026-11-09", { hostDay: 1, addedDay: 2, addedDate: "2026-11-10" }],
    ["2026-11-12", { hostDay: 4, addedDay: 3, addedDate: "2026-11-11" }],
  ]);

  it("finds the donor date of a pulled-forward day and of a caught-up day", () => {
    expect(donorOnDate(combines, "2026-11-10")).toEqual({ day: 2, hostDay: 1, hostDate: "2026-11-09" });
    expect(donorOnDate(combines, "2026-11-11")).toEqual({ day: 3, hostDay: 4, hostDate: "2026-11-12" });
  });

  it("is undefined for a host date and for a date with no combine", () => {
    expect(donorOnDate(combines, "2026-11-09")).toBeUndefined();
    expect(donorOnDate(combines, "2026-11-20")).toBeUndefined();
    expect(donorOnDate(NO_COMBINES, "2026-11-10")).toBeUndefined();
  });
});

describe("activeCombineOn and activeDonorOn (a stored combine is only used while it still fits the program)", () => {
  const combines: CombinesByDate = new Map([["2026-11-09", { hostDay: 1, addedDay: 2, addedDate: "2026-11-10" }]]);

  it("gives the combine on its host date and the donor on the added date", () => {
    expect(activeCombineOn(program, START, "2026-11-09", combines)).toEqual({ hostDay: 1, addedDay: 2, addedDate: "2026-11-10" });
    expect(activeDonorOn(program, START, "2026-11-10", combines)).toEqual({ day: 2, hostDay: 1, hostDate: "2026-11-09" });
  });

  it("gives nothing on other dates, and the host date is not a donor date", () => {
    expect(activeCombineOn(program, START, "2026-11-10", combines)).toBeUndefined();
    expect(activeDonorOn(program, START, "2026-11-09", combines)).toBeUndefined();
  });

  it("handles a missed day caught up: host Day 4 on 12 Nov, Day 3 from 11 Nov", () => {
    const missed: CombinesByDate = new Map([["2026-11-12", { hostDay: 4, addedDay: 3, addedDate: "2026-11-11" }]]);

    expect(activeCombineOn(program, START, "2026-11-12", missed)).toBeDefined();
    expect(activeDonorOn(program, START, "2026-11-11", missed)).toEqual({ day: 3, hostDay: 4, hostDate: "2026-11-12" });
  });

  it("ignores a combine when the start date moved so the host date is a different day", () => {
    expect(activeCombineOn(program, "2026-11-03", "2026-11-09", combines)).toBeUndefined();
    expect(activeDonorOn(program, "2026-11-03", "2026-11-10", combines)).toBeUndefined();
  });

  it("ignores a combine without a start date, or for a pair the program does not allow", () => {
    expect(activeCombineOn(program, null, "2026-11-09", combines)).toBeUndefined();
    expect(activeCombineOn(steadyStrength, START, "2026-11-09", combines)).toBeUndefined();
    expect(activeDonorOn(steadyStrength, START, "2026-11-10", combines)).toBeUndefined();
  });

  it("ignores a combine whose added date is not where the added day falls", () => {
    const wrongDate: CombinesByDate = new Map([["2026-11-09", { hostDay: 1, addedDay: 2, addedDate: "2026-11-17" }]]);
    expect(activeCombineOn(program, START, "2026-11-09", wrongDate)).toBeUndefined();
    expect(activeDonorOn(program, START, "2026-11-17", wrongDate)).toBeUndefined();
  });
});
