import type { Range } from "../program/model";
import { createCuePlayer } from "../timer/cues";
import { buildRestPlan, defaultRestSeconds, REST_LIMITS } from "../timer/plans";
import { createRestMemory } from "./restMemory";
import { openTimer } from "./timerView";

/**
 * The rest timer, shared by every place that starts a rest: Today's "Rest 30s"
 * buttons and the log screen's "Log set" button.
 *
 *   Today rest button ───┐ (opens ready, Start it)
 *                        ├─▶ openRestTimer(range, name, memoryKey, options) ─▶ timer overlay
 *   Log set (log screen) ┘ (opens already running)   │ Start remembers the chosen seconds
 *                                   ▼
 *                           adjustedRests (restMemory.ts, one page load)
 *
 * Both callers build `memoryKey` with `restMemoryKey(date, blockPosition,
 * exerciseId)`, so a rest adjusted from one place is the default in the other.
 */

/**
 * Rest lengths Ed adjusted and started during this page load (see restMemory.ts).
 * Module-level so it survives screen re-renders but not a reload.
 */
const adjustedRests = createRestMemory();

/**
 * The seconds a rest button should offer right now: the remembered value for
 * `memoryKey` if Ed adjusted and started one this page load, else the low end
 * of the program's `range`. Used for button labels and as the timer default.
 */
export function currentRestSeconds(range: Range, memoryKey: string): number {
  return adjustedRests.get(memoryKey, defaultRestSeconds(range));
}

/** Optional behaviour of `openRestTimer`. */
export interface RestTimerOptions {
  /**
   * Runs after the overlay closes, however it closed (callers use it to
   * refresh a button label that shows the remembered seconds, or to put focus back).
   */
  onClose?: () => void;

  /**
   * Start counting straight away (rule 8: after "Log set" the rest is already
   * running). The caller must be inside the tap that asked for it, because
   * this is also what primes the audio cues.
   */
  startImmediately?: boolean;
}

/**
 * Opens the one-segment rest timer for `restName`, starting at
 * `currentRestSeconds`. By default it opens ready, with a stepper to adjust
 * the length before Start; with `startImmediately` it opens already running
 * and the stepper is not shown. Starting remembers the chosen length under
 * `memoryKey` for the rest of the page load. The timer's finish cue tells Ed
 * to begin the next set.
 */
export function openRestTimer(range: Range, restName: string, memoryKey: string, options: RestTimerOptions = {}): void {
  const cues = createCuePlayer();
  const { minSeconds, maxSeconds, secondsStep } = REST_LIMITS;
  const startingSeconds = currentRestSeconds(range, memoryKey);
  /** Follows the stepper, so Start can remember what was actually chosen. */
  let chosenSeconds = startingSeconds;

  // The caller is inside a tap: unlock the audio now, because a timer that starts by itself has
  // no later Start tap to do it (the overlay's own taps still keep it alive afterwards).
  if (options.startImmediately) cues.prime();

  openTimer(buildRestPlan(startingSeconds, restName), {
    dialogName: "Rest timer",
    startImmediately: options.startImmediately,
    onUserTap: () => cues.prime(),
    onEvents: (events) => cues.handleEvents(events),
    onSecondTick: (remainingSec) => cues.handleSecond(remainingSec),
    onStart: () => adjustedRests.set(memoryKey, chosenSeconds),
    onClose: options.onClose,
    setup: {
      fields: [
        {
          id: "seconds", label: "rest", value: startingSeconds,
          min: minSeconds, max: maxSeconds, step: secondsStep,
          format: (value) => `Rest ${value}s`,
        },
      ],
      rebuildPlan: (values) => {
        chosenSeconds = values.seconds ?? startingSeconds;
        return buildRestPlan(chosenSeconds, restName);
      },
    },
  });
}
