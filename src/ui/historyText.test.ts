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

describe("helpers for a set on a different day than its session", () => {
  const session = sessionWith({ programWeek: 1, day: 1 });

  it("look the block up under the set's own day, defaulting to the session's day", () => {
    // Day 1 and day 5 both end with the heavy bag in block 6; day 2 has no block 6.
    expect(loggedSetNoun(program, session, 6, "heavy_bag")).toBe("round");
    expect(loggedSetNoun(program, session, 6, "heavy_bag", 2)).toBe("set");
    expect(loggedSetLabel(program, session, 6, "heavy_bag", 5)).toBe("Round");
    // Day 2 block 2 is split-squat jumps, which day 1's block 2 (slams) does not contain.
    expect(loggedSetNoun(program, session, 2, "split_squat_jump")).toBe("set");
    // A day-2 session holds a set of day 5's heavy bag: only the set's own day (5) gives "Round"; the session's day 2 would give "Set".
    expect(loggedSetLabel(program, sessionWith({ programWeek: 1, day: 2 }), 6, "heavy_bag", 5)).toBe("Round");
  });

  it("shows reps and kg by the set's own day", () => {
    const day2Session = sessionWith({ programWeek: 1, day: 2 });
    const loggedAt = new Date("2026-11-02T10:00:00Z");

    // Day 1 block 3 is pull-ups (reps). Under the session's day 2, block 3 holds no pull-up, so it would fall back to the stored values (none) and say false.
    const pullUpOnDay1: LoggedSet = { exerciseId: "pull_up", day: 1, blockPosition: 3, setNumber: 1, loggedAt };
    expect(loggedSetShowsRepsAndLoad(program, day2Session, pullUpOnDay1)).toBe(true);

    // Day 5 block 6 is the heavy bag (no reps). Under the session's day 2 there is no block 6, so the stored reps would say true.
    const heavyBagOnDay5: LoggedSet = { exerciseId: "heavy_bag", day: 5, blockPosition: 6, setNumber: 1, reps: 5, loggedAt };
    expect(loggedSetShowsRepsAndLoad(program, day2Session, heavyBagOnDay5)).toBe(false);
  });

  it("names a warm-up by the set's own day for rotation", () => {
    // Block 1 is the warm-up on days 1-6, where ytwi is swapped for Reverse fly in week 5. Day 7 has no training,
    // so a set on day 7 is not a warm-up and keeps the library name. Same session, same block, name decided by the set's day.
    const week5 = sessionWith({ programWeek: 5, day: 1 });
    expect(performedExerciseName(program, week5, 1, "ytwi")).toBe("Reverse fly");
    expect(performedExerciseName(program, week5, 1, "ytwi", 1)).toBe("Reverse fly");
    expect(performedExerciseName(program, week5, 1, "ytwi", 7)).toBe("YTWI raises");

    // And the other way round: a session on day 7 holding a day-1 warm-up set is still rotated.
    expect(performedExerciseName(program, sessionWith({ programWeek: 5, day: 7 }), 1, "ytwi", 1)).toBe("Reverse fly");
  });
});
