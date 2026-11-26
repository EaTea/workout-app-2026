import type { TrainingBreak } from "../break/model";
import { addDaysToDate } from "../program/calendar";
import { formatShortDate } from "./format";

/*
 * The words of "Break from training": the Settings section, Today's card and
 * History's line. Pure functions (no DOM) so the wording is unit tested;
 * `breakUi.ts` and `history.ts` draw them.
 *
 * A stored break's `to` is the first day BACK, so the last day OFF is `to`
 * minus one day. To avoid off-by-one confusion the wording never says
 * "until": a running break reads "Back on <to>", and a finished break reads
 * as a range of days that were off, last day included.
 *
 *   break { from: 26 Nov, to: 3 Dec }
 *     ──▶ breakRangeText     "26 Nov to 2 Dec"          (first and last day off)
 *     ──▶ backOnText         "Back on 3 Dec"            (first day back)
 *     ──▶ pastBreakLine      "26 Nov to 2 Dec · Physio: rest the neck"
 *     ──▶ historyBreakLine   "On a break · 26 Nov to 2 Dec"
 */

/** The number of days the "Take a break" form starts with. */
export const DEFAULT_BREAK_DAYS = 7;

/** Placeholder of the note field. */
export const BREAK_NOTE_PLACEHOLDER = "e.g. Physio: rest the neck";

/** The heading of the Settings section. */
export const BREAK_SECTION_TITLE = "Break from training";

/** The title of the card on a break day, and the first words of History's line. */
export const ON_A_BREAK_TITLE = "On a break";

/** The button that ends a running break, on Settings and Today. */
export const END_BREAK_LABEL = "End the break today";

/** The link on Today and the button on Settings that open the start form. */
export const TAKE_A_BREAK_LABEL = "Take a break";

/** The form's submit button. */
export const START_BREAK_LABEL = "Start break";

/** Shown instead of an end button on a `?date=` preview, where nothing may be saved. */
export const BREAK_PREVIEW_MESSAGE = "Go back to today to end the break.";

/**
 * "26 Nov to 2 Dec": the first and last day OFF of `trainingBreak`. A one-day
 * break shows a single date ("26 Nov"). The last day is `to` minus one.
 */
export function breakRangeText(trainingBreak: Pick<TrainingBreak, "from" | "to">): string {
  const lastDayOff = addDaysToDate(trainingBreak.to, -1);
  const first = formatShortDate(trainingBreak.from);
  if (lastDayOff <= trainingBreak.from) return first;
  return `${first} to ${formatShortDate(lastDayOff)}`;
}

/** "Back on 3 Dec": when training resumes, given a break's `to` (or Today's resume date). */
export function backOnText(firstDayBack: string): string {
  return `Back on ${formatShortDate(firstDayBack)}`;
}

/** "26 Nov to 2 Dec · Physio: rest the neck": a past break as one plain line; the note is left off when there is none. */
export function pastBreakLine(trainingBreak: TrainingBreak): string {
  const range = breakRangeText(trainingBreak);
  return trainingBreak.note === undefined ? range : `${range} · ${trainingBreak.note}`;
}

/** "On a break · 26 Nov to 2 Dec": the line History shows where a break sits among the days. */
export function historyBreakLine(trainingBreak: Pick<TrainingBreak, "from" | "to">): string {
  return `${ON_A_BREAK_TITLE} · ${breakRangeText(trainingBreak)}`;
}

/** "On a break · Back on 3 Dec": the first line of the running-break view in Settings. */
export function runningBreakTitleLine(trainingBreak: Pick<TrainingBreak, "to">): string {
  return `${ON_A_BREAK_TITLE} · ${backOnText(trainingBreak.to)}`;
}

/**
 * Turns what was typed in the "days" field into a number for `startBreak`.
 * Anything that is not a plain whole number (empty, "abc", "2.5") becomes NaN,
 * which `startBreak` refuses with its own readable message, so the wording of
 * that error lives in one place.
 */
export function parseBreakDays(typedText: string): number {
  const trimmed = typedText.trim();
  if (!/^\d+$/.test(trimmed)) return Number.NaN;
  return Number(trimmed);
}
