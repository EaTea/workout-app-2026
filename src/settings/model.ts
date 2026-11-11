/**
 * Internal settings model: what the schedule logic needs to know about the
 * athlete. Persistence (a separate wire type plus mapping functions) arrives
 * with the storage step; nothing here is serialised directly.
 */

/**
 * One saved max in an exercise's history: the value and the calendar date
 * ("YYYY-MM-DD") it was saved. `savedOn` is null when the date is unknown
 * (a max saved before dates were recorded); such an entry counts as the
 * earliest. See maxHistory.ts for the helpers.
 */
export interface MaxHistoryEntry {
  savedOn: string | null;
  reps: number;
}

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

  /**
   * Every max saved per exercise id, oldest first, one entry per day. The
   * last entry always matches `maxReps` / `maxSavedOn` (those stay as the
   * "latest" view). The schedule uses the history to work out which max a
   * past day was shown with (the week 8 hold).
   */
  maxHistory: Record<string, MaxHistoryEntry[]>;
}
