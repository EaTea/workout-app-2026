/**
 * Small helpers the demo builders (steadyStrength.ts) use to turn "the hand
 * rests on the counter" or "the foot is flat on the floor here" into joint
 * angles, so poses are described by where things touch, not by hand-tuned
 * numbers. Pure TypeScript on top of skeleton.ts, unit tested.
 *
 *   wanted joint positions ──solveLimb──▶ angles for one arm or leg ──▶ Pose
 *
 * The solver is a small damped least-squares (Levenberg-Marquardt) fit: it
 * nudges the chosen angles until the chosen joints are as close as possible
 * to their target points, calling jointPositions() each time, so it can never
 * produce anything the real skeleton couldn't do.
 */
import type { JointName, LegAngles, Pose, Vec3 } from "./model";
import { jointPositions } from "./skeleton";

/** The four limbs whose angles can be solved. */
export type Limb = "armLeft" | "armRight" | "legLeft" | "legRight";

/** Wanted positions for joints; any axis left out is not constrained. */
export type JointTargets = Partial<Record<JointName, Partial<Vec3>>>;

/** Allowed range of every angle the solver may change, in degrees (keeps limbs anatomically sensible). */
const ANGLE_LIMITS: Record<string, [number, number]> = {
  flex: [-70, 170],
  abduct: [-40, 100],
  rotate: [-100, 100],
  elbow: [0, 150],
  wrist: [-60, 60],
  knee: [0, 150],
  ankle: [-60, 40],
};

/** A deep copy of a pose, so a builder can change one pose without touching another. */
export function copyPose(pose: Pose): Pose {
  return JSON.parse(JSON.stringify(pose)) as Pose;
}

/**
 * The same pose, but pinned by a different joint. The joint's current world
 * position becomes the anchor, so nothing moves on screen. Used where the
 * planted point changes during a rep (heel then toe): a move must keep one
 * anchor, so the demo ends one move on the old anchor and starts the next on
 * the new one at the identical world point.
 */
export function reanchored(pose: Pose, joint: JointName): Pose {
  const copy = copyPose(pose);
  copy.anchor = { joint, at: { ...jointPositions(pose)[joint] } };
  return copy;
}

/**
 * Leg angles described the way a person sees them: thigh swing from vertical
 * in the world (forward positive), knee bend, and the foot's tilt in the
 * world (0 = flat on the floor, positive = toes up). `pelvisPitch` is the
 * forward tip of the pelvis; the hip angle is relative to the pelvis, so it
 * is compensated here and a leaning body keeps its legs where they are.
 */
export function legAngles(world: { thigh: number; knee: number; foot: number }, pelvisPitch = 0, abduct = 0): LegAngles {
  return {
    flex: world.thigh + pelvisPitch,
    abduct,
    knee: world.knee,
    ankle: world.foot - world.thigh + world.knee,
  };
}

/** Solves the small linear system A x = b by Gaussian elimination with pivoting (A is square, tiny). */
function solveLinear(matrix: number[][], rhs: number[]): number[] {
  const size = rhs.length;
  const a = matrix.map((row, index) => [...row, rhs[index] as number]);

  for (let column = 0; column < size; column += 1) {
    let pivot = column;
    for (let row = column + 1; row < size; row += 1) {
      if (Math.abs((a[row] as number[])[column] as number) > Math.abs((a[pivot] as number[])[column] as number)) pivot = row;
    }
    [a[column], a[pivot]] = [a[pivot] as number[], a[column] as number[]];

    const pivotRow = a[column] as number[];
    for (let row = column + 1; row < size; row += 1) {
      const rowValues = a[row] as number[];
      const factor = (rowValues[column] as number) / (pivotRow[column] as number);
      for (let k = column; k <= size; k += 1) rowValues[k] = (rowValues[k] as number) - factor * (pivotRow[k] as number);
    }
  }

  const solution = new Array<number>(size).fill(0);
  for (let row = size - 1; row >= 0; row -= 1) {
    const rowValues = a[row] as number[];
    let sum = rowValues[size] as number;
    for (let k = row + 1; k < size; k += 1) sum -= (rowValues[k] as number) * (solution[k] as number);
    solution[row] = sum / (rowValues[row] as number);
  }
  return solution;
}

