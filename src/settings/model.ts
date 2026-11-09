/**
 * Internal settings model: what the schedule logic needs to know about the
 * athlete. Persistence (a separate wire type plus mapping functions) arrives
 * with the storage step; nothing here is serialised directly.
 */

/** The athlete's own configuration, edited on the settings screen. */
export interface TrainingSettings {
  /** First day of the program as a calendar date "YYYY-MM-DD", or null until chosen. */
  startDate: string | null;

  /** Tested max reps keyed by exercise id (e.g. `pull_up`, `dip`). Missing key = not tested yet. */
  maxReps: Record<string, number>;
}
