import type { LoggedSession, LoggedSet } from "./model";

/**
 * Pure grouping for the History screen: turns a session's flat list of sets
 * into one group per exercise, in the order the exercises appear in the
 * session's blocks.
 *
 *   session.sets  [pull_up#1, slam#1, pull_up#2, slam#2]   (logged order)
 *        │ groupSetsByExercise
 *        ▼
 *   [ {block 2, slam,    sets #1 #2},
 *     {block 3, pull_up, sets #1 #2} ]                     (block order)
 *
 * Used by `ui/history.ts`; has no DOM or program dependency.
 */

/** All logged sets of one exercise within one block of a session. */
export interface ExerciseGroup {
  /** 1-based block position, as Today numbers blocks. */
  blockPosition: number;

  /** Exercise library id. */
  exerciseId: string;

  /** The sets, ordered by set number. Never empty. */
  sets: LoggedSet[];
}

/**
 * Groups `session.sets` by (block position, exercise). Groups are ordered by
 * block position; two exercises in the same block (a superset) keep the order
 * in which their first set was logged. The same exercise in two different
 * blocks gives two groups, because "set 2" only means something within one block.
 */
export function groupSetsByExercise(session: LoggedSession): ExerciseGroup[] {
  const groupsInFirstLoggedOrder: ExerciseGroup[] = [];

  for (const set of session.sets) {
    const existingGroup = groupsInFirstLoggedOrder.find(
      (group) => group.blockPosition === set.blockPosition && group.exerciseId === set.exerciseId,
    );

    if (existingGroup === undefined) {
      groupsInFirstLoggedOrder.push({ blockPosition: set.blockPosition, exerciseId: set.exerciseId, sets: [set] });
    } else {
      existingGroup.sets.push(set);
    }
  }

  for (const group of groupsInFirstLoggedOrder) {
    group.sets.sort((first, second) => first.setNumber - second.setNumber);
  }

  // Array.prototype.sort is stable, so equal block positions keep their first-logged order.
  return groupsInFirstLoggedOrder.sort((first, second) => first.blockPosition - second.blockPosition);
}
