import type { Exercise, Program } from "../program/model";
import { retestWeekStartDate, wasMaxSavedDuringWeek } from "../program/schedule";
import { toDayNumber } from "../program/calendar";
import type { TrainingSettings } from "../settings/model";
import type { FatigueCheck, WeeklyFatigueCheck } from "../fatigue/model";
import type { FatigueHistory } from "../fatigue/model";
import { checkForWeek, weeklyChecksFor } from "../fatigue/operations";
import { trainingWeekOf } from "./checkin";
import { stampMaxSavedDates, updateMaxHistory } from "./settings";

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

/**
 * Which max-tested exercises the retest card should still ask for on `date`.
 * Empty (no card) unless `date` is a retest-week training day, the card was
 * not dismissed for that date, and the exercise's max was not yet saved on a
 * date inside that week, Day 1 to Day 7 (the same check the schedule uses to
 * switch EMOMs to the new max, `wasMaxSavedDuringWeek`). Exercises come back in program order.
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
    (exercise) => exercise.maxTested && !wasMaxSavedDuringWeek(settings, exercise.id, weekStartDate),
  );
}

/**
 * True when the retest card should still show on `date` for the broad jump
 * alone: both maxes are saved (the caller found no exercises to retest), it is
 * a retest-week training day, "Not today" was not tapped for `date`, no broad
 * jump is saved in that week's check, and "Skip jump" was not tapped for this
 * retest week (`skippedWeekStart` is that week's Day 1). This keeps the jump
 * from being lost just because the maxes were saved first. Called by
 * `renderTodayScreen` when `retestExercisesToSave` is empty.
 */
export function shouldOfferJumpOnly(
  program: Program,
  settings: TrainingSettings,
  date: string,
  dismissedDate: string | undefined,
  history: FatigueHistory,
  skippedWeekStart: string | undefined,
): boolean {
  const weekStartDate = retestWeekStartDate(program, settings, date);
  const week = trainingWeekOf(program, settings, date);
  if (weekStartDate === undefined || week === undefined || dismissedDate === date) return false;
  if (skippedWeekStart === weekStartDate) return false;

  const savedCheck = checkForWeek(weeklyChecksFor(history, settings.startDate, program.lengthWeeks), week);
  return savedCheck?.broadJumpMetres === undefined;
}

/**
 * The settings after saving ONE retested max: `freshSettings` (just re-read
 * from storage by app.ts, so another open copy's changes survive) with only
 * `exerciseId`'s max set to `newMax`, stamped `today` and added to its history (the real local date,
 * never a `?date=` preview). Every other max, its date and the start date are
 * left exactly as they were. Pure; called by `handleSaveRetestMax` in app.ts.
 */
export function applyRetestMax(freshSettings: TrainingSettings, exerciseId: string, newMax: number, today: string): TrainingSettings {
  const maxReps = { ...freshSettings.maxReps, [exerciseId]: newMax };
  const maxSavedOn = stampMaxSavedDates(freshSettings, maxReps, new Set([exerciseId]), today);
  const maxHistory = updateMaxHistory(freshSettings, maxReps, new Set([exerciseId]), today);
  return { ...freshSettings, maxReps, maxSavedOn, maxHistory };
}

/**
 * The week 8 check after a retest save: `existing` (the week's check, if any)
 * with only the fields in `values` replaced, so saving the pull-up retest and
 * the broad jump in either order never wipes the other. Keeps the existing
 * check's date (a later save in the week merges into the same check), else
 * files it under `today`. A field that is absent from `values` is kept as it
 * was. Pure; called by `recordRetestCheck` in app.ts.
 */
export function mergeRetestCheck(
  existing: WeeklyFatigueCheck | undefined,
  values: { broadJumpMetres?: number; maxPullUps?: number },
  today: string,
  savedAt: Date,
): FatigueCheck {
  return {
    date: existing?.date ?? today,
    broadJumpMetres: values.broadJumpMetres ?? existing?.broadJumpMetres,
    maxPullUps: values.maxPullUps ?? existing?.maxPullUps,
    savedAt,
  };
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

/** Converts stored text (untrusted, possibly null or corrupt) into the skipped retest week's first date, or undefined. Called once at startup. */
export function retestJumpSkippedFromWire(wire: RetestDismissedWire | null): string | undefined {
  return retestDismissedFromWire(wire);
}

/** Converts the skipped retest week's first date to its stored text. Called when "Skip jump" is tapped. */
export function retestJumpSkippedToWire(weekStartDate: string): RetestDismissedWire {
  return retestDismissedToWire(weekStartDate);
}
