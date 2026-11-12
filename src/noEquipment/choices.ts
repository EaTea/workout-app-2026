import type { WorkoutLog } from "../log/model";
import { setsForItem } from "../log/operations";
import { noEquipmentItemKey } from "../program/noEquipment";
import type { SessionView } from "../program/schedule";

/**
 * Works out which items of a session are swapped to their "No equipment"
 * version on one date, from the log and the ticks. The log decides first: once
 * a set is logged the choice is locked, so a later tick or untick cannot make
 * the logged sets belong to a different exercise.
 *
 *   for each item that has a swap (key = "<blockPosition>:<originalId>")
 *
 *     sets logged today under the swap's id? ──yes──▶ swapped, locked
 *                    │ no
 *     sets logged today under the original id? ─yes─▶ not swapped, locked
 *                    │ no                              (whatever the tick says)
 *     key ticked? ──yes──▶ swapped, not locked
 *                    │ no
 *                    └────▶ not swapped, not locked
 *
 * Both sets present (not expected; e.g. an import): the swap wins, since its
 * sets are the more specific evidence of a choice.
 */
export interface NoEquipmentChoices {
  /** Keys of items to train as their swap: pass to `applyNoEquipmentChoices`. */
  swapped: Set<string>;

  /**
   * Keys of items whose choice is fixed by logged sets (swapped or not).
   * The Today tick is disabled for these and the row's "Instead of ..." line adds "sets logged" when swapped.
   */
  locked: Set<string>;
}

/**
 * Decides swapped and locked items for `date`. `session` must be the
 * UNSWAPPED `buildSession` result (its items carry `noEquipment` and the
 * original `exercise`), `ticks` is `ticksForDate(...)` for the same date.
 * Returns empty sets for non-training sessions. Pure; a single call feeds both
 * `applyNoEquipmentChoices` (from `swapped`) and the tick's disabled state
 * (from `locked`) on Today and the log screen.
 *
 * Logged sets are looked up with the session's own day, so on a combined date
 * (two days' sets on one date, each carrying its `day`) Day 1's block 3 never
 * sees Day 2's block 3 sets. With `qualifyKeysWithDay` the keys also carry the
 * day ("2.3:single_leg_rdl"): used for each half of a combined session.
 */
export function noEquipmentChoices(
  session: SessionView,
  log: WorkoutLog,
  date: string,
  ticks: ReadonlySet<string>,
  qualifyKeysWithDay = false,
): NoEquipmentChoices {
  const choices: NoEquipmentChoices = { swapped: new Set(), locked: new Set() };
  if (session.kind !== "training") return choices;

  session.blocks.forEach((block, blockIndex) => {
    const blockPosition = blockIndex + 1;

    for (const item of block.items) {
      if (item.noEquipment === undefined) continue;

      const key = noEquipmentItemKey(blockPosition, item.exercise.id, qualifyKeysWithDay ? session.dayNumber : undefined);
      const hasSwapSets = setsForItem(log, date, blockPosition, item.noEquipment.exercise.id, session.dayNumber).length > 0;
      const hasOriginalSets = setsForItem(log, date, blockPosition, item.exercise.id, session.dayNumber).length > 0;

      if (hasSwapSets) {
        choices.swapped.add(key);
        choices.locked.add(key);
      } else if (hasOriginalSets) {
        choices.locked.add(key);
      } else if (ticks.has(key)) {
        choices.swapped.add(key);
      }
    }
  });

  return choices;
}
