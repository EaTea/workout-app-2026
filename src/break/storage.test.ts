import { describe, expect, it } from "vitest";
import { FakeStorage } from "../export/testStorage";
import { storageKeysForProgram } from "../storage/programKeys";
import type { TrainingBreak } from "./model";
import { endBreakAndSave, loadBreaks, saveBreaks, startBreakAndSave } from "./storage";

const keys = storageKeysForProgram("explosive-endurance");
const weekBreak: TrainingBreak = { from: "2026-11-26", to: "2026-12-03", note: "Physio" };

describe("loadBreaks and saveBreaks", () => {
  it("loads nothing when nothing is stored", () => {
    expect(loadBreaks(new FakeStorage(), keys.breaks)).toEqual([]);
  });

  it("loads nothing for unreadable JSON", () => {
    expect(loadBreaks(new FakeStorage({ [keys.breaks]: "{not json" }), keys.breaks)).toEqual([]);
  });

  it("loads nothing when getItem throws", () => {
    const throwing = {
      getItem: () => {
        throw new Error("denied");
      },
      setItem: () => {},
    };

    expect(loadBreaks(throwing, keys.breaks)).toEqual([]);
  });

  it("round-trips through storage under the breaks key", () => {
    const storage = new FakeStorage();

    expect(saveBreaks(storage, keys.breaks, [weekBreak])).toEqual({ ok: true, breaks: [weekBreak] });

    expect(JSON.parse(storage.getItem(keys.breaks) as string)).toEqual({ version: 1, breaks: [weekBreak] });
    expect(loadBreaks(storage, keys.breaks)).toEqual([weekBreak]);
  });

  it("returns the write failure instead of throwing", () => {
    const storage = new FakeStorage();
    storage.failingKeys.add(keys.breaks);

    const result = saveBreaks(storage, keys.breaks, [weekBreak]);

    expect(result.ok).toBe(false);
  });
});

describe("startBreakAndSave", () => {
  it("adds to what is stored, re-reading first", () => {
    const storage = new FakeStorage();
    saveBreaks(storage, keys.breaks, [weekBreak]);

    const result = startBreakAndSave(storage, keys.breaks, { from: "2026-12-10", days: 3 });

    expect(result.ok).toBe(true);
    expect(loadBreaks(storage, keys.breaks)).toEqual([weekBreak, { from: "2026-12-10", to: "2026-12-13" }]);
  });

  it("writes nothing when the break overlaps or the days are invalid", () => {
    const storage = new FakeStorage();
    saveBreaks(storage, keys.breaks, [weekBreak]);
    const writesBefore = storage.writeLog.length;

    expect(startBreakAndSave(storage, keys.breaks, { from: "2026-11-28", days: 2 }).ok).toBe(false);
    expect(startBreakAndSave(storage, keys.breaks, { from: "2026-12-10", days: 40 }).ok).toBe(false);

    expect(storage.writeLog.length).toBe(writesBefore);
    expect(loadBreaks(storage, keys.breaks)).toEqual([weekBreak]);
  });
});

describe("endBreakAndSave", () => {
  it("ends the covering break and saves", () => {
    const storage = new FakeStorage();
    saveBreaks(storage, keys.breaks, [weekBreak]);

    endBreakAndSave(storage, keys.breaks, "2026-11-29");

    expect(loadBreaks(storage, keys.breaks)).toEqual([{ ...weekBreak, to: "2026-11-29" }]);
  });

  it("removes a break ended on its first day", () => {
    const storage = new FakeStorage();
    saveBreaks(storage, keys.breaks, [weekBreak]);

    endBreakAndSave(storage, keys.breaks, "2026-11-26");

    expect(loadBreaks(storage, keys.breaks)).toEqual([]);
  });
});
