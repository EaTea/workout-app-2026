import type { Exercise, Program } from "../program/model";
import { retestWeekStartDate, wasMaxSavedSince } from "../program/schedule";
import { toDayNumber } from "../program/calendar";
import type { TrainingSettings } from "../settings/model";

/**
 * Pure rules and storage mapping for the week 8 retest card on Today
 * (PLAN.md rule 5). The card itself is drawn by retestCard.ts and wired up
 * by app.ts.
 *
 *   program + settings + shown date + dismissed date
 *        │  retestExercisesToSave
 *        ▼
 *   exercises still to retest (empty list = no card)
 */

/** localStorage key holding the date ("YYYY-MM-DD") on which "Not today" was last tapped. */
export const RETEST_DISMISSED_STORAGE_KEY = "explosive-endurance.retest-dismissed";

/**
 * Which max-tested exercises the retest card should still ask for on `date`.
 * Empty (no card) unless `date` is a retest-week training day, the card was
 * not dismissed for that date, and the exercise's max was not yet saved on or
 * after that week's Day 1 (the same check the schedule uses to switch EMOMs
 * to the new max, `wasMaxSavedSince`). Exercises come back in program order.
 * Called by `renderTodayScreen` on every render.
 */
export function retestExercisesToSave(
  program: Program,
  settings: TrainingSettings,
  date: string,
  dismissedDate: string | undefined,
): Exercise[] {
  const weekStartDate = retestWeekStartDate(program, settings, date);
  if (weekStartDate === undefined || dismissedDate === date) {
    return [];
  }

  return Object.values(program.exercises).filter(
    (exercise) => exercise.maxTested && !wasMaxSavedSince(settings, exercise.id, weekStartDate),
  );
}

/**
 * Wire type for the dismissal: the stored text is just the date. A named
 * type keeps the stored shape explicit (CLAUDE.md section 6) and gives
 * the mapping functions below something to convert to and from.
 */
export type RetestDismissedWire = string;

/**
 * Converts stored text (untrusted, possibly null or corrupt) into the
 * dismissed date, or undefined when nothing valid is stored. Called once at
 * startup by `startApp`.
 */
export function retestDismissedFromWire(wire: RetestDismissedWire | null): string | undefined {
  if (wire === null) {
    return undefined;
  }

  try {
    toDayNumber(wire);
    return wire;
  } catch {
    return undefined;
  }
}

/** Converts the dismissed date to its stored text. Called by `startApp` when "Not today" is tapped. */
export function retestDismissedToWire(dismissedDate: string): RetestDismissedWire {
  return dismissedDate;
}
