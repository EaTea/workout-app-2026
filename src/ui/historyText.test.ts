import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parseProgram } from "../program/parse";
import type { LoggedSession, LoggedSet } from "../log/model";
import { exerciseDisplayName, formatSessionHeader, loggedSetLabel, loggedSetNoun, loggedSetShowsRepsAndLoad, performedExerciseName } from "./historyText";

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

describe("loggedSetShowsRepsAndLoad", () => {
  const session = sessionWith({ programWeek: 1, day: 1 });

  /** A logged set that carries no reps or load. */
  function bareSet(exerciseId: string, blockPosition: number): LoggedSet {
    return { exerciseId, blockPosition, setNumber: 1, loggedAt: new Date("2026-11-02T10:00:00Z") };
  }

  it("offers reps and kg for a rep item even when the set was logged without reps", () => {
    expect(loggedSetShowsRepsAndLoad(program, session, bareSet("pull_up", 3))).toBe(true);
  });

  it("offers none for heavy-bag rounds and timed holds", () => {
    expect(loggedSetShowsRepsAndLoad(program, session, bareSet("heavy_bag", 6))).toBe(false);
    expect(loggedSetShowsRepsAndLoad(program, session, bareSet("side_plank", 5))).toBe(false);
  });

  it("falls back to the stored values when the item cannot be found", () => {
    expect(loggedSetShowsRepsAndLoad(program, session, bareSet("removed_exercise", 99))).toBe(false);
    expect(loggedSetShowsRepsAndLoad(program, session, { ...bareSet("removed_exercise", 99), reps: 5 })).toBe(true);
    expect(loggedSetShowsRepsAndLoad(program, sessionWith({}), { ...bareSet("pull_up", 3), loadKg: 5 })).toBe(true);
  });
});

describe("performedExerciseName", () => {
  // Day 1's first block is the warm-up, which contains ytwi (swapped for Reverse fly in weeks 5-8).
  const warmupPosition = program.days[1]!.blocks.findIndex((block) => block.type === "warmup") + 1;
  const strengthPosition = program.days[1]!.blocks.findIndex((block) => block.type !== "warmup") + 1;

  it("shows the rotated-in name for a warm-up logged in a swapped week", () => {
    const session = sessionWith({ programWeek: 5, day: 1 });
    expect(performedExerciseName(program, session, warmupPosition, "ytwi")).toBe("Reverse fly");
  });

  it("shows the library name in an unrotated week, or for a non-warm-up block, or without a stored week", () => {
    expect(performedExerciseName(program, sessionWith({ programWeek: 2, day: 1 }), warmupPosition, "ytwi")).toBe("YTWI raises");
    expect(performedExerciseName(program, sessionWith({ programWeek: 5, day: 1 }), strengthPosition, "ytwi")).toBe("YTWI raises");
    expect(performedExerciseName(program, sessionWith({ day: 1 }), warmupPosition, "ytwi")).toBe("YTWI raises");
  });
});
