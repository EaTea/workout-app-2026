import { describe, expect, it } from "vitest";
import { MAX_HISTORY_STORAGE_KEY } from "../settings/maxHistoryStorage";
import { SETTINGS_STORAGE_KEY } from "../settings/storage";
import { readExportSource, type ExportReadStorage } from "./source";

/** Minimal in-memory stand-in for localStorage, with the key listing `readExportSource` needs. */
function fakeStorage(initial: Record<string, string> = {}): ExportReadStorage {
  const data = new Map(Object.entries(initial));
  return {
    get length() {
      return data.size;
    },
    key: (index: number) => [...data.keys()][index] ?? null,
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => void data.set(key, value),
  } as unknown as ExportReadStorage;
}

describe("readExportSource", () => {
  it("reads the max history from its own storage key, including maxes no longer set", () => {
    const storage = fakeStorage({
      [SETTINGS_STORAGE_KEY]: JSON.stringify({ version: 2, startDate: "2026-11-02", maxReps: { pull_up: 14 }, maxSavedOn: { pull_up: "2026-12-18" } }),
      [MAX_HISTORY_STORAGE_KEY]: JSON.stringify({
        version: 1,
        maxHistory: { pull_up: [{ savedOn: "2026-11-02", reps: 12 }], dip: [{ savedOn: "2026-11-02", reps: 15 }] },
      }),
    });

    const source = readExportSource(storage);

    expect(source.settings.maxHistory).toEqual({
      pull_up: [{ savedOn: "2026-11-02", reps: 12 }, { savedOn: "2026-12-18", reps: 14 }],
      dip: [{ savedOn: "2026-11-02", reps: 15 }],
    });
  });

  it("returns empty data from empty storage without writing anything", () => {
    const storage = fakeStorage();

    const source = readExportSource(storage);

    expect(source.settings.maxHistory).toEqual({});
    expect(source.log.sessions).toEqual({});
    expect(storage.length).toBe(0);
  });
});
