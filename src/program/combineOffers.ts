import type { Combine, CombinesByDate } from "../combine/model";
import type { WorkoutLog } from "../log/model";
import { addDaysToDate, programStatus } from "./calendar";
import type { DayNumber, Program } from "./model";

/**
 * Which "Add Day N" buttons Today offers (rule 2 of the PR 23 design) and
 * which dates are donor dates (rule 6). Pure: the caller passes in everything
 * (program, start date, the date being shown, the log and the stored
 * combines), so there is no clock or storage in here.
 *
 *   program.combinePairs ─┐
 *   start date, today ────┤
 *   log (what is logged) ─┼─▶ combineOffersFor ─▶ ["Add Day D+1", "Add missed Day D-1"]
 *   combines store ───────┘
 *   combines store, date ───────▶ donorOnDate ─▶ "Day N done with Day M on <date>"
 *
 * `CombineOffer.combine` is the record Today stores when the button is
 * tapped (`addCombine` in `combine/storage.ts`).
 */

/**
 * One button Today may show.
 *  - "addNext": "Add Day D+1 to today" (pulled forward from tomorrow)
 *  - "addMissed": "Add missed Day D-1 to today" (caught up from yesterday)
 */
export interface CombineOffer {
  kind: "addNext" | "addMissed";

  /** The day that would be added. */
  day: DayNumber;

  /** The date that day would normally be trained on. */
  date: string;

  /** The record to store under today's date if the person taps the button. */
  combine: Combine;
}

/** A date that shows "Day N done with Day M on <date>" instead of a session. */
export interface DonorInfo {
  /** The day whose session was folded into another date (the day the donor date would have trained). */
  day: DayNumber;

  /** The day it was folded into. */
  hostDay: DayNumber;

  /** The date it was folded into. */
  hostDate: string;
}

/**
 * The buttons to offer on `today`, in the order Today lists them ("Add Day
 * D+1" before "Add missed Day D-1"). Empty when none apply. An offer needs:
 *  - today is a training day D inside the program (not the rest day, not
 *    before the start date, not after the last week) with nothing logged
 *    today, and today is not already part of a combine (host or donor);
 *  - the other day's pair is allowed in `program.combinePairs`:
 *    [D, D+1] for "addNext", [D-1, D] for "addMissed";
 *  - the other day is in the same week (always true for adjacent days
 *    inside one week), its date has nothing logged on it, and its date is
 *    not part of a combine. "addMissed" therefore only ever looks at a date
 *    in the past, and "addNext" at the next date.
 * `startDate` is the settings' start date (null when not set: no offers).
 */
export function combineOffersFor(
  program: Program,
  startDate: string | null,
  today: string,
  log: WorkoutLog,
  combines: CombinesByDate,
): CombineOffer[] {
  const status = programStatus(startDate, program.lengthWeeks, today);
  if (status.kind !== "active") return [];

  const todayDay = status.dayNumber;
  const todayIsFree = program.days[todayDay] !== undefined && !hasLoggedSets(log, today) && !isPartOfCombine(combines, today);
  if (!todayIsFree) return [];

  const offers: CombineOffer[] = [];

  const nextDay = todayDay + 1;
  if (isAllowedPair(program, todayDay, nextDay)) {
    const nextDate = addDaysToDate(today, 1);
    if (canBeAdded(log, combines, nextDate)) {
      offers.push({ kind: "addNext", day: nextDay, date: nextDate, combine: { hostDay: todayDay, addedDay: nextDay, addedDate: nextDate } });
    }
  }

  const previousDay = todayDay - 1;
  if (isAllowedPair(program, previousDay, todayDay)) {
    const previousDate = addDaysToDate(today, -1);
    if (canBeAdded(log, combines, previousDate)) {
      offers.push({ kind: "addMissed", day: previousDay, date: previousDate, combine: { hostDay: todayDay, addedDay: previousDay, addedDate: previousDate } });
    }
  }

  return offers;
}

/**
 * Whether `date` is a donor date (rule 6): the date of a day that was folded
 * into another date's session. Returns who it was folded into, or undefined.
 * Today shows "Day N done with Day M on <date>" and no session for it. A
 * host date is not a donor date (it keeps its own session).
 */
export function donorOnDate(combines: CombinesByDate, date: string): DonorInfo | undefined {
  for (const [hostDate, combine] of combines) {
    if (combine.addedDate === date) {
      return { day: combine.addedDay, hostDay: combine.hostDay, hostDate };
    }
  }
  return undefined;
}

/**
 * The combine on `date` if it still makes sense for the program as it is now,
 * else undefined. A stored combine can go stale (the start date moved, or
 * program.json's pairs changed); Today then treats the date as a normal day
 * instead of failing. It is valid when `date` is a training day of the
 * program whose day is the combine's `hostDay`, the two days are an allowed
 * pair, and `addedDate` is where the added day falls in the same week.
 * Used by Today, the log screen and the wake lock to decide whether to build
 * a combined session.
 */
export function activeCombineOn(program: Program, startDate: string | null, date: string, combines: CombinesByDate): Combine | undefined {
  const combine = combines.get(date);
  if (combine === undefined) return undefined;

  const status = programStatus(startDate, program.lengthWeeks, date);
  if (status.kind !== "active" || status.dayNumber !== combine.hostDay) return undefined;

  const earlierDay = Math.min(combine.hostDay, combine.addedDay);
  const laterDay = Math.max(combine.hostDay, combine.addedDay);
  if (!isAllowedPair(program, earlierDay, laterDay)) return undefined;
  if (program.days[combine.hostDay] === undefined || program.days[combine.addedDay] === undefined) return undefined;
  if (combine.addedDate !== addDaysToDate(date, combine.addedDay - combine.hostDay)) return undefined;

  return combine;
}

/**
 * `donorOnDate`, but only when the donor date and its host combine are still
 * consistent with the program as it is now (see `activeCombineOn`): the date
 * must be the added day's date and the host's combine must be active. Today
 * shows the "done with" card only for this.
 */
export function activeDonorOn(program: Program, startDate: string | null, date: string, combines: CombinesByDate): DonorInfo | undefined {
  const donor = donorOnDate(combines, date);
  if (donor === undefined) return undefined;

  const status = programStatus(startDate, program.lengthWeeks, date);
  if (status.kind !== "active" || status.dayNumber !== donor.day) return undefined;
  if (activeCombineOn(program, startDate, donor.hostDate, combines) === undefined) return undefined;

  return donor;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** True when [earlierDay, laterDay] is one of the program's allowed pairs. */
function isAllowedPair(program: Program, earlierDay: DayNumber, laterDay: DayNumber): boolean {
  return program.combinePairs.some(([allowedEarlier, allowedLater]) => allowedEarlier === earlierDay && allowedLater === laterDay);
}

/** True when `date` is a host date or a donor date of any combine. */
function isPartOfCombine(combines: CombinesByDate, date: string): boolean {
  return combines.has(date) || donorOnDate(combines, date) !== undefined;
}

/** True when at least one set is logged on `date`. */
function hasLoggedSets(log: WorkoutLog, date: string): boolean {
  return (log.sessions[date]?.sets.length ?? 0) > 0;
}

/** True when the other day's date is free to be added: nothing logged on it and not already combined. */
function canBeAdded(log: WorkoutLog, combines: CombinesByDate, otherDate: string): boolean {
  return !hasLoggedSets(log, otherDate) && !isPartOfCombine(combines, otherDate);
}
