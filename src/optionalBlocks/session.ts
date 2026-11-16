import type { WorkoutLog } from "../log/model";
import { setsForItem } from "../log/operations";
import type { CombinedBlock, CombinedSession } from "../program/combine";
import type { BlockView, SessionView } from "../program/schedule";
import { buildIntervalPlan, defaultIntervalSettings } from "../timer/plans";
import { optionalBlockKey, type OptionalBlockKey } from "./model";

/**
 * Applying the athlete's "skip this optional block" choices to a built
 * session (PLAN.md PR 28 rule 3). Pure: no storage, no clock, no UI.
 *
 *   buildSession ─▶ (No equipment swaps) ─▶ applySkippedBlocks(skipped keys of the date)
 *                                              ├─ block gets `skipped: true` (kept, same position)
 *                                              └─ targetMinutes drops by the block's estimate
 *
 * The block is MARKED rather than removed so Today (step 4) can still draw
 * "Boxing skipped today · Add it back" in its place with its original number,
 * while `sessionProgress.ts` and `blockCountOf` ignore marked blocks. For a
 * combined day it is applied to each day's session BEFORE `combineSessions`
 * (see `noEquipment/session.ts`), so each day's blocks are matched by their
 * own day-qualified key and the combined minutes drop by the same amount.
 */

/**
 * How long the block is estimated to take, in whole minutes: the total
 * seconds of the timer plan its first interval item would run with the
 * default settings (work, rest, ... as `buildIntervalPlan` builds it, which
 * will include any gear-up segment that plan gains), rounded to the nearest
 * minute with half rounding up. A block with no interval item (none ships
 * today) has no timer to measure, so its estimate is 0 and skipping it
 * leaves the header's minutes alone.
 */
export function estimatedBlockMinutes(block: BlockView): number {
  const intervalItem = block.items.find((item) => item.format === "interval");
  if (intervalItem === undefined) return 0;

  const plan = buildIntervalPlan(intervalItem, defaultIntervalSettings(intervalItem));
  const totalSeconds = plan.segments.reduce((sum, segment) => sum + segment.durationSec, 0);

  return Math.round(totalSeconds / 60);
}

/**
 * True when any of the given exercises has a logged set in this day's block
 * on `date`. Logged sets win over a stored skip (see `applySkippedBlocks`),
 * and the "Boxing today?" question is hidden once this is true.
 */
export function isBlockStarted(log: WorkoutLog, date: string, day: number, blockPosition: number, exerciseIds: string[]): boolean {
  return exerciseIds.some((exerciseId) => setsForItem(log, date, blockPosition, exerciseId, day).length > 0);
}

/**
 * Returns `session` with every block whose key is in `skippedKeys` marked
 * skipped and `targetMinutes` reduced by `estimatedBlockMinutes` for each
 * (never below 0). Only blocks with `optional` set can be skipped; a key for
 * any other block is ignored. Logged sets win: a block with any set logged on
 * `date` in `log` is never treated as skipped, whatever is stored (the
 * athlete skipped, then logged a round through a direct link). A session that is not a training day is
 * returned as is. Does not change its input. Called by
 * `buildSwappedSession` / `buildSwappedCombinedSession` so every screen that
 * counts sets agrees.
 */
export function applySkippedBlocks(session: SessionView, skippedKeys: ReadonlySet<OptionalBlockKey>, log: WorkoutLog = { sessions: {} }, date = ""): SessionView {
  if (session.kind !== "training" || skippedKeys.size === 0) return session;

  let minutesSaved = 0;
  const blocks = session.blocks.map((block) => {
    const isSkipped = block.optional !== undefined && skippedKeys.has(optionalBlockKey(session.dayNumber, block.position));
    if (!isSkipped) return block;
    if (isBlockStarted(log, date, session.dayNumber, block.position, block.items.map((item) => item.exercise.id))) return block;

    minutesSaved += estimatedBlockMinutes(block);
    return { ...block, skipped: true };
  });

  return { ...session, blocks, targetMinutes: Math.max(0, session.targetMinutes - minutesSaved) };
}

/**
 * How many blocks the header should count: all of a session's blocks except
 * skipped ones. For a combined session an alternate block (two days' parts)
 * counts unless every part is skipped. Used by Today's "~N min · M blocks".
 */
export function blockCountOf(session: Extract<SessionView, { kind: "training" }> | CombinedSession): number {
  if (session.kind === "combined") {
    return session.blocks.filter((combinedBlock: CombinedBlock) => combinedBlock.parts.some((part) => !part.block.skipped)).length;
  }

  return session.blocks.filter((block) => !block.skipped).length;
}
