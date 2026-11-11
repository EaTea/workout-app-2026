import { describe, expect, it } from "vitest";
import {
  ACTIVE_PROGRAM_STORAGE_KEY,
  activeProgramFromWire,
  activeProgramToWire,
  chooseStartup,
  hasSavedProgramData,
  loadActiveProgramId,
  saveActiveProgramId,
} from "./activeProgram";
import type { Program } from "../program/model";
import type { LoadedCatalogueEntry } from "../program/load";
import { storageKeysForProgram } from "./programKeys";

/** A tiny in-memory Storage stand-in. */
function memoryStorage(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial));
  return {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => void data.set(key, value),
  };
}

describe("active program wire mapping", () => {
  it("writes version 1 with the program id", () => {
    expect(activeProgramToWire("steady-strength")).toEqual({ version: 1, programId: "steady-strength" });
  });

  it("reads back what it wrote", () => {
    expect(activeProgramFromWire(activeProgramToWire("steady-strength"))).toBe("steady-strength");
  });

  it.each([null, 7, "x", [], {}, { version: 2, programId: "a" }, { version: 1 }, { version: 1, programId: "" }, { version: 1, programId: 3 }])(
    "rejects %j",
    (json) => {
      expect(activeProgramFromWire(json)).toBeUndefined();
    },
  );
});

describe("loadActiveProgramId / saveActiveProgramId", () => {
  it("uses the app-wide key", () => {
    expect(ACTIVE_PROGRAM_STORAGE_KEY).toBe("workout-app.active-program");
  });

  it("returns undefined when nothing is stored", () => {
    expect(loadActiveProgramId(memoryStorage())).toBeUndefined();
  });

  it("round-trips a saved id", () => {
    const storage = memoryStorage();

    expect(saveActiveProgramId(storage, "steady-strength")).toEqual({ ok: true });
    expect(storage.getItem(ACTIVE_PROGRAM_STORAGE_KEY)).toBe('{"version":1,"programId":"steady-strength"}');
    expect(loadActiveProgramId(storage)).toBe("steady-strength");
  });

  it("returns undefined for unparsable or malformed text", () => {
    expect(loadActiveProgramId(memoryStorage({ [ACTIVE_PROGRAM_STORAGE_KEY]: "{broken" }))).toBeUndefined();
    expect(loadActiveProgramId(memoryStorage({ [ACTIVE_PROGRAM_STORAGE_KEY]: '{"version":9}' }))).toBeUndefined();
  });

  it("returns undefined when reading throws", () => {
    const blocked = { getItem: () => { throw new Error("blocked"); } };

    expect(loadActiveProgramId(blocked)).toBeUndefined();
  });

  it("reports a failed save instead of throwing", () => {
    const full = { setItem: () => { throw new Error("quota exceeded"); } };

    expect(saveActiveProgramId(full, "steady-strength")).toEqual({ ok: false, error: "quota exceeded" });
  });
});

/** A catalogue entry loaded fine. */
function loadedEntry(programId: string): LoadedCatalogueEntry {
  return {
    entry: { programId, programUrl: `./${programId}.json` },
    outcome: { kind: "loaded", program: {} as Program, warnings: [] },
  };
}

/** A catalogue entry whose file failed to load or parse. */
function brokenEntry(programId: string): LoadedCatalogueEntry {
  return {
    entry: { programId, programUrl: `./${programId}.json` },
    outcome: { kind: "broken", error: `./${programId}.json: bad` },
  };
}

