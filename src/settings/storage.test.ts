import { describe, expect, it } from "vitest";
import {
  loadSettings,
  saveSettings,
  settingsFromWire,
  settingsToWire,
  SETTINGS_STORAGE_KEY,
} from "./storage";

/** Minimal in-memory stand-in for localStorage. */
function fakeStorage(initial: Record<string, string> = {}): Storage {
  const data = new Map(Object.entries(initial));
  return {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => void data.set(key, value),
  } as unknown as Storage;
}

const defaults = { startDate: null, maxReps: {}, maxSavedOn: {}, maxHistory: {} };

describe("settings mapping", () => {
  it("round-trips valid settings", () => {
    const settings = {
      startDate: "2026-11-02",
      maxReps: { pull_up: 14, dip: 15 },
      maxSavedOn: { pull_up: "2026-12-18" },
      maxHistory: {
        pull_up: [
          { savedOn: "2026-11-02", reps: 12 },
          { savedOn: "2026-12-18", reps: 14 },
        ],
        dip: [{ savedOn: null, reps: 15 }],
      },
    };
    expect(settingsFromWire(settingsToWire(settings))).toEqual(settings);
    expect(settingsToWire(settings).version).toBe(3);
  });

  it("reads v1 data with no saved dates", () => {
    expect(settingsFromWire({ version: 1, startDate: "2026-11-02", maxReps: { pull_up: 12 } })).toEqual({
      startDate: "2026-11-02",
      maxReps: { pull_up: 12 },
      maxSavedOn: {},
      maxHistory: { pull_up: [{ savedOn: null, reps: 12 }] },
    });
  });

  it("maps v2 so the current max is the only history entry, dated maxSavedOn or unknown", () => {
    const v2 = {
      version: 2,
      startDate: "2026-11-02",
      maxReps: { pull_up: 12, dip: 15 },
      maxSavedOn: { pull_up: "2026-11-02" },
    };
    expect(settingsFromWire(v2)).toEqual({
      startDate: "2026-11-02",
      maxReps: { pull_up: 12, dip: 15 },
      maxSavedOn: { pull_up: "2026-11-02" },
      maxHistory: {
        pull_up: [{ savedOn: "2026-11-02", reps: 12 }],
        dip: [{ savedOn: null, reps: 15 }],
      },
    });
  });

  it("reads v3, sorting entries, keeping the later duplicate of a date and dropping bad entries", () => {
    const v3 = {
      version: 3,
      startDate: null,
      maxHistory: {
        pull_up: [
          { savedOn: "2026-12-18", reps: 14 },
          { savedOn: "2026-11-02", reps: 11 },
          { savedOn: "2026-11-02", reps: 12 },
          { savedOn: "2026-02-30", reps: 99 },
          { savedOn: "2026-11-05", reps: 0 },
          "junk",
        ],
        dip: [],
        bench: "nope",
      },
    };
    expect(settingsFromWire(v3)).toEqual({
      startDate: null,
      maxReps: { pull_up: 14 },
      maxSavedOn: { pull_up: "2026-12-18" },
      maxHistory: {
        pull_up: [
          { savedOn: "2026-11-02", reps: 12 },
          { savedOn: "2026-12-18", reps: 14 },
        ],
      },
    });
  });

  it("writes the latest max as the last history entry when the history is missing or stale", () => {
    const wire = settingsToWire({
      startDate: null,
      maxReps: { pull_up: 14, dip: 15 },
      maxSavedOn: { pull_up: "2026-12-18" },
      maxHistory: { pull_up: [{ savedOn: "2026-11-02", reps: 12 }] },
    });
    expect(wire.maxHistory).toEqual({
      pull_up: [
        { savedOn: "2026-11-02", reps: 12 },
        { savedOn: "2026-12-18", reps: 14 },
      ],
      dip: [{ savedOn: null, reps: 15 }],
    });
  });

  it("drops bad saved dates and dates for exercises without a max", () => {
    const wire = {
      version: 2,
      startDate: null,
      maxReps: { pull_up: 12, dip: 15 },
      maxSavedOn: { pull_up: "2026-02-30", dip: "2026-12-21", bench: "2026-12-21", extra: 5 },
    };
    expect(settingsFromWire(wire).maxSavedOn).toEqual({ dip: "2026-12-21" });
    expect(settingsFromWire({ ...wire, maxSavedOn: ["2026-12-21"] }).maxSavedOn).toEqual({});
    expect(settingsFromWire({ ...wire, maxSavedOn: undefined }).maxSavedOn).toEqual({});
  });

  it("returns defaults for non-objects and wrong versions", () => {
    expect(settingsFromWire(null)).toEqual(defaults);
    expect(settingsFromWire("text")).toEqual(defaults);
    expect(settingsFromWire({ version: 4, startDate: "2026-11-02", maxReps: { dip: 5 } })).toEqual(defaults);
    expect(settingsFromWire({ startDate: "2026-11-02" })).toEqual(defaults);
  });

  it("drops a bad date but keeps valid maxes", () => {
    expect(settingsFromWire({ version: 1, startDate: "2026-02-30", maxReps: { dip: 5 } })).toEqual({
      startDate: null,
      maxReps: { dip: 5 },
      maxSavedOn: {},
      maxHistory: { dip: [{ savedOn: null, reps: 5 }] },
    });
    expect(settingsFromWire({ version: 1, startDate: "11/02/2026", maxReps: {} }).startDate).toBeNull();
    expect(settingsFromWire({ version: 1, startDate: 5, maxReps: {} }).startDate).toBeNull();
  });

  it("drops non-positive-integer maxes", () => {
    const wire = { version: 1, startDate: null, maxReps: { a: 0, b: -3, c: 2.5, d: "7", e: null, f: 8 } };
    expect(settingsFromWire(wire).maxReps).toEqual({ f: 8 });
    expect(settingsFromWire({ version: 1, startDate: null, maxReps: [1, 2] }).maxReps).toEqual({});
  });
});

describe("loadSettings / saveSettings", () => {
  it("returns defaults when nothing is stored", () => {
    expect(loadSettings(fakeStorage())).toEqual(defaults);
  });

  it("returns defaults for corrupt JSON", () => {
    expect(loadSettings(fakeStorage({ [SETTINGS_STORAGE_KEY]: "{not json" }))).toEqual(defaults);
  });

  it("saves and reloads settings", () => {
    const storage = fakeStorage();
    const settings = {
      startDate: "2026-11-02",
      maxReps: { pull_up: 12 },
      maxSavedOn: { pull_up: "2026-11-02" },
      maxHistory: { pull_up: [{ savedOn: "2026-11-02", reps: 12 }] },
    };
    saveSettings(settings, storage);
    expect(JSON.parse(storage.getItem(SETTINGS_STORAGE_KEY) as string)).toEqual({
      version: 3,
      startDate: "2026-11-02",
      maxHistory: { pull_up: [{ savedOn: "2026-11-02", reps: 12 }] },
    });
    expect(loadSettings(storage)).toEqual(settings);
  });
});
