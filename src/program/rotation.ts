import type { Program, WarmupRotation } from "./model";
import type { BlockView, SessionView } from "./schedule";

/**
 * Pure rules for the warm-up rotation (program.json `warmupRotation`).
 * The warm-ups alternate every `everyWeeks` weeks: weeks 1-4 as written,
 * weeks 5-8 with the swaps (for the shipped program).
 *
 *   week    1 2 3 4 | 5 6 7 8
 *   block   as written | swapped
 *
 * `buildSession` (schedule.ts) uses `applyRotationToBlocks` to label swapped
 * warm-up items; Today uses `isFirstRotationDay` to decide when to show the
 * "Warm-up rotation" card; app.ts stores the dismissal (rotationDismissed.ts).
 */

/**
 * True when `week` (1-based) falls in a swapped block of weeks:
 * floor((week - 1) / everyWeeks) is odd. Called by `applyRotationToBlocks`
 * and `isFirstRotationDay`.
 */
export function isRotatedWeek(week: number, everyWeeks: number): boolean {
  return Math.floor((week - 1) / everyWeeks) % 2 === 1;
}

/**
 * The name swapped in for `exerciseId` (the swap's `in`), or undefined when
 * the rotation does not replace that exercise. Called by
 * `applyRotationToBlocks`.
 */
export function rotatedName(exerciseId: string, rotation: WarmupRotation): string | undefined {
  return rotation.swaps.find((swap) => swap.out === exerciseId)?.in;
}

/**
 * True when `session` is the first training day of the first week of a
 * swapped block (week 5, first training day, for everyWeeks 4): the day the
 * "Warm-up rotation" card is shown. Called by `renderTodayScreen`.
 */
export function isFirstRotationDay(program: Program, session: SessionView): boolean {
  if (session.kind !== "training") return false;

  const everyWeeks = program.warmupRotation.everyWeeks;
  const isFirstWeekOfBlock = (session.week - 1) % everyWeeks === 0;
  if (!isFirstWeekOfBlock || !isRotatedWeek(session.week, everyWeeks)) return false;

  const trainingDayNumbers = Object.keys(program.days).map(Number);
  return session.dayNumber === Math.min(...trainingDayNumbers);
}

/**
 * Returns `blocks` with each warm-up item whose exercise is a swap's `out`
 * marked `rotatedIn` (the new display name and the original's name) when
 * `week` is a swapped week; otherwise the blocks unchanged. Only the display
 * changes: `item.exercise` stays the original so logging keeps its id.
 * Called by `buildSession`.
 */
export function applyRotationToBlocks(blocks: BlockView[], week: number, rotation: WarmupRotation): BlockView[] {
  if (!isRotatedWeek(week, rotation.everyWeeks)) return blocks;

  return blocks.map((block) => {
    if (block.type !== "warmup") return block;

    return {
      ...block,
      items: block.items.map((item) => {
        const displayName = rotatedName(item.exercise.id, rotation);
        if (displayName === undefined) return item;

        return { ...item, rotatedIn: { displayName, originalName: item.exercise.name } };
      }),
    };
  });
}

/** Display name of an item: the rotated-in name when there is one, else the exercise's own. Used by Today and the log screen. */
export function itemDisplayName(item: { exercise: { name: string }; rotatedIn?: { displayName: string } }): string {
  return item.rotatedIn?.displayName ?? item.exercise.name;
}
