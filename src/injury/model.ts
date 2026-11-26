import type { InjuryArea } from "../program/model";

/**
 * Internal (in-memory) forms of what the person records about an injury:
 * the injuries themselves (`Injury`, stored under `keys.injuries`) and their
 * per-date choices (`InjuryChoices`, stored under `keys.injuryChoices`). Only
 * `wire.ts` converts between these and the stored JSON; `storage.ts` and
 * `operations.ts` work with these types. Nothing here diagnoses anything: the
 * app records what the person says and when.
 */

/** The sides an injury can be on; "both" also covers a central area. */
export const INJURY_SIDES = ["left", "right", "both"] as const;

/** Which side of the body is injured. */
export type InjurySide = (typeof INJURY_SIDES)[number];

/**
 * One flagged injury. It is active on dates from `from` up to, but not
 * including, `to` (the date the person cleared it); with no `to` it is still
 * flagged. Dates are "YYYY-MM-DD" local calendar dates.
 *
 *   from 22 Nov ─────────────────────▶ to 3 Dec
 *   active:  22 Nov ... 2 Dec          not active: 3 Dec onwards (the day it was cleared)
 */
export interface Injury {
  area: InjuryArea;
  side: InjurySide;
  from: string;
  to?: string;
  note?: string;
}

/**
 * The kinds of choice the person can make for one item on one date.
 * "addBack": train an item the injury leaves out, at half the sets, pain-free
 * only. "halfSets": "Half sets today" on an item's "First time back" row
 * after the injury was cleared (same halving as "addBack").
 */
export type InjuryChoiceKind = "addBack" | "halfSets";

/** Every choice kind, for the wire mapping's check of stored values. */
export const INJURY_CHOICE_KINDS: readonly InjuryChoiceKind[] = ["addBack", "halfSets"];

/**
 * The person's choices per calendar date and per item key (see
 * `noEquipmentItemKey` in `program/noEquipment.ts`: "<blockPosition>:<exerciseId>",
 * day-qualified "2.3:pull_up" for a row of a combined session).
 *
 *   "2026-11-23" ──▶ { "3:pull_up" ──▶ "addBack" }
 */
export type InjuryChoices = Map<string, Map<string, InjuryChoiceKind>>;
