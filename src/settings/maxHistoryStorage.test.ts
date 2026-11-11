import { describe, expect, it } from "vitest";
import { loadMaxHistory, MAX_HISTORY_STORAGE_KEY, maxHistoryFromWire, maxHistoryToWire, saveMaxHistory } from "./maxHistoryStorage";

/** Minimal in-memory stand-in for localStorage. */
function fakeStorage(initial: Record<string, string> = {}): Storage {
  const data = new Map(Object.entries(initial));
  return {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => void data.set(key, value),
  } as unknown as Storage;
}

describe("max history mapping", () => {
  it("round-trips a history through the wire form", () => {
    const history = {
      pull_up: [{ savedOn: "2026-11-02", reps: 12 }, { savedOn: "2026-12-18", reps: 14 }],
      dip: [{ savedOn: null, reps: 15 }],
    };
    expect(maxHistoryToWire(history)).toEqual({ version: 1, maxHistory: history });
    expect(maxHistoryFromWire(maxHistoryToWire(history))).toEqual(history);
  });

  it("sorts entries, keeps the later duplicate of a date, drops bad entries and empty exercises", () => {
    const wire = {
      version: 1,
      maxHistory: {
        pull_up: [
          { savedOn: "2026-12-18", reps: 14 },
          { savedOn: "2026-11-02", reps: 11 },
          { savedOn: "2026-11-02", reps: 12 },
          { savedOn: "2026-02-30", reps: 99 },
          { savedOn: "2026-11-05", reps: 0 },
          { savedOn: 5, reps: 3 },
          "junk",
        ],
        dip: [],
        bench: "nope",
      },
    };
    expect(maxHistoryFromWire(wire)).toEqual({
      pull_up: [{ savedOn: "2026-11-02", reps: 12 }, { savedOn: "2026-12-18", reps: 14 }],
    });
  });

  it("gives an empty history for anything unreadable or of another version", () => {
    expect(maxHistoryFromWire(null)).toEqual({});
    expect(maxHistoryFromWire({ version: 2, maxHistory: { pull_up: [{ savedOn: null, reps: 5 }] } })).toEqual({});
    expect(maxHistoryFromWire({ version: 1, maxHistory: [1] })).toEqual({});
  });
});

describe("loadMaxHistory / saveMaxHistory", () => {
  it("is empty when nothing is stored or the text is corrupt", () => {
    expect(loadMaxHistory(fakeStorage())).toEqual({});
    expect(loadMaxHistory(fakeStorage({ [MAX_HISTORY_STORAGE_KEY]: "{oops" }))).toEqual({});
  });

  it("saves and reloads", () => {
    const storage = fakeStorage();
    const history = { pull_up: [{ savedOn: "2026-11-02", reps: 12 }] };
    saveMaxHistory(history, storage);
    expect(loadMaxHistory(storage)).toEqual(history);
  });
});
