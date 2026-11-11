import type { FatigueCheck, FatigueField, FatigueHistory } from "./model";

/**
 * Pure fatigue-check operations (no storage, no DOM). PR 4 step 3's check-in
 * card and Today warning call these to save a check, to show "Best recent"
 * and the percentage, and to decide whether to show the drop warning.
 */

/** How many earlier checks "best recent" looks back over. */
export const RECENT_CHECK_COUNT = 3;

/** A drop strictly larger than this fraction of the best recent value is a warning. */
export const DROP_WARNING_FRACTION = 0.1;

/** Tolerance so floating-point noise (e.g. 10.8 vs 12) cannot push an exact 10% drop over the line. */
const FRACTION_TOLERANCE = 1e-9;

/** Result of comparing a value with the best recent one. */
export interface Comparison {
  /**
   * Change relative to the best, rounded to a whole percent; negative is a
   * drop (-17 for 10 vs 12). Never contradicts `isDropOverThreshold`: a drop
   * over 10% that would round to -10 is given to one decimal instead (-10.3),
   * and a drop that is not over 10% is never shown beyond -10.
   */
  percentChange: number;
  /** True when the value is down by strictly more than 10%. */
  isDropOverThreshold: boolean;
}

/** One field of a week's check that is down by more than 10%, with the numbers the warning shows. */
export interface FatigueWarning {
  /** Which measurement dropped. */
  field: FatigueField;

  /** The value saved this week. */
  value: number;

  /** The best of the previous 3 checks that recorded this field (what `value` is compared with). */
  best: number;

  /** The change against `best` as `compareToBest` reports it (negative; one decimal when a whole number would read as 10%). */
  percentChange: number;
}

/** Returns a new history with `check` saved; any existing check for the same program week is replaced. */
export function recordCheck(history: FatigueHistory, check: FatigueCheck): FatigueHistory {
  const otherWeeks = history.checks.filter((existing) => existing.programWeek !== check.programWeek);
  return { checks: [...otherWeeks, check] };
}

/** Returns the check saved for `week`, or undefined. Used to pre-fill and to know whether the card is still due. */
export function checkForWeek(history: FatigueHistory, week: number): FatigueCheck | undefined {
  return history.checks.find((check) => check.programWeek === week);
}

/**
 * The best (largest) value of `field` among the previous 3 checks before
 * `beforeWeek` that recorded that field, newest weeks first. Checks that
 * skipped the field are ignored (they do not use up one of the 3 slots).
 * Undefined when there is none, so the card shows no "Best recent" line.
 */
export function bestRecent(history: FatigueHistory, field: FatigueField, beforeWeek: number): number | undefined {
  const recentValues = history.checks
    .filter((check) => check.programWeek < beforeWeek && check[field] !== undefined)
    .sort((first, second) => second.programWeek - first.programWeek)
    .slice(0, RECENT_CHECK_COUNT)
    .map((check) => check[field] as number);

  return recentValues.length === 0 ? undefined : Math.max(...recentValues);
}

/**
 * Compares `value` with `best`. A best of 0 (0 pull-ups) cannot be dropped
 * from or compared by percentage, so it gives 0% and no warning.
 */
export function compareToBest(value: number, best: number): Comparison {
  if (best <= 0) {
    return { percentChange: 0, isDropOverThreshold: false };
  }

  const changeFraction = (value - best) / best;
  const isDropOverThreshold = -changeFraction > DROP_WARNING_FRACTION + FRACTION_TOLERANCE;

  return {
    percentChange: displayPercentChange(changeFraction * 100, isDropOverThreshold),
    isDropOverThreshold,
  };
}

/**
 * Turns an exact percentage into the figure shown next to the value, without
 * ever contradicting the warning:
 *  - a flagged drop (over 10%) whose whole-number rounding would read -10 is
 *    shown to one decimal, rounded away from zero (-10.3), so it visibly
 *    exceeds 10;
 *  - an unflagged change is never shown beyond -10 (exactly 10% is not a warning).
 * Everything else is a plain whole percent. Used only by `compareToBest`.
 */
function displayPercentChange(exactPercent: number, isDropOverThreshold: boolean): number {
  const wholePercent = Math.round(exactPercent);

  if (isDropOverThreshold && wholePercent > -11) {
    // The tiny subtraction stops float noise (10.1 x 10 = 101.00000000000001) rounding up an extra tenth.
    return -Math.ceil(Math.abs(exactPercent) * 10 - 1e-9) / 10;
  }
  if (!isDropOverThreshold && wholePercent < -10) {
    return -10;
  }

  // `+ 0` turns -0 into 0 so a tiny change shows as "0%", not "-0%".
  return wholePercent + 0;
}

/**
 * Which recorded fields of the check for `week` are down by more than 10%
 * against their best recent value. Empty when there is no check for the week,
 * nothing earlier to compare with, or no drop. Drives both the card warning
 * and the Today banner (PR 4 step 3).
 */
export function fatigueWarnings(history: FatigueHistory, week: number): FatigueWarning[] {
  const check = checkForWeek(history, week);
  if (check === undefined) return [];

  const warnings: FatigueWarning[] = [];
  for (const field of ["broadJumpMetres", "maxPullUps"] as const) {
    const value = check[field];
    const best = bestRecent(history, field, week);
    if (value === undefined || best === undefined) continue;

    const comparison = compareToBest(value, best);
    if (comparison.isDropOverThreshold) {
      warnings.push({ field, value, best, percentChange: comparison.percentChange });
    }
  }
  return warnings;
}
