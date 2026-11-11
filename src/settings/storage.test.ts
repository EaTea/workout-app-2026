import { describe, expect, it } from "vitest";
import {
  loadSettings,
  saveSettings,
  settingsFromWire,
  settingsToWire,
} from "./storage";
import { storageKeysForProgram } from "../storage/programKeys";

/** Explosive Endurance's keys, the ones the app has always used. */
const KEYS = storageKeysForProgram("explosive-endurance");

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
  it("round-trips valid settings (v2 for the settings key, the history on top of it)", () => {
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
    expect(settingsFromWire(settingsToWire(settings), settings.maxHistory)).toEqual(settings);
    expect(settingsToWire(settings)).toEqual({
      version: 2,
      startDate: "2026-11-02",
      maxReps: { pull_up: 14, dip: 15 },
      maxSavedOn: { pull_up: "2026-12-18" },
    });
  });

  it("reads v1 data with no saved dates; each max becomes an undated history entry", () => {
    expect(settingsFromWire({ version: 1, startDate: "2026-11-02", maxReps: { pull_up: 12 } })).toEqual({
      startDate: "2026-11-02",
      maxReps: { pull_up: 12 },
      maxSavedOn: {},
      maxHistory: { pull_up: [{ savedOn: null, reps: 12 }] },
    });
  });

  it("reads v2 with no stored history: the current max is the only entry, dated maxSavedOn or unknown", () => {
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

  it("appends a settings max the history doesn't have (an older copy saved it)", () => {
    const history = { pull_up: [{ savedOn: "2026-11-02", reps: 12 }] };
    const v2 = { version: 2, startDate: null, maxReps: { pull_up: 14 }, maxSavedOn: { pull_up: "2026-12-18" } };
    expect(settingsFromWire(v2, history).maxHistory).toEqual({
      pull_up: [
        { savedOn: "2026-11-02", reps: 12 },
        { savedOn: "2026-12-18", reps: 14 },
      ],
    });
  });

  it("keeps the history of an exercise whose max was cleared", () => {
    const history = { pull_up: [{ savedOn: "2026-11-02", reps: 12 }] };
    const v2 = { version: 2, startDate: null, maxReps: {}, maxSavedOn: {} };
    expect(settingsFromWire(v2, history)).toEqual({ startDate: null, maxReps: {}, maxSavedOn: {}, maxHistory: history });
  });

  it("keeps the stored history when the settings entry is unusable", () => {
    const history = { pull_up: [{ savedOn: "2026-11-02", reps: 12 }] };
    expect(settingsFromWire("junk", history)).toEqual({ ...defaults, maxHistory: history });
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
    expect(settingsFromWire({ version: 3, startDate: "2026-11-02", maxReps: { dip: 5 } })).toEqual(defaults);
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
    expect(loadSettings(fakeStorage(), KEYS)).toEqual(defaults);
  });

  it("returns defaults for corrupt JSON", () => {
    expect(loadSettings(fakeStorage({ [KEYS.settings]: "{not json" }), KEYS)).toEqual(defaults);
  });

  it("saves v2 settings and the history in separate keys, and reloads them", () => {
    const storage = fakeStorage();
    const settings = {
      startDate: "2026-11-02",
      maxReps: { pull_up: 12 },
      maxSavedOn: { pull_up: "2026-11-02" },
      maxHistory: { pull_up: [{ savedOn: "2026-11-02", reps: 12 }] },
    };
    saveSettings(settings, storage, KEYS);
    expect(JSON.parse(storage.getItem(KEYS.settings) as string)).toEqual({
      version: 2,
      startDate: "2026-11-02",
      maxReps: { pull_up: 12 },
      maxSavedOn: { pull_up: "2026-11-02" },
    });
    expect(JSON.parse(storage.getItem(KEYS.maxHistory) as string)).toEqual({
      version: 1,
      maxHistory: { pull_up: [{ savedOn: "2026-11-02", reps: 12 }] },
    });
    expect(loadSettings(storage, KEYS)).toEqual(settings);
  });

  it("writes the current max into the history when the in-memory history is missing it", () => {
    const storage = fakeStorage();
    saveSettings({ startDate: null, maxReps: { pull_up: 14, dip: 15 }, maxSavedOn: { pull_up: "2026-12-18" }, maxHistory: { pull_up: [{ savedOn: "2026-11-02", reps: 12 }] } }, storage, KEYS);
    expect(JSON.parse(storage.getItem(KEYS.maxHistory) as string).maxHistory).toEqual({
      pull_up: [{ savedOn: "2026-11-02", reps: 12 }, { savedOn: "2026-12-18", reps: 14 }],
      dip: [{ savedOn: null, reps: 15 }],
    });
  });

  it("an undated max that isn't in the history is placed the same way in memory and after a reload (undated first, no duplicates)", () => {
    const storage = fakeStorage({
      [KEYS.settings]: JSON.stringify({ version: 2, startDate: null, maxReps: { pull_up: 14 }, maxSavedOn: {} }),
      [KEYS.maxHistory]: JSON.stringify({ version: 1, maxHistory: { pull_up: [{ savedOn: "2026-11-02", reps: 12 }] } }),
    });

    const firstLoad = loadSettings(storage, KEYS);
    expect(firstLoad.maxHistory.pull_up).toEqual([{ savedOn: null, reps: 14 }, { savedOn: "2026-11-02", reps: 12 }]);

    saveSettings(firstLoad, storage, KEYS);
    expect(loadSettings(storage, KEYS)).toEqual(firstLoad);
    expect(settingsFromWire(settingsToWire(firstLoad), firstLoad.maxHistory)).toEqual(firstLoad);
  });

  it("an older copy writing v2 settings over a newer history loses nothing", () => {
    const storage = fakeStorage();
    saveSettings({
      startDate: "2026-11-02",
      maxReps: { pull_up: 14 },
      maxSavedOn: { pull_up: "2026-12-18" },
      maxHistory: { pull_up: [{ savedOn: "2026-11-02", reps: 12 }, { savedOn: "2026-12-18", reps: 14 }] },
    }, storage, KEYS);

    // The older copy only knows the settings key: it writes its stale v2 settings (max 12, and it moved the start date).
    storage.setItem(KEYS.settings, JSON.stringify({ version: 2, startDate: "2026-11-03", maxReps: { pull_up: 12 }, maxSavedOn: { pull_up: "2026-11-02" } }));

    const loaded = loadSettings(storage, KEYS);
    expect(loaded.startDate).toBe("2026-11-03");
    expect(loaded.maxHistory.pull_up).toEqual([{ savedOn: "2026-11-02", reps: 12 }, { savedOn: "2026-12-18", reps: 14 }]);

    // Even after the app saves what it loaded, the 14 is still in the history.
    saveSettings(loaded, storage, KEYS);
    expect(loadSettings(storage, KEYS).maxHistory.pull_up).toContainEqual({ savedOn: "2026-12-18", reps: 14 });
  });

  it("an older copy that saved a newer max is picked up on the next load, with the history intact", () => {
    const storage = fakeStorage({
      [KEYS.maxHistory]: JSON.stringify({ version: 1, maxHistory: { pull_up: [{ savedOn: "2026-11-02", reps: 12 }] } }),
      [KEYS.settings]: JSON.stringify({ version: 2, startDate: null, maxReps: { pull_up: 13 }, maxSavedOn: { pull_up: "2026-12-01" } }),
    });
    expect(loadSettings(storage, KEYS).maxHistory.pull_up).toEqual([{ savedOn: "2026-11-02", reps: 12 }, { savedOn: "2026-12-01", reps: 13 }]);
  });

  it("keeps the history when the settings entry is corrupt", () => {
    const storage = fakeStorage({
      [KEYS.settings]: "{not json",
      [KEYS.maxHistory]: JSON.stringify({ version: 1, maxHistory: { pull_up: [{ savedOn: "2026-11-02", reps: 12 }] } }),
    });
    expect(loadSettings(storage, KEYS).maxHistory).toEqual({ pull_up: [{ savedOn: "2026-11-02", reps: 12 }] });
  });
});

describe("exercise ids that are Object.prototype member names", () => {
  it("reads a max for an exercise called constructor or toString, with and without a saved date", () => {
    const settings = settingsFromWire({ version: 2, startDate: null, maxReps: { constructor: 7, toString: 5 }, maxSavedOn: { constructor: "2026-11-03" } });

    expect(settings.maxReps).toEqual({ constructor: 7, toString: 5 });
    expect(settings.maxHistory.constructor).toEqual([{ savedOn: "2026-11-03", reps: 7 }]);
    expect(settings.maxHistory.toString).toEqual([{ savedOn: null, reps: 5 }]);
  });
});
