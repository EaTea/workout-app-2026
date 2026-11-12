import { describe, expect, it } from "vitest";
import { storageKeysForProgram } from "./programKeys";

describe("storageKeysForProgram", () => {
  it("gives Explosive Endurance exactly the keys the app has always used, so no migration is needed", () => {
    // Spelled out literally on purpose: changing any of these strings would strand existing users' data.
    expect(storageKeysForProgram("explosive-endurance")).toEqual({
      programId: "explosive-endurance",
      settings: "explosive-endurance.settings",
      maxHistory: "explosive-endurance.max-history",
      log: "explosive-endurance.log",
      logCorruptBackupPrefix: "explosive-endurance.log.corrupt-",
      fatigue: "explosive-endurance.fatigue",
      fatigueCorruptBackupPrefix: "explosive-endurance.fatigue.corrupt-",
      checkInSnoozed: "explosive-endurance.checkin-snoozed",
      fatigueWarningDismissed: "explosive-endurance.fatigue-warning-dismissed",
      rotationDismissed: "explosive-endurance.rotation-dismissed",
      retestDismissed: "explosive-endurance.retest-dismissed",
      retestJumpSkipped: "explosive-endurance.retest-jump-skipped",
      noEquipment: "explosive-endurance.no-equipment",
      importBackupPrefix: "explosive-endurance.import-backup-",
    });
  });

  it("builds another program's keys from its own id", () => {
    const keys = storageKeysForProgram("steady-strength");

    expect(keys.settings).toBe("steady-strength.settings");
    expect(keys.logCorruptBackupPrefix).toBe("steady-strength.log.corrupt-");
    expect(keys.noEquipment).toBe("steady-strength.no-equipment");
    expect(keys.importBackupPrefix).toBe("steady-strength.import-backup-");
  });

  it("never shares a key between two programs", () => {
    const explosive = Object.values(storageKeysForProgram("explosive-endurance"));
    const steady = new Set(Object.values(storageKeysForProgram("steady-strength")));

    expect(explosive.filter((key) => steady.has(key))).toEqual([]);
  });
});
