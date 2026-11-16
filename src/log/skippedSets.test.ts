import { describe, expect, it } from "vitest";
import type { WorkoutLog } from "./model";
import { logSet, skipSet, skippedSetNumbersForItem, setsForItem } from "./operations";
import { formatProgress } from "./itemSets";
import { logFromWire, logToWire } from "./wire";

const emptyLog: WorkoutLog = { sessions: {} };
const DATE = "2026-11-02";
const KEY = { exerciseId: "pull_up", blockPosition: 2, setNumber: 3 };
const CONTEXT = { programWeek: 1, day: 1 as const };

describe("skipSet", () => {
  it("records the set as skipped without logging it", () => {
    const log = skipSet(emptyLog, DATE, KEY, CONTEXT);

    expect(setsForItem(log, DATE, 2, "pull_up")).toEqual([]);
    expect(skippedSetNumbersForItem(log, DATE, 2, "pull_up")).toEqual([3]);
    expect(log.sessions[DATE]?.programWeek).toBe(1);
  });

  it("keeps one skip when the same set is skipped twice", () => {
    const once = skipSet(emptyLog, DATE, KEY, CONTEXT);
    const twice = skipSet(once, DATE, KEY, CONTEXT);

    expect(twice).toBe(once);
    expect(skippedSetNumbersForItem(twice, DATE, 2, "pull_up")).toEqual([3]);
  });

  it("leaves a logged set alone: logged wins over skipped", () => {
    const logged = logSet(emptyLog, DATE, { exerciseId: "pull_up", blockPosition: 2, setNumber: 3, reps: 5, loggedAt: new Date("2026-11-02T10:00:00Z") }, CONTEXT);

    expect(skipSet(logged, DATE, KEY, CONTEXT)).toBe(logged);
  });

  it("counts skips per set number, in order", () => {
    let log = skipSet(emptyLog, DATE, { ...KEY, setNumber: 5 }, CONTEXT);
    log = skipSet(log, DATE, { ...KEY, setNumber: 2 }, CONTEXT);

    expect(skippedSetNumbersForItem(log, DATE, 2, "pull_up")).toEqual([2, 5]);
    expect(skippedSetNumbersForItem(log, DATE, 3, "pull_up")).toEqual([]);
  });
});

describe("logSet over a skip", () => {
  it("replaces the skip when the skipped set is logged later (reopen)", () => {
    const skipped = skipSet(emptyLog, DATE, KEY, CONTEXT);
    const reopened = logSet(skipped, DATE, { exerciseId: "pull_up", blockPosition: 2, setNumber: 3, reps: 6, loggedAt: new Date("2026-11-02T10:00:00Z") }, CONTEXT);

    expect(skippedSetNumbersForItem(reopened, DATE, 2, "pull_up")).toEqual([]);
    expect(setsForItem(reopened, DATE, 2, "pull_up").map((set) => set.setNumber)).toEqual([3]);
  });

  it("leaves other skips of the same date alone", () => {
    let log = skipSet(emptyLog, DATE, KEY, CONTEXT);
    log = skipSet(log, DATE, { ...KEY, setNumber: 4 }, CONTEXT);
    log = logSet(log, DATE, { exerciseId: "pull_up", blockPosition: 2, setNumber: 3, reps: 6, loggedAt: new Date("2026-11-02T10:00:00Z") }, CONTEXT);

    expect(skippedSetNumbersForItem(log, DATE, 2, "pull_up")).toEqual([4]);
  });
});

describe("combined days", () => {
  it("a skip on Day 2 does not match Day 1's set with the same block and number", () => {
    const log = skipSet(emptyLog, DATE, { ...KEY, day: 2 }, { programWeek: 1, day: 1 });

    expect(skippedSetNumbersForItem(log, DATE, 2, "pull_up", 1)).toEqual([]);
    expect(skippedSetNumbersForItem(log, DATE, 2, "pull_up", 2)).toEqual([3]);
  });
});

describe("wire form of skips", () => {
  it("round-trips skipped sets", () => {
    const log = skipSet(emptyLog, DATE, { ...KEY, day: 2 }, { programWeek: 1, day: 1 });
    const { log: readBack, problems } = logFromWire(JSON.parse(JSON.stringify(logToWire(log))));

    expect(problems.messages).toEqual([]);
    expect(readBack.sessions[DATE]?.skippedSets).toEqual([{ exerciseId: "pull_up", day: 2, blockPosition: 2, setNumber: 3 }]);
  });

  it("writes no skippedSets field when nothing was skipped", () => {
    const logged = logSet(emptyLog, DATE, { exerciseId: "pull_up", blockPosition: 2, setNumber: 1, reps: 4, loggedAt: new Date("2026-11-02T10:00:00Z") }, CONTEXT);

    expect(JSON.stringify(logToWire(logged))).not.toContain("skippedSets");
  });

  it("reads an older log with no skippedSets as none skipped", () => {
    const older = { version: 1, sessions: [{ date: DATE, day: 1, sets: [{ exerciseId: "pull_up", blockPosition: 2, setNumber: 1, reps: 4, loggedAt: "2026-11-02T10:00:00.000Z" }] }] };
    const { log, problems } = logFromWire(older);

    expect(problems.messages).toEqual([]);
    expect(log.sessions[DATE]?.skippedSets).toBeUndefined();
  });

  it("sets aside a bad skip with a message and keeps the good ones", () => {
    const wire = { version: 1, sessions: [{ date: DATE, sets: [], skippedSets: [{ exerciseId: "pull_up", blockPosition: 0, setNumber: 1 }, { exerciseId: "dip", blockPosition: 2, setNumber: 1 }] }] };
    const { log, problems } = logFromWire(wire);

    expect(problems.messages.join(" ")).toContain("blockPosition");
    expect(log.sessions[DATE]?.skippedSets).toEqual([{ exerciseId: "dip", blockPosition: 2, setNumber: 1 }]);
  });

  it("keeps a session that has only skips, and drops a skip that names a logged set", () => {
    const wire = {
      version: 1,
      sessions: [{
        date: DATE,
        sets: [{ exerciseId: "pull_up", blockPosition: 2, setNumber: 1, reps: 4, loggedAt: "2026-11-02T10:00:00.000Z" }],
        skippedSets: [{ exerciseId: "pull_up", blockPosition: 2, setNumber: 1 }, { exerciseId: "pull_up", blockPosition: 2, setNumber: 2 }],
      }],
    };
    const { log, problems } = logFromWire(wire);

    expect(problems.messages).toEqual([]);
    expect(log.sessions[DATE]?.skippedSets).toEqual([{ exerciseId: "pull_up", blockPosition: 2, setNumber: 2 }]);
  });
});

describe("formatProgress with skipped sets", () => {
  it("shows skipped sets beside the logged count", () => {
    expect(formatProgress(2, 6, 1)).toBe("2/6 · 1 skipped");
  });

  it("reads as complete when logged and skipped sets fill the item", () => {
    expect(formatProgress(4, 6, 2)).toBe("✓ 4/6 · 2 skipped");
    expect(formatProgress(0, 3, 3)).toBe("✓ 0/3 · 3 skipped");
  });

  it("shows nothing when nothing is logged or skipped", () => {
    expect(formatProgress(0, 6, 0)).toBeUndefined();
  });
});
