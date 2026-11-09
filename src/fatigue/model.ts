/**
 * Internal weekly fatigue-check model (PLAN.md rule 6). Step 3 of PR 4 (the
 * "Weekly check-in" card and the drop warning on Today) works with these
 * types; persistence uses separate wire types (`wire.ts`).
 *
 *   FatigueHistory
 *   └─ checks: FatigueCheck[]            at most one per program week
 *        └─ { date: "2026-11-09",        the day the check was saved
 *             programWeek: 2,             1-8
 *             broadJumpMetres?: 2.31,     either measurement may be skipped
 *             maxPullUps?: 10,
 *             savedAt: Date }
 *
 * Saving again in the same program week replaces that week's check.
 */

/** One weekly check-in. At least one of the two measurements is normally present, but neither is required. */
export interface FatigueCheck {
  /** Program date "YYYY-MM-DD" on which the check was saved. */
  date: string;

  /** Program week (1-8) the check belongs to; the key that makes it "one per week". */
  programWeek: number;

  /** Best broad jump in metres (more than 0, at most 5, 2 decimals). Absent when skipped. */
  broadJumpMetres?: number;

  /** Maximum strict pull-ups (whole number 0-100). Absent when skipped. */
  maxPullUps?: number;

  /** When the check was saved. Internal type is a Date; the wire form is an ISO 8601 string. */
  savedAt: Date;
}

/** All saved checks, in no guaranteed order (use `checkForWeek` / `bestRecent` to look things up). */
export interface FatigueHistory {
  checks: FatigueCheck[];
}

/** The two measurements a check can record. */
export type FatigueField = "broadJumpMetres" | "maxPullUps";
