import type { DayNumber } from "../program/model";

/**
 * Internal (in-memory) form of the "optional block" choices (PR 28 design,
 * rule 5): which optional blocks (the boxing finisher) the athlete chose to
 * skip on which date. Only `wire.ts` converts between this and the stored
 * JSON; `storage.ts`, the session logic and the Today screen use these types.
 *
 *   "2026-11-16" ──▶ Set { "1:6" }     (Day 1, block 6 skipped on 16 Nov)
 *
 * Only skips are stored: "Box" (the program as written) is the absence of a
 * record, and a date with no skips has no entry at all.
 */

/** Identifies one block of one program day, `"<day>:<blockPosition>"` (e.g. "1:6"); build it with `optionalBlockKey`. */
export type OptionalBlockKey = string;

/** The skipped block keys of each date ("YYYY-MM-DD"); never holds an empty set. */
export type SkippedBlocksByDate = Map<string, Set<OptionalBlockKey>>;

/**
 * Builds the key for a block: the program day it belongs to and its 1-based
 * position in that day (`BlockView.position`). The day is part of the key so
 * a combined day's two blocks cannot collide. Used by the storage functions,
 * the session logic and the Today screen so they all spell it the same way.
 */
export function optionalBlockKey(day: DayNumber, blockPosition: number): OptionalBlockKey {
  return `${day}:${blockPosition}`;
}
