import type { InjuryArea } from "../program/model";
import type { ItemView, SessionView } from "../program/schedule";
import { areaWord } from "./injuryFlagText";

/*
 * The words of Today's rows while an area is flagged, kept as pure functions
 * so the wording is unit tested without a DOM. `today.ts` draws them.
 *
 *   left-out row    Pull-ups  Left out for your shoulder · [Add it back]
 *   left-out block  Boxing left out for your shoulder · [Add it back]
 *   stand-in row    Lying leg raise / "Instead of Hanging leg raise"
 *   caution row     ... "Pain-free only · stop if it hurts"
 *   area-free day   "Shoulder-free session · instead of Day 3 (Upper: push)"
 */

/** The label of the button that brings a left-out item (or block) back for the day. */
export const ADD_IT_BACK_LABEL = "Add it back";

/** The line under a row that must be done within what doesn't hurt (kept "caution" rows and added-back rows). */
export const PAIN_FREE_ONLY_LINE = "Pain-free only · stop if it hurts";

/** The line under the row of an exercise that is back for the first time after an injury was cleared. */
export const FIRST_TIME_BACK_LINE = "First time back · pain-free only";

/** The label of the button that halves a "First time back" row's sets for the day. */
export const HALF_SETS_TODAY_LABEL = "Half sets today";

/** The line shown on a row after "Half sets today", so the halved dose is not mistaken for the program's. */
export const HALVED_FOR_RETURN_LINE = "Sets halved today";

/** The accessible name of a "Half sets today" button; it starts with the visible text (WCAG 2.5.3). */
export function halfSetsTodayButtonName(subject: string): string {
  return `${HALF_SETS_TODAY_LABEL}, ${subject}`;
}

/** "Left out for your shoulder": what a left-out item's compact line says. */
export function leftOutLine(area: InjuryArea): string {
  return `Left out for your ${areaWord(area)}`;
}

/** "Boxing left out for your shoulder": the line of an optional block whose items are all left out. */
export function leftOutBlockLine(blockLabel: string, area: InjuryArea): string {
  return `${blockLabel} left out for your ${areaWord(area)}`;
}

/** The accessible name of an "Add it back" button; it starts with the visible text (WCAG 2.5.3). */
export function addItBackButtonName(subject: string): string {
  return `${ADD_IT_BACK_LABEL}, ${subject}`;
}

/** "Instead of Hanging leg raise": the line on an injury stand-in row, worded like a ticked "No equipment" row. */
export function standInLine(item: Pick<ItemView, "injuryStandInFor">): string | undefined {
  if (item.injuryStandInFor === undefined) return undefined;
  return `Instead of ${item.injuryStandInFor.original.name}`;
}

/** The area an item is left out for, or undefined when it is not left out. */
export function leftOutArea(item: Pick<ItemView, "leftOut">): InjuryArea | undefined {
  return item.leftOut?.area;
}

/**
 * The area that leaves every item of an optional block out, or undefined when
 * any item stays (then the left-out items are single lines inside the block).
 */
export function wholeBlockLeftOutArea(items: readonly Pick<ItemView, "leftOut">[]): InjuryArea | undefined {
  if (items.length === 0) return undefined;
  const areas = items.map(leftOutArea);
  return areas.every((area) => area !== undefined) ? areas[0] : undefined;
}

/** "Shoulder-free session · instead of Day 3 (Upper: push)": the heading of an area-free day, or undefined on a normal session. */
export function areaFreeHeading(session: Extract<SessionView, { kind: "training" }>): string | undefined {
  if (session.areaFreeSession === undefined) return undefined;
  return `${session.areaFreeSession.name} · instead of Day ${session.dayNumber} (${session.areaFreeSession.insteadOf})`;
}
