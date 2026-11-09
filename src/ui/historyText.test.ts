import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parseProgram } from "../program/parse";
import type { LoggedSession } from "../log/model";
import { exerciseDisplayName, formatSessionHeader, loggedSetLabel, loggedSetNoun } from "./historyText";

const program = parseProgram(JSON.parse(readFileSync("public/program.json", "utf-8"))).program;

/** A session with the given context and no sets (the helpers never read the sets). */
function sessionWith(context: Partial<LoggedSession>): LoggedSession {
  return { date: "2026-11-09", sets: [], ...context };
}

describe("formatSessionHeader", () => {
  it("shows date, week, day and the day's title", () => {
    expect(formatSessionHeader(sessionWith({ programWeek: 2, day: 1 }), program)).toBe("9 Nov · Week 2 · Day 1 · Upper: pull");
  });

  it("leaves out week and day when they were not stored", () => {
    expect(formatSessionHeader(sessionWith({}), program)).toBe("9 Nov");
  });

  it("leaves out the title for a day the program does not have", () => {
    expect(formatSessionHeader(sessionWith({ programWeek: 2, day: 7 }), program)).toBe("9 Nov · Week 2 · Day 7");
    expect(formatSessionHeader(sessionWith({ day: 9 }), program)).toBe("9 Nov · Day 9");
  });
});

describe("exerciseDisplayName", () => {
  it("uses the library name, or the raw id when the exercise is gone", () => {
    expect(exerciseDisplayName(program, "pull_up")).toBe("Pull-ups");
    expect(exerciseDisplayName(program, "removed_exercise")).toBe("removed_exercise");
  });
});

describe("loggedSetNoun and loggedSetLabel", () => {
  it("fall back to set / Set when the program no longer describes the exercise", () => {
    const session = sessionWith({ programWeek: 1, day: 1 });
    expect(loggedSetNoun(program, session, 99, "removed_exercise")).toBe("set");
    expect(loggedSetLabel(program, session, 99, "removed_exercise")).toBe("Set");
    expect(loggedSetNoun(program, sessionWith({}), 2, "med_ball_slam")).toBe("set");
  });

  it("read the item's format when it is found", () => {
    const session = sessionWith({ programWeek: 1, day: 1 });
    // Day 1 block 2 is med ball slams (straight sets).
    expect(loggedSetNoun(program, session, 2, "med_ball_slam")).toBe("set");
    expect(loggedSetLabel(program, session, 2, "med_ball_slam")).toBe("Set");
  });
});
