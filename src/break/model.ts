/**
 * Internal (in-memory) form of a break from training, stored under
 * `keys.breaks`. Only `wire.ts` converts between this and the stored JSON;
 * `operations.ts` and `storage.ts` work with this type. The schedule (Break 1
 * step 2) skips break days and Today (step 3) shows the break.
 */

/**
 * One break from training. It covers dates from `from` up to, but NOT
 * including, `to` (the first day back). Dates are "YYYY-MM-DD" local dates.
 *
 *   from 26 Nov ─────────────────▶ to 3 Dec
 *   covered:  26 Nov ... 2 Dec     not covered: 3 Dec onwards (first day back)
 *
 * So "7 days from 26 Nov" is from 2026-11-26, to 2026-12-03.
 */
export interface TrainingBreak {
  from: string;
  to: string;
  /** Optional reminder of why, e.g. "Physio: rest the neck". Never empty when present. */
  note?: string;
}
