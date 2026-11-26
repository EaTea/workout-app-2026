import { describe, expect, it } from "vitest";
import { FakeStorage } from "../export/testStorage";
import { storageKeysForProgram } from "../storage/programKeys";
import type { Injury, InjuryChoices } from "./model";
import { activeAreasOn, activeInjuriesOn, clearInjury, flagInjury, openInjuryFor } from "./operations";
import { addBackKeysForDate, clearInjuryAndSave, flagInjuryAndSave, loadInjuries, loadInjuryChoices, setInjuryChoice } from "./storage";
import { choicesFromWire, choicesToWire, injuriesFromWire, injuriesToWire } from "./wire";

const keys = storageKeysForProgram("explosive-endurance");
const TODAY = "2026-11-22";

const rightShoulder: Injury = { area: "shoulder", side: "right", from: "2026-11-22", note: "Fell on it" };

describe("injuries wire mapping", () => {
  it("round-trips injuries, leaving absent to and note out of the JSON", () => {
    const injuries: Injury[] = [rightShoulder, { area: "shoulder", side: "both", from: "2026-10-01", to: "2026-10-10" }];

    const wire = injuriesToWire(injuries);

    expect(wire).toEqual({
      version: 1,
      injuries: [
        { area: "shoulder", side: "right", from: "2026-11-22", note: "Fell on it" },
        { area: "shoulder", side: "both", from: "2026-10-01", to: "2026-10-10" },
      ],
    });
    expect(injuriesFromWire(JSON.parse(JSON.stringify(wire)))).toEqual(injuries);
  });

  it.each([
    ["null", null],
    ["a string", "x"],
    ["an array", []],
    ["a wrong version", { version: 2, injuries: [{ area: "shoulder", side: "left", from: "2026-11-22" }] }],
    ["a missing version", { injuries: [] }],
    ["injuries not a list", { version: 1, injuries: {} }],
  ])("loads nothing for %s", (_name, wire) => {
    expect(injuriesFromWire(wire)).toEqual([]);
  });

  it("skips bad entries and keeps the good ones", () => {
    const injuries = injuriesFromWire({
      version: 1,
      injuries: [
        null,
        "x",
        { area: "knee", side: "left", from: "2026-11-22" },
        { area: "shoulder", side: "up", from: "2026-11-22" },
        { area: "shoulder", side: "left", from: "2026-02-30" },
        { area: "shoulder", side: "left" },
        { area: "shoulder", side: "left", from: "2026-11-22" },
      ],
    });

    expect(injuries).toEqual([{ area: "shoulder", side: "left", from: "2026-11-22" }]);
  });

  it("drops a bad to (leaving the injury flagged) and a note that is not text", () => {
    const injuries = injuriesFromWire({
      version: 1,
      injuries: [
        { area: "shoulder", side: "left", from: "2026-11-22", to: "soon", note: 5 },
        { area: "shoulder", side: "right", from: "2026-11-22", to: "2026-11-01", note: "" },
      ],
    });

    expect(injuries).toEqual([
      { area: "shoulder", side: "left", from: "2026-11-22" },
      { area: "shoulder", side: "right", from: "2026-11-22" },
    ]);
  });
});

describe("choices wire mapping", () => {
  it("round-trips choices with dates and keys sorted, leaving empty dates out", () => {
    const choices: InjuryChoices = new Map([
      ["2026-11-24", new Map([["3:pull_up", "addBack" as const]])],
      ["2026-11-23", new Map([["5:dip", "addBack" as const], ["3:pull_up", "addBack" as const]])],
      ["2026-11-25", new Map()],
    ]);

    const wire = choicesToWire(choices);

    expect(Object.keys(wire.choices)).toEqual(["2026-11-23", "2026-11-24"]);
    expect(Object.keys(wire.choices["2026-11-23"]!)).toEqual(["3:pull_up", "5:dip"]);
    expect(choicesFromWire(JSON.parse(JSON.stringify(wire)))).toEqual(
      new Map([
        ["2026-11-23", new Map([["3:pull_up", "addBack"], ["5:dip", "addBack"]])],
        ["2026-11-24", new Map([["3:pull_up", "addBack"]])],
      ]),
    );
  });

  it.each([
    ["null", null],
    ["a wrong version", { version: 2, choices: { "2026-11-23": { "3:a": "addBack" } } }],
    ["choices missing", { version: 1 }],
    ["choices an array", { version: 1, choices: [] }],
  ])("loads nothing for %s", (_name, wire) => {
    expect(choicesFromWire(wire).size).toBe(0);
  });

  it("drops bad dates, bad keys and unknown choice kinds, keeping the rest", () => {
    const choices = choicesFromWire({
      version: 1,
      choices: {
        "2026-11-23": { "3:pull_up": "addBack", "2.3:dip": "addBack", bad: "addBack", "3:UPPER": "addBack", "4:slam": "doubleSets", "5:x": 7 },
        "2026-02-30": { "3:a": "addBack" },
        "2026-11-24": "nope",
        "2026-11-25": { "3:a": "other" },
      },
    });

    expect([...choices.keys()]).toEqual(["2026-11-23"]);
    expect([...choices.get("2026-11-23")!.keys()]).toEqual(["3:pull_up", "2.3:dip"]);
  });
});

