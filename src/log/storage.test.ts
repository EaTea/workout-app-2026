import { describe, expect, it } from "vitest";
import type { WorkoutLog } from "./model";
import { LOG_CORRUPT_BACKUP_PREFIX, LOG_STORAGE_KEY, loadLog, saveLog, type LogStorage } from "./storage";
import { logFromWire, logToWire, LogWireError } from "./wire";

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
    expect(logFromWire(JSON.parse(text))).toEqual(sampleLog);
  });

  it("writes version 1, sessions oldest first, ISO timestamps, and omits absent fields", () => {
    const wire = logToWire(sampleLog);
    expect(wire.version).toBe(1);
    expect(wire.sessions.map((session) => session.date)).toEqual(["2026-11-02", "2026-11-04"]);
    expect(wire.sessions[0]?.sets[0]?.loggedAt).toBe("2026-11-02T18:04:00.000Z");
    expect(wire.sessions[1]).not.toHaveProperty("programWeek");
    expect(wire.sessions[1]?.sets[0]).not.toHaveProperty("reps");
  });

  it("rejects bad shapes with a message naming the field", () => {
    const cases: Array<[string, (wire: ReturnType<typeof validWire>) => unknown, string]> = [
      ["not an object", () => "text", "log: expected an object"],
      ["wrong version", (wire) => ({ ...wire, version: 2 }), "log.version"],
      ["sessions not array", (wire) => ({ ...wire, sessions: {} }), "log.sessions"],
      ["bad date", (wire) => { wire.sessions[0]!.date = "2026-02-30"; return wire; }, "sessions[0].date"],
      ["empty sets", (wire) => { wire.sessions[0]!.sets = []; return wire; }, "sessions[0].sets"],
      ["exerciseId type", (wire) => { (wire.sessions[0]!.sets[0] as Record<string, unknown>).exerciseId = 5; return wire; }, "exerciseId"],
      ["block position zero", (wire) => { wire.sessions[0]!.sets[0]!.blockPosition = 0; return wire; }, "blockPosition"],
      ["set number fraction", (wire) => { wire.sessions[0]!.sets[0]!.setNumber = 1.5; return wire; }, "setNumber"],
      ["reps string", (wire) => { (wire.sessions[0]!.sets[0] as Record<string, unknown>).reps = "6"; return wire; }, "reps"],
      ["negative load", (wire) => { (wire.sessions[0]!.sets[0] as Record<string, unknown>).loadKg = -1; return wire; }, "loadKg"],
      ["note not string", (wire) => { (wire.sessions[0]!.sets[0] as Record<string, unknown>).note = 3; return wire; }, "note"],
      ["bad timestamp", (wire) => { wire.sessions[0]!.sets[0]!.loggedAt = "yesterday"; return wire; }, "loggedAt"],
      ["bad week", (wire) => { (wire.sessions[0] as Record<string, unknown>).programWeek = "1"; return wire; }, "programWeek"],
    ];

    for (const [, breakIt, expectedText] of cases) {
      expect(() => logFromWire(breakIt(validWire())), expectedText).toThrow(LogWireError);
      expect(() => logFromWire(breakIt(validWire()))).toThrow(expectedText);
    }
  });

  it("rejects duplicate dates and duplicate sets", () => {
    const duplicateDate = validWire();
    duplicateDate.sessions.push(structuredClone(duplicateDate.sessions[0]!));
    expect(() => logFromWire(duplicateDate)).toThrow("duplicate session");

    const duplicateSet = validWire();
    duplicateSet.sessions[0]!.sets.push(structuredClone(duplicateSet.sessions[0]!.sets[0]!));
    expect(() => logFromWire(duplicateSet)).toThrow("duplicate set");
  });
});

describe("loadLog", () => {
  const now = new Date("2026-11-09T12:00:00.000Z");

  it("returns an empty log with no warning when nothing is stored", () => {
    expect(loadLog(fakeStorage(), now)).toEqual({ log: { sessions: {} } });
  });

  it("loads a saved log", () => {
    const storage = fakeStorage();
    saveLog(storage, sampleLog);
    expect(loadLog(storage, now)).toEqual({ log: sampleLog });
  });

  it("warns and keeps a backup for corrupt JSON, leaving the original untouched", () => {
    const storage = fakeStorage({ [LOG_STORAGE_KEY]: "{not json" });
    const result = loadLog(storage, now);

    expect(result.log).toEqual({ sessions: {} });
    expect(result.warning).toContain("could not be read");
    expect(storage.data.get(`${LOG_CORRUPT_BACKUP_PREFIX}2026-11-09T12:00:00.000Z`)).toBe("{not json");
    expect(storage.data.get(LOG_STORAGE_KEY)).toBe("{not json");
  });

  it("warns and keeps a backup for an unknown version", () => {
    const text = JSON.stringify({ version: 2, sessions: [] });
    const storage = fakeStorage({ [LOG_STORAGE_KEY]: text });
    const result = loadLog(storage, now);

    expect(result.warning).toContain("version");
    expect(storage.data.get(`${LOG_CORRUPT_BACKUP_PREFIX}2026-11-09T12:00:00.000Z`)).toBe(text);
  });

  it("warns and keeps a backup for a bad field type", () => {
    const wire = validWire();
    (wire.sessions[0]!.sets[0] as Record<string, unknown>).reps = "six";
    const text = JSON.stringify(wire);
    const storage = fakeStorage({ [LOG_STORAGE_KEY]: text });

    expect(loadLog(storage, now).warning).toContain("reps");
    expect([...storage.data.values()]).toContain(text);
  });

  it("different incidents get different backup keys", () => {
    const storage = fakeStorage({ [LOG_STORAGE_KEY]: "bad" });
    loadLog(storage, new Date("2026-11-09T12:00:00.000Z"));
    loadLog(storage, new Date("2026-11-10T12:00:00.000Z"));
    expect([...storage.data.keys()].filter((key) => key.startsWith(LOG_CORRUPT_BACKUP_PREFIX))).toHaveLength(2);
  });

  it("still returns an empty log with a warning when the backup cannot be written", () => {
    const storage = fakeStorage({ [LOG_STORAGE_KEY]: "bad" }, true);
    const result = loadLog(storage, now);
    expect(result.log).toEqual({ sessions: {} });
    expect(result.warning).toContain("backup copy could not be made");
  });

  it("returns an empty log with a warning when reading throws", () => {
    const storage: LogStorage = {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {},
    };
    expect(loadLog(storage, now).warning).toContain("blocked");
  });
});

describe("saveLog", () => {
  it("stores the wire JSON under the log key", () => {
    const storage = fakeStorage();
    expect(saveLog(storage, sampleLog)).toEqual({ ok: true });
    expect(JSON.parse(storage.data.get(LOG_STORAGE_KEY) as string)).toEqual(logToWire(sampleLog));
  });

  it("reports failure instead of throwing when storage is full", () => {
    expect(saveLog(fakeStorage({}, true), sampleLog)).toEqual({ ok: false, error: "QuotaExceededError" });
  });
});
