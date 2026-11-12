import type { BlockItem } from "./model";
import type { ItemView, SessionView } from "./schedule";

/*
 * How a ticked "No equipment" swap reaches the screen:
 *
 *   ticks + log ──▶ noEquipmentChoices ──▶ applyNoEquipmentChoices(buildSession(...)) ──▶ Today / log screen
 *   (noEquipment/   (noEquipment/        (this module, pure)
 *    storage.ts)     choices.ts)
 *
 * `noEquipment/session.ts` (`buildSwappedSession`) chains these steps for
 * Today and the log screen. This module only turns a set of keys into
 * swapped views. `buildSession` itself is unchanged and knows nothing about
 * ticks.
 */

/**
 * Builds the key a tick is stored under: "<blockPosition>:<originalExerciseId>",
 * e.g. "3:single_leg_rdl". `blockPosition` is 1-based, as Today numbers the
 * session's blocks (warm-up included). Used by Today and the log screen to
 * ask whether an item is ticked, and by `applyNoEquipmentChoices` to match.
 *
 * A combined session (two days on one date) has a block 3 in EACH day, so its
 * keys also carry the day the block belongs to: "2.3:single_leg_rdl" is Day
 * 2's block 3. Pass `day` only for rows of a combined session; a normal
 * session's keys stay exactly as they always were.
 */
export function noEquipmentItemKey(blockPosition: number, originalExerciseId: string, day?: number): string {
  const dayPrefix = day === undefined ? "" : `${day}.`;
  return `${dayPrefix}${blockPosition}:${originalExerciseId}`;
}

/**
 * True when the item has a "No equipment" swap to offer, or is one already
 * (a ticked, swapped view). Today uses it to decide whether to show the tick.
 */
export function hasNoEquipmentSwap(item: ItemView): boolean {
  return item.noEquipment !== undefined || item.swappedFrom !== undefined;
}

/**
 * The id of the program's original exercise for an item, whether or not it
 * is currently swapped. This is the id used inside tick keys, so callers can
 * build the key the same way for swapped and unswapped rows.
 */
export function originalExerciseIdOf(item: ItemView): string {
  return item.swappedFrom?.id ?? item.exercise.id;
}

/**
 * Replaces every item whose tick key is in `swappedKeys` (and that has a
 * swap view) with that swap view, recording the original exercise in
 * `swappedFrom`. Keys for items without a swap, or with the wrong block
 * position, are ignored; non-training sessions are returned as they are.
 * Pure: the input session is not mutated. Called on the result of
 * `buildSession` before Today and the log screen render. With
 * `qualifyKeysWithDay` the keys are the day-qualified form (one day of a
 * combined session; see `noEquipmentItemKey`).
 */
export function applyNoEquipmentChoices(session: SessionView, swappedKeys: ReadonlySet<string>, qualifyKeysWithDay = false): SessionView {
  if (session.kind !== "training" || swappedKeys.size === 0) return session;

  const blocks = session.blocks.map((block, blockIndex) => {
    const blockPosition = blockIndex + 1;
    const items = block.items.map((item) => {
      const swapView = item.noEquipment;
      if (swapView === undefined) return item;
      const keyDay = qualifyKeysWithDay ? session.dayNumber : undefined;
      if (!swappedKeys.has(noEquipmentItemKey(blockPosition, item.exercise.id, keyDay))) return item;
      return { ...swapView, swappedFrom: item.exercise };
    });
    return { ...block, items };
  });

  return { ...session, blocks };
}

/**
 * True when a set logged under `loggedExerciseId` belongs to this program
 * item: the item's own exercise, or the id of its "No equipment" swap (swapped
 * sets are logged under the swap's id, in the item's normal block position).
 * Shared by the "last time", Progress and History lookups, which find a
 * logged set's program item. Note it says nothing about whether the item was
 * swapped that day; callers that care use `noEquipmentChoices` (via `buildSwappedSession`).
 */
export function isExerciseLoggedForItem(item: Pick<BlockItem, "exerciseId" | "noEquipment">, loggedExerciseId: string): boolean {
  return item.exerciseId === loggedExerciseId || item.noEquipment?.exercise.id === loggedExerciseId;
}