describe("activeInjuriesOn", () => {
  const cleared: Injury = { area: "shoulder", side: "left", from: "2026-11-10", to: "2026-11-20" };

  it("is active from the start date, before the clearing date", () => {
    expect(activeInjuriesOn([cleared], "2026-11-09")).toEqual([]);
    expect(activeInjuriesOn([cleared], "2026-11-10")).toEqual([cleared]);
    expect(activeInjuriesOn([cleared], "2026-11-19")).toEqual([cleared]);
  });

  it("is not active on the clearing date or after", () => {
    expect(activeInjuriesOn([cleared], "2026-11-20")).toEqual([]);
    expect(activeInjuriesOn([cleared], "2026-12-01")).toEqual([]);
  });

  it("stays active for ever while there is no clearing date", () => {
    expect(activeInjuriesOn([rightShoulder], "2027-01-01")).toEqual([rightShoulder]);
    expect(activeInjuriesOn([rightShoulder], "2026-11-21")).toEqual([]);
  });

  it("lists each flagged area once, even with overlapping injuries", () => {
    expect(activeAreasOn([rightShoulder, { ...rightShoulder, side: "left" }], "2026-11-23")).toEqual(["shoulder"]);
    expect(activeAreasOn([cleared], "2026-11-23")).toEqual([]);
  });
});

describe("flagInjury and clearInjury", () => {
  it("adds an injury without changing the input", () => {
    const before: Injury[] = [];
    const result = flagInjury(before, rightShoulder);

    expect(result).toEqual({ ok: true, injuries: [rightShoulder] });
    expect(before).toEqual([]);
  });

  it("refuses a second open injury for the same area", () => {
    const result = flagInjury([rightShoulder], { ...rightShoulder, side: "left" });

    expect(result.ok).toBe(false);
  });

  it("allows flagging again after the area was cleared", () => {
    const cleared = clearInjury([rightShoulder], "shoulder", "2026-11-25");
    const result = flagInjury(cleared, { area: "shoulder", side: "left", from: "2026-12-01" });

    expect(result.ok).toBe(true);
  });

  it("sets the clearing date of the open injury only", () => {
    const old: Injury = { area: "shoulder", side: "left", from: "2026-10-01", to: "2026-10-05" };
    const cleared = clearInjury([old, rightShoulder], "shoulder", "2026-11-25");

    expect(cleared).toEqual([old, { ...rightShoulder, to: "2026-11-25" }]);
    expect(openInjuryFor(cleared, "shoulder")).toBeUndefined();
    expect(activeInjuriesOn(cleared, "2026-11-24")).toHaveLength(1);
    expect(activeInjuriesOn(cleared, "2026-11-25")).toHaveLength(0);
  });

  it("never sets a clearing date before the start", () => {
    expect(clearInjury([rightShoulder], "shoulder", "2026-11-01")[0]!.to).toBe("2026-11-22");
  });
});

