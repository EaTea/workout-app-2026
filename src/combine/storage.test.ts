import { describe, expect, it } from "vitest";
import { FakeStorage } from "../export/testStorage";
import { storageKeysForProgram } from "../storage/programKeys";
import type { CombinesByDate } from "./model";
import { addCombine, loadCombines, removeCombine, saveCombines } from "./storage";
import { combinesFromWire, combinesToWire } from "./wire";

const KEY = storageKeysForProgram("explosive-endurance").combines;

const NOV_9_COMBINE = { hostDay: 1, addedDay: 2, addedDate: "2026-11-10" };
const NOV_12_COMBINE = { hostDay: 4, addedDay: 3, addedDate: "2026-11-11" };

describe("wire mapping", () => {
  it("round-trips combines through the wire form, with host dates sorted", () => {
    const combines: CombinesByDate = new Map([
      ["2026-11-12", NOV_12_COMBINE],
      ["2026-11-09", NOV_9_COMBINE],
    ]);

    const wire = combinesToWire(combines);

    expect(Object.keys(wire.combines)).toEqual(["2026-11-09", "2026-11-12"]);
    expect(wire).toEqual({ version: 1, combines: { "2026-11-09": NOV_9_COMBINE, "2026-11-12": NOV_12_COMBINE } });
    expect(combinesFromWire(JSON.parse(JSON.stringify(wire)))).toEqual(combines);
  });

  it.each([
    ["null", null],
    ["a string", "x"],
    ["an array", []],
    ["a wrong version", { version: 2, combines: { "2026-11-09": NOV_9_COMBINE } }],
    ["a missing version", { combines: { "2026-11-09": NOV_9_COMBINE } }],
    ["combines not an object", { version: 1, combines: [] }],
    ["combines missing", { version: 1 }],
  ])("starts empty for %s", (_name, wire) => {
    expect(combinesFromWire(wire)).toEqual(new Map());
  });

  it.each([
    ["a host date that is not a date", "tomorrow", NOV_9_COMBINE],
    ["an impossible host date", "2026-02-30", NOV_9_COMBINE],
    ["an added date that is not a date", "2026-11-09", { ...NOV_9_COMBINE, addedDate: "soon" }],
    ["a missing added date", "2026-11-09", { hostDay: 1, addedDay: 2 }],
    ["an added date equal to the host date", "2026-11-09", { ...NOV_9_COMBINE, addedDate: "2026-11-09" }],
    ["the same day twice", "2026-11-09", { ...NOV_9_COMBINE, addedDay: 1 }],
    ["a day of 0", "2026-11-09", { ...NOV_9_COMBINE, hostDay: 0 }],
    ["a day of 8", "2026-11-09", { ...NOV_9_COMBINE, addedDay: 8 }],
    ["a fractional day", "2026-11-09", { ...NOV_9_COMBINE, addedDay: 2.5 }],
    ["a text day", "2026-11-09", { ...NOV_9_COMBINE, hostDay: "1" }],
    ["a non-object entry", "2026-11-09", "1+2"],
  ])("drops an entry with %s but keeps the good ones", (_name, badHostDate, badEntry) => {
    const wire = { version: 1, combines: { [badHostDate]: badEntry, "2026-11-12": NOV_12_COMBINE } };

    expect(combinesFromWire(wire)).toEqual(new Map([["2026-11-12", NOV_12_COMBINE]]));
  });

  it("ignores extra fields on an entry", () => {
    const wire = { version: 1, combines: { "2026-11-09": { ...NOV_9_COMBINE, colour: "red" } } };

    expect(combinesFromWire(wire)).toEqual(new Map([["2026-11-09", NOV_9_COMBINE]]));
  });
});

describe("loadCombines", () => {
  it("is empty when nothing is stored", () => {
    expect(loadCombines(new FakeStorage(), KEY)).toEqual(new Map());
  });

  it("is empty for text that is not JSON", () => {
    expect(loadCombines(new FakeStorage({ [KEY]: "{not json" }), KEY)).toEqual(new Map());
  });

  it("is empty when storage cannot be read", () => {
    const unreadable = { getItem: () => { throw new Error("denied"); }, setItem: () => undefined };
    expect(loadCombines(unreadable, KEY)).toEqual(new Map());
  });
});

describe("addCombine, removeCombine and saveCombines", () => {
  it("adds a combine, then another, and loads both back", () => {
    const storage = new FakeStorage();

    addCombine(storage, KEY, "2026-11-09", NOV_9_COMBINE);
    const result = addCombine(storage, KEY, "2026-11-12", NOV_12_COMBINE);

    expect(result.ok).toBe(true);
    expect(loadCombines(storage, KEY)).toEqual(new Map([["2026-11-09", NOV_9_COMBINE], ["2026-11-12", NOV_12_COMBINE]]));
  });

  it("re-reads before writing, so a change made by another open copy is kept", () => {
    const storage = new FakeStorage();
    addCombine(storage, KEY, "2026-11-09", NOV_9_COMBINE);

    // A second copy of the app saved a combine this copy never saw.
    storage.setItem(KEY, JSON.stringify(combinesToWire(new Map([["2026-11-09", NOV_9_COMBINE], ["2026-11-12", NOV_12_COMBINE]]))));
    removeCombine(storage, KEY, "2026-11-09");

    expect(loadCombines(storage, KEY)).toEqual(new Map([["2026-11-12", NOV_12_COMBINE]]));
  });

  it("removing a date with no combine changes nothing", () => {
    const storage = new FakeStorage();
    addCombine(storage, KEY, "2026-11-09", NOV_9_COMBINE);

    expect(removeCombine(storage, KEY, "2026-11-20").ok).toBe(true);
    expect(loadCombines(storage, KEY).size).toBe(1);
  });

  it("returns the readable error when the write fails, and leaves the stored value alone", () => {
    const storage = new FakeStorage();
    addCombine(storage, KEY, "2026-11-09", NOV_9_COMBINE);
    storage.failingKeys.add(KEY);

    const result = addCombine(storage, KEY, "2026-11-12", NOV_12_COMBINE);

    expect(result).toEqual({ ok: false, error: `quota exceeded for ${KEY}` });
    expect(loadCombines(storage, KEY).size).toBe(1);
  });

  it("saveCombines replaces everything stored", () => {
    const storage = new FakeStorage();
    addCombine(storage, KEY, "2026-11-09", NOV_9_COMBINE);

    saveCombines(storage, KEY, new Map([["2026-11-12", NOV_12_COMBINE]]));

    expect(loadCombines(storage, KEY)).toEqual(new Map([["2026-11-12", NOV_12_COMBINE]]));
  });
});
