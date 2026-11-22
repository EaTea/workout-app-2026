import { INJURY_AREAS, type InjuryArea } from "../program/model";
import type { Injury } from "./model";

/**
 * Pure helpers over the list of injuries: which are active on a date, flagging
 * a new one and clearing one. No storage, no clock. `storage.ts` wraps the
 * changing helpers in read-modify-write saves; Today, the log screen and
 * `buildInjurySession` ask `activeAreasOn` which areas to train around.
 *
 * "Open" means flagged with no clearing date yet. At most one injury per area
 * is open at a time (an area can have many past, cleared injuries).
 */

/** Result of `flagInjury`: the new list, or a readable reason nothing changed. */
export type FlagInjuryResult = { ok: true; injuries: Injury[] } | { ok: false; error: string };

/**
 * The injuries active on `date`: flagged on or before it, and not yet cleared
 * (`to` is the clearing date, so the flag no longer applies on that day or
 * after). Called with the date being shown, so a past date in a `?date=`
 * preview sees the flags that were active then.
 */
export function activeInjuriesOn(injuries: readonly Injury[], date: string): Injury[] {
  // YYYY-MM-DD strings sort chronologically, so plain comparison is date comparison.
  return injuries.filter((injury) => injury.from <= date && (injury.to === undefined || date < injury.to));
}

/**
 * The distinct areas flagged on `date`, in `INJURY_AREAS` order (so "the
 * first area" is the same every time). What `applyInjuries` takes.
 */
export function activeAreasOn(injuries: readonly Injury[], date: string): InjuryArea[] {
  const active = activeInjuriesOn(injuries, date);
  return INJURY_AREAS.filter((area) => active.some((injury) => injury.area === area));
}

/** The still-flagged (no clearing date) injury for `area`, if any. Used by the Settings screen to show "Clear" instead of "Add". */
export function openInjuryFor(injuries: readonly Injury[], area: InjuryArea): Injury | undefined {
  return injuries.find((injury) => injury.area === area && injury.to === undefined);
}

/**
 * Adds `injury` (which should have no `to`) to the list. Refuses when that
 * area already has an open injury, so an area is never flagged twice at once.
 * Pure: the input list is not changed.
 */
export function flagInjury(injuries: readonly Injury[], injury: Injury): FlagInjuryResult {
  if (openInjuryFor(injuries, injury.area) !== undefined) {
    return { ok: false, error: `Your ${injury.area} is already flagged.` };
  }

  return { ok: true, injuries: [...injuries, injury] };
}

/**
 * Clears the open injury for `area` as of `date`: sets its `to`, so the flag
 * is active on earlier dates only. Does nothing when the area has no open
 * injury. `date` is never set before the injury's start (a flag cleared the
 * day it was set is simply never active). Pure: the input list is not changed.
 */
export function clearInjury(injuries: readonly Injury[], area: InjuryArea, date: string): Injury[] {
  return injuries.map((injury) => {
    if (injury.area !== area || injury.to !== undefined) return injury;
    return { ...injury, to: date < injury.from ? injury.from : date };
  });
}
