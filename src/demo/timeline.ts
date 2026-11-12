/**
 * Turns a Demo (a loop of hold and move steps) into the pose to draw at a
 * given moment. Pure functions, unit tested.
 *
 *   elapsedMs ──wrap──▶ which step? ──ease──▶ blended Pose + label
 *
 *   |-- hold 1500 --|---- move 2500 ----|------ hold 4000 ------|---- move 2500 ----|
 *   0              1500                4000                    8000               10500 = loop end
 *
 * Speed and pausing are the CALLER's job: the view scales the elapsed time it
 * passes in (half speed = advance the clock at half rate; pause = stop
 * advancing it). Nothing here knows about either.
 */
import type { Demo, Pose, Step } from "./model";

/** Ease-in-out quad: slow start, faster middle, slow end. Maps 0..1 to 0..1. */
export function ease(t: number): number {
  return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
}

/** Linear blend of two numbers. */
function mix(from: number, to: number, t: number): number {
  return from + (to - from) * t;
}

/**
 * Blends every angle of two poses linearly (t = 0 gives `from`, 1 gives `to`)
 * and also the anchor point. Throws if the poses anchor different joints,
 * because blending between two different anchor joints would make the
 * figure slide; demos must keep one anchor joint per move.
 */
export function blendPoses(from: Pose, to: Pose, t: number): Pose {
  if (from.anchor.joint !== to.anchor.joint) {
    throw new Error(`Cannot blend poses anchored on different joints ("${from.anchor.joint}" and "${to.anchor.joint}"); use one anchor joint per move.`);
  }

  /** Blends two plain objects of numbers key by key (all pose parts are such objects). */
  const blendNumbers = <T extends Record<string, number>>(a: T, b: T): T => {
    const result = {} as Record<string, number>;
    for (const key of Object.keys(a)) {
      result[key] = mix(a[key] as number, b[key] as number, t);
    }
    return result as T;
  };

  return {
    pelvis: blendNumbers(from.pelvis, to.pelvis),
    spine: blendNumbers(from.spine, to.spine),
    neck: blendNumbers(from.neck, to.neck),
    armLeft: blendNumbers(from.armLeft, to.armLeft),
    armRight: blendNumbers(from.armRight, to.armRight),
    legLeft: blendNumbers(from.legLeft, to.legLeft),
    legRight: blendNumbers(from.legRight, to.legRight),
    anchor: { joint: from.anchor.joint, at: blendNumbers(from.anchor.at, to.anchor.at) },
  };
}

/** Total length of one pass through the demo's steps, in ms. */
export function loopLengthMs(demo: Demo): number {
  return demo.steps.reduce((total, step) => total + step.ms, 0);
}

/** The pose, label and step number to draw at one moment. */
export type Frame = { pose: Pose; label: string; stepIndex: number };

/**
 * The frame at `elapsedMs` since the loop began. Elapsed time wraps around
 * the loop, so the demo repeats forever. Moves use eased progress; holds
 * show their pose unchanged.
 */
export function frameAt(demo: Demo, elapsedMs: number): Frame {
  const loop = loopLengthMs(demo);
  if (loop <= 0) {
    throw new Error(`Demo "${demo.exerciseId}" has no steps with a duration.`);
  }

  // Modulo that stays non-negative even for negative input.
  let remaining = ((elapsedMs % loop) + loop) % loop;

  for (let stepIndex = 0; stepIndex < demo.steps.length; stepIndex += 1) {
    const step = demo.steps[stepIndex] as Step;
    if (remaining < step.ms) {
      const pose = step.kind === "hold" ? step.pose : blendPoses(step.from, step.to, ease(remaining / step.ms));
      return { pose, label: step.label, stepIndex };
    }
    remaining -= step.ms;
  }

  // Unreachable because remaining < loop; satisfies the compiler.
  throw new Error("frameAt ran past the end of the loop.");
}

/** Start time (ms into the loop) of every hold step, in order; used by "Next step" with reduced motion. */
export function holdStartTimes(demo: Demo): number[] {
  const starts: number[] = [];
  let stepStart = 0;
  for (const step of demo.steps) {
    if (step.kind === "hold") {
      starts.push(stepStart);
    }
    stepStart += step.ms;
  }
  return starts;
}

/**
 * The absolute elapsed time of the next hold that starts strictly after the
 * current position in the loop, wrapping into the next loop if needed. The
 * result is always at least `elapsedMs`. Used by "Next step" with reduced motion.
 */
export function nextHoldTime(demo: Demo, elapsedMs: number): number {
  const starts = holdStartTimes(demo);
  const first = starts[0];
  if (first === undefined) {
    throw new Error(`Demo "${demo.exerciseId}" has no hold steps.`);
  }

  const loop = loopLengthMs(demo);
  const loopStart = Math.floor(elapsedMs / loop) * loop;
  const position = elapsedMs - loopStart;

  const laterHold = starts.find((start) => start > position);
  return laterHold !== undefined ? loopStart + laterHold : loopStart + loop + first;
}

/** The hold steps' poses and labels, shown side by side as the Start / End stills with reduced motion. */
export function stillFrames(demo: Demo): Array<{ pose: Pose; label: string }> {
  const stills: Array<{ pose: Pose; label: string }> = [];
  for (const step of demo.steps) {
    if (step.kind === "hold") {
      stills.push({ pose: step.pose, label: step.label });
    }
  }
  return stills;
}
