import type { WorkoutLog } from "../log/model";

/**
 * The hand-off between the screens that change the log (log screen, History)
 * and app.ts, which owns the stored log. A screen never saves a whole log it
 * built itself; it describes ONE change as an `operation` on whatever log is
 * stored right now, and app.ts applies and saves it (read-modify-write, see
 * `applyLogChange` in log/storage.ts).
 *
 *   screen: commit(fresh => logSet(fresh, ...)) ──▶ app.ts changeLog ──▶ re-read, apply, save
 *   screen: adopts outcome.log, shows outcome.error (if any)
 */

/** What a screen gets back after asking for a change. */
export interface LogChangeOutcome {
  /** The log the screen should now show: the fresh stored log with the change applied, or the app's unchanged copy if the change was refused. */
  log: WorkoutLog;

  /** A readable reason to show inline when the change could not be saved (or was refused), else null. */
  error: string | null;
}

/** Asks app.ts to apply one change to the freshly re-read stored log and save it. */
export type ChangeLog = (operation: (freshLog: WorkoutLog) => WorkoutLog) => LogChangeOutcome;
