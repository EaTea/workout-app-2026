import { describe, expect, it } from "vitest";
import type { LoggedSet, WorkoutLog } from "./model";
import { logSet } from "./operations";
import { applyLogChange, listCorruptLogBackups, loadLog, saveLog, type LogStorage } from "./storage";
import { logFromWire, logToWire } from "./wire";
import { storageKeysForProgram } from "../storage/programKeys";

/** Explosive Endurance's keys, the ones the app has always used. */
const KEYS = storageKeysForProgram("explosive-endurance");

/** In-memory stand-in for localStorage; `failWrites` simulates a full or blocked store. */
function fakeStorage(initial: Record<string, string> = {}, failWrites = false): LogStorage & { data: Map<string, string> } {
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

const sampleLog: WorkoutLog = {
  sessions: {
    "2026-11-04": {
      date: "2026-11-04",
      sets: [{ exerciseId: "heavy_bag", blockPosition: 1, setNumber: 1, loggedAt: new Date("2026-11-04T10:00:00.000Z") }],
    },
    "2026-11-02": {
      date: "2026-11-02",
      programWeek: 1,
      day: 1,
      sets: [
        {
          exerciseId: "pull_up",
          blockPosition: 2,
          setNumber: 1,
          reps: 6,
          loadKg: 6.5,
          note: "felt good",
          loggedAt: new Date("2026-11-02T18:04:00.000Z"),
        },
      ],
    },
  },
};

/** A minimal valid wire object that tests then break one field at a time. */
function validWire() {
  return {
    version: 1,
    sessions: [
      {
        date: "2026-11-02",
        sets: [{ exerciseId: "pull_up", blockPosition: 2, setNumber: 1, reps: 6, loggedAt: "2026-11-02T18:04:00.000Z" }],
      },
    ],
  };
}

describe("log mapping", () => {
  it("round-trips through JSON text", () => {
    const text = JSON.stringify(logToWire(sampleLog));
    expect(logFromWire(JSON.parse(text))).toEqual({ log: sampleLog, problems: { setAsideSetCount: 0, messages: [] } });
  });

  it("writes version 1, sessions oldest first, ISO timestamps, and omits absent fields", () => {
    const wire = logToWire(sampleLog);
    expect(wire.version).toBe(1);
    expect(wire.sessions.map((session) => session.date)).toEqual(["2026-11-02", "2026-11-04"]);
    expect(wire.sessions[0]?.sets[0]?.loggedAt).toBe("2026-11-02T18:04:00.000Z");
    expect(wire.sessions[1]).not.toHaveProperty("programWeek");
    expect(wire.sessions[1]?.sets[0]).not.toHaveProperty("reps");
  });

  it("throws for a file that is unusable as a whole", () => {
    expect(() => logFromWire("text")).toThrow("log: expected an object");
    expect(() => logFromWire({ ...validWire(), version: 2 })).toThrow("log.version");
    expect(() => logFromWire({ ...validWire(), sessions: {} })).toThrow("log.sessions");
  });

  it("sets aside an invalid set with a message naming the field, and keeps the other sets", () => {
    const cases: Array<[string, (set: Record<string, unknown>) => void, string]> = [
      ["exerciseId type", (set) => { set.exerciseId = 5; }, "exerciseId"],
      ["block position zero", (set) => { set.blockPosition = 0; }, "blockPosition"],
      ["set number fraction", (set) => { set.setNumber = 1.5; }, "setNumber"],
      ["reps string", (set) => { set.reps = "6"; }, "reps"],
      ["negative load", (set) => { set.loadKg = -1; }, "loadKg"],
      ["note not string", (set) => { set.note = 3; }, "note"],
      ["bad timestamp", (set) => { set.loggedAt = "yesterday"; }, "loggedAt"],
    ];

    for (const [, breakIt, expectedText] of cases) {
      const wire = validWire();
      const goodSet = { exerciseId: "dip", blockPosition: 4, setNumber: 1, reps: 8, loggedAt: "2026-11-02T18:10:00.000Z" };
      wire.sessions[0]!.sets.push(goodSet);
      breakIt(wire.sessions[0]!.sets[0] as unknown as Record<string, unknown>);

      const result = logFromWire(wire);
      expect(result.problems.setAsideSetCount, expectedText).toBe(1);
      expect(result.problems.messages[0], expectedText).toContain(expectedText);
      expect(result.log.sessions["2026-11-02"]?.sets.map((set) => set.exerciseId)).toEqual(["dip"]);
    }
  });

  it("sets aside a session with a bad date, counting its sets, and keeps the other sessions", () => {
    const wire = validWire();
    wire.sessions.push({ date: "2026-02-30", sets: [...wire.sessions[0]!.sets, ...wire.sessions[0]!.sets] });

    const result = logFromWire(wire);
    expect(Object.keys(result.log.sessions)).toEqual(["2026-11-02"]);
    expect(result.problems.setAsideSetCount).toBe(2);
    expect(result.problems.messages[0]).toContain("sessions[1].date");
  });

  it("drops a session whose every set is invalid, and ignores an empty one without a problem", () => {
    const allBad = validWire();
    allBad.sessions[0]!.sets[0]!.setNumber = 0;
    expect(logFromWire(allBad)).toMatchObject({ log: { sessions: {} }, problems: { setAsideSetCount: 1 } });

    const empty = validWire();
    empty.sessions.push({ date: "2026-11-03", sets: [] });
    expect(logFromWire(empty).problems.messages).toEqual([]);
  });

  it("keeps the first of two duplicate sets and the first of two sessions on one date, setting the repeats aside", () => {
    const duplicateDate = validWire();
    duplicateDate.sessions.push(structuredClone(duplicateDate.sessions[0]!));
    const dateResult = logFromWire(duplicateDate);
    expect(dateResult.problems.messages[0]).toContain("duplicate session");
    expect(dateResult.problems.setAsideSetCount).toBe(1);

    const duplicateSet = validWire();
    duplicateSet.sessions[0]!.sets.push(structuredClone(duplicateSet.sessions[0]!.sets[0]!));
    const setResult = logFromWire(duplicateSet);
    expect(setResult.problems.messages[0]).toContain("duplicate set");
    expect(setResult.log.sessions["2026-11-02"]?.sets).toHaveLength(1);
  });

  it("checks programWeek and a day number of 1 to 7, dropping a bad value but keeping the sets", () => {
    const wire = validWire();
    Object.assign(wire.sessions[0]!, { programWeek: "1", day: 8 });

    const result = logFromWire(wire);
    expect(result.log.sessions["2026-11-02"]).toEqual({ date: "2026-11-02", sets: expect.any(Array) });
    expect(result.problems.setAsideSetCount).toBe(0);
    expect(result.problems.messages).toHaveLength(2);
    expect(result.problems.messages[1]).toContain("day number from 1 to 7");

    const goodDay = validWire();
    Object.assign(goodDay.sessions[0]!, { day: 7 });
    expect(logFromWire(goodDay).log.sessions["2026-11-02"]?.day).toBe(7);
  });
});

/** Storage whose reads throw (blocked or disabled storage); writes are recorded in `writes`. */
function blockedReadStorage(): LogStorage & { writes: string[] } {
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

describe("loadLog", () => {
  const now = new Date("2026-11-09T12:00:00.000Z");

  it("returns an empty log with no warning when nothing is stored", () => {
    expect(loadLog(fakeStorage(), KEYS, now)).toEqual({ log: { sessions: {} } });
  });

  it("loads a saved log", () => {
    const storage = fakeStorage();
    saveLog(storage, KEYS, sampleLog);
    expect(loadLog(storage, KEYS, now)).toEqual({ log: sampleLog });
  });

  it("warns and keeps a backup for corrupt JSON, leaving the original untouched", () => {
    const storage = fakeStorage({ [KEYS.log]: "{not json" });
    const result = loadLog(storage, KEYS, now);

    expect(result.log).toEqual({ sessions: {} });
    expect(result.warning).toContain("could not be read");
    expect(storage.data.get(`${KEYS.logCorruptBackupPrefix}2026-11-09T12:00:00.000Z`)).toBe("{not json");
    expect(storage.data.get(KEYS.log)).toBe("{not json");
  });

  it("warns and keeps a backup for an unknown version", () => {
    const text = JSON.stringify({ version: 2, sessions: [] });
    const storage = fakeStorage({ [KEYS.log]: text });
    const result = loadLog(storage, KEYS, now);

    expect(result.warning).toContain("version");
    expect(storage.data.get(`${KEYS.logCorruptBackupPrefix}2026-11-09T12:00:00.000Z`)).toBe(text);
  });

  it("keeps the readable sets of a log with one bad set, says how many were set aside, and backs up the original text", () => {
    const wire = validWire();
    wire.sessions[0]!.sets.push({ exerciseId: "dip", blockPosition: 4, setNumber: 1, reps: "six", loggedAt: "2026-11-02T18:10:00.000Z" } as never);
    const text = JSON.stringify(wire);
    const storage = fakeStorage({ [KEYS.log]: text });

    const result = loadLog(storage, KEYS, now);

    expect(result.log.sessions["2026-11-02"]?.sets.map((set) => set.exerciseId)).toEqual(["pull_up"]);
    expect(result.warning).toContain("1 set of your saved workout log could not be read and was set aside");
    expect(result.warning).toContain("reps");
    expect(result.saveRefusedReason).toBeUndefined();
    expect(storage.data.get(`${KEYS.logCorruptBackupPrefix}2026-11-09T12:00:00.000Z`)).toBe(text);
    expect(storage.data.get(KEYS.log)).toBe(text);
  });

  it("says 'sets' for several and refuses to save when the original cannot be copied aside", () => {
    const wire = validWire();
    wire.sessions[0]!.sets.push({ exerciseId: "dip", blockPosition: 4, setNumber: 0, reps: 1, loggedAt: "2026-11-02T18:10:00.000Z" }, { exerciseId: "dip", blockPosition: 4, setNumber: -1, reps: 1, loggedAt: "2026-11-02T18:10:00.000Z" });
    const result = loadLog(fakeStorage({ [KEYS.log]: JSON.stringify(wire) }, true), KEYS, now);

    expect(result.warning).toContain("2 sets of your saved workout log could not be read and were set aside");
    expect(result.log.sessions["2026-11-02"]?.sets).toHaveLength(1);
    expect(result.saveRefusedReason).toBeDefined();
  });

  it("different incidents get different backup keys", () => {
    const storage = fakeStorage({ [KEYS.log]: "bad" });
    loadLog(storage, KEYS, new Date("2026-11-09T12:00:00.000Z"));
    loadLog(storage, KEYS, new Date("2026-11-10T12:00:00.000Z"));
    expect([...storage.data.keys()].filter((key) => key.startsWith(KEYS.logCorruptBackupPrefix))).toHaveLength(2);
  });

  it("still returns an empty log with a warning, and refuses saving, when the backup cannot be written", () => {
    const storage = fakeStorage({ [KEYS.log]: "bad" }, true);
    const result = loadLog(storage, KEYS, now);
    expect(result.log).toEqual({ sessions: {} });
    expect(result.warning).toContain("backup copy could not be made");
    expect(result.saveRefusedReason).toBeDefined();
  });

  it("returns an empty log with a warning, and refuses saving, when reading throws", () => {
    const result = loadLog(blockedReadStorage(), KEYS, now);
    expect(result.log).toEqual({ sessions: {} });
    expect(result.warning).toContain("blocked");
    expect(result.saveRefusedReason).toContain("blocked");
  });
});

describe("saveLog", () => {
  it("stores the wire JSON under the log key", () => {
    const storage = fakeStorage();
    expect(saveLog(storage, KEYS, sampleLog)).toEqual({ ok: true });
    expect(JSON.parse(storage.data.get(KEYS.log) as string)).toEqual(logToWire(sampleLog));
  });

  it("reports failure instead of throwing when storage is full", () => {
    expect(saveLog(fakeStorage({}, true), KEYS, sampleLog)).toEqual({ ok: false, error: "QuotaExceededError" });
  });
});

/** A pull-up EMOM minute on 9 Nov and a med ball slam set, used as the two tabs' changes. */
function setOf(exerciseId: string, blockPosition: number): LoggedSet {
  return { exerciseId, blockPosition, setNumber: 1, reps: 6, loggedAt: new Date("2026-11-09T18:00:00.000Z") };
}

describe("applyLogChange", () => {
  const now = new Date("2026-11-09T12:00:00.000Z");

  it("applies the change to the fresh stored log and saves it", () => {
    const storage = fakeStorage();
    const result = applyLogChange(storage, KEYS, (fresh) => logSet(fresh, "2026-11-09", setOf("med_ball_slam", 2)), now);

    expect(result.saved).toBe(true);
    expect(loadLog(storage, KEYS, now).log.sessions["2026-11-09"]?.sets.map((set) => set.exerciseId)).toEqual(["med_ball_slam"]);
  });

  it("two open copies of the app do not wipe each other's sets", () => {
    const storage = fakeStorage();

    // Tab B loaded (an empty log) before tab A logged anything.
    const tabBStartupLog = loadLog(storage, KEYS, now).log;
    applyLogChange(storage, KEYS, (fresh) => logSet(fresh, "2026-11-09", setOf("med_ball_slam", 2)), now);

    // Tab B's own copy does not know about the slams, but its change is applied to the stored log.
    expect(tabBStartupLog.sessions).toEqual({});
    const tabBResult = applyLogChange(storage, KEYS, (fresh) => logSet(fresh, "2026-11-09", setOf("pull_up", 3)), now);

    const stored = loadLog(storage, KEYS, now).log.sessions["2026-11-09"]?.sets.map((set) => set.exerciseId);
    expect(stored).toEqual(["med_ball_slam", "pull_up"]);
    expect(tabBResult).toEqual({ saved: true, log: loadLog(storage, KEYS, now).log });
  });

  it("refuses, writing nothing, when the stored log cannot be read", () => {
    const storage = blockedReadStorage();
    const result = applyLogChange(storage, KEYS, (fresh) => logSet(fresh, "2026-11-09", setOf("pull_up", 3)), now);

    expect(result).toMatchObject({ saved: false, error: expect.stringContaining("blocked") });
    expect(result).not.toHaveProperty("log");
    expect(storage.writes).toEqual([]);
  });

  it("refuses when an unreadable log could not be backed up, leaving the original in place", () => {
    const storage = fakeStorage({ [KEYS.log]: "{not json" }, true);
    const result = applyLogChange(storage, KEYS, (fresh) => logSet(fresh, "2026-11-09", setOf("pull_up", 3)), now);

    expect(result.saved).toBe(false);
    expect(storage.data.get(KEYS.log)).toBe("{not json");
  });

  it("after backing up an unreadable log it saves the change over it", () => {
    const storage = fakeStorage({ [KEYS.log]: "{not json" });
    const result = applyLogChange(storage, KEYS, (fresh) => logSet(fresh, "2026-11-09", setOf("pull_up", 3)), now);

    expect(result.saved).toBe(true);
    expect(storage.data.get(`${KEYS.logCorruptBackupPrefix}2026-11-09T12:00:00.000Z`)).toBe("{not json");
    expect(loadLog(storage, KEYS, now).warning).toBeUndefined();
  });

  it("keeps the change in the returned log when the write fails", () => {
    const storage = fakeStorage({}, true);
    const result = applyLogChange(storage, KEYS, (fresh) => logSet(fresh, "2026-11-09", setOf("pull_up", 3)), now);

    expect(result.saved).toBe(false);
    expect(result.saved === false && result.error).toContain("QuotaExceededError");
    expect(result.saved === false && result.log?.sessions["2026-11-09"]?.sets).toHaveLength(1);
  });
});

describe("listCorruptLogBackups", () => {
  /** A fake with the key-listing part of the Storage API. */
  function listingStorage(initial: Record<string, string>) {
    const entries = Object.entries(initial);
    return {
      length: entries.length,
      key: (index: number) => entries[index]?.[0] ?? null,
      getItem: (key: string) => initial[key] ?? null,
    };
  }

  it("returns only the log's corrupt backups, oldest first", () => {
    const backups = listCorruptLogBackups(
      listingStorage({
        [`${KEYS.logCorruptBackupPrefix}2026-11-09T08:00:00.000Z`]: "second",
        [KEYS.log]: "{}",
        [`${KEYS.logCorruptBackupPrefix}2026-11-02T08:00:00.000Z`]: "first",
        "explosive-endurance.fatigue.corrupt-2026-11-01T00:00:00.000Z": "other",
      }),
      KEYS,
    );

    expect(backups.map((backup) => backup.originalText)).toEqual(["first", "second"]);
  });

  it("returns an empty list when there are none or storage throws", () => {
    expect(listCorruptLogBackups(listingStorage({}), KEYS)).toEqual([]);
    expect(listCorruptLogBackups({ length: 1, key: () => { throw new Error("blocked"); }, getItem: () => null }, KEYS)).toEqual([]);
  });
});
