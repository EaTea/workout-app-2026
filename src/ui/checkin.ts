import type { Program } from "../program/model";
import { programStatus, toDayNumber } from "../program/calendar";
import { phaseForWeek } from "../program/schedule";
import type { TrainingSettings } from "../settings/model";
import type { FatigueField, FatigueHistory } from "../fatigue/model";
import { checkForWeek, fatigueWarnings, weeklyChecksFor, type FatigueWarning } from "../fatigue/operations";

/**
 * Pure rules and storage mapping for the weekly check-in on Today (PLAN.md
 * rule 6). The card is drawn by checkinCard.ts and wired up by app.ts.
 *
 *   program + settings + shown date + saved checks + snoozed date
 *        │  checkInWeekToAsk
 *        ▼
 *   program week to ask about (undefined = no card)
 *
 *   saved checks + shown date
 *        │  dropWarningForShownDate
 *        ▼
 *   this week's drops over 10% (empty = no banner)
 */

/** Broad jump limits (metres): more than 0 and at most 5, two decimals. Same as the stored check's rules. */
export const MINIMUM_BROAD_JUMP_METRES = 0.01;
export const MAXIMUM_BROAD_JUMP_METRES = 5;

/** Pull-up limit; a check records whole numbers from 0 to this. */
export const MAXIMUM_PULL_UPS = 100;

/** Step of the broad jump stepper. */
export const BROAD_JUMP_STEP_METRES = 0.01;

/** Where the first tap on a blank broad jump stepper lands when there is no "best recent" to start from. */
export const DEFAULT_BROAD_JUMP_METRES = 2;

/** Where the first tap on a blank pull-up stepper lands when there is no "best recent" to start from. */
export const DEFAULT_PULL_UPS = 10;

/** Shown on the retest and check-in cards in a `?date=` preview, where saving is switched off (see app.ts). */
export const PREVIEW_SAVING_OFF_MESSAGE = "Previewing — saving is off on this date.";

/**
 * The program week the check-in card should ask about on `date`, or
 * undefined for no card. A card is due when `date` is a training day of an
 * active program, the week is not a retest week (the retest card replaces the
 * check-in then), no check is saved for the week and "Remind me tomorrow" was
 * not tapped on this very date. A snooze made on an earlier date therefore
 * ends by itself: the card returns on the next date of the same week.
 * A program without a `fatigueCheck` never asks. Called by
 * `renderTodayScreen` on every render, and by app.ts when saving.
 */
export function checkInWeekToAsk(
  program: Program,
  settings: TrainingSettings,
  date: string,
  history: FatigueHistory,
  snoozedDate: string | undefined,
): number | undefined {
  if (program.fatigueCheck === undefined) return undefined;

  const week = trainingWeekOf(program, settings, date);
  if (week === undefined || phaseForWeek(program, week).retest) return undefined;
  const weeklyChecks = weeklyChecksFor(history, settings.startDate, program.lengthWeeks);
  if (checkForWeek(weeklyChecks, week) !== undefined || snoozedDate === date) return undefined;

  return week;
}

/**
 * The program week of `date` when it is a training day of an active program
 * (not a rest day, not before the start or after the end), else undefined.
 * Shared by the card rule above and the week 8 retest hook in app.ts.
 */
export function trainingWeekOf(program: Program, settings: TrainingSettings, date: string): number | undefined {
  const status = programStatus(settings.startDate, program.lengthWeeks, date);
  if (status.kind !== "active" || program.days[status.dayNumber] === undefined) return undefined;

  return status.week;
}

/**
 * The drops over 10% in the check saved for the program week of `date`
 * (any day of an active program, including the rest day), with that week.
 * Empty `warnings` when the date is outside the program or the week has no
 * drop. A program without a `fatigueCheck` never has one. Drives the Today
 * banner, "for the rest of that week".
 */
export function dropWarningForShownDate(
  program: Program,
  settings: TrainingSettings,
  date: string,
  history: FatigueHistory,
): { week: number; warnings: FatigueWarning[] } {
  if (program.fatigueCheck === undefined) return { week: 0, warnings: [] };

  const status = programStatus(settings.startDate, program.lengthWeeks, date);
  if (status.kind !== "active") return { week: 0, warnings: [] };

  const weeklyChecks = weeklyChecksFor(history, settings.startDate, program.lengthWeeks);
  return { week: status.week, warnings: fatigueWarnings(weeklyChecks, status.week) };
}

