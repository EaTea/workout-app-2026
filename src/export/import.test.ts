import { describe, expect, it } from "vitest";
import { parseImport } from "./import";
import { exportToWire, serializeExport, type ExportBundle } from "./wire";

const bundle: ExportBundle = {
  exportedAt: new Date("2026-11-09T08:00:00.000Z"),
  settings: {
    startDate: "2026-11-02",
    maxReps: { pull_up: 14 },
    maxSavedOn: { pull_up: "2026-12-18" },
    maxHistory: { pull_up: [{ savedOn: "2026-11-02", reps: 12 }, { savedOn: "2026-12-18", reps: 14 }], dip: [{ savedOn: "2026-11-02", reps: 15 }] },
  },
  log: {
    sessions: {
      "2026-11-02": {
        date: "2026-11-02", programWeek: 1, day: 1,
        sets: [
          { exerciseId: "pull_up", blockPosition: 3, setNumber: 1, reps: 5, loadKg: 8, note: "ok", loggedAt: new Date("2026-11-02T18:00:00.000Z") },
          { exerciseId: "pull_up", blockPosition: 3, setNumber: 2, reps: 4, loggedAt: new Date("2026-11-02T18:05:00.000Z") },
        ],
      },
      "2026-11-04": {
        date: "2026-11-04", programWeek: 1, day: 3,
        sets: [{ exerciseId: "dip", blockPosition: 3, setNumber: 1, reps: 7, loggedAt: new Date("2026-11-04T18:00:00.000Z") }],
      },
    },
  },
  fatigueHistory: { checks: [{ date: "2026-11-09", savedProgramWeek: 2, maxPullUps: 10, savedAt: new Date("2026-11-09T07:30:00.000Z") }] },
  corruptLogBackups: [],
  importBackups: [],
};

/** The export file text for `bundle`, optionally edited as a plain object first. */
function fileText(edit: (file: Record<string, unknown>) => void = () => undefined): string {
  const file = JSON.parse(serializeExport(exportToWire(bundle))) as Record<string, unknown>;
  edit(file);
  return JSON.stringify(file);
}

