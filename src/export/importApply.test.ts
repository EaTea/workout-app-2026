import { describe, expect, it } from "vitest";
import { parseImport, type ImportedData } from "./import";
import { applyImport, undoLastImport } from "./importApply";
import { MAX_IMPORT_BACKUPS, listImportBackups, type ImportBackup } from "./importBackup";
import { readExportSource } from "./source";
import { FakeStorage } from "./testStorage";
import { storageKeysForProgram } from "../storage/programKeys";

/** Explosive Endurance's keys, the ones the app has always used. */
const KEYS = storageKeysForProgram("explosive-endurance");

const NOW = new Date("2026-11-10T09:00:00.000Z");
const BACKUP_KEY = `${KEYS.importBackupPrefix}2026-11-10T09:00:00.000Z`;

const importedData: ImportedData = {
  programId: "explosive-endurance",
  settings: { startDate: "2026-11-02", maxReps: { pull_up: 14 }, maxSavedOn: { pull_up: "2026-12-18" }, maxHistory: { pull_up: [{ savedOn: "2026-12-18", reps: 14 }] } },
  log: {
    sessions: {
      "2026-11-02": {
        date: "2026-11-02", programWeek: 1, day: 1,
        sets: [{ exerciseId: "pull_up", blockPosition: 3, setNumber: 1, reps: 5, loggedAt: new Date("2026-11-02T18:00:00.000Z") }],
      },
    },
  },
  fatigueHistory: { checks: [{ date: "2026-11-09", maxPullUps: 10, savedAt: new Date("2026-11-09T07:30:00.000Z") }] },
  combines: new Map([["2026-11-09", { hostDay: 1, addedDay: 2, addedDate: "2026-11-10" }]]),
};

/** Storage holding some older data under all five keys. */
function storageWithOldData(): FakeStorage {
  return new FakeStorage({
    [KEYS.settings]: JSON.stringify({ version: 2, startDate: "2026-10-01", maxReps: { dip: 9 }, maxSavedOn: { dip: "2026-10-01" } }),
    [KEYS.maxHistory]: JSON.stringify({ version: 1, maxHistory: { dip: [{ savedOn: "2026-10-01", reps: 9 }] } }),
    [KEYS.log]: JSON.stringify({
      version: 1,
      sessions: [{ date: "2026-10-01", programWeek: 1, day: 1, sets: [{ exerciseId: "dip", blockPosition: 3, setNumber: 1, reps: 6, loggedAt: "2026-10-01T18:00:00.000Z" }] }],
    }),
    [KEYS.fatigue]: JSON.stringify({ version: 1, checks: [{ date: "2026-10-05", maxPullUps: 8, savedAt: "2026-10-05T07:00:00.000Z" }] }),
    [KEYS.combines]: JSON.stringify({ version: 1, combines: { "2026-10-05": { hostDay: 3, addedDay: 4, addedDate: "2026-10-06" } } }),
  });
}

/** The five data keys' current raw text. */
function dataKeys(storage: FakeStorage): Record<string, string | null> {
  return Object.fromEntries([KEYS.log, KEYS.fatigue, KEYS.combines, KEYS.settings, KEYS.maxHistory].map((key) => [key, storage.getItem(key)]));
}

