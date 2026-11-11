import { describe, expect, it } from "vitest";
import type { FatigueHistory } from "./model";
import { recordCheck } from "./operations";
import { applyFatigueChange, FATIGUE_CORRUPT_BACKUP_PREFIX, FATIGUE_STORAGE_KEY, loadFatigueHistory, saveFatigueHistory, type FatigueStorage } from "./storage";
import { fatigueHistoryFromWire, fatigueHistoryToWire } from "./wire";

/** In-memory stand-in for localStorage; `failWrites` simulates a full or blocked store. */
function fakeStorage(initial: Record<string, string> = {}, failWrites = false): FatigueStorage & { data: Map<string, string> } {
  const data = new Map(Object.entries(initial));
  return {
    data,
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => {
      if (failWrites) throw new Error("QuotaExceededError");
      data.set(key, value);
    },
  };
}

/** Storage whose reads throw; writes are recorded in `writes`. */
function blockedReadStorage(): FatigueStorage & { writes: string[] } {
  const writes: string[] = [];
  return {
    writes,
    getItem: () => {
      throw new Error("blocked");
    },
    setItem: (key) => {
      writes.push(key);
    },
  };
}

const sampleHistory: FatigueHistory = {
  checks: [
    { date: "2026-11-16", savedProgramWeek: 2, maxPullUps: 10, savedAt: new Date("2026-11-16T07:00:00.000Z") },
    { date: "2026-11-09", savedProgramWeek: 1, broadJumpMetres: 2.34, maxPullUps: 12, savedAt: new Date("2026-11-09T07:30:00.000Z") },
  ],
};

/** A minimal valid wire object that tests break one field at a time. */
function validWire() {
  return {
    version: 1,
    checks: [{ date: "2026-11-09", programWeek: 1, broadJumpMetres: 2.34, maxPullUps: 12, savedAt: "2026-11-09T07:30:00.000Z" }],
  };
}

describe("fatigue mapping", () => {
  it("round-trips through JSON text, writing checks oldest date first and omitting skipped fields", () => {
    const wire = fatigueHistoryToWire(sampleHistory);
    expect(wire.version).toBe(1);
    expect(wire.checks.map((entry) => entry.date)).toEqual(["2026-11-09", "2026-11-16"]);
    expect(wire.checks.map((entry) => entry.programWeek)).toEqual([1, 2]);
    expect(wire.checks[1]).not.toHaveProperty("broadJumpMetres");
    expect(wire.checks[0]?.savedAt).toBe("2026-11-09T07:30:00.000Z");

    const result = fatigueHistoryFromWire(JSON.parse(JSON.stringify(wire)));
    expect(result.problems).toEqual({ setAsideCheckCount: 0, messages: [] });
    expect(result.history.checks).toEqual([sampleHistory.checks[1], sampleHistory.checks[0]]);
  });

  it("throws for a file that is unusable as a whole", () => {
    expect(() => fatigueHistoryFromWire("text")).toThrow("fatigue: expected an object");
    expect(() => fatigueHistoryFromWire({ ...validWire(), version: 2 })).toThrow("fatigue.version");
    expect(() => fatigueHistoryFromWire({ ...validWire(), checks: {} })).toThrow("fatigue.checks");
  });

  it("sets aside an invalid check with a message naming the field, and keeps the others", () => {
    const cases: Array<[Record<string, unknown>, string]> = [
      [{ date: "2026-02-30" }, "date"],
      [{ date: 5 }, "date"],
      [{ broadJumpMetres: 0 }, "broadJumpMetres"],
      [{ broadJumpMetres: 5.01 }, "broadJumpMetres"],
      [{ broadJumpMetres: 2.345 }, "broadJumpMetres"],
      [{ broadJumpMetres: "2.3" }, "broadJumpMetres"],
      [{ maxPullUps: -1 }, "maxPullUps"],
      [{ maxPullUps: 101 }, "maxPullUps"],
      [{ maxPullUps: 7.5 }, "maxPullUps"],
      [{ savedAt: "yesterday" }, "savedAt"],
    ];

    for (const [override, expectedText] of cases) {
      const wire = validWire();
      wire.checks.push({ date: "2026-11-16", programWeek: 2, maxPullUps: 10, savedAt: "2026-11-16T07:00:00.000Z" } as never);
      Object.assign(wire.checks[0]!, override);

      const result = fatigueHistoryFromWire(wire);
      expect(result.problems.setAsideCheckCount, expectedText).toBe(1);
      expect(result.problems.messages[0], expectedText).toContain(expectedText);
      expect(result.history.checks.map((entry) => entry.date), expectedText).toEqual(["2026-11-16"]);
    }
  });

  it("accepts the boundary values 5 m, 0.01 m, 0 pull-ups, 100 pull-ups and weeks 1 and 8", () => {
    const wire = validWire();
    wire.checks = [
      { date: "2026-11-09", programWeek: 1, broadJumpMetres: 5, maxPullUps: 0, savedAt: "2026-11-09T07:00:00.000Z" },
      { date: "2026-12-28", programWeek: 8, broadJumpMetres: 0.01, maxPullUps: 100, savedAt: "2026-12-28T07:00:00.000Z" },
    ];
    expect(fatigueHistoryFromWire(wire).problems.messages).toEqual([]);
  });

  it("ignores the stored programWeek when reading: an odd or missing one is dropped, a valid one is only remembered", () => {
    const wire = validWire();
    wire.checks = [
      { date: "2026-11-09", programWeek: 99, maxPullUps: 12, savedAt: "2026-11-09T07:30:00.000Z" },
      { date: "2026-11-16", programWeek: undefined, maxPullUps: 10, savedAt: "2026-11-16T07:00:00.000Z" },
      { date: "2026-11-23", programWeek: 2, maxPullUps: 9, savedAt: "2026-11-23T07:00:00.000Z" },
    ] as never;
    const result = fatigueHistoryFromWire(wire);

    expect(result.problems.messages).toEqual([]);
    expect(result.history.checks.map((entry) => entry.savedProgramWeek)).toEqual([undefined, undefined, 2]);
  });

  it("writes no programWeek for a check that was never inside the program", () => {
    const wire = fatigueHistoryToWire({ checks: [{ date: "2026-10-20", maxPullUps: 14, savedAt: new Date("2026-10-20T07:00:00.000Z") }] });
    expect(wire.checks[0]).not.toHaveProperty("programWeek");
  });

  it("keeps two checks in one stored week when their dates differ (the week is derived later)", () => {
    const wire = validWire();
    wire.checks.push({ ...wire.checks[0]!, date: "2026-11-10" });
    const result = fatigueHistoryFromWire(wire);

    expect(result.history.checks).toHaveLength(2);
    expect(result.problems.messages).toEqual([]);
  });

  it("keeps the first of two checks for one DATE and sets the repeat aside", () => {
    const wire = validWire();
    wire.checks.push({ ...wire.checks[0]!, maxPullUps: 3 });
    const result = fatigueHistoryFromWire(wire);

    expect(result.history.checks).toHaveLength(1);
    expect(result.history.checks[0]?.maxPullUps).toBe(12);
    expect(result.problems.messages[0]).toContain("duplicate check for 2026-11-09");
  });
});

