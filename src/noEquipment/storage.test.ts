import { describe, expect, it } from "vitest";
import { FakeStorage } from "../export/testStorage";
import { storageKeysForProgram } from "../storage/programKeys";
import { loadTicks, setTick, ticksForDate } from "./storage";
import { ticksFromWire, ticksToWire } from "./wire";

const KEY = storageKeysForProgram("explosive-endurance").noEquipment;
const TODAY = "2026-11-20";

/** Reads the stored JSON back, for asserting what was written. */
function storedWire(storage: FakeStorage): unknown {
  return JSON.parse(storage.getItem(KEY) ?? "null");
}

describe("wire mapping", () => {
  it("round-trips ticks through the wire form", () => {
    const ticks = new Map([
      ["2026-11-05", new Set(["3:single_leg_rdl", "5:pull_up"])],
      ["2026-11-04", new Set(["2:dip"])],
    ]);

    const wire = ticksToWire(ticks);

    expect(wire).toEqual({ version: 1, ticks: { "2026-11-04": ["2:dip"], "2026-11-05": ["3:single_leg_rdl", "5:pull_up"] } });
    expect(ticksFromWire(JSON.parse(JSON.stringify(wire)))).toEqual(ticks);
  });

  it("leaves dates with no ticks out of the wire form", () => {
    expect(ticksToWire(new Map([["2026-11-05", new Set<string>()]])).ticks).toEqual({});
  });

  it.each([
    ["null", null],
    ["a string", "x"],
    ["an array", []],
    ["a wrong version", { version: 2, ticks: { "2026-11-05": ["3:a"] } }],
    ["a missing version", { ticks: { "2026-11-05": ["3:a"] } }],
    ["ticks not an object", { version: 1, ticks: [] }],
    ["ticks missing", { version: 1 }],
  ])("starts empty for %s", (_name, wire) => {
    expect(ticksFromWire(wire).size).toBe(0);
  });

  it("drops bad dates, non-array values, bad keys and non-string entries, keeping the rest", () => {
    const ticks = ticksFromWire({
      version: 1,
      ticks: {
        "2026-11-05": ["3:single_leg_rdl", "bad", "3:UPPER", ":x", "3:", 7, null, "3:ok id"],
        "2026-02-30": ["3:a"],
        tomorrow: ["3:a"],
        "2026-11-06": "3:a",
        "2026-11-07": ["nope"],
      },
    });

    expect([...ticks.keys()]).toEqual(["2026-11-05"]);
    expect([...ticksForDate(ticks, "2026-11-05")]).toEqual(["3:single_leg_rdl"]);
  });
});

describe("day-qualified keys (rows of a combined session)", () => {
  it("are kept by ticksFromWire and survive the round trip, while malformed ones are dropped", () => {
    const ticks = ticksFromWire({ version: 1, ticks: { "2026-11-09": ["1.3:pull_up", "2.4:single_leg_rdl", "3:dip", ".3:x", "1.:x", "1.2.3:x", "a.3:x"] } });

    expect([...ticksForDate(ticks, "2026-11-09")].sort()).toEqual(["1.3:pull_up", "2.4:single_leg_rdl", "3:dip"]);
    expect(ticksFromWire(JSON.parse(JSON.stringify(ticksToWire(ticks))))).toEqual(ticks);
  });
});

describe("loadTicks", () => {
  it("is empty when nothing is stored", () => {
    expect(loadTicks(new FakeStorage(), KEY).size).toBe(0);
  });

  it("is empty, without throwing or keeping a copy, for malformed JSON", () => {
    const storage = new FakeStorage({ [KEY]: "{not json" });

    expect(loadTicks(storage, KEY).size).toBe(0);
    expect(storage.writeLog).toEqual([]);
  });

  it("is empty when reading storage throws", () => {
    const throwingStorage = { getItem: () => { throw new Error("blocked"); }, setItem: () => {} };

    expect(loadTicks(throwingStorage, KEY).size).toBe(0);
  });
});