describe("applyImport", () => {
  it("backs up first, then replaces every key; reading the stored data gives the imported data", () => {
    const storage = storageWithOldData();

    const result = applyImport(storage, KEYS, importedData, NOW);

    expect(result).toEqual({ ok: true, backupKey: BACKUP_KEY });
    expect(storage.writeLog[0]).toBe(BACKUP_KEY);
    const source = readExportSource(storage, KEYS);
    expect(source.settings).toEqual(importedData.settings);
    expect(source.log).toEqual(importedData.log);
    expect(source.fatigueHistory).toEqual(importedData.fatigueHistory);
    expect(source.combines).toEqual(importedData.combines);
  });

  it("replaces the stored combines, and an import with none clears them", () => {
    const storage = storageWithOldData();

    applyImport(storage, KEYS, { ...importedData, combines: new Map() }, NOW);

    expect(readExportSource(storage, KEYS).combines).toEqual(new Map());
  });

  it("puts the old combines back when the combines write fails", () => {
    const storage = storageWithOldData();
    const before = dataKeys(storage);
    storage.failingKeys.add(KEYS.combines);

    const result = applyImport(storage, KEYS, importedData, NOW);

    expect(result.ok).toBe(false);
    expect(dataKeys(storage)).toEqual(before);
  });

  it("keeps the replaced data in the backup as an export file that imports back to it", () => {
    const storage = storageWithOldData();

    applyImport(storage, KEYS, importedData, NOW);

    const [backup] = listImportBackups(storage, KEYS) as [ImportBackup];
    expect(backup.storageKey).toBe(BACKUP_KEY);
    const restored = parseImport(backup.exportText);
    expect(restored.ok && restored.summary).toMatchObject({ sessionCount: 1, setCount: 1, checkCount: 1, startDate: "2026-10-01" });
    expect(restored.ok && restored.data.settings.maxHistory).toEqual({ dip: [{ savedOn: "2026-10-01", reps: 9 }] });
  });

  it("refuses data of another program and leaves storage untouched", () => {
    const storage = storageWithOldData();
    const before = dataKeys(storage);
    storage.writeLog.length = 0;

    const result = applyImport(storage, KEYS, { ...importedData, programId: "steady-strength" }, NOW);

    expect(result.ok).toBe(false);
    expect(!result.ok && result.error).toContain('This backup is for "steady-strength", but you\'re using "explosive-endurance"');
    expect(dataKeys(storage)).toEqual(before);
    expect(storage.writeLog).toEqual([]);
    expect(listImportBackups(storage, KEYS)).toEqual([]);
  });

  it("imports data of the matching program, and its backup is stamped with that program", () => {
    const steadyKeys = storageKeysForProgram("steady-strength");
    const storage = new FakeStorage();

    const result = applyImport(storage, steadyKeys, { ...importedData, programId: "steady-strength" }, NOW);

    expect(result.ok).toBe(true);
    expect(readExportSource(storage, steadyKeys).programId).toBe("steady-strength");
    const [backup] = listImportBackups(storage, steadyKeys) as [ImportBackup];
    expect(JSON.parse(backup.exportText)).toMatchObject({ version: 2, programId: "steady-strength" });
  });

  it("works on a fresh phone with nothing stored", () => {
    const storage = new FakeStorage();

    expect(applyImport(storage, KEYS, importedData, NOW).ok).toBe(true);
    expect(readExportSource(storage, KEYS).log).toEqual(importedData.log);
  });

  it("changes nothing when the backup cannot be written", () => {
    const storage = storageWithOldData();
    const before = dataKeys(storage);
    storage.failingKeys.add(BACKUP_KEY);

    const result = applyImport(storage, KEYS, importedData, NOW);

    expect(result.ok).toBe(false);
    expect(!result.ok && result.error).toContain("nothing was changed");
    expect(dataKeys(storage)).toEqual(before);
  });

  it("puts the old data back when a later key fails to write", () => {
    for (const failingKey of [KEYS.log, KEYS.fatigue, KEYS.maxHistory, KEYS.settings]) {
      const storage = storageWithOldData();
      const before = dataKeys(storage);
      storage.failingKeys.add(failingKey);

      const result = applyImport(storage, KEYS, importedData, NOW);

      expect(result.ok).toBe(false);
      expect(!result.ok && result.error).toContain("previous data was put back");
      expect(dataKeys(storage)).toEqual(before);
      expect(storage.getItem(BACKUP_KEY)).toBeNull(); // rolled back fully, so the duplicate is removed
    }
  });

  it("removes keys that did not exist before when rolling back", () => {
    const storage = new FakeStorage();
    storage.failingKeys.add(KEYS.settings);

    const result = applyImport(storage, KEYS, importedData, NOW);

    expect(result.ok).toBe(false);
    expect(dataKeys(storage)).toEqual({ [KEYS.log]: null, [KEYS.fatigue]: null, [KEYS.combines]: null, [KEYS.settings]: null, [KEYS.maxHistory]: null });
  });

  it("says where the data is when even the rollback fails", () => {
    const storage = storageWithOldData();
    storage.failingKeys.add(KEYS.settings);
    // Writing the old log text back also fails (storage is now refusing it).
    const realSetItem = storage.setItem.bind(storage);
    let logWrites = 0;
    storage.setItem = (key: string, value: string) => {
      if (key === KEYS.log && ++logWrites === 2) throw new Error("disk full");
      realSetItem(key, value);
    };

    const result = applyImport(storage, KEYS, importedData, NOW);

    expect(result.ok).toBe(false);
    expect(!result.ok && result.error).toContain(KEYS.log);
    expect(!result.ok && result.error).toContain(BACKUP_KEY);
    expect(storage.getItem(BACKUP_KEY)).not.toBeNull(); // the only full copy of the old data stays
  });

  it("leaves no backups after three failed attempts that each rolled back", () => {
    const storage = storageWithOldData();
    storage.failingKeys.add(KEYS.settings);

    for (const minute of [1, 2, 3]) {
      applyImport(storage, KEYS, importedData, new Date(NOW.getTime() + minute * 60_000));
    }

    expect(listImportBackups(storage, KEYS)).toEqual([]);
  });

  it("writes the backup as compact JSON that holds the raw text of the five keys", () => {
    const storage = storageWithOldData();
    const before = dataKeys(storage);

    applyImport(storage, KEYS, importedData, NOW);

    const backupText = storage.getItem(BACKUP_KEY) as string;
    expect(backupText).not.toContain("\n");
    const [backup] = listImportBackups(storage, KEYS) as [ImportBackup];
    expect(Object.fromEntries((backup.rawStoredTexts ?? []).map((raw) => [raw.storageKey, raw.text]))).toEqual(before);
  });

  it("keeps only the 3 newest import backups after a successful import", () => {
    const storage = storageWithOldData();

    for (const minute of [1, 2, 3, 4, 5]) {
      expect(applyImport(storage, KEYS, importedData, new Date(NOW.getTime() + minute * 60_000)).ok).toBe(true);
    }

    const keys = listImportBackups(storage, KEYS).map((backup) => backup.storageKey);
    expect(keys).toHaveLength(MAX_IMPORT_BACKUPS);
    expect(keys).toEqual([3, 4, 5].map((minute) => `${KEYS.importBackupPrefix}${new Date(NOW.getTime() + minute * 60_000).toISOString()}`));
  });

  it("refuses, writing nothing, when the stored log cannot be read at all", () => {
    const storage = storageWithOldData();
    storage.getItem = (key: string) => {
      if (key === KEYS.log) throw new Error("blocked");
      return FakeStorage.prototype.getItem.call(storage, key);
    };
    storage.writeLog.length = 0;

    const result = applyImport(storage, KEYS, importedData, NOW);

    expect(result.ok).toBe(false);
    expect(storage.writeLog).toEqual([]);
  });

  it("keeps unreadable stored log text under the loaders' own corrupt key before replacing it", () => {
    const storage = storageWithOldData();
    storage.setItem(KEYS.log, "{broken");

    applyImport(storage, KEYS, importedData, NOW);

    expect(storage.getItem("explosive-endurance.log.corrupt-2026-11-10T09:00:00.000Z")).toBe("{broken");
  });
});