/** What the card's two steppers hold before saving; undefined is a blank field (never saved as a number). */
export interface CheckInDraft {
  /** The program week the draft is for; a draft of another week is discarded. */
  week: number;
  broadJumpMetres?: number;
  maxPullUps?: number;
}

/**
 * A fresh draft for `week`: both fields blank. They are NOT pre-filled with
 * the best recent values, because a pre-filled value saved by a tap on Save
 * would record a measurement Ed never took. "Best recent" is shown as a hint
 * and is where the first tap on a blank stepper starts (checkinCard.ts).
 */
export function createCheckInDraft(week: number): CheckInDraft {
  return { week };
}

/**
 * Reads broad jump text typed into the stepper: metres with up to two
 * decimals ("2.3", "2.31", also "2,31"), more than 0 and at most 5. Anything
 * else returns undefined and the field reverts. Used as the stepper's
 * `parseTyped` rule by checkinCard.ts.
 */
export function parseBroadJumpInput(text: string): number | undefined {
  const trimmed = text.trim().replace(",", ".");
  if (!/^\d+(\.\d{1,2})?$/.test(trimmed)) return undefined;

  const metres = Number(trimmed);
  if (metres < MINIMUM_BROAD_JUMP_METRES || metres > MAXIMUM_BROAD_JUMP_METRES) return undefined;

  return metres;
}

/** Rounds to two decimals so repeated 0.01 steps never show floating-point noise. */
export function roundToTwoDecimals(value: number): number {
  return Math.round(value * 100) / 100;
}

/** Display text for a broad jump, always two decimals ("2.30"). */
export function formatMetres(metres: number): string {
  return metres.toFixed(2);
}

/** "Best recent: 2.34 m" / "Best recent: 12 reps". */
export function formatBestRecent(field: FatigueField, best: number): string {
  return `Best recent: ${field === "broadJumpMetres" ? `${formatMetres(best)} m` : `${best} reps`}`;
}

/** "−17%", "+3%" or "0%", using a real minus sign like the mockup. */
export function formatPercentChange(percentChange: number): string {
  if (percentChange < 0) return `−${Math.abs(percentChange)}%`;
  return percentChange > 0 ? `+${percentChange}%` : "0%";
}

/**
 * Plain-language headline for the drops, e.g. "Pull-ups are down more than
 * 10% this week." or "Broad jump and pull-ups are down more than 10% this
 * week." Followed in the UI by the program's `fatigueCheck.rule` text.
 * `warnings` must not be empty.
 */
export function describeDrops(warnings: FatigueWarning[]): string {
  const hasJump = warnings.some((warning) => warning.field === "broadJumpMetres");
  const hasPullUps = warnings.some((warning) => warning.field === "maxPullUps");

  if (hasJump && hasPullUps) return "Broad jump and pull-ups are down more than 10% this week.";
  return hasJump ? "Broad jump is down more than 10% this week." : "Pull-ups are down more than 10% this week.";
}

/** Stored form of a snoozed date: just the date text (CLAUDE.md section 6 wants the shape named). */
export type CheckInSnoozedWire = string;

/** Reads stored snooze text (untrusted, possibly null or corrupt) into a date, or undefined. Called once at startup. */
export function checkInSnoozedFromWire(wire: CheckInSnoozedWire | null): string | undefined {
  if (wire === null) return undefined;

  try {
    toDayNumber(wire);
    return wire;
  } catch {
    return undefined;
  }
}

/** Converts the snoozed date to its stored text. Called when "Remind me tomorrow" is tapped. */
export function checkInSnoozedToWire(snoozedDate: string): CheckInSnoozedWire {
  return snoozedDate;
}

/** Stored form of the dismissed banner: `{"week": 3}` as JSON text. */
export interface FatigueWarningDismissedWire {
  week: number;
}

/**
 * Reads stored dismissal text (untrusted) into the dismissed program week
 * (1 or more, whole), or undefined when absent or unusable. Called once at startup.
 */
export function fatigueWarningDismissedFromWire(text: string | null): number | undefined {
  if (text === null) return undefined;

  try {
    const parsed: unknown = JSON.parse(text);
    const week = (parsed as Partial<FatigueWarningDismissedWire> | null)?.week;
    return typeof week === "number" && Number.isInteger(week) && week >= 1 ? week : undefined;
  } catch {
    return undefined;
  }
}

/** Converts the dismissed week to its stored text. Called when the banner's Dismiss is tapped. */
export function fatigueWarningDismissedToWire(week: number): string {
  const wire: FatigueWarningDismissedWire = { week };
  return JSON.stringify(wire);
}
