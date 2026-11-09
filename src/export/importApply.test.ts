import { describe, expect, it } from "vitest";
import { FATIGUE_STORAGE_KEY } from "../fatigue/storage";
import { LOG_STORAGE_KEY } from "../log/storage";
import { MAX_HISTORY_STORAGE_KEY } from "../settings/maxHistoryStorage";
import { SETTINGS_STORAGE_KEY } from "../settings/storage";
import { parseImport, type ImportedData } from "./import";
import { applyImport } from "./importApply";
import { IMPORT_BACKUP_PREFIX, listImportBackups, type ImportBackup } from "./importBackup";
import { readExportSource } from "./source";
import { FakeStorage } from "./testStorage";

const NOW = new Date("2026-11-10T09:00:00.000Z");
const BACKUP_KEY = `${IMPORT_BACKUP_PREFIX}2026-11-10T09:00:00.000Z`;

const importedData: ImportedData = {
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
};

/** Storage holding some older data under all four keys. */
function storageWithOldData(): FakeStorage {
  return new FakeStorage({
    [SETTINGS_STORAGE_KEY]: JSON.stringify({ version: 2, startDate: "2026-10-01", maxReps: { dip: 9 }, maxSavedOn: { dip: "2026-10-01" } }),
    [MAX_HISTORY_STORAGE_KEY]: JSON.stringify({ version: 1, maxHistory: { dip: [{ savedOn: "2026-10-01", reps: 9 }] } }),
    [LOG_STORAGE_KEY]: JSON.stringify({
      version: 1,
      sessions: [{ date: "2026-10-01", programWeek: 1, day: 1, sets: [{ exerciseId: "dip", blockPosition: 3, setNumber: 1, reps: 6, loggedAt: "2026-10-01T18:00:00.000Z" }] }],
    }),
    [FATIGUE_STORAGE_KEY]: JSON.stringify({ version: 1, checks: [{ date: "2026-10-05", maxPullUps: 8, savedAt: "2026-10-05T07:00:00.000Z" }] }),
  });
}

/** The four data keys' current raw text. */
function dataKeys(storage: FakeStorage): Record<string, string | null> {
  return Object.fromEntries([LOG_STORAGE_KEY, FATIGUE_STORAGE_KEY, SETTINGS_STORAGE_KEY, MAX_HISTORY_STORAGE_KEY].map((key) => [key, storage.getItem(key)]));
}

describe("applyImport", () => {
  it("backs up first, then replaces every key; reading the stored data gives the imported data", () => {
    const storage = storageWithOldData();

    const result = applyImport(storage, importedData, NOW);

    expect(result).toEqual({ ok: true, backupKey: BACKUP_KEY });
    expect(storage.writeLog[0]).toBe(BACKUP_KEY);
    const source = readExportSource(storage);
    expect(source.settings).toEqual(importedData.settings);
    expect(source.log).toEqual(importedData.log);
    expect(source.fatigueHistory).toEqual(importedData.fatigueHistory);
  });

  it("keeps the replaced data in the backup as an export file that imports back to it", () => {
    const storage = storageWithOldData();

    applyImport(storage, importedData, NOW);

    const [backup] = listImportBackups(storage) as [ImportBackup];
    expect(backup.storageKey).toBe(BACKUP_KEY);
    const restored = parseImport(backup.exportText);
    expect(restored.ok && restored.summary).toMatchObject({ sessionCount: 1, setCount: 1, checkCount: 1, startDate: "2026-10-01" });
    expect(restored.ok && restored.data.settings.maxHistory).toEqual({ dip: [{ savedOn: "2026-10-01", reps: 9 }] });
  });

  it("works on a fresh phone with nothing stored", () => {
    const storage = new FakeStorage();

    expect(applyImport(storage, importedData, NOW).ok).toBe(true);
    expect(readExportSource(storage).log).toEqual(importedData.log);
  });

  it("changes nothing when the backup cannot be written", () => {
    const storage = storageWithOldData();
    const before = dataKeys(storage);
    storage.failingKeys.add(BACKUP_KEY);

    const result = applyImport(storage, importedData, NOW);

    expect(result.ok).toBe(false);
    expect(!result.ok && result.error).toContain("nothing was changed");
    expect(dataKeys(storage)).toEqual(before);
  });

  it("puts the old data back when a later key fails to write", () => {
    for (const failingKey of [LOG_STORAGE_KEY, FATIGUE_STORAGE_KEY, MAX_HISTORY_STORAGE_KEY, SETTINGS_STORAGE_KEY]) {
      const storage = storageWithOldData();
      const before = dataKeys(storage);
      storage.failingKeys.add(failingKey);

      const result = applyImport(storage, importedData, NOW);

      expect(result.ok).toBe(false);
      expect(!result.ok && result.error).toContain("previous data was put back");
      expect(dataKeys(storage)).toEqual(before);
      expect(storage.getItem(BACKUP_KEY)).not.toBeNull();
    }
  });

  it("removes keys that did not exist before when rolling back", () => {
    const storage = new FakeStorage();
    storage.failingKeys.add(SETTINGS_STORAGE_KEY);

    const result = applyImport(storage, importedData, NOW);

    expect(result.ok).toBe(false);
    expect(dataKeys(storage)).toEqual({ [LOG_STORAGE_KEY]: null, [FATIGUE_STORAGE_KEY]: null, [SETTINGS_STORAGE_KEY]: null, [MAX_HISTORY_STORAGE_KEY]: null });
  });

  it("says where the data is when even the rollback fails", () => {
    const storage = storageWithOldData();
    storage.failingKeys.add(SETTINGS_STORAGE_KEY);
    // Writing the old log text back also fails (storage is now refusing it).
    const realSetItem = storage.setItem.bind(storage);
    let logWrites = 0;
    storage.setItem = (key: string, value: string) => {
      if (key === LOG_STORAGE_KEY && ++logWrites === 2) throw new Error("disk full");
      realSetItem(key, value);
    };

    const result = applyImport(storage, importedData, NOW);

    expect(result.ok).toBe(false);
    expect(!result.ok && result.error).toContain(LOG_STORAGE_KEY);
    expect(!result.ok && result.error).toContain(BACKUP_KEY);
  });

  it("refuses, writing nothing, when the stored log cannot be read at all", () => {
    const storage = storageWithOldData();
    storage.getItem = (key: string) => {
      if (key === LOG_STORAGE_KEY) throw new Error("blocked");
      return FakeStorage.prototype.getItem.call(storage, key);
    };
    storage.writeLog.length = 0;

    const result = applyImport(storage, importedData, NOW);

    expect(result.ok).toBe(false);
    expect(storage.writeLog).toEqual([]);
  });

  it("keeps unreadable stored log text under the loaders' own corrupt key before replacing it", () => {
    const storage = storageWithOldData();
    storage.setItem(LOG_STORAGE_KEY, "{broken");

    applyImport(storage, importedData, NOW);

    expect(storage.getItem("explosive-endurance.log.corrupt-2026-11-10T09:00:00.000Z")).toBe("{broken");
  });
});

describe("export after an import", () => {
  it("lists the import backups in the export source, apart from the corrupt-log backups", () => {
    const storage = storageWithOldData();
    applyImport(storage, importedData, NOW);

    const source = readExportSource(storage);

    expect(source.importBackups.map((backup) => backup.storageKey)).toEqual([BACKUP_KEY]);
    expect(source.corruptLogBackups).toEqual([]);
  });
});