describe("loadFatigueHistory", () => {
  const now = new Date("2026-11-09T12:00:00.000Z");
  const backupKey = `${FATIGUE_CORRUPT_BACKUP_PREFIX}2026-11-09T12:00:00.000Z`;

  it("returns an empty history with no warning when nothing is stored", () => {
    expect(loadFatigueHistory(fakeStorage(), now)).toEqual({ history: { checks: [] } });
  });

  it("loads a saved history", () => {
    const storage = fakeStorage();
    saveFatigueHistory(storage, sampleHistory);
    const loaded = loadFatigueHistory(storage, now);

    expect(loaded.warning).toBeUndefined();
    expect(loaded.history.checks).toHaveLength(2);
  });

  it("warns and keeps a backup for corrupt JSON, leaving the original untouched", () => {
    const storage = fakeStorage({ [FATIGUE_STORAGE_KEY]: "{not json" });
    const result = loadFatigueHistory(storage, now);

    expect(result.history).toEqual({ checks: [] });
    expect(result.warning).toContain("could not be read");
    expect(storage.data.get(backupKey)).toBe("{not json");
    expect(storage.data.get(FATIGUE_STORAGE_KEY)).toBe("{not json");
  });

  it("warns and keeps a backup for an unknown version", () => {
    const text = JSON.stringify({ version: 2, checks: [] });
    const storage = fakeStorage({ [FATIGUE_STORAGE_KEY]: text });

    expect(loadFatigueHistory(storage, now).warning).toContain("version");
    expect(storage.data.get(backupKey)).toBe(text);
  });

  it("keeps the readable checks, says how many were set aside, and backs up the original text", () => {
    const wire = validWire();
    wire.checks.push({ date: "2026-11-16", programWeek: 2, maxPullUps: "ten", savedAt: "2026-11-16T07:00:00.000Z" } as never);
    const text = JSON.stringify(wire);
    const storage = fakeStorage({ [FATIGUE_STORAGE_KEY]: text });

    const result = loadFatigueHistory(storage, now);

    expect(result.history.checks.map((entry) => entry.savedProgramWeek)).toEqual([1]);
    expect(result.warning).toContain("1 weekly check-in could not be read and was set aside");
    expect(result.warning).toContain("maxPullUps");
    expect(result.saveRefusedReason).toBeUndefined();
    expect(storage.data.get(backupKey)).toBe(text);
  });

  it("different incidents get different backup keys", () => {
    const storage = fakeStorage({ [FATIGUE_STORAGE_KEY]: "bad" });
    loadFatigueHistory(storage, new Date("2026-11-09T12:00:00.000Z"));
    loadFatigueHistory(storage, new Date("2026-11-10T12:00:00.000Z"));
    expect([...storage.data.keys()].filter((key) => key.startsWith(FATIGUE_CORRUPT_BACKUP_PREFIX))).toHaveLength(2);
  });

  it("refuses saving when the backup cannot be written", () => {
    const result = loadFatigueHistory(fakeStorage({ [FATIGUE_STORAGE_KEY]: "bad" }, true), now);
    expect(result.history).toEqual({ checks: [] });
    expect(result.warning).toContain("backup copy could not be made");
    expect(result.saveRefusedReason).toBeDefined();
  });

  it("returns an empty history with a warning, and refuses saving, when reading throws", () => {
    const result = loadFatigueHistory(blockedReadStorage(), now);
    expect(result.history).toEqual({ checks: [] });
    expect(result.warning).toContain("blocked");
    expect(result.saveRefusedReason).toContain("blocked");
  });
});

