import type { BlockView, ItemView, RepTarget } from "../program/schedule";
import type { LoggedSet } from "./model";

/**
 * Pure helpers that answer "what is there to log for this item?". They sit
 * between the schedule (`ItemView`/`BlockView`, final numbers for a date) and
 * the log screen / Today rows, which only draw what these return.
 *
 *   ItemView + BlockView ──▶ countSetsForItem      how many ticks the item has
 *                        ──▶ itemTracksReps        do sets carry reps/kg at all?
 *                        ──▶ plannedRepsForSet     the plan's number for set n
 *   logged sets so far   ──▶ choosePrefill         what the stepper starts at
 *                        ──▶ nextSetNumber         where "Skip"/"Log set" go next
 *                        ──▶ formatProgress        "2/6" on Today
 */

/**
 * The value a reps/kg stepper starts at for one set. `reps` is undefined when
 * nothing is known (a max-based target without a saved max, or free-text reps
 * such as "easy, ~50% effort"). `loadKg` is 0 for "no load" (bodyweight):
 * the log screen stores 0 as "no load recorded", never as a literal 0 kg.
 */
export interface SetPrefill {
  reps?: number;
  loadKg: number;
}

/** The fields of a logged set that pre-filling reads: only reps and load matter. */
export type PreviousSet = Pick<LoggedSet, "reps" | "loadKg">;

/**
 * How many sets (ticks) an item has on the log screen:
 *  - straight sets: the number of sets, already halved in a deload
 *  - EMOM: its minutes (halved in a deload), one tick per minute
 *  - interval (heavy bag): the high end of the rounds range (a deload has
 *    already collapsed it to the halved low end)
 *  - anything else (warm-up reps inside a superset): the block's rounds, high
 *    end, else 1
 * Used by the log screen and by Today's "2/6" progress.
 */
export function countSetsForItem(item: ItemView, block: BlockView): number {
  if (item.sets.length > 0) return item.sets.length;
  if (item.format === "emom" && item.minutes !== undefined) return item.minutes;
  if (item.format === "interval" && item.rounds) return item.rounds.max;
  return block.rounds?.max ?? 1;
}

/**
 * False for items whose sets are just ticked: heavy-bag rounds and timed
 * holds (side plank, hollow hold: `durationSec`). True for everything with
 * reps, where the log screen shows reps and kg steppers.
 */
export function itemTracksReps(item: ItemView): boolean {
  return item.format !== "interval" && item.durationSec === undefined;
}

/**
 * The rep target for set number `setNumber` (1-based): the set's own target
 * when sets are prescribed one by one, else the item-level target (EMOM,
 * warm-ups). Undefined when the item has none.
 */
function targetForSet(item: ItemView, setNumber: number): RepTarget | undefined {
  return item.sets[setNumber - 1]?.target ?? item.target;
}

/**
 * The plan's rep number for a set, used as the pre-fill when nothing was
 * logged before: a fixed count as is, a range at its low end (also what a
 * percent-of-max range gives). Free text and "needs a max" have no number, so
 * the result is undefined and the athlete types the reps.
 */
export function plannedRepsForSet(item: ItemView, setNumber: number): number | undefined {
  const target = targetForSet(item, setNumber);

  switch (target?.kind) {
    case "fixed":
      return target.count;
    case "range":
      return target.min;
    default:
      return undefined;
  }
}

/**
 * True when the set's reps are required before it can be logged: the plan
 * cannot give a number because the athlete's max is missing. (Free-text
 * targets like "8 each direction" may be logged without reps.)
 */
export function setNeedsMax(item: ItemView, setNumber: number): boolean {
  return targetForSet(item, setNumber)?.kind === "needsMax";
}

/**
 * Chooses what the steppers start at (rule 8): the previous set of this item
 * this session if there is one, else the plan's target.
 *
 * Seam for step 4: "last time" (the same exercise on an earlier date) slots in
 * between the two, as another optional `lastTimeSet` argument. It is not
 * looked up yet.
 */
export function choosePrefill(previousSetThisSession: PreviousSet | undefined, plannedReps: number | undefined): SetPrefill {
  if (previousSetThisSession !== undefined) {
    return { reps: previousSetThisSession.reps, loadKg: previousSetThisSession.loadKg ?? 0 };
  }

  // Seam for step 4 ("last time" pre-fill): consult the last-time set here.
  return { reps: plannedReps, loadKg: 0 };
}

/**
 * Which set the log screen should move to after `fromSetNumber` is logged or
 * skipped: the first unlogged set after it, else the first unlogged set
 * before it (a skipped one), else undefined when nothing is left.
 * `loggedSetNumbers` are the 1-based numbers already logged.
 */
export function nextSetNumber(fromSetNumber: number, totalSets: number, loggedSetNumbers: number[]): number | undefined {
  const isOpen = (setNumber: number) => setNumber !== fromSetNumber && !loggedSetNumbers.includes(setNumber);

  for (let setNumber = fromSetNumber + 1; setNumber <= totalSets; setNumber++) {
    if (isOpen(setNumber)) return setNumber;
  }
  for (let setNumber = 1; setNumber < fromSetNumber; setNumber++) {
    if (isOpen(setNumber)) return setNumber;
  }
  return undefined;
}

/**
 * Today's progress text for an item: "2/6", "✓ 6/6" when complete, or
 * undefined when nothing is logged (the row shows no progress then). Logged
 * counts above the total (a deload-shortened item re-opened) read as complete.
 */
export function formatProgress(loggedCount: number, totalSets: number): string | undefined {
  if (loggedCount === 0) return undefined;
  return loggedCount >= totalSets ? `✓ ${loggedCount}/${totalSets}` : `${loggedCount}/${totalSets}`;
}

/**
 * The word for one tick of an item: "Set" for straight sets, "Min" for EMOM
 * minutes, "Round" for heavy-bag rounds and warm-up rounds.
 */
export function setWord(item: ItemView): string {
  if (item.sets.length > 0) return "Set";
  return item.format === "emom" ? "Min" : "Round";
}

/**
 * Text for a logged set in the list: "6 reps · 6 kg", "6 reps" for
 * bodyweight, "Done" for ticked-only sets (bag rounds, holds).
 */
export function formatLoggedSet(set: Pick<LoggedSet, "reps" | "loadKg">): string {
  const parts: string[] = [];
  if (set.reps !== undefined) parts.push(set.reps === 1 ? "1 rep" : `${set.reps} reps`);
  if (set.loadKg !== undefined) parts.push(`${set.loadKg} kg`);
  return parts.length > 0 ? parts.join(" · ") : "Done";
}
