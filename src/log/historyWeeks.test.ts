import { describe, expect, it } from "vitest";
import { groupDatesIntoWeeks } from "./historyWeeks";
import type { LoggedSession, LoggedSet, WorkoutLog } from "./model";

/** A minimal logged set; these tests only care that a session has one. */
function makeSet(): LoggedSet {
  return { exerciseId: "dip", blockPosition: 1, setNumber: 1, reps: 6, loggedAt: new Date("2026-11-02T10:00:00Z") };
}

/** A session with one logged set and, optionally, a stored program week. */
function makeSession(date: string, programWeek?: number): LoggedSession {
  const session: LoggedSession = { date, sets: [makeSet()] };
  if (programWeek !== undefined) {
    session.programWeek = programWeek;
  }
  return session;
}

/** Builds a log from sessions, keyed by their dates. */
function makeLog(...sessions: LoggedSession[]): WorkoutLog {
  const log: WorkoutLog = { sessions: {} };
  for (const session of sessions) {
    log.sessions[session.date] = session;
  }
  return log;
}

/** Shortens expectations: just the dates of each week. */
function weekDates(log: WorkoutLog): string[][] {
  return groupDatesIntoWeeks(log).map((week) => week.dates);
}

describe("groupDatesIntoWeeks", () => {
  it("returns no weeks for an empty log", () => {
    expect(groupDatesIntoWeeks(makeLog())).toEqual([]);
  });

  it("puts sessions of one stored week into one group, newest first", () => {
    const log = makeLog(makeSession("2026-11-16", 3), makeSession("2026-11-18", 3), makeSession("2026-11-17", 3));

    expect(weekDates(log)).toEqual([["2026-11-18", "2026-11-17", "2026-11-16"]]);
  });

  it("starts a new group when the stored week changes", () => {
    const log = makeLog(
      makeSession("2026-11-18", 3),
      makeSession("2026-11-16", 3),
      makeSession("2026-11-11", 2),
      makeSession("2026-11-09", 2),
      makeSession("2026-11-04", 1),
    );

    expect(weekDates(log)).toEqual([["2026-11-18", "2026-11-16"], ["2026-11-11", "2026-11-09"], ["2026-11-04"]]);
  });

  it("keeps a restart at week 1 apart from an earlier week 1 (7-day rule)", () => {
    const log = makeLog(makeSession("2026-11-18", 1), makeSession("2026-11-16", 1), makeSession("2026-09-02", 1), makeSession("2026-09-01", 1));

    expect(weekDates(log)).toEqual([["2026-11-18", "2026-11-16"], ["2026-09-02", "2026-09-01"]]);
  });

  it("groups sessions with no stored week together, at most 7 days apart", () => {
    const log = makeLog(makeSession("2026-11-18"), makeSession("2026-11-15"), makeSession("2026-11-12"), makeSession("2026-11-11"));

    // 18th to 12th is 6 days (together); 11th is 7 days before the 18th (new group).
    expect(weekDates(log)).toEqual([["2026-11-18", "2026-11-15", "2026-11-12"], ["2026-11-11"]]);
  });

  it("treats a missing stored week as different from a stored week", () => {
    const log = makeLog(makeSession("2026-11-18", 3), makeSession("2026-11-17"));

    expect(weekDates(log)).toEqual([["2026-11-18"], ["2026-11-17"]]);
  });

  it("splits a gap of 7 or more days inside the same stored week", () => {
    const log = makeLog(makeSession("2026-11-18", 2), makeSession("2026-11-11", 2));

    expect(weekDates(log)).toEqual([["2026-11-18"], ["2026-11-11"]]);
  });

  it("keeps dates exactly 6 days apart together", () => {
    const log = makeLog(makeSession("2026-11-18", 2), makeSession("2026-11-12", 2));

    expect(weekDates(log)).toEqual([["2026-11-18", "2026-11-12"]]);
  });

  it("measures the 7 days from the newest date of the group, not the previous date", () => {
    // Each step is 4 days, but the third date is 8 days before the newest.
    const log = makeLog(makeSession("2026-11-18", 2), makeSession("2026-11-14", 2), makeSession("2026-11-10", 2));

    expect(weekDates(log)).toEqual([["2026-11-18", "2026-11-14"], ["2026-11-10"]]);
  });

  it("counts days correctly across a daylight saving change", () => {
    // 2026-10-25 is the end of European summer time: 7 days apart, not 6.96.
    const log = makeLog(makeSession("2026-10-28", 2), makeSession("2026-10-21", 2));

    expect(weekDates(log)).toEqual([["2026-10-28"], ["2026-10-21"]]);
  });

  it("leaves out days that only have skipped sets", () => {
    const skipOnlySession: LoggedSession = {
      date: "2026-11-17",
      programWeek: 3,
      sets: [],
      skippedSets: [{ exerciseId: "dip", blockPosition: 1, setNumber: 1 }],
    };
    const log = makeLog(makeSession("2026-11-18", 3), skipOnlySession, makeSession("2026-11-16", 3));

    expect(weekDates(log)).toEqual([["2026-11-18", "2026-11-16"]]);
  });

  it("returns no weeks when every session is skip-only", () => {
    const log = makeLog({ date: "2026-11-17", sets: [], skippedSets: [] });

    expect(groupDatesIntoWeeks(log)).toEqual([]);
  });

  describe("with breaks", () => {
    // Start 2 Nov; break 26 Nov to 3 Dec (3 Dec is the first day back, week 4 day 4).
    const weekBreak = [{ from: "2026-11-26", to: "2026-12-03" }];

    it("keeps a week with a break inside it as one group (25 Nov W4 D3 and 3 Dec W4 D4)", () => {
      const log = makeLog(makeSession("2026-12-03", 4), makeSession("2026-11-25", 4));

      expect(groupDatesIntoWeeks(log, weekBreak).map((week) => week.dates)).toEqual([["2026-12-03", "2026-11-25"]]);
    });

    it("splits the same two dates without the break (8 days apart)", () => {
      const log = makeLog(makeSession("2026-12-03", 4), makeSession("2026-11-25", 4));

      expect(weekDates(log)).toEqual([["2026-12-03"], ["2026-11-25"]]);
    });

    it("still splits when the stored week changes across a break", () => {
      const log = makeLog(makeSession("2026-12-07", 5), makeSession("2026-11-25", 4));

      expect(groupDatesIntoWeeks(log, weekBreak).map((week) => week.dates)).toEqual([["2026-12-07"], ["2026-11-25"]]);
    });

    it("still splits two same-week sessions 7 program days apart even with a break elsewhere", () => {
      const log = makeLog(makeSession("2026-11-20", 1), makeSession("2026-11-10", 1));

      expect(groupDatesIntoWeeks(log, weekBreak).map((week) => week.dates)).toEqual([["2026-11-20"], ["2026-11-10"]]);
    });
  });
});
