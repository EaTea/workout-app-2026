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

  /**
   * The calendar date ("YYYY-MM-DD") each max in `maxReps` was last saved or
   * changed, keyed by exercise id. Missing key = no known date (e.g. a max
   * saved before dates were recorded). The schedule uses it to tell whether a
   * max was retested during the retest week.
   */
  maxSavedOn: Record<string, string>;
}
