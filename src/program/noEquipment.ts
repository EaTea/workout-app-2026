import { INJURY_AREAS, type Block, type BlockItem, type Program } from "./model";
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
 * `swappedFrom` (its `loads` level) and keeping the original's `injury` views
 * and its "First time back" mark (without the "Half sets today" offer). Keys for items without a swap, or with the wrong block
 * position, are ignored; non-training sessions are returned as they are.
 * Pure: the input session is not mutated. Called on the result of
 * `buildSession` before Today and the log screen render. With
 * `qualifyKeysWithDay` the keys are the day-qualified form (one day of a
 * combined session; see `noEquipmentItemKey`).
 */
export function applyNoEquipmentChoices(session: SessionView, swappedKeys: ReadonlySet<string>, qualifyKeysWithDay = false): SessionView {
  if (session.kind !== "training" || swappedKeys.size === 0) return session;

  const blocks = session.blocks.map((block) => {
    // The block's place in the program day (a block left out this week doesn't shift it), as ticks are keyed.
    const blockPosition = block.position;
    const items = block.items.map((item) => {
      const swapView = item.noEquipment;
      if (swapView === undefined) return item;
      const keyDay = qualifyKeysWithDay ? session.dayNumber : undefined;
      if (!swappedKeys.has(noEquipmentItemKey(blockPosition, item.exercise.id, keyDay))) return item;
      // Carry the original's injury stand-ins: an injury wins over the tick, so the
      // exercise sheet words "Your shoulder" from the original (see injurySheetText.ts).
      // A "First time back" row stays one when swapped (the swap is pain-free-only too), but never offers "Half sets today" (that is for the original's dose).
      const firstTimeBack = item.firstTimeBack === undefined ? undefined : { ...item.firstTimeBack, halfSetsOffered: false };
      return { ...swapView, swappedFrom: item.exercise, injury: item.injury, firstTimeBack };
    });
    return { ...block, items };
  });

  return { ...session, blocks };
}

/**
 * True when a set logged under `loggedExerciseId` belongs to this program
 * item: the item's own exercise, the id of its "No equipment" swap (swapped
 * sets are logged under the swap's id, in the item's normal block position),
 * or the id of one of its injury stand-ins (a stand-in's sets are logged
 * under its own id in the item's block position too).
 * Shared by the "last time", Progress and History lookups, which find a
 * logged set's program item. Note it says nothing about whether the item was
 * swapped or stood in for that day; callers that care use `noEquipmentChoices` (via `buildSwappedSession`).
 */
export function isExerciseLoggedForItem(item: Pick<BlockItem, "exerciseId" | "noEquipment" | "injury">, loggedExerciseId: string): boolean {
  if (item.exerciseId === loggedExerciseId || item.noEquipment?.exercise.id === loggedExerciseId) return true;

  return INJURY_AREAS.some((area) => item.injury?.[area]?.exercise.id === loggedExerciseId);
}

/**
 * Finds the program block and item a logged set belongs to, from the set's
 * day, block position and exercise id: first the day's own block at that
 * position (the item itself, its no-equipment swap or an injury stand-in),
 * then, for sets logged in an area-free session (the shoulder-free session
 * replaces a whole day, with its own block positions), the area sessions'
 * blocks at that position. Undefined when nothing matches.
 *
 * Used by the "last time", Progress and History lookups so an area-free
 * session's sets find the block type and item they were done as. The day's
 * own block always wins, so a set that fits both keeps its normal meaning.
 */
export function findLoggedBlockAndItem(program: Program, day: number, blockPosition: number, loggedExerciseId: string): { block: Block; item: BlockItem } | undefined {
  const dayBlock = program.days[day]?.blocks[blockPosition - 1];
  const dayItem = dayBlock?.items.find((item) => isExerciseLoggedForItem(item, loggedExerciseId));
  if (dayBlock !== undefined && dayItem !== undefined) return { block: dayBlock, item: dayItem };

  for (const area of INJURY_AREAS) {
    const areaBlock = program.injurySessions?.[area]?.blocks[blockPosition - 1];
    const areaItem = areaBlock?.items.find((item) => item.exerciseId === loggedExerciseId);
    if (areaBlock !== undefined && areaItem !== undefined) return { block: areaBlock, item: areaItem };
  }

  return undefined;
}
