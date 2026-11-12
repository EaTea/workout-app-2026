/**
 * The pure decisions behind the "Show me" overlay (ui/demoView.ts): which
 * camera angle comes next, what the Turn button says, how the clock and the
 * camera ease along, and which still is current with reduced motion. No DOM,
 * so all of it is unit tested in Vitest; demoView.ts only wires it to buttons.
 */
import { CAMERA_AZIMUTH } from "../demo/renderer";
import type { CameraView, Demo } from "../demo/model";
import { ease } from "../demo/timeline";

/** How long the camera takes to swing to the next angle, in ms. */
export const TURN_DURATION_MS = 800;

/** The slowest a real frame gap is allowed to count (ms); a stalled or throttled page must not make the figure jump. */
export const MAX_FRAME_DELTA_MS = 250;

/** The two speeds the "Slower" button toggles between. */
export const NORMAL_SPEED = 1;
export const SLOW_SPEED = 0.5;

/** The angle after `current` in `cycle` (a demo's `views`), wrapping back to the first; with one view it stays on it. */
export function nextView(cycle: readonly CameraView[], current: CameraView): CameraView {
  const index = cycle.indexOf(current);
  return cycle[(index + 1) % cycle.length] as CameraView;
}

/** How a camera angle is named to the person ("angle" reads better than "three-quarter" on a button). */
export function viewName(view: CameraView): string {
  return view === "threeQuarter" ? "angle" : view;
}

/** Text of the Turn button: it names the angle the next tap goes to, e.g. "↻ Turn (front)". */
export function turnButtonLabel(upcomingView: CameraView): string {
  return `↻ Turn (${viewName(upcomingView)})`;
}

/** Text of the speed button: it names what a tap switches to. */
export function speedButtonLabel(speed: number): string {
  return speed === NORMAL_SPEED ? "Slower" : "Normal speed";
}

/** Text of the pause button: it names what a tap does. */
export function pauseButtonLabel(isPaused: boolean): string {
  return isPaused ? "▶ Play" : "❚❚ Pause";
}

/**
 * The real time since the previous frame, limited to [0, MAX_FRAME_DELTA_MS].
 * `previousTimestamp` is null for the first frame after (re)starting the
 * loop, which counts as zero, so a tab coming back never makes the clock jump.
 */
export function frameDeltaMs(previousTimestamp: number | null, timestamp: number): number {
  if (previousTimestamp === null) return 0;
  return Math.min(Math.max(timestamp - previousTimestamp, 0), MAX_FRAME_DELTA_MS);
}

/** The demo clock after `deltaMs` of real time: advances by delta times speed unless paused. */
export function advanceClock(elapsedMs: number, deltaMs: number, speed: number, isPaused: boolean): number {
  return isPaused ? elapsedMs : elapsedMs + deltaMs * speed;
}

/**
 * Camera azimuth part-way through a turn: eased from `from` to `to` over
 * TURN_DURATION_MS, `sinceTurnStartMs` after the Turn tap.
 */
export function turnAzimuth(from: number, to: number, sinceTurnStartMs: number): number {
  const progress = Math.min(Math.max(sinceTurnStartMs / TURN_DURATION_MS, 0), 1);
  return from + (to - from) * ease(progress);
}

/** Camera azimuth in degrees for a named view (re-exported so the view needs one import). */
export function azimuthOf(view: CameraView): number {
  return CAMERA_AZIMUTH[view];
}

/**
 * Which of the demo's stills (hold steps, in order) the step with index
 * `stepIndex` is; -1 for a move step. Used to highlight the current still in
 * the reduced-motion "Start → Hold" caption.
 */
export function stillIndexForStep(demo: Demo, stepIndex: number): number {
  let holdsSoFar = 0;
  for (let index = 0; index < demo.steps.length; index += 1) {
    if (demo.steps[index]?.kind !== "hold") continue;
    if (index === stepIndex) return holdsSoFar;
    holdsSoFar += 1;
  }
  return -1;
}
