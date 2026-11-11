import { describe, expect, it } from "vitest";
import { exportToWire, serializeExport, type ExportBundle, type ExportWireV1 } from "./wire";

const bundle: ExportBundle = {
  exportedAt: new Date("2026-11-09T08:00:00.000Z"),
  settings: { startDate: "2026-11-02", maxReps: { pull_up: 12 }, maxSavedOn: { pull_up: "2026-11-02" }, maxHistory: { pull_up: [{ savedOn: "2026-11-02", reps: 12 }] } },
  log: {
    sessions: {
      "2026-11-02": {
        date: "2026-11-02", programWeek: 1, day: 1,
        sets: [{ exerciseId: "pull_up", blockPosition: 3, setNumber: 1, reps: 5, note: "ok", loggedAt: new Date("2026-11-02T18:00:00.000Z") }],
      },
    },
  },
  fatigueHistory: { checks: [{ date: "2026-11-09", savedProgramWeek: 2, maxPullUps: 10, savedAt: new Date("2026-11-09T07:30:00.000Z") }] },
  corruptLogBackups: [],
  importBackups: [],
};

describe("exportToWire", () => {
  it("maps every part to its wire form with format, version and ISO timestamps", () => {
    expect(exportToWire(bundle)).toEqual({
      format: "explosive-endurance-export",
      version: 1,
      exportedAt: "2026-11-09T08:00:00.000Z",
      settings: { version: 2, startDate: "2026-11-02", maxReps: { pull_up: 12 }, maxSavedOn: { pull_up: "2026-11-02" } },
      maxHistory: { version: 1, maxHistory: { pull_up: [{ savedOn: "2026-11-02", reps: 12 }] } },
      log: {
        version: 1,
        sessions: [
          {
            date: "2026-11-02", programWeek: 1, day: 1,
            sets: [{ exerciseId: "pull_up", blockPosition: 3, setNumber: 1, reps: 5, note: "ok", loggedAt: "2026-11-02T18:00:00.000Z" }],
          },
        ],
      },
      fatigueChecks: { version: 1, checks: [{ date: "2026-11-09", programWeek: 2, maxPullUps: 10, savedAt: "2026-11-09T07:30:00.000Z" }] },
    });
  });

  it("writes an empty maxHistory block when no max was ever saved", () => {
    const wire = exportToWire({ ...bundle, settings: { startDate: null, maxReps: {}, maxSavedOn: {}, maxHistory: {} } });

    expect(wire.maxHistory).toEqual({ version: 1, maxHistory: {} });
  });

  it("types the settings field as every settings version the reader accepts, and writes v2", () => {
    // Compile-time check: older exports (v1 settings) must fit the same field type.
    const olderFile: ExportWireV1["settings"] = { version: 1, startDate: null, maxReps: {} };
    expect(olderFile.version).toBe(1);
    expect(exportToWire(bundle).settings.version).toBe(2);
  });

  it("includes corrupt-log backups, mapped to their own wire shape, only when there are any", () => {
    const withBackups = exportToWire({
      ...bundle,
      corruptLogBackups: [{ storageKey: "explosive-endurance.log.corrupt-2026-11-09T08:00:00.000Z", originalText: "{broken" }],
    });

    expect(withBackups.corruptLogBackups).toEqual([{ key: "explosive-endurance.log.corrupt-2026-11-09T08:00:00.000Z", text: "{broken" }]);
    expect("corruptLogBackups" in exportToWire(bundle)).toBe(false);
  });

  it("includes import backups under their own key, separate from corrupt-log backups, only when there are any", () => {
    const withBackups = exportToWire({
      ...bundle,
      importBackups: [{ storageKey: "explosive-endurance.import-backup-2026-11-09T08:00:00.000Z", exportText: "{\"format\":\"x\"}" }],
    });

    expect(withBackups.importBackups).toEqual([{ key: "explosive-endurance.import-backup-2026-11-09T08:00:00.000Z", text: "{\"format\":\"x\"}" }]);
    expect(withBackups.corruptLogBackups).toBeUndefined();
    expect("importBackups" in exportToWire(bundle)).toBe(false);
  });

  it("exports an empty app (no log, no checks) as valid JSON", () => {
    const wire = exportToWire({ ...bundle, log: { sessions: {} }, fatigueHistory: { checks: [] } });
    const parsed = JSON.parse(serializeExport(wire));

    expect(parsed.log.sessions).toEqual([]);
    expect(parsed.fatigueChecks.checks).toEqual([]);
  });
});