describe("chooseStartup", () => {
  const both = [loadedEntry("explosive-endurance"), loadedEntry("steady-strength")];

  it("runs the stored program when it is in the catalogue and loaded", () => {
    expect(chooseStartup(both, "steady-strength", false)).toEqual({ kind: "run", programId: "steady-strength" });
  });

  it("lets the stored choice win over Explosive Endurance's saved data", () => {
    expect(chooseStartup(both, "steady-strength", true)).toEqual({ kind: "run", programId: "steady-strength" });
  });

  it("shows the error card for a stored program whose file is broken", () => {
    const loaded = [loadedEntry("explosive-endurance"), brokenEntry("steady-strength")];

    expect(chooseStartup(loaded, "steady-strength", true)).toEqual({
      kind: "broken",
      programId: "steady-strength",
      error: "./steady-strength.json: bad",
    });
  });

  it("opens the picker when the stored id is not in the catalogue, even with Explosive data", () => {
    expect(chooseStartup(both, "removed-program", true)).toEqual({ kind: "picker" });
  });

  it("runs Explosive Endurance when nothing is stored but it has saved data", () => {
    expect(chooseStartup(both, undefined, true)).toEqual({ kind: "run", programId: "explosive-endurance" });
  });

  it("does not depend on the order of the catalogue", () => {
    const reversed = [loadedEntry("steady-strength"), loadedEntry("explosive-endurance")];

    expect(chooseStartup(reversed, undefined, true)).toEqual({ kind: "run", programId: "explosive-endurance" });
    expect(chooseStartup(reversed, undefined, false)).toEqual({ kind: "picker" });
  });

  it("shows the error card when nothing is stored, Explosive has data and its file is broken", () => {
    const loaded = [brokenEntry("explosive-endurance"), loadedEntry("steady-strength")];

    expect(chooseStartup(loaded, undefined, true)).toMatchObject({ kind: "broken", programId: "explosive-endurance" });
  });

  it("opens the picker when nothing is stored and Explosive Endurance has no data", () => {
    expect(chooseStartup(both, undefined, false)).toEqual({ kind: "picker" });
  });

  it("opens the picker when nothing is stored and Explosive Endurance is not in the catalogue, whatever its data", () => {
    expect(chooseStartup([loadedEntry("steady-strength")], undefined, true)).toEqual({ kind: "picker" });
  });
});

describe("hasSavedProgramData", () => {
  const keys = storageKeysForProgram("explosive-endurance");
  const settingsText = (fields: object) => JSON.stringify({ version: 2, startDate: null, maxReps: {}, maxSavedOn: {}, ...fields });
  const emptyLogText = JSON.stringify({ version: 1, sessions: [] });

  /** A storage stand-in with the Storage methods the readers use. */
  function storageWith(initial: Record<string, string>): Storage {
    return memoryStorage(initial) as unknown as Storage;
  }

  it("is false for a fresh browser", () => {
    expect(hasSavedProgramData(storageWith({}), keys)).toBe(false);
  });

  it("is false when the stored settings and log are empty", () => {
    expect(hasSavedProgramData(storageWith({ [keys.settings]: settingsText({}), [keys.log]: emptyLogText }), keys)).toBe(false);
  });

  it("is true with a start date", () => {
    expect(hasSavedProgramData(storageWith({ [keys.settings]: settingsText({ startDate: "2026-11-02" }) }), keys)).toBe(true);
  });

  it("is true with a saved max", () => {
    expect(hasSavedProgramData(storageWith({ [keys.settings]: settingsText({ maxReps: { pull_up: 12 } }) }), keys)).toBe(true);
  });

  it("is true with a logged session", () => {
    const log = JSON.stringify({
      version: 1,
      sessions: [
        { date: "2026-11-02", sets: [{ exerciseId: "pull_up", blockPosition: 1, setNumber: 1, reps: 5, loggedAt: "2026-11-02T10:00:00.000Z" }] },
      ],
    });

    expect(hasSavedProgramData(storageWith({ [keys.log]: log }), keys)).toBe(true);
  });

  it("is true for a log that cannot be read, without copying it aside", () => {
    const writes: string[] = [];
    const storage = storageWith({ [keys.log]: "{ not json" });
    const spied = { getItem: storage.getItem.bind(storage), setItem: (key: string) => void writes.push(key) } as unknown as Storage;

    expect(hasSavedProgramData(spied, keys)).toBe(true);
    expect(writes).toEqual([]);
  });

  it("ignores another program's keys", () => {
    const other = storageKeysForProgram("steady-strength");

    expect(hasSavedProgramData(storageWith({ [other.settings]: settingsText({ startDate: "2026-11-02" }) }), keys)).toBe(false);
  });
});
