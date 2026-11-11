import { describe, expect, it } from "vitest";
import {
  ACTIVE_PROGRAM_STORAGE_KEY,
  activeProgramFromWire,
  activeProgramToWire,
  chooseCatalogueEntry,
  loadActiveProgramId,
  saveActiveProgramId,
} from "./activeProgram";

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

describe("chooseCatalogueEntry", () => {
  const catalogue = {
    entries: [
      { programId: "explosive-endurance", programUrl: "./program.json" },
      { programId: "steady-strength", programUrl: "./steady-strength.json" },
    ],
  };

  it("uses the stored program when the catalogue has it", () => {
    expect(chooseCatalogueEntry(catalogue, "steady-strength")).toBe(catalogue.entries[1]);
  });

  it("falls back to the first entry when nothing is stored", () => {
    expect(chooseCatalogueEntry(catalogue, undefined)).toBe(catalogue.entries[0]);
  });

  it("falls back to the first entry when the stored id is not in the catalogue", () => {
    expect(chooseCatalogueEntry(catalogue, "removed-program")).toBe(catalogue.entries[0]);
  });
});
