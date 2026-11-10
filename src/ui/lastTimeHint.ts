import type { Program } from "../program/model";
import type { BlockView, ItemView } from "../program/schedule";
import { setNounFor } from "../log/itemSets";
import { findLastTime, type LastTime } from "../log/lastTime";
import type { WorkoutLog } from "../log/model";
import { formatLastTime } from "./format";

/**
 * Last time (rule 8) for an item in the session of day `dayNumber` on `date`,
 * or undefined for warm-up blocks, which never show or use it. The same
 * result drives the hint text and the load pre-fill, so the two can never
 * disagree. Shared by Today's item rows and the log screen.
 *
 *   log + program + item + block + day ──▶ findLastTime ──▶ LastTime
 */
export function lastTimeForItem(log: WorkoutLog, program: Program, item: ItemView, block: BlockView, dayNumber: number, date: string): LastTime | undefined {
  if (block.type === "warmup") return undefined;

  return findLastTime(log, program, { exerciseId: item.exercise.id, dayNumber, blockType: block.type }, date);
}

/**
 * The "Last time (2 Nov): 6 × 6 at 6 kg" line for an item, or undefined when
 * there is nothing to show (see `lastTimeForItem`).
 *
 *   lastTimeForItem ──▶ formatLastTime ──▶ text
 */
export function lastTimeHint(log: WorkoutLog, program: Program, item: ItemView, block: BlockView, dayNumber: number, date: string): string | undefined {
  const lastTime = lastTimeForItem(log, program, item, block, dayNumber, date);
  return lastTime === undefined ? undefined : formatLastTime(lastTime, setNounFor(item));
}
