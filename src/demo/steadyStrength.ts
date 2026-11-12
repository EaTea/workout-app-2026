/**
 * The "Show me" demos for the Steady Strength program, keyed by exercise id
 * (the ids in public/steady-strength.json). registry.ts exposes this map to
 * the view; later PR 21/22 steps add the other exercises here.
 *
 * Every demo is built from `neutralStandingPose()` and changes only what
 * differs, so a pose reads as "standing, except ...". Safe ranges from the
 * plan's table are enforced by steadyStrength.test.ts, which samples every
 * frame of the loop.
 */
import { MOVE_MS, HOLD_EXERCISE_MS, START_HOLD_MS, type Demo, type Pose } from "./model";
import { BODY, neutralStandingPose } from "./skeleton";

// ---------------------------------------------------------------------------
// High wall sit
// ---------------------------------------------------------------------------

/** Knee bend at the bottom of the wall sit. 40 degrees leaves a knee angle of 140, inside the plan's 135 minimum ("no more than a quarter"). */
export const WALL_SIT_KNEE_BEND_DEGREES = 40;

/** How far behind the pelvis centre the wall surface is, in metres (half the thickness of the back). */
const WALL_BEHIND_PELVIS_METRES = 0.13;

/**
 * The high wall sit: the back stays flat on the wall and the feet stay put,
 * while the knees bend to 40 degrees. Side view:
 *
 *      wall |   Start            Hold (slid down)
 *           |   O                 O
 *           |  /|                /|
 *           | / |               / |__
 *           |   |\                 /|   thigh forward 40, shin vertical
 *           |  /  \  feet ahead    | |   (the feet do not move)
 *      -----+--------------------------
 *
 * The pelvis is at x = 0 in BOTH poses and the trunk is upright, so the hip
 * and chest keep exactly the same distance from the wall; only the hip height
 * changes. The feet stay at the same spot (anchored by the right heel), so
 * the legs are tilted forward at the start and the shin is vertical at the end.
 */
function buildHighWallSit(): Demo {
  // At the bottom the shin is vertical, so the ankle sits `thigh * sin(bend)` in front of the hip.
  // That horizontal gap between hip and ankle is the same in both poses.
  const hipToAnkleGap = BODY.thigh * Math.sin((WALL_SIT_KNEE_BEND_DEGREES * Math.PI) / 180);
  // Standing with straight legs, the whole leg leans forward by the angle that gives the same gap.
  const standingLegLean = (Math.asin(hipToAnkleGap / (BODY.thigh + BODY.shin)) * 180) / Math.PI;

  // The right heel is anchored a little behind the ankle; both heels end up on the floor.
  const heelAnchor = { x: hipToAnkleGap - BODY.heelBack, y: 0, z: -BODY.pelvisHalfWidth };

  /** A pose with both legs given: hip swing, knee bend and the ankle angle that keeps the foot flat. */
  function wallSitPose(hipSwing: number, kneeBend: number): Pose {
    const pose = neutralStandingPose(heelAnchor);
    // A flat foot is perpendicular to the shin, which leans forward by (hipSwing - kneeBend), so the ankle cancels that lean.
    const leg = { flex: hipSwing, abduct: 0, knee: kneeBend, ankle: -(hipSwing - kneeBend) };
    pose.legLeft = { ...leg };
    pose.legRight = { ...leg };
    // Arms hang with a slight natural bend; trunk, neck and pelvis stay at the neutral values (upright, back flat).
    pose.armLeft = { ...pose.armLeft, flex: 4, elbow: 6 };
    pose.armRight = { ...pose.armRight, flex: 4, elbow: 6 };
    return pose;
  }

  const standing = wallSitPose(standingLegLean, 0);
  const slidDown = wallSitPose(WALL_SIT_KNEE_BEND_DEGREES, WALL_SIT_KNEE_BEND_DEGREES);

  return {
    exerciseId: "high_wall_sit",
    cue: "Back on the wall, slide down a little and hold.",
    ariaLabel: "High wall sit: standing with your back on the wall, then slid a little way down and held",
    view: "side",
    framing: "body",
    moving: ["thighLeft", "thighRight", "shinLeft", "shinRight"],
    props: [{ kind: "wall", x: -WALL_BEHIND_PELVIS_METRES }],
    steps: [
      { kind: "hold", pose: standing, ms: START_HOLD_MS, label: "Start" },
      { kind: "move", from: standing, to: slidDown, ms: MOVE_MS, label: "Slide down a little" },
      { kind: "hold", pose: slidDown, ms: HOLD_EXERCISE_MS, label: "Hold" },
      { kind: "move", from: slidDown, to: standing, ms: MOVE_MS, label: "Slide back up" },
    ],
  };
}

/** Every Steady Strength demo built so far, keyed by exercise id. */
export const steadyStrengthDemos: Record<string, Demo> = {
  high_wall_sit: buildHighWallSit(),
};
