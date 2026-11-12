import { describe, expect, it } from "vitest";
import type { LoggedSet, WorkoutLog } from "./model";
import { deleteSet, editSet, logSet, sessionDates, setsForItem } from "./operations";

const emptyLog: WorkoutLog = { sessions: {} };

/** Builds a set with sensible defaults; override what the test cares about. */
function makeSet(overrides: Partial<LoggedSet> = {}): LoggedSet {
  return {
    exerciseId: "pull_up",
    blockPosition: 2,
    setNumber: 1,
    reps: 6,
    loggedAt: new Date("2026-11-02T18:00:00.000Z"),
    ...overrides,
  };
}

describe("logSet", () => {
  it("adds a set and creates the session with context", () => {
    const log = logSet(emptyLog, "2026-11-02", makeSet(), { programWeek: 1, day: 1 });
    expect(log.sessions["2026-11-02"]).toEqual({
      date: "2026-11-02",
      programWeek: 1,
      day: 1,
      sets: [makeSet()],
    });
  });

  it("does not mutate the input log", () => {
    logSet(emptyLog, "2026-11-02", makeSet());
    expect(emptyLog).toEqual({ sessions: {} });
  });

  it("replaces a set with the same exercise, block and set number, keeping its position", () => {
    let log = logSet(emptyLog, "2026-11-02", makeSet({ setNumber: 1 }));
    log = logSet(log, "2026-11-02", makeSet({ setNumber: 2 }));
    log = logSet(log, "2026-11-02", makeSet({ setNumber: 1, reps: 9 }));

    const sets = log.sessions["2026-11-02"]?.sets;
    expect(sets?.map((set) => [set.setNumber, set.reps])).toEqual([
      [1, 9],
      [2, 6],
    ]);
  });

  it("keeps same exercise in a different block as a separate set", () => {
    let log = logSet(emptyLog, "2026-11-02", makeSet({ blockPosition: 2 }));
    log = logSet(log, "2026-11-02", makeSet({ blockPosition: 3 }));
    expect(log.sessions["2026-11-02"]?.sets).toHaveLength(2);
  });

  it("ignores context when the session already exists", () => {
    let log = logSet(emptyLog, "2026-11-02", makeSet(), { programWeek: 1, day: 1 });
    log = logSet(log, "2026-11-02", makeSet({ setNumber: 2 }), { programWeek: 5, day: 5 });
    expect(log.sessions["2026-11-02"]?.programWeek).toBe(1);
  });
});

describe("editSet", () => {
  const key = { exerciseId: "pull_up", blockPosition: 2, setNumber: 1 };

  it("changes fields, keeps loggedAt, and can clear a field", () => {
    let log = logSet(emptyLog, "2026-11-02", makeSet({ loadKg: 5 }));
    log = editSet(log, "2026-11-02", key, { reps: 8, loadKg: undefined, note: "easy" });

    const edited = log.sessions["2026-11-02"]?.sets[0];
    expect(edited?.reps).toBe(8);
    expect(edited?.loadKg).toBeUndefined();
    expect(edited?.note).toBe("easy");
    expect(edited?.loggedAt).toEqual(makeSet().loggedAt);
  });

  it("returns the same log when the set or date does not exist", () => {
    const log = logSet(emptyLog, "2026-11-02", makeSet());
    expect(editSet(log, "2026-11-02", { ...key, setNumber: 9 }, { reps: 1 })).toBe(log);
    expect(editSet(log, "2026-11-03", key, { reps: 1 })).toBe(log);
  });

  it("does not mutate the input log", () => {
    const log = logSet(emptyLog, "2026-11-02", makeSet());
    editSet(log, "2026-11-02", key, { reps: 99 });
    expect(log.sessions["2026-11-02"]?.sets[0]?.reps).toBe(6);
  });
});

describe("deleteSet", () => {
  const key = { exerciseId: "pull_up", blockPosition: 2, setNumber: 1 };

  it("removes only the matching set", () => {
    let log = logSet(emptyLog, "2026-11-02", makeSet({ setNumber: 1 }));
    log = logSet(log, "2026-11-02", makeSet({ setNumber: 2 }));
    log = deleteSet(log, "2026-11-02", key);
    expect(log.sessions["2026-11-02"]?.sets.map((set) => set.setNumber)).toEqual([2]);
  });

  it("removes the session when its last set is deleted", () => {
    let log = logSet(emptyLog, "2026-11-02", makeSet());
    log = deleteSet(log, "2026-11-02", key);
    expect(log.sessions).toEqual({});
    expect(sessionDates(log)).toEqual([]);
  });

  it("returns the same log when nothing matches", () => {
    const log = logSet(emptyLog, "2026-11-02", makeSet());
    expect(deleteSet(log, "2026-11-02", { ...key, exerciseId: "dip" })).toBe(log);
    expect(deleteSet(log, "2030-01-01", key)).toBe(log);
  });
});