describe("parseImport", () => {
  it("round trips: export then import gives back the same internal data", () => {
    const result = parseImport(serializeExport(exportToWire(bundle)));

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data).toEqual({ settings: bundle.settings, log: bundle.log, fatigueHistory: bundle.fatigueHistory });
    expect(result.problems).toEqual([]);
  });

  it("summarises sessions, sets, checks, date range and start date", () => {
    const result = parseImport(fileText());

    expect(result.ok && result.summary).toEqual({
      sessionCount: 2, setCount: 3, checkCount: 1, firstSessionDate: "2026-11-02", lastSessionDate: "2026-11-04", startDate: "2026-11-02",
    });
  });

  it("summarises an empty app without dates", () => {
    const empty = serializeExport(exportToWire({ ...bundle, log: { sessions: {} }, fatigueHistory: { checks: [] } }));

    const result = parseImport(empty);

    expect(result.ok && result.summary.sessionCount).toBe(0);
    expect(result.ok && result.summary.firstSessionDate).toBeUndefined();
  });

  it("reads v1 settings inside the file, with each max as the only history entry", () => {
    const result = parseImport(fileText((file) => {
      file.settings = { version: 1, startDate: "2026-11-02", maxReps: { pull_up: 12 } };
      delete file.maxHistory;
    }));

    expect(result.ok && result.data.settings).toEqual({
      startDate: "2026-11-02", maxReps: { pull_up: 12 }, maxSavedOn: {}, maxHistory: { pull_up: [{ savedOn: null, reps: 12 }] },
    });
  });

  it("accepts a file with no maxHistory block, rebuilding the history from the settings' maxes", () => {
    const result = parseImport(fileText((file) => void delete file.maxHistory));

    expect(result.ok).toBe(true);
    expect(result.ok && result.problems).toEqual([]);
    expect(result.ok && result.data.settings.maxHistory).toEqual({ pull_up: [{ savedOn: "2026-12-18", reps: 14 }] });
  });

  it("restores the max history from the maxHistory block, including an exercise with no current max", () => {
    const result = parseImport(fileText());

    expect(result.ok && result.data.settings.maxHistory.dip).toEqual([{ savedOn: "2026-11-02", reps: 15 }]);
  });

  it("lists a maxHistory block of an unknown version and an unknown settings version, falling back to defaults", () => {
    const result = parseImport(fileText((file) => {
      file.maxHistory = { version: 9, maxHistory: {} };
      file.settings = { version: 7 };
    }));

    expect(result.ok && result.problems).toEqual([
      'settings: unknown version 7, so the start date and maxes are left empty',
      "maxHistory: not a version 1 block, so it was ignored",
    ]);
    expect(result.ok && result.data.settings).toEqual({ startDate: null, maxReps: {}, maxSavedOn: {}, maxHistory: {} });
  });

  it("keeps readable sets and lists the unreadable ones as problems", () => {
    const result = parseImport(fileText((file) => {
      const log = file.log as { sessions: { sets: Record<string, unknown>[] }[] };
      log.sessions[0]!.sets[1]!.reps = -4;
    }));

    expect(result.ok && result.summary.setCount).toBe(2);
    expect(result.ok && result.problems).toHaveLength(1);
    expect(result.ok && result.problems[0]).toContain("reps");
  });

  it("keeps readable checks and lists the unreadable ones", () => {
    const result = parseImport(fileText((file) => {
      (file.fatigueChecks as { checks: unknown[] }).checks.push({ date: "nonsense" });
    }));

    expect(result.ok && result.summary.checkCount).toBe(1);
    expect(result.ok && result.problems).toHaveLength(1);
  });

  it("ignores corruptLogBackups and importBackups in the file", () => {
    const result = parseImport(fileText((file) => {
      file.corruptLogBackups = [{ key: "explosive-endurance.log.corrupt-x", text: "{" }];
      file.importBackups = [{ key: "explosive-endurance.import-backup-x", text: "{}" }];
    }));

    expect(result.ok && result.data).toEqual({ settings: bundle.settings, log: bundle.log, fatigueHistory: bundle.fatigueHistory });
  });

  it("refuses text that is not JSON", () => {
    const result = parseImport("{nope");

    expect(result.ok).toBe(false);
    expect(!result.ok && result.error).toContain("could not be read as JSON");
  });

  it("refuses JSON that is not our format", () => {
    for (const text of ["[]", "null", "42", '{"format":"something-else","version":1}', '{"version":1}']) {
      const result = parseImport(text);
      expect(result.ok).toBe(false);
      expect(!result.ok && result.error).toContain("not an Explosive Endurance export");
    }
  });

  it("refuses an unknown version, naming it", () => {
    for (const version of [2, 0, "1", null]) {
      const result = parseImport(fileText((file) => void (file.version = version)));
      expect(result.ok).toBe(false);
      expect(!result.ok && result.error).toContain(`version ${JSON.stringify(version)}`);
    }
    const missing = parseImport(fileText((file) => void delete file.version));
    expect(missing.ok).toBe(false);
  });

  it("refuses a file whose log, check-ins or settings section is missing or unreadable", () => {
    for (const section of ["settings", "log", "fatigueChecks"]) {
      const missing = parseImport(fileText((file) => void delete file[section]));
      expect(missing.ok).toBe(false);
      expect(!missing.ok && missing.error).toContain(`"${section}"`);
    }

    const wrongLogVersion = parseImport(fileText((file) => void (file.log = { version: 5, sessions: [] })));
    expect(wrongLogVersion.ok).toBe(false);
    expect(!wrongLogVersion.ok && wrongLogVersion.error).toContain("log in this file");

    const wrongChecksShape = parseImport(fileText((file) => void (file.fatigueChecks = { version: 1, checks: "x" })));
    expect(wrongChecksShape.ok).toBe(false);
    expect(!wrongChecksShape.ok && wrongChecksShape.error).toContain("check-ins");
  });
});