describe("export after an import", () => {
  it("lists the import backups in the export source, apart from the corrupt-log backups", () => {
    const storage = storageWithOldData();
    applyImport(storage, KEYS, importedData, NOW);

    const source = readExportSource(storage, KEYS);

    expect(source.importBackups.map((backup) => backup.storageKey)).toEqual([BACKUP_KEY]);
    expect(source.corruptLogBackups).toEqual([]);
  });
});

describe("undoLastImport", () => {
  it("puts back the exact previous key texts, including settings the loaders cannot read", () => {
    const storage = storageWithOldData();
    storage.setItem(KEYS.settings, JSON.stringify({ version: 99, startDate: "2026-10-01" }));
    const before = dataKeys(storage);
    applyImport(storage, KEYS, importedData, NOW);

    const result = undoLastImport(storage, KEYS, new Date(NOW.getTime() + 60_000));

    expect(result.ok).toBe(true);
    expect(dataKeys(storage)).toEqual(before);
  });

  it("backs up the data it replaces, so the undo can be undone", () => {
    const storage = storageWithOldData();
    applyImport(storage, KEYS, importedData, NOW);
    const importedKeys = dataKeys(storage);

    undoLastImport(storage, KEYS, new Date(NOW.getTime() + 60_000));
    const second = undoLastImport(storage, KEYS, new Date(NOW.getTime() + 120_000));

    expect(second.ok).toBe(true);
    expect(dataKeys(storage)).toEqual(importedKeys);
  });

  it("removes keys that were absent before the import", () => {
    const storage = new FakeStorage();
    applyImport(storage, KEYS, importedData, NOW);

    undoLastImport(storage, KEYS, new Date(NOW.getTime() + 60_000));

    expect(dataKeys(storage)).toEqual({ [KEYS.log]: null, [KEYS.fatigue]: null, [KEYS.combines]: null, [KEYS.settings]: null, [KEYS.maxHistory]: null });
  });

  it("removes the current combines when the backup predates the combines key (there were none before)", () => {
    const storage = storageWithOldData();
    storage.removeItem(KEYS.combines);
    applyImport(storage, KEYS, importedData, NOW);
    expect(storage.getItem(KEYS.combines)).not.toBeNull();

    // Make the backup look like one written before the combines key existed: no entry for it.
    const backupText = JSON.parse(storage.getItem(BACKUP_KEY) as string);
    backupText.rawStoredTexts = backupText.rawStoredTexts.filter((raw: { key: string }) => raw.key !== KEYS.combines);
    delete backupText.combines;
    storage.setItem(BACKUP_KEY, JSON.stringify(backupText));

    const result = undoLastImport(storage, KEYS, new Date(NOW.getTime() + 60_000));

    expect(result.ok).toBe(true);
    expect(storage.getItem(KEYS.combines)).toBeNull();
    expect(readExportSource(storage, KEYS).log.sessions["2026-10-01"]).toBeDefined();
  });

  it("falls back to reading an older backup that has no raw texts", () => {
    const storage = storageWithOldData();
    applyImport(storage, KEYS, importedData, NOW);
    const backupText = JSON.parse(storage.getItem(BACKUP_KEY) as string);
    delete backupText.rawStoredTexts;
    storage.setItem(BACKUP_KEY, JSON.stringify(backupText, null, 2));

    const result = undoLastImport(storage, KEYS, new Date(NOW.getTime() + 60_000));

    expect(result.ok).toBe(true);
    expect(readExportSource(storage, KEYS).log.sessions["2026-10-01"]).toBeDefined();
  });

  it("names programs by display name when refusing data or a backup of another program", () => {
    const names = { "explosive-endurance": "Explosive Endurance", "steady-strength": "Steady Strength" };
    const storage = storageWithOldData();

    const applied = applyImport(storage, KEYS, { ...importedData, programId: "steady-strength" }, NOW, names);
    expect(!applied.ok && applied.error).toContain('This backup is for "Steady Strength", but you\'re using "Explosive Endurance"');

    applyImport(storage, KEYS, importedData, NOW);
    const backupText = JSON.parse(storage.getItem(BACKUP_KEY) as string);
    backupText.programId = "steady-strength";
    storage.setItem(BACKUP_KEY, JSON.stringify(backupText));
    const undone = undoLastImport(storage, KEYS, new Date(NOW.getTime() + 60_000), names);
    expect(!undone.ok && undone.error).toContain('"Steady Strength"');
  });

  it("refuses, changing nothing, a backup that belongs to another program", () => {
    const storage = storageWithOldData();
    applyImport(storage, KEYS, importedData, NOW);
    const backupText = JSON.parse(storage.getItem(BACKUP_KEY) as string);
    backupText.programId = "steady-strength";
    storage.setItem(BACKUP_KEY, JSON.stringify(backupText));
    const before = dataKeys(storage);

    const result = undoLastImport(storage, KEYS, new Date(NOW.getTime() + 60_000));

    expect(result.ok).toBe(false);
    expect(!result.ok && result.error).toContain('"steady-strength"');
    expect(dataKeys(storage)).toEqual(before);
    expect(listImportBackups(storage, KEYS)).toHaveLength(1);
  });

  describe("a backup stored in the old version 1 format (no programId)", () => {
    /** Rewrites the stored backup as the version 1 app wrote it: no programId, version 1; raw texts kept only when asked. */
    function downgradeBackupToVersion1(storage: FakeStorage, keepRawTexts: boolean): void {
      const backupText = JSON.parse(storage.getItem(BACKUP_KEY) as string);
      backupText.version = 1;
      delete backupText.programId;
      if (!keepRawTexts) delete backupText.rawStoredTexts;
      storage.setItem(BACKUP_KEY, JSON.stringify(backupText));
    }

    it("is undone from its raw texts when it has them", () => {
      const storage = storageWithOldData();
      const before = dataKeys(storage);
      applyImport(storage, KEYS, importedData, NOW);
      downgradeBackupToVersion1(storage, true);

      const result = undoLastImport(storage, KEYS, new Date(NOW.getTime() + 60_000));

      expect(result.ok).toBe(true);
      expect(dataKeys(storage)).toEqual(before);
    });

    it("is undone by reading it like an import file when it has no raw texts", () => {
      const storage = storageWithOldData();
      applyImport(storage, KEYS, importedData, NOW);
      downgradeBackupToVersion1(storage, false);

      const result = undoLastImport(storage, KEYS, new Date(NOW.getTime() + 60_000));

      expect(result.ok).toBe(true);
      expect(readExportSource(storage, KEYS).log.sessions["2026-10-01"]).toBeDefined();
    });
  });

  it("says so, changing nothing, when there is no backup", () => {
    const storage = storageWithOldData();
    const before = dataKeys(storage);

    const result = undoLastImport(storage, KEYS, NOW);

    expect(result.ok).toBe(false);
    expect(dataKeys(storage)).toEqual(before);
  });

  it("restores the old data and removes its own backup when a write fails", () => {
    const storage = storageWithOldData();
    applyImport(storage, KEYS, importedData, NOW);
    const importedKeys = dataKeys(storage);
    storage.failingKeys.add(KEYS.settings);

    const result = undoLastImport(storage, KEYS, new Date(NOW.getTime() + 60_000));

    expect(result.ok).toBe(false);
    expect(dataKeys(storage)).toEqual(importedKeys);
    expect(listImportBackups(storage, KEYS)).toHaveLength(1);
  });
});
