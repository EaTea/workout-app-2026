import type { ItemView } from "../program/schedule";
import { formatRepTarget } from "../ui/format";
import { createTimerPlan, type TimerPlan, type TimerSegment } from "./engine";

/**
 * Builders that turn what the schedule computed for one exercise into a
 * `TimerPlan` the shared timer view (ui/timerView.ts) can run.
 *
 *   ItemView (from buildSession, deload already applied)
 *        │  buildEmomPlan
 *        ▼
 *   TimerPlan: N one-minute "minute" segments, each labelled with its target
 *
 * No arithmetic happens here: minutes and reps come straight from the view,
 * and rep text comes from the same formatter the Today screen uses, so the
 * timer can never disagree with the row it was started from.
 */

/** Seconds in one EMOM minute. */
const EMOM_MINUTE_SECONDS = 60;

/**
 * Builds the plan for an EMOM item: one 60-second segment per minute, titled
 * e.g. "Pull-ups EMOM · 5 min". Called by the Start EMOM button on Today.
 * Throws if the item is not an EMOM with a positive number of minutes (the
 * button is only drawn for such items, so this signals a programming error).
 */
export function buildEmomPlan(item: ItemView): TimerPlan {
  const minutes = item.minutes;
  if (item.format !== "emom" || minutes === undefined) {
    throw new Error(`${item.exercise.name} is not an EMOM item`);
  }

  const label = describeEmomTarget(item);
  const segments: TimerSegment[] = [];
  for (let round = 1; round <= minutes; round += 1) {
    segments.push({ phase: "minute", durationSec: EMOM_MINUTE_SECONDS, round, totalRounds: minutes, label });
  }

  return createTimerPlan(`${item.exercise.name} EMOM · ${minutes} min`, segments);
}

/** The per-minute instruction: "Target 6–7 reps", or a prompt to set a max when the target needs one. */
function describeEmomTarget(item: ItemView): string {
  if (item.target === undefined) return "Go";
  if (item.target.kind === "needsMax") return "Set your max for a target";
  return `Target ${formatRepTarget(item.target)} reps`;
}