describe("saveFatigueHistory", () => {
  it("stores the wire JSON under the fatigue key", () => {
    const storage = fakeStorage();
    expect(saveFatigueHistory(storage, sampleHistory)).toEqual({ ok: true });
    expect(JSON.parse(storage.data.get(FATIGUE_STORAGE_KEY) as string)).toEqual(fatigueHistoryToWire(sampleHistory));
  });

  it("reports failure instead of throwing when storage is full", () => {
    expect(saveFatigueHistory(fakeStorage({}, true), sampleHistory)).toEqual({ ok: false, error: "QuotaExceededError" });
  });
});

describe("applyFatigueChange", () => {
  const now = new Date("2026-11-09T12:00:00.000Z");
  const weekOne = { date: "2026-11-09", savedProgramWeek: 1, maxPullUps: 12, savedAt: new Date("2026-11-09T07:00:00.000Z") };
  const weekTwo = { date: "2026-11-16", savedProgramWeek: 2, maxPullUps: 10, savedAt: new Date("2026-11-16T07:00:00.000Z") };

  it("applies the change to the fresh stored history and saves it", () => {
    const storage = fakeStorage();
    const result = applyFatigueChange(storage, (fresh) => recordCheck(fresh, weekOne, "2026-11-09", 8), now);

    expect(result.saved).toBe(true);
    expect(loadFatigueHistory(storage, now).history.checks).toEqual([weekOne]);
  });

  it("two open copies of the app do not wipe each other's checks", () => {
    const storage = fakeStorage();
    const tabBStartupHistory = loadFatigueHistory(storage, now).history;
    applyFatigueChange(storage, (fresh) => recordCheck(fresh, weekOne, "2026-11-09", 8), now);

    expect(tabBStartupHistory.checks).toEqual([]);
    applyFatigueChange(storage, (fresh) => recordCheck(fresh, weekTwo, "2026-11-09", 8), now);

    expect(loadFatigueHistory(storage, now).history.checks.map((entry) => entry.date)).toEqual(["2026-11-09", "2026-11-16"]);
  });

  it("refuses, writing nothing, when the stored history cannot be read", () => {
    const storage = blockedReadStorage();
    const result = applyFatigueChange(storage, (fresh) => recordCheck(fresh, weekOne, "2026-11-09", 8), now);

    expect(result).toMatchObject({ saved: false, error: expect.stringContaining("blocked") });
    expect(result).not.toHaveProperty("history");
    expect(storage.writes).toEqual([]);
  });

  it("refuses when unreadable data could not be backed up, leaving the original in place", () => {
    const storage = fakeStorage({ [FATIGUE_STORAGE_KEY]: "{not json" }, true);
    const result = applyFatigueChange(storage, (fresh) => recordCheck(fresh, weekOne, "2026-11-09", 8), now);

    expect(result.saved).toBe(false);
    expect(storage.data.get(FATIGUE_STORAGE_KEY)).toBe("{not json");
  });

  it("after backing up unreadable data it saves the change over it", () => {
    const storage = fakeStorage({ [FATIGUE_STORAGE_KEY]: "{not json" });
    const result = applyFatigueChange(storage, (fresh) => recordCheck(fresh, weekOne, "2026-11-09", 8), now);

    expect(result.saved).toBe(true);
    expect(storage.data.get(`${FATIGUE_CORRUPT_BACKUP_PREFIX}2026-11-09T12:00:00.000Z`)).toBe("{not json");
    expect(loadFatigueHistory(storage, now).warning).toBeUndefined();
  });

  it("keeps the change in the returned history when the write fails", () => {
    const result = applyFatigueChange(fakeStorage({}, true), (fresh) => recordCheck(fresh, weekOne, "2026-11-09", 8), now);

    expect(result.saved).toBe(false);
    expect(result.saved === false && result.error).toContain("QuotaExceededError");
    expect(result.saved === false && result.history?.checks).toHaveLength(1);
  });
});