describe("injuries storage", () => {
  it("loads an empty list when nothing, bad JSON or a throwing storage is there", () => {
    expect(loadInjuries(new FakeStorage(), keys.injuries)).toEqual([]);
    expect(loadInjuries(new FakeStorage({ [keys.injuries]: "{nope" }), keys.injuries)).toEqual([]);
    const throwing = { getItem: () => { throw new Error("denied"); }, setItem: () => {} };
    expect(loadInjuries(throwing, keys.injuries)).toEqual([]);
  });

  it("flags and clears an injury, saving each", () => {
    const storage = new FakeStorage();

    expect(flagInjuryAndSave(storage, keys.injuries, rightShoulder).ok).toBe(true);
    expect(loadInjuries(storage, keys.injuries)).toEqual([rightShoulder]);

    expect(clearInjuryAndSave(storage, keys.injuries, "shoulder", "2026-11-30").ok).toBe(true);
    expect(loadInjuries(storage, keys.injuries)).toEqual([{ ...rightShoulder, to: "2026-11-30" }]);
  });

  it("re-reads before saving, so a change made by another open copy is kept", () => {
    const storage = new FakeStorage();
    flagInjuryAndSave(storage, keys.injuries, rightShoulder);
    storage.setItem(keys.injuries, JSON.stringify(injuriesToWire([rightShoulder, { area: "shoulder", side: "left", from: "2026-01-01", to: "2026-01-09" }])));

    clearInjuryAndSave(storage, keys.injuries, "shoulder", "2026-11-30");

    expect(loadInjuries(storage, keys.injuries)).toHaveLength(2);
  });

  it("refuses to flag an already flagged area and writes nothing", () => {
    const storage = new FakeStorage();
    flagInjuryAndSave(storage, keys.injuries, rightShoulder);
    const writesBefore = storage.writeLog.length;

    expect(flagInjuryAndSave(storage, keys.injuries, { ...rightShoulder, side: "left" }).ok).toBe(false);
    expect(storage.writeLog.length).toBe(writesBefore);
  });

  it("reports a write failure instead of throwing", () => {
    const storage = new FakeStorage();
    storage.failingKeys.add(keys.injuries);

    expect(flagInjuryAndSave(storage, keys.injuries, rightShoulder).ok).toBe(false);
  });
});

describe("injury choices storage", () => {
  it("sets and removes a choice, and reads the keys for a date", () => {
    const storage = new FakeStorage();

    setInjuryChoice(storage, keys.injuryChoices, "2026-11-23", "3:pull_up", "addBack", TODAY);
    const afterSet = loadInjuryChoices(storage, keys.injuryChoices);
    expect([...addBackKeysForDate(afterSet, "2026-11-23")]).toEqual(["3:pull_up"]);
    expect(addBackKeysForDate(afterSet, "2026-11-24").size).toBe(0);

    setInjuryChoice(storage, keys.injuryChoices, "2026-11-23", "3:pull_up", undefined, TODAY);
    expect(loadInjuryChoices(storage, keys.injuryChoices).size).toBe(0);
  });

  it("prunes other dates older than 14 days but keeps the date being written", () => {
    const storage = new FakeStorage();
    setInjuryChoice(storage, keys.injuryChoices, "2026-11-08", "3:pull_up", "addBack", "2026-11-08"); // 14 days before TODAY: kept
    setInjuryChoice(storage, keys.injuryChoices, "2026-11-07", "3:pull_up", "addBack", "2026-11-07");

    const result = setInjuryChoice(storage, keys.injuryChoices, "2026-11-23", "5:dip", "addBack", TODAY);

    expect(result.ok && [...result.choices.keys()].sort()).toEqual(["2026-11-08", "2026-11-23"]);

    // Backfilling an old date in a ?date= preview is kept, though it is older than the cut-off.
    const backfilled = setInjuryChoice(storage, keys.injuryChoices, "2026-10-01", "3:pull_up", "addBack", TODAY);
    expect(backfilled.ok && backfilled.choices.has("2026-10-01")).toBe(true);
  });

  it("re-reads before saving, so another copy's choice for a different item is kept", () => {
    const storage = new FakeStorage();
    setInjuryChoice(storage, keys.injuryChoices, "2026-11-23", "3:pull_up", "addBack", TODAY);
    storage.setItem(keys.injuryChoices, JSON.stringify(choicesToWire(new Map([["2026-11-23", new Map([["3:pull_up", "addBack" as const], ["6:heavy_bag", "addBack" as const]])]]))));

    setInjuryChoice(storage, keys.injuryChoices, "2026-11-23", "4:dip", "addBack", TODAY);

    expect([...addBackKeysForDate(loadInjuryChoices(storage, keys.injuryChoices), "2026-11-23")].sort()).toEqual(["3:pull_up", "4:dip", "6:heavy_bag"]);
  });

  it("loads empty choices from damaged data and reports a write failure", () => {
    expect(loadInjuryChoices(new FakeStorage({ [keys.injuryChoices]: "[[" }), keys.injuryChoices).size).toBe(0);

    const storage = new FakeStorage();
    storage.failingKeys.add(keys.injuryChoices);
    expect(setInjuryChoice(storage, keys.injuryChoices, "2026-11-23", "3:a", "addBack", TODAY).ok).toBe(false);
  });
});
