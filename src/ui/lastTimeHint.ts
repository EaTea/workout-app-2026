import type { BlockView, ItemView } from "../program/schedule";
import { setNounFor } from "../log/itemSets";
import { findLastTime } from "../log/lastTime";
import type { WorkoutLog } from "../log/model";
import { formatLastTime } from "./format";

/**
 * The "Last time (2 Nov): 6 × 6 at 6 kg" line for an item, or undefined when
 * there is nothing to show: warm-up blocks never show it (rule 8), and an
 * exercise never logged on an earlier date has no last time. Shared by Today's
 * item rows and the log screen so both say the same thing.
 *
 *   log + item + date ──▶ findLastTime ──▶ formatLastTime ──▶ text
 */
export function lastTimeHint(log: WorkoutLog, item: ItemView, block: BlockView, date: string): string | undefined {
  if (block.type === "warmup") return undefined;

  const lastTime = findLastTime(log, item.exercise.id, date);
  return lastTime === undefined ? undefined : formatLastTime(lastTime, setNounFor(item));
}