describe("ticksForDate", () => {
  it("is empty for a date with no ticks", () => {
    expect(ticksForDate(new Map(), "2026-11-05").size).toBe(0);
  });
});

describe("setTick", () => {
  it("ticks and unticks an item, persisting each change", () => {
    const storage = new FakeStorage();

    setTick(storage, KEY, TODAY, "3:single_leg_rdl", true, TODAY);
    expect(storedWire(storage)).toEqual({ version: 1, ticks: { [TODAY]: ["3:single_leg_rdl"] } });

    setTick(storage, KEY, TODAY, "5:pull_up", true, TODAY);
    expect([...ticksForDate(loadTicks(storage, KEY), TODAY)]).toEqual(["3:single_leg_rdl", "5:pull_up"]);

    setTick(storage, KEY, TODAY, "3:single_leg_rdl", false, TODAY);
    expect([...ticksForDate(loadTicks(storage, KEY), TODAY)]).toEqual(["5:pull_up"]);
  });

  it("returns the saved ticks", () => {
    const result = setTick(new FakeStorage(), KEY, TODAY, "3:a", true, TODAY);

    expect(result.ok && [...ticksForDate(result.ticks, TODAY)]).toEqual(["3:a"]);
  });

  it("re-reads before saving, so another writer's change for another date survives", () => {
    const storage = new FakeStorage();
    setTick(storage, KEY, TODAY, "3:a", true, TODAY);
    // A second open copy of the app writes a tick for another day after this copy's load.
    const staleView = loadTicks(storage, KEY);
    setTick(storage, KEY, "2026-11-21", "4:b", true, TODAY);

    setTick(storage, KEY, TODAY, "5:c", true, TODAY);

    expect(staleView.has("2026-11-21")).toBe(false);
    const stored = loadTicks(storage, KEY);
    expect([...ticksForDate(stored, "2026-11-21")]).toEqual(["4:b"]);
    expect([...ticksForDate(stored, TODAY)]).toEqual(["3:a", "5:c"]);
  });

  it("keeps a date exactly 14 days before today and prunes one 15 days before", () => {
    const storage = new FakeStorage({
      [KEY]: JSON.stringify({ version: 1, ticks: { "2026-11-06": ["1:a"], "2026-11-05": ["1:b"] } }),
    });

    setTick(storage, KEY, TODAY, "3:c", true, TODAY);

    expect(Object.keys((storedWire(storage) as { ticks: object }).ticks)).toEqual(["2026-11-06", TODAY]);
  });

  it("keeps a backfilled date older than the retention window but still prunes an older other date", () => {
    const storage = new FakeStorage({
      [KEY]: JSON.stringify({ version: 1, ticks: { "2026-10-01": ["1:a"] } }),
    });

    // 2026-10-31 is 20 days before TODAY: written on purpose, so it must stay.
    const result = setTick(storage, KEY, "2026-10-31", "3:single_leg_rdl", true, TODAY);

    expect(result.ok).toBe(true);
    expect(storedWire(storage)).toEqual({ version: 1, ticks: { "2026-10-31": ["3:single_leg_rdl"] } });
  });

  it("removes a date whose last tick is unticked", () => {
    const storage = new FakeStorage();
    setTick(storage, KEY, TODAY, "3:a", true, TODAY);

    setTick(storage, KEY, TODAY, "3:a", false, TODAY);

    expect(storedWire(storage)).toEqual({ version: 1, ticks: {} });
  });

  it("keeps different programs' ticks separate", () => {
    const storage = new FakeStorage();
    const otherKey = storageKeysForProgram("steady-strength").noEquipment;

    setTick(storage, KEY, TODAY, "3:a", true, TODAY);

    expect(loadTicks(storage, otherKey).size).toBe(0);
    expect(otherKey).not.toBe(KEY);
  });

  it("reports a write failure without throwing", () => {
    const storage = new FakeStorage();
    storage.failingKeys.add(KEY);

    const result = setTick(storage, KEY, TODAY, "3:a", true, TODAY);

    expect(result).toEqual({ ok: false, error: `quota exceeded for ${KEY}` });
  });
});
