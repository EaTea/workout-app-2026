/**
 * Internal weekly fatigue-check model (PLAN.md rule 6). Two views of the same
 * data, kept apart so a changed start date can never misfile old checks:
 *
 *   FatigueHistory (what is stored, keyed by DATE)
 *   └─ checks: FatigueCheck[]            one per date
 *        └─ { date: "2026-11-09",        the day the check was saved (the key)
 *             savedProgramWeek?: 2,      week at save time; written for older
 *                                        app versions, never used when reading
 *             broadJumpMetres?: 2.31,     either measurement may be skipped
 *             maxPullUps?: 10,
 *             savedAt: Date }
 *
 *        │  weeklyChecksFor(history, startDate, lengthWeeks)   (operations.ts)
 *        ▼
 *   WeeklyFatigueHistory (what the UI compares, keyed by DERIVED program week)
 *   └─ checks: WeeklyFatigueCheck[]      FatigueCheck + programWeek worked out
 *                                        from the CURRENT start date
 *
 * Checks dated before the start date (or with no start date) are kept in the
 * stored history but have no week, so they never appear in the weekly view.
 */

/** One stored check-in, identified by its date. At least one measurement is normally present, but neither is required. */
export interface FatigueCheck {
  /** Program date "YYYY-MM-DD" on which the check was saved. This is the check's key. */
  date: string;

  /**
   * The program week (1-8) the app worked out when the check was saved. Kept
   * only so it can be written back for older app versions that key checks by
   * week; it is ignored when reading, because the start date may have moved.
   */
  savedProgramWeek?: number;

  /** Best broad jump in metres (more than 0, at most 5, 2 decimals). Absent when skipped. */
  broadJumpMetres?: number;

  /** Maximum strict pull-ups (whole number 0-100). Absent when skipped. */
  maxPullUps?: number;

  /** When the check was saved. Internal type is a Date; the wire form is an ISO 8601 string. */
  savedAt: Date;
}

/** All stored checks, in no guaranteed order. At most one per date. */
export interface FatigueHistory {
  checks: FatigueCheck[];
}

/** A stored check together with the program week its date falls in under the current start date. */
export interface WeeklyFatigueCheck extends FatigueCheck {
  /** Program week (1-8) derived from `date` and the current start date; the key that makes it "one per week". */
  programWeek: number;
}

/** The checks that fall inside the program, each with its derived week. Used for every comparison and lookup. */
export interface WeeklyFatigueHistory {
  checks: WeeklyFatigueCheck[];
}

/** The two measurements a check can record. */
export type FatigueField = "broadJumpMetres" | "maxPullUps";
