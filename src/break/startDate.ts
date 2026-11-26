import { addDaysToDate } from "../program/calendar";

/**
 * Why a new break starts on the day it does. "today" is the normal case; the
 * other two push the start to tomorrow so a break never swallows a day that
 * is already done.
 */
export type BreakStartReason = "today" | "trainedToday" | "donorToday";

/** Where a new break starts and why; the Settings form shows the reason before "Start break". */
export interface BreakStartDecision {
  from: string;
  reason: BreakStartReason;
}

/**
 * Decides the first day of a new break. A break normally starts on the real
 * `today`. But if today already has logged sets (`hasLoggedToday`), or today
 * is the added date of an active combine (`isDonorToday`: yesterday's session
 * already included today's program day), starting today would hide a session
 * that was done and the same program day would repeat after the break. Then
 * the break starts tomorrow instead.
 *
 *   today untouched ──────────────▶ from = today
 *   today trained / donor date ───▶ from = tomorrow ("Coming up" until then)
 *
 * Pure. Called by the Settings break card (`breakUi.ts`), with the two flags
 * worked out by `app.ts` from the log and `activeDonorOn`.
 */
export function breakStartDate(today: string, hasLoggedToday: boolean, isDonorToday: boolean): BreakStartDecision {
  if (hasLoggedToday) return { from: addDaysToDate(today, 1), reason: "trainedToday" };
  if (isDonorToday) return { from: addDaysToDate(today, 1), reason: "donorToday" };
  return { from: today, reason: "today" };
}
