import { describe, expect, it } from "vitest";
import { FakeStorage } from "../export/testStorage";
import { storageKeysForProgram } from "../storage/programKeys";
import { optionalBlockKey, type SkippedBlocksByDate } from "./model";
import { loadOptionalBlockChoices, saveOptionalBlockChoices, setBlockSkipped } from "./storage";
import { optionalBlockChoicesFromWire, optionalBlockChoicesToWire } from "./wire";

const KEY = storageKeysForProgram("explosive-endurance").optionalBlockChoices;

describe("optionalBlockKey", () => {
  it("spells the key as day, colon, block position", () => {
    expect(optionalBlockKey(1, 6)).toBe("1:6");
    expect(optionalBlockKey(5, 6)).toBe("5:6");
  });
});

describe("wire mapping", () => {
  it("round-trips skips through the wire form, with dates and keys sorted", () => {
    const skips: SkippedBlocksByDate = new Map([
      ["2026-11-20", new Set(["5:6"])],
      ["2026-11-16", new Set(["5:6", "1:6"])],
    ]);

    const wire = optionalBlockChoicesToWire(skips);

    expect(Object.keys(wire.choices)).toEqual(["2026-11-16", "2026-11-20"]);
    expect(wire).toEqual({ version: 1, choices: { "2026-11-16": { skipped: ["1:6", "5:6"] }, "2026-11-20": { skipped: ["5:6"] } } });
    expect(optionalBlockChoicesFromWire(JSON.parse(JSON.stringify(wire)))).toEqual(skips);
  });

  it("does not write a date with no skips", () => {
    expect(optionalBlockChoicesToWire(new Map([["2026-11-16", new Set<string>()]]))).toEqual({ version: 1, choices: {} });
  });

  it.each([
    ["null", null],
    ["a string", "x"],
    ["an array", []],
    ["a wrong version", { version: 2, choices: { "2026-11-16": { skipped: ["1:6"] } } }],
    ["a missing version", { choices: { "2026-11-16": { skipped: ["1:6"] } } }],
    ["choices not an object", { version: 1, choices: [] }],
    ["choices missing", { version: 1 }],
  ])("starts empty for %s", (_name, wire) => {
    expect(optionalBlockChoicesFromWire(wire)).toEqual(new Map());
  });

  it.each([
    ["a date that is not a date", { tomorrow: { skipped: ["1:6"] } }],
    ["an impossible date", { "2026-02-30": { skipped: ["1:6"] } }],
    ["a date entry that is not an object", { "2026-11-16": "1:6" }],
    ["skipped not a list", { "2026-11-16": { skipped: "1:6" } }],
    ["only unusable keys", { "2026-11-16": { skipped: ["8:1", "1:0", "x", "1:6:2", 16, null] } }],
  ])("drops %s on its own", (_name, choices) => {
    expect(optionalBlockChoicesFromWire({ version: 1, choices })).toEqual(new Map());
  });

  it("keeps the usable keys of a date and drops the others", () => {
    const skips = optionalBlockChoicesFromWire({ version: 1, choices: { "2026-11-16": { skipped: ["1:6", "0:1", "bad", 3, "1:6"] } } });

    expect(skips).toEqual(new Map([["2026-11-16", new Set(["1:6"])]]));
  });
});

describe("loadOptionalBlockChoices", () => {
  it("gives no skips when nothing is stored", () => {
    expect(loadOptionalBlockChoices(new FakeStorage(), KEY)).toEqual(new Map());
  });

  it("gives no skips for text that is not JSON", () => {
    expect(loadOptionalBlockChoices(new FakeStorage({ [KEY]: "{not json" }), KEY)).toEqual(new Map());
  });

  it("reads what saveOptionalBlockChoices wrote", () => {
    const storage = new FakeStorage();
    const skips: SkippedBlocksByDate = new Map([["2026-11-16", new Set(["1:6"])]]);

    expect(saveOptionalBlockChoices(storage, KEY, skips)).toEqual({ ok: true, skipsByDate: skips });
    expect(loadOptionalBlockChoices(storage, KEY)).toEqual(skips);
  });
});

describe("setBlockSkipped", () => {
  it("stores a skip, and several blocks of one date together", () => {
    const storage = new FakeStorage();

    setBlockSkipped(storage, KEY, "2026-11-16", "1:6", true);
    const result = setBlockSkipped(storage, KEY, "2026-11-16", "5:6", true);

    expect(result.ok && result.skipsByDate).toEqual(new Map([["2026-11-16", new Set(["1:6", "5:6"])]]));
    expect(JSON.parse(storage.getItem(KEY) as string)).toEqual({ version: 1, choices: { "2026-11-16": { skipped: ["1:6", "5:6"] } } });
  });

  it("removes a skip, and the date once its last skip is gone", () => {
    const storage = new FakeStorage();
    setBlockSkipped(storage, KEY, "2026-11-16", "1:6", true);
    setBlockSkipped(storage, KEY, "2026-11-16", "5:6", true);

    setBlockSkipped(storage, KEY, "2026-11-16", "1:6", false);
    expect(loadOptionalBlockChoices(storage, KEY)).toEqual(new Map([["2026-11-16", new Set(["5:6"])]]));

    setBlockSkipped(storage, KEY, "2026-11-16", "5:6", false);
    expect(loadOptionalBlockChoices(storage, KEY)).toEqual(new Map());
    expect(JSON.parse(storage.getItem(KEY) as string)).toEqual({ version: 1, choices: {} });
  });

  it("un-skipping a block that was never skipped changes nothing", () => {
    const storage = new FakeStorage();

    const result = setBlockSkipped(storage, KEY, "2026-11-16", "1:6", false);

    expect(result.ok && result.skipsByDate).toEqual(new Map());
  });

  it("re-reads before writing, so a skip stored by another open copy is kept", () => {
    const storage = new FakeStorage();
    setBlockSkipped(storage, KEY, "2026-11-16", "1:6", true);
    // Another tab stores a different date's skip behind this one's back.
    storage.setItem(KEY, JSON.stringify({ version: 1, choices: { "2026-11-16": { skipped: ["1:6"] }, "2026-11-20": { skipped: ["5:6"] } } }));

    setBlockSkipped(storage, KEY, "2026-11-23", "1:6", true);

    expect([...loadOptionalBlockChoices(storage, KEY).keys()]).toEqual(["2026-11-16", "2026-11-20", "2026-11-23"]);
  });

  it("reports a write failure instead of throwing", () => {
    const storage = new FakeStorage();
    storage.failingKeys.add(KEY);

    const result = setBlockSkipped(storage, KEY, "2026-11-16", "1:6", true);

    expect(result.ok).toBe(false);
  });
});