describe("setsForItem", () => {
  it("returns that item's sets on that date ordered by set number", () => {
    let log = logSet(emptyLog, "2026-11-02", makeSet({ setNumber: 2 }));
    log = logSet(log, "2026-11-02", makeSet({ setNumber: 1 }));
    log = logSet(log, "2026-11-02", makeSet({ blockPosition: 3 }));
    log = logSet(log, "2026-11-02", makeSet({ exerciseId: "dip" }));
    log = logSet(log, "2026-11-04", makeSet({ setNumber: 3 }));

    expect(setsForItem(log, "2026-11-02", 2, "pull_up").map((set) => set.setNumber)).toEqual([1, 2]);
    expect(setsForItem(log, "2026-11-04", 2, "pull_up").map((set) => set.setNumber)).toEqual([3]);
  });

  it("returns an empty list for an unlogged date or item", () => {
    const log = logSet(emptyLog, "2026-11-02", makeSet());
    expect(setsForItem(log, "2026-11-09", 2, "pull_up")).toEqual([]);
    expect(setsForItem(log, "2026-11-02", 5, "pull_up")).toEqual([]);
  });
});

describe("sessionDates", () => {
  it("lists dates newest first", () => {
    let log = logSet(emptyLog, "2026-11-04", makeSet());
    log = logSet(log, "2026-12-01", makeSet());
    log = logSet(log, "2026-11-02", makeSet());
    expect(sessionDates(log)).toEqual(["2026-12-01", "2026-11-04", "2026-11-02"]);
  });
});

describe("sets that carry their own day", () => {
  it("keeps two sets with the same exercise, block and set number but different days distinct", () => {
    let log = logSet(emptyLog, "2026-11-09", makeSet({ day: 1, reps: 5 }), { day: 1 });
    log = logSet(log, "2026-11-09", makeSet({ day: 2, reps: 7 }), { day: 1 });

    expect(log.sessions["2026-11-09"]?.sets.map((set) => [set.day, set.reps])).toEqual([[1, 5], [2, 7]]);

    // Re-logging the day 2 set replaces only that one.
    log = logSet(log, "2026-11-09", makeSet({ day: 2, reps: 9 }));
    expect(log.sessions["2026-11-09"]?.sets.map((set) => [set.day, set.reps])).toEqual([[1, 5], [2, 9]]);
  });

  it("edits and deletes only the set of the key's day", () => {
    let log = logSet(emptyLog, "2026-11-09", makeSet({ day: 1, reps: 5 }), { day: 1 });
    log = logSet(log, "2026-11-09", makeSet({ day: 2, reps: 7 }));
    const key = { exerciseId: "pull_up", day: 2, blockPosition: 2, setNumber: 1 };

    const edited = editSet(log, "2026-11-09", key, { reps: 8 });
    expect(edited.sessions["2026-11-09"]?.sets.map((set) => set.reps)).toEqual([5, 8]);

    const deleted = deleteSet(log, "2026-11-09", key);
    expect(deleted.sessions["2026-11-09"]?.sets.map((set) => set.day)).toEqual([1]);
  });

  it("setsForItem returns only the asked day's sets, while a key without a day means the session's day", () => {
    let log = logSet(emptyLog, "2026-11-09", makeSet({ day: 1, reps: 5 }), { day: 1 });
    log = logSet(log, "2026-11-09", makeSet({ day: 2, reps: 7 }));

    expect(setsForItem(log, "2026-11-09", 2, "pull_up", 2).map((set) => set.reps)).toEqual([7]);
    expect(setsForItem(log, "2026-11-09", 2, "pull_up", 1).map((set) => set.reps)).toEqual([5]);
    expect(setsForItem(log, "2026-11-09", 2, "pull_up").map((set) => set.reps).sort()).toEqual([5, 7]);

    const deleted = deleteSet(log, "2026-11-09", { exerciseId: "pull_up", blockPosition: 2, setNumber: 1 });
    expect(deleted.sessions["2026-11-09"]?.sets.map((set) => set.day)).toEqual([2]);
  });

  it("old sets in a session with no stored day behave as before: they match any day and are replaced by a new set", () => {
    let log = logSet(emptyLog, "2026-11-02", makeSet({ reps: 5 }));

    expect(setsForItem(log, "2026-11-02", 2, "pull_up", 1)).toHaveLength(1);
    expect(setsForItem(log, "2026-11-02", 2, "pull_up", 3)).toHaveLength(1);

    log = logSet(log, "2026-11-02", makeSet({ day: 1, reps: 9 }));
    expect(log.sessions["2026-11-02"]?.sets.map((set) => set.reps)).toEqual([9]);
  });

  it("old sets in a session with a stored day still count on any day, so a moved start date changes nothing", () => {
    // The session says Day 1, but after the start date moves the same date can
    // be Day 3. Before sets carried a day, Today still counted these sets and
    // re-logging replaced them; that must not change.
    let log = logSet(emptyLog, "2026-11-02", makeSet({ reps: 5 }), { day: 1 });

    expect(setsForItem(log, "2026-11-02", 2, "pull_up", 1)).toHaveLength(1);
    expect(setsForItem(log, "2026-11-02", 2, "pull_up", 3)).toHaveLength(1);

    log = logSet(log, "2026-11-02", makeSet({ day: 3, reps: 9 }));
    expect(log.sessions["2026-11-02"]?.sets.map((set) => set.reps)).toEqual([9]);
  });
});
