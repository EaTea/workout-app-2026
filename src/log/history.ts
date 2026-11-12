import type { DayNumber } from "../program/model";
import type { LoggedSession, LoggedSet } from "./model";
import { setDay } from "./setDay";

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
  /** Program day (1-7) the block belongs to (`setDay`); undefined for an old set in a session with no stored day. */
  day: DayNumber | undefined;

  /** 1-based block position, as Today numbers blocks. */
  blockPosition: number;

  /** Exercise library id. */
  exerciseId: string;

  /** The sets, ordered by set number. Never empty. */
  sets: LoggedSet[];
}

/**
 * Groups `session.sets` by (day, block position, exercise), the day being each
 * set's effective day (`setDay`). Groups are ordered by day, then block
 * position (so a combined session lists one day's blocks, then the other's;
 * a normal session has one day, so this is just block order); two exercises in the same block (a superset) keep the order
 * in which their first set was logged. The same exercise in two different
 * blocks gives two groups, because "set 2" only means something within one block.
 * The same block position on two different days also gives two groups.
 */
export function groupSetsByExercise(session: LoggedSession): ExerciseGroup[] {
  const groupsInFirstLoggedOrder: ExerciseGroup[] = [];

  for (const set of session.sets) {
    const day = setDay(session, set);
    const existingGroup = groupsInFirstLoggedOrder.find(
      (group) => group.day === day && group.blockPosition === set.blockPosition && group.exerciseId === set.exerciseId,
    );

    if (existingGroup === undefined) {
      groupsInFirstLoggedOrder.push({ day, blockPosition: set.blockPosition, exerciseId: set.exerciseId, sets: [set] });
    } else {
      existingGroup.sets.push(set);
    }
  }

  for (const group of groupsInFirstLoggedOrder) {
    group.sets.sort((first, second) => first.setNumber - second.setNumber);
  }

  // Array.prototype.sort is stable, so equal (day, block position) keep their first-logged order.
  // A group with no day at all (an old set in a session with none) sorts first, as day 0.
  return groupsInFirstLoggedOrder.sort((first, second) => (first.day ?? 0) - (second.day ?? 0) || first.blockPosition - second.blockPosition);
}