/** The angles of a limb as a plain record (arms and legs both are objects of numbers). */
function limbAngles(pose: Pose, limb: Limb): Record<string, number> {
  return pose[limb] as unknown as Record<string, number>;
}

/**
 * Returns a copy of `pose` in which the angles named in `free` on `limb` are
 * adjusted so that the joints in `targets` sit as near as possible to their
 * wanted points (world metres, after the pose's anchor is applied). Angles
 * not named stay as they are.
 *
 * Callers pick a sensible starting pose (the limb already roughly right) so
 * the fit lands on the natural solution (elbow down, knee forward) rather
 * than a mirror-image one. A weak pull towards the starting angles keeps
 * angles that the targets don't pin down from wandering.
 *
 * Callers check the result: the demo tests assert the touching joints end
 * within a couple of centimetres of their supports.
 */
export function solveLimb(pose: Pose, limb: Limb, targets: JointTargets, free: string[]): Pose {
  const result = copyPose(pose);
  const angles = limbAngles(result, limb);
  const start = free.map((name) => angles[name] as number);
  const entries = Object.entries(targets) as Array<[JointName, Partial<Vec3>]>;

  /** Residuals: (joint - target) for each constrained axis in metres, plus a very weak pull to the start angles. */
  const residuals = (values: number[]): number[] => {
    free.forEach((name, index) => { angles[name] = values[index] as number; });
    const joints = jointPositions(result);
    const out: number[] = [];
    for (const [joint, wanted] of entries) {
      for (const axis of ["x", "y", "z"] as const) {
        const target = wanted[axis];
        if (target !== undefined) out.push(joints[joint][axis] - target);
      }
    }
    values.forEach((value, index) => out.push(((value - (start[index] as number)) * 0.0003)));
    return out;
  };

  const sumSquares = (values: number[]) => values.reduce((total, value) => total + value * value, 0);
  const clamp = (name: string, value: number) => {
    const [low, high] = ANGLE_LIMITS[name] ?? [-180, 180];
    return Math.min(high, Math.max(low, value));
  };

  let current = [...start];
  let currentCost = sumSquares(residuals(current));
  let damping = 1e-3;

  for (let iteration = 0; iteration < 200; iteration += 1) {
    const base = residuals(current);
    // Finite-difference Jacobian, one column per free angle (0.01 degree steps).
    const columns = current.map((_, index) => {
      const nudged = [...current];
      nudged[index] = (nudged[index] as number) + 0.01;
      return residuals(nudged).map((value, row) => (value - (base[row] as number)) / 0.01);
    });

    const size = current.length;
    const normal = Array.from({ length: size }, (_, i) =>
      Array.from({ length: size }, (_, j) =>
        (columns[i] as number[]).reduce((total, value, row) => total + value * ((columns[j] as number[])[row] as number), 0)));
    const gradient = columns.map((column) => column.reduce((total, value, row) => total + value * (base[row] as number), 0));

    let improved = false;
    for (let attempt = 0; attempt < 12 && !improved; attempt += 1) {
      const damped = normal.map((row, i) => row.map((value, j) => (i === j ? value * (1 + damping) + 1e-9 : value)));
      const step = solveLinear(damped, gradient.map((value) => -value));
      const candidate = current.map((value, index) => clamp(free[index] as string, value + (step[index] as number)));
      const candidateCost = sumSquares(residuals(candidate));
      if (candidateCost < currentCost) {
        improved = currentCost - candidateCost > 1e-14;
        current = candidate;
        currentCost = candidateCost;
        damping = Math.max(damping / 3, 1e-9);
        if (!improved) break;
      } else {
        damping *= 4;
      }
    }
    if (!improved) break;
  }

  residuals(current); // leave the best angles written into `result`
  return result;
}
