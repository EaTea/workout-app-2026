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
 * warm-up items; Today uses `rotationBlockStartWeek` to decide when to show the
 * "Warm-up rotation" card; app.ts stores the dismissal (see the mapping in
 * ui/rotationCard.ts).
 */

/**
 * True when `week` (1-based) falls in a swapped block of weeks:
 * floor((week - 1) / everyWeeks) is odd. Called by `applyRotationToBlocks`
 * and `rotationBlockStartWeek`.
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
 * The first week of the swapped block that `session` belongs to (5 for weeks
 * 5-8 with everyWeeks 4), or undefined when `session` is not a training day
 * of a swapped block (rest days, unrotated weeks, not started, complete).
 * Today shows the "Warm-up rotation" card on every such day until the block's
 * start week is dismissed; the dismissal is keyed by this number. Called by
 * `renderTodayScreen` and app.ts `handleDismissRotation`.
 */
export function rotationBlockStartWeek(program: Program, session: SessionView): number | undefined {
  if (session.kind !== "training") return undefined;

  // No rotation in the program: no swapped block, so no card.
  if (program.warmupRotation === undefined) return undefined;

  const everyWeeks = program.warmupRotation.everyWeeks;
  if (!isRotatedWeek(session.week, everyWeeks)) return undefined;

  // Weeks are 1-based, so a block starting at week 5 covers weeks 5..8.
  return session.week - ((session.week - 1) % everyWeeks);
}

/**
 * Returns `blocks` with each warm-up item whose exercise is a swap's `out`
 * marked `rotatedIn` (the new display name and the original's name) when
 * `week` is a swapped week; otherwise the blocks unchanged. Only the display
 * changes: `item.exercise` stays the original so logging keeps its id.
 * `rotation` is undefined for a program with no warm-up rotation, which
 * leaves the blocks unchanged. Called by `buildSession`.
 */
export function applyRotationToBlocks(blocks: BlockView[], week: number, rotation: WarmupRotation | undefined): BlockView[] {
  if (rotation === undefined || !isRotatedWeek(week, rotation.everyWeeks)) return blocks;

  return blocks.map((block) => {
    if (block.type !== "warmup") return block;

    return {
      ...block,
      items: block.items.map((item) => {
        const displayName = rotatedName(item.exercise.id, rotation);
        if (displayName === undefined) return item;

        // A rotated-in warm-up is a different exercise, so the original's
        // "No equipment" swap no longer applies to it: no swap view, no tick.
        return { ...item, rotatedIn: { displayName, originalName: item.exercise.name }, noEquipment: undefined };
      }),
    };
  });
}

/** Display name of an item: the rotated-in name when there is one, else the exercise's own. Used by Today, the log screen, the timer labels, History and the CSV export (the latter two pass the exercise as recorded and the rotated name for the set's week). */
export function itemDisplayName(item: { exercise: { name: string }; rotatedIn?: { displayName: string } }): string {
  return item.rotatedIn?.displayName ?? item.exercise.name;
}

/**
 * The name a logged set was performed as: the rotated-in name when the set was
 * a warm-up logged in a swapped week, else the exercise's own library name
 * (or the raw id when the library no longer has it). `week` and `blockType`
 * are what the session stored / the program's block says; undefined for either
 * means no rotation can be assumed. Mirrors `applyRotationToBlocks`, which
 * only swaps warm-up items. Called by History and the CSV export.
 */
export function performedAsName(
  program: Program,
  exerciseId: string,
  week: number | undefined,
  blockType: string | undefined,
): string {
  const ownName = program.exercises[exerciseId]?.name ?? exerciseId;
  if (week === undefined || blockType !== "warmup") return ownName;
  if (program.warmupRotation === undefined) return ownName;
  if (!isRotatedWeek(week, program.warmupRotation.everyWeeks)) return ownName;

  return rotatedName(exerciseId, program.warmupRotation) ?? ownName;
}
