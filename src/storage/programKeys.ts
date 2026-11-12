/**
 * The localStorage keys one program's per-user data lives under.
 *
 * Every program keeps its own settings, max history, log, check-ins and card
 * dismissals, so each key is `${programId}.<name>`. For the original program
 * ("explosive-endurance") that gives exactly the keys the app has always
 * used, so nothing is migrated.
 *
 *   programId ──storageKeysForProgram──▶ ProgramStorageKeys ──▶ storage modules, app.ts, import/export
 *
 * NOT in here (app-wide, shared by all programs, so not built from a program
 * id): the service worker's reload guard (`pwa/register.ts`), its cache
 * prefix (`pwa/serviceWorkerSource.ts`) and the active-program key
 * (`storage/activeProgram.ts`).
 */

/** Every per-program localStorage key (or key prefix) for one program id. */
export interface ProgramStorageKeys {
  /** The catalogue id these keys were built from; export files carry it so an import can tell whose backup it is. */
  programId: string;
  /** Training settings (v2: start date, maxes). */
  settings: string;
  /** Max-rep history per exercise. */
  maxHistory: string;
  /** The workout log. */
  log: string;
  /** Prefix of the copies `loadLog` keeps of an unreadable log (followed by an ISO timestamp). */
  logCorruptBackupPrefix: string;
  /** Weekly fatigue check-ins. */
  fatigue: string;
  /** Prefix of the copies `loadFatigueHistory` keeps of unreadable check-ins (followed by an ISO timestamp). */
  fatigueCorruptBackupPrefix: string;
  /** Date the weekly check-in card was snoozed. */
  checkInSnoozed: string;
  /** Week for which the fatigue-drop warning was dismissed. */
  fatigueWarningDismissed: string;
  /** Block weeks for which the rotation card was dismissed. */
  rotationDismissed: string;
  /** Date the re-test card was dismissed. */
  retestDismissed: string;
  /** Week for which the re-test jump prompt was skipped. */
  retestJumpSkipped: string;
  /** Today's "No equipment" swap ticks per date (throwaway pre-session state, pruned after 14 days, not exported). */
  noEquipment: string;
  /** Prefix of the backups an import keeps of the data it replaces (followed by an ISO timestamp). */
  importBackupPrefix: string;
}

/**
 * Builds all of a program's storage keys from its id. Called once at startup
 * (main.ts) and the result is passed to the storage modules and app.ts, so no
 * module has to know how keys are spelled.
 *
 * @param programId the catalogue id, e.g. "explosive-endurance"
 */
export function storageKeysForProgram(programId: string): ProgramStorageKeys {
  return {
    programId,
    settings: `${programId}.settings`,
    maxHistory: `${programId}.max-history`,
    log: `${programId}.log`,
    logCorruptBackupPrefix: `${programId}.log.corrupt-`,
    fatigue: `${programId}.fatigue`,
    fatigueCorruptBackupPrefix: `${programId}.fatigue.corrupt-`,
    checkInSnoozed: `${programId}.checkin-snoozed`,
    fatigueWarningDismissed: `${programId}.fatigue-warning-dismissed`,
    rotationDismissed: `${programId}.rotation-dismissed`,
    retestDismissed: `${programId}.retest-dismissed`,
    retestJumpSkipped: `${programId}.retest-jump-skipped`,
    noEquipment: `${programId}.no-equipment`,
    importBackupPrefix: `${programId}.import-backup-`,
  };
}
