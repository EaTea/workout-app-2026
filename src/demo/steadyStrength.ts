/**
 * The "Show me" demos for the Steady Strength program, keyed by exercise id
 * (the ids in public/steady-strength.json). registry.ts lazy-loads
 * this module (it is heavy to build, so it must stay out of the main bundle)
 * and lists its keys in DEMO_EXERCISE_IDS.
 *
 * Every demo is built from `neutralStandingPose()` and changes only what
 * differs, so a pose reads as "standing, except ...". Safe ranges from the
 * plan's table are enforced by steadyStrength.test.ts, which samples every
 * frame of the loop.
 */
import {
  END_HOLD_MS, MOVE_MS, HOLD_EXERCISE_MS, START_HOLD_MS,
  type ArmAngles, type Demo, type JointName, type Pose, type Prop, type Step, type Vec3,
} from "./model";
import { copyPose, legAngles, reanchored, solveLimb, type Limb } from "./poseTools";
import { BODY, jointPositions, neutralStandingPose } from "./skeleton";
import { blendPoses } from "./timeline";

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


// ---------------------------------------------------------------------------
// Shared building blocks for the other demos
// ---------------------------------------------------------------------------

/** Arms hanging loosely with a slight natural bend (as in the wall sit). */
const RELAXED_ARM: ArmAngles = { flex: 4, abduct: 0, rotate: 0, elbow: 6, wrist: 0 };

/** Counter height in metres: a normal kitchen worktop, about hip height. */
const COUNTER_HEIGHT = 0.9;

/** Height of a wrist resting on a flat surface at counter height (the hand's own thickness above the top). */
const WRIST_ON_COUNTER_Y = COUNTER_HEIGHT + 0.035;

/** Heel to toe distance of a foot, in metres (the same whatever the ankle angle). */
const FOOT_SPAN = BODY.heelBack + BODY.footLength;

/** Which side a limb is on. */
type Side = "Left" | "Right";

/** A world point, shorthand for the many targets below. */
function at(x: number, y: number, z: number): Vec3 {
  return { x, y, z };
}

/** A standing pose with the arms relaxed; `anchorAt` is where the right heel is planted. */
function standing(anchorAt: Vec3 = at(0, 0, -BODY.pelvisHalfWidth)): Pose {
  const pose = neutralStandingPose(anchorAt);
  pose.armLeft = { ...RELAXED_ARM };
  pose.armRight = { ...RELAXED_ARM };
  return pose;
}

/** Shorthand for a hold step. */
function hold(pose: Pose, ms: number, label: string): Step {
  return { kind: "hold", pose, ms, label };
}

/** Shorthand for a move step. */
function move(from: Pose, to: Pose, ms: number, label: string): Step {
  return { kind: "move", from, to, ms, label };
}

/** The limb name for an arm or leg on one side. */
function limbOf(kind: "arm" | "leg", side: Side): Limb {
  return `${kind}${side}` as Limb;
}

/**
 * Puts one hand flat on a surface: the wrist at `wrist` and the fingertips
 * `along` further on (so the hand lies on the surface rather than gripping its
 * edge). `guess` is a rough starting arm so the fit finds the natural elbow-down
 * arm. Used for counters, chair arms and the wall.
 */
function restHand(pose: Pose, side: Side, wrist: Vec3, along: Vec3, guess: Partial<ArmAngles>): Pose {
  const limb = limbOf("arm", side);
  const start = copyPose(pose);
  start[limb] = { ...pose[limb] as ArmAngles, ...guess } as never;
  const targets = {
    [`wrist${side}`]: wrist,
    [`hand${side}`]: at(wrist.x + along.x, wrist.y + along.y, wrist.z + along.z),
  };
  return solveLimb(start, limb, targets, ["flex", "abduct", "elbow", "wrist"]);
}

/**
 * Puts one foot at a place: either the heel or the toe is given, and the other
 * end follows from the foot's tilt (0 = flat, positive = toes up). `forwardSign`
 * is +1 for a figure facing +x and -1 for one facing -x. The leg angles are
 * fitted so the pose's anchor decides where the pelvis is, so callers anchor
 * on the pelvis while designing a pose and call `reanchored` afterwards.
 */
function placeFoot(
  pose: Pose, side: Side, contact: { heel?: Vec3; toe?: Vec3 }, tiltDegrees: number, guess: Partial<{ flex: number; abduct: number; knee: number; ankle: number }>,
  forwardSign: 1 | -1 = 1,
): Pose {
  const tilt = (tiltDegrees * Math.PI) / 180;
  const along = at(forwardSign * FOOT_SPAN * Math.cos(tilt), FOOT_SPAN * Math.sin(tilt), 0);
  const heel = contact.heel ?? at(contact.toe!.x - along.x, contact.toe!.y - along.y, contact.toe!.z);
  const toe = contact.toe ?? at(heel.x + along.x, heel.y + along.y, heel.z);

  const limb = limbOf("leg", side);
  const start = copyPose(pose);
  start[limb] = { ...(pose[limb] as object), ...guess } as never;
  return solveLimb(start, limb, { [`heel${side}`]: heel, [`toe${side}`]: toe }, ["flex", "abduct", "knee", "ankle"]);
}

/**
 * A pose halfway between two, with one foot's toe raised to `toeHeight` metres
 * by bending that knee (and, if `heelHeight` is given, the ankle too, to hold the foot level at that height). Blending joint angles straight between two poses can
 * scrape a swinging foot through the floor; going via this lifted pose (as two
 * moves) lets the foot clear it. Used where a foot slides forward or back.
 */
function halfwayWithToeLifted(from: Pose, to: Pose, side: Side, toeHeight: number, heelHeight?: number): Pose {
  const targets: Record<string, { y: number }> = { [`toe${side}`]: { y: toeHeight } };
  if (heelHeight !== undefined) targets[`heel${side}`] = { y: heelHeight };
  const halfway = blendPoses(from, to, 0.5);
  // Start from a bent knee: a straight leg is a stationary point for the fit (a tiny bend does not lift the toe at first).
  (side === "Left" ? halfway.legLeft : halfway.legRight).knee = 30;
  return solveLimb(halfway, limbOf("leg", side), targets, heelHeight === undefined ? ["knee"] : ["knee", "ankle"]);
}

/** Where a joint is in a pose (world metres). */
function where(pose: Pose, joint: JointName): Vec3 {
  return jointPositions(pose)[joint];
}

// ---------------------------------------------------------------------------
// 1. Head turns
// ---------------------------------------------------------------------------

/** How far the head turns each way, in degrees ("about 45"; the safety test caps it at 45). */
export const HEAD_TURN_DEGREES = 45;

/**
 * Head turns: front view, close up on the head. The figure stands tall and
 * turns only the head, one way and back, then the other way and back. The
 * head never tips back or down (neck flex stays 0).
 */
function buildHeadTurns(): Demo {
  const facingForward = standing();
  const turnedTo = (degrees: number): Pose => {
    const pose = copyPose(facingForward);
    pose.neck.turn = degrees;
    return pose;
  };
  const oneSide = turnedTo(HEAD_TURN_DEGREES);
  const otherSide = turnedTo(-HEAD_TURN_DEGREES);

  return {
    exerciseId: "head_turns",
    cue: "Sit or stand tall and turn your head slowly to one side, then the other.",
    ariaLabel: "Head turns: facing forward, then the head turned slowly to one side, back to the middle, then to the other side and back",
    view: "front",
    framing: "closeUpHead",
    moving: ["head"],
    props: [],
    steps: [
      hold(facingForward, START_HOLD_MS, "Start"),
      move(facingForward, oneSide, MOVE_MS, "Turn to one side"),
      hold(oneSide, END_HOLD_MS, "Looking to one side"),
      move(oneSide, facingForward, MOVE_MS, "Back to the middle"),
      move(facingForward, otherSide, MOVE_MS, "Turn to the other side"),
      hold(otherSide, END_HOLD_MS, "Looking to the other side"),
      move(otherSide, facingForward, MOVE_MS, "Back to the middle"),
    ],
  };
}

// ---------------------------------------------------------------------------
// 2. Neck retraction
// ---------------------------------------------------------------------------

/** How far the head slides straight back, in metres. */
export const NECK_RETRACTION_METRES = 0.04;

/**
 * Neck retraction (chin tuck): side view, close up on the head. A fingertip
 * rests on the chin and the head slides straight back with the chin kept
 * level (neck flex stays 0). The hand follows the chin, so its arm is fitted
 * afresh for the start and end head positions.
 */
function buildNeckRetraction(): Demo {
  /** A pose with the head slid back by `retract` metres and the right hand on the chin. */
  const poseWithHandOnChin = (retract: number): Pose => {
    const pose = standing();
    pose.neck.retract = retract;
    const head = where(pose, "head");
    const chin = at(head.x + 0.075, head.y - 0.085, -0.08);
    pose.armRight = { flex: 40, abduct: 0, rotate: -50, elbow: 130, wrist: 0 };
    return solveLimb(pose, "armRight", { handRight: chin }, ["flex", "abduct", "rotate", "elbow", "wrist"]);
  };
  const forward = poseWithHandOnChin(0);
  const slidBack = poseWithHandOnChin(NECK_RETRACTION_METRES);

  return {
    exerciseId: "neck_retraction",
    cue: "With a hand on your chin, slide your head straight back.",
    ariaLabel: "Neck retraction: head forward with a hand on the chin, then the head slid straight back with the chin level",
    view: "side",
    framing: "closeUpHead",
    moving: ["head", "handRight"],
    props: [],
    steps: [
      hold(forward, START_HOLD_MS, "Start"),
      move(forward, slidBack, MOVE_MS, "Slide your head straight back"),
      hold(slidBack, HOLD_EXERCISE_MS, "Hold"),
      move(slidBack, forward, MOVE_MS, "Let it come forward"),
    ],
  };
}

// ---------------------------------------------------------------------------
// 3. Standing back extension
// ---------------------------------------------------------------------------

/** The small arch: the trunk tips back this many degrees (the plan's limit is 10). */
export const BACK_EXTENSION_DEGREES = 8;

/**
 * Standing back extension: side view. Both hands are on the small of the
 * back and the trunk leans back only a little, bending at the lower back. The
 * knees stay straight and the hips stay where they are.
 */
function buildStandingBackExtension(): Demo {
  /** A pose with the trunk arched back by `archDegrees` and both hands on the lower back. */
  const poseWithArch = (archDegrees: number): Pose => {
    const pose = standing();
    pose.spine.flex = -archDegrees;
    const pelvis = where(pose, "pelvis");
    for (const side of ["Left", "Right"] as const) {
      const sign = side === "Left" ? 1 : -1;
      pose[limbOf("arm", side)] = { flex: -35, abduct: 30, rotate: -60, elbow: 100, wrist: 0 } as never;
      const solved = solveLimb(pose, limbOf("arm", side), { [`hand${side}`]: at(pelvis.x - 0.10, pelvis.y + 0.17, sign * 0.10) }, ["flex", "abduct", "rotate", "elbow", "wrist"]);
      pose[limbOf("arm", side)] = solved[limbOf("arm", side)] as never;
    }
    return pose;
  };
  const upright = poseWithArch(0);
  const arched = poseWithArch(BACK_EXTENSION_DEGREES);

  return {
    exerciseId: "standing_back_extension",
    cue: "Hands on your lower back, lean back just a little.",
    ariaLabel: "Standing back extension: standing with hands on the lower back, then leaning back a little",
    view: "side",
    framing: "body",
    moving: ["trunk"],
    props: [],
    steps: [
      hold(upright, START_HOLD_MS, "Start"),
      move(upright, arched, MOVE_MS, "Lean back a little"),
      hold(arched, END_HOLD_MS, "End"),
      move(arched, upright, MOVE_MS, "Stand tall again"),
    ],
  };
}

// ---------------------------------------------------------------------------
// 4. Ankle pumps, seated
// ---------------------------------------------------------------------------

/** Seat height of the chair for the seated exercises, in metres. */
const SEAT_HEIGHT = 0.45;
/** Pelvis height when sitting on that seat: the pelvis centre sits about 0.10 above the seat top. */
const SEATED_PELVIS_Y = SEAT_HEIGHT + 0.10;

/**
 * Ankle pumps: side view, close up on the right foot. The figure sits on a
 * chair with the right leg stretched out in front and the foot held just clear
 * of the floor, and the foot tilts toes up, then toes pointed. (The foot is
 * held clear of the floor, not resting on its heel, because a pointed foot
 * would otherwise go through the floor.) The leg stays still and only the
 * ankle moves; the other foot rests flat on the floor.
 */
function buildAnklePumps(): Demo {
  const pose = neutralStandingPose();
  pose.anchor = { joint: "pelvis", at: at(0, SEATED_PELVIS_Y, 0) };
  pose.armLeft = { ...RELAXED_ARM };
  pose.armRight = { ...RELAXED_ARM };

  // Resting foot: flat on the floor under the knee.
  let seated = placeFoot(pose, "Left", { heel: at(0.30, 0, BODY.pelvisHalfWidth) }, 0, { flex: 80, knee: 90, ankle: 10 });

  // Pumping leg: the ankle is held 0.15 m up so the pointed toe just clears the floor.
  seated = solveLimb({ ...seated, legRight: { flex: 80, abduct: 0, knee: 40, ankle: 0 } }, "legRight", { ankleRight: at(0.62, 0.15, -BODY.pelvisHalfWidth) }, ["flex", "knee"]);

  // Hands rest on the thighs.
  for (const side of ["Left", "Right"] as const) {
    const sign = side === "Left" ? 1 : -1;
    seated[limbOf("arm", side)] = { flex: 35, abduct: 5, rotate: 0, elbow: 55, wrist: 0 } as never;
    seated = solveLimb(seated, limbOf("arm", side), { [`hand${side}`]: at(0.2, 0.64, sign * 0.12) }, ["flex", "abduct", "elbow", "wrist"]);
  }

  /** The seated pose with the right foot tilted `footTilt` degrees (0 = flat, positive = toes up). */
  const withFootTilt = (footTilt: number): Pose => {
    const copy = copyPose(seated);
    const leg = copy.legRight;
    leg.ankle = footTilt - leg.flex + leg.knee;
    return copy;
  };
  const flat = withFootTilt(0);
  const toesUp = withFootTilt(25);
  const toesPointed = withFootTilt(-25);

  return {
    exerciseId: "ankle_pumps",
    cue: "Sitting, pull your toes up, then point them.",
    ariaLabel: "Ankle pumps: sitting with the foot flat, then the toes pulled up, then the toes pointed",
    view: "side",
    framing: "closeUpFoot",
    moving: ["footRight"],
    props: [{ kind: "chair", x: 0.30, seatHeight: SEAT_HEIGHT, withArms: false }],
    steps: [
      hold(flat, START_HOLD_MS, "Start"),
      move(flat, toesUp, MOVE_MS, "Pull your toes up"),
      hold(toesUp, END_HOLD_MS, "Toes up"),
      move(toesUp, toesPointed, MOVE_MS, "Point your toes"),
      hold(toesPointed, END_HOLD_MS, "Toes pointed"),
      move(toesPointed, flat, MOVE_MS, "Relax"),
    ],
  };
}

// ---------------------------------------------------------------------------
// 5. Single-leg stand
// ---------------------------------------------------------------------------

/** Standing leg with a soft (slightly bent, not locked) knee and the foot flat. */
const SOFT_KNEE_LEG = legAngles({ thigh: 3, knee: 8, foot: 0 });

/**
 * Single-leg stand at the counter: three-quarter view, the counter beside the
 * figure on its left (the far side, so it never hides the legs). The left foot
 * is planted with a soft knee and the left hand rests on the counter; the right
 * foot lifts a little off the floor.
 */
function buildSingleLegStand(): Demo {
  const base = standing(at(0, 0, BODY.pelvisHalfWidth));
  base.anchor = { joint: "heelLeft", at: at(0, 0, BODY.pelvisHalfWidth) };
  base.legLeft = { ...SOFT_KNEE_LEG };
  base.legRight = { ...SOFT_KNEE_LEG };
  const pelvis = where(base, "pelvis");
  const withHand = restHand(base, "Left", at(pelvis.x, WRIST_ON_COUNTER_Y, 0.40), at(0.09, 0, 0), { flex: 5, abduct: 30, elbow: 50 });
  withHand.armRight = { ...RELAXED_ARM, abduct: 8 };

  const bothFeetDown = withHand;
  const footLifted = copyPose(withHand);
  footLifted.legRight = legAngles({ thigh: 10, knee: 45, foot: -20 });

  return {
    exerciseId: "single_leg_stand",
    cue: "Hold the counter and lift one foot a little off the floor.",
    ariaLabel: "Single-leg stand: both feet down with a hand on the counter, then one foot lifted a little off the floor",
    view: "threeQuarter",
    framing: "body",
    moving: ["thighRight", "shinRight", "footRight"],
    props: [{ kind: "counter", x: 0.28, height: COUNTER_HEIGHT, side: "left" }],
    steps: [
      hold(bothFeetDown, START_HOLD_MS, "Start"),
      move(bothFeetDown, footLifted, MOVE_MS, "Lift one foot a little"),
      hold(footLifted, HOLD_EXERCISE_MS, "Hold"),
      move(footLifted, bothFeetDown, MOVE_MS, "Foot down, then the other side"),
    ],
  };
}

// ---------------------------------------------------------------------------
// 6. Heel-to-toe stand
// ---------------------------------------------------------------------------

/** Near edge of the counter the figure faces, in metres in front of the heels. */
const FRONT_COUNTER_X = 0.42;

/** Puts both hands flat on the front counter, a shoulder-width apart, centred on the pelvis. */
function bothHandsOnFrontCounter(pose: Pose): Pose {
  const pelvis = where(pose, "pelvis");
  let result = pose;
  for (const side of ["Left", "Right"] as const) {
    const sign = side === "Left" ? 1 : -1;
    result = restHand(result, side, at(FRONT_COUNTER_X + 0.06, WRIST_ON_COUNTER_Y, pelvis.z + sign * 0.17), at(0.09, 0, 0), { flex: 35, abduct: 5, elbow: 45 });
  }
  return result;
}

/**
 * Heel-to-toe stand: side view, counter in front. Both hands hold the counter.
 * Start with the feet side by side; end with the left foot stepped in front so
 * its heel touches the right toe, feet in one line, weight shared between them.
 */
function buildHeelToToeStand(): Demo {
  const apart = bothHandsOnFrontCounter(standing());

  // End: weight moves over the line of the feet, so the pelvis sits above the line (z = -0.09).
  let together = standing();
  together.legRight = { flex: 0, abduct: -6.3, knee: 0, ankle: 0 };
  together = solveLimb(together, "legRight", { pelvis: { x: 0.16, y: 0.88 }, toeRight: { y: 0 } }, ["flex", "knee", "ankle"]);
  const rightToe = where(together, "toeRight");
  together = placeFoot(together, "Left", { heel: at(rightToe.x + 0.005, 0, -BODY.pelvisHalfWidth) }, 0, { flex: 20, abduct: -6, knee: 5, ankle: 15 });
  together = bothHandsOnFrontCounter(together);

  return {
    exerciseId: "heel_to_toe_stand",
    cue: "Hold the counter, put one foot right in front of the other and stand still.",
    ariaLabel: "Heel-to-toe stand: feet side by side holding the counter, then one foot in front of the other with the heel touching the toe",
    view: "side",
    framing: "body",
    moving: ["thighLeft", "shinLeft", "footLeft"],
    props: [{ kind: "counter", x: FRONT_COUNTER_X, height: COUNTER_HEIGHT }],
    steps: [
      hold(apart, START_HOLD_MS, "Start"),
      move(apart, together, MOVE_MS, "Put one foot in front"),
      hold(together, HOLD_EXERCISE_MS, "Hold"),
      move(together, apart, MOVE_MS, "Feet apart, then the other side"),
    ],
  };
}

// ---------------------------------------------------------------------------
// 8. Sideways walking
// ---------------------------------------------------------------------------

/**
 * Sideways walking along the counter: front camera angle. The figure faces
 * AWAY from the camera (yaw 180) towards a counter behind it, because a counter
 * between the camera and the figure would hide the legs. It steps sideways to
 * its left: left foot out, then right foot in, twice-over in effect two steps;
 * the feet never cross. The figure travels, and jumps back when the loop restarts.
 *
 *   camera ──▶   [figure, seen from behind]   ──▶   [counter]
 *   figure's left = viewer's left
 */
function buildSidewaysWalking(): Demo {
  /** Pelvis x: the figure faces -x, so the counter is at lower x. */
  const pelvisX = 0.0;
  const sideStepMetres = 0.2;
  const hipHalf = BODY.pelvisHalfWidth;

  /**
   * One pose of the side-step. `pelvisSide` is how far the pelvis is to the
   * figure's left; `leftFootSide` and `rightFootSide` the same for the feet;
   * `lift` raises that foot off the floor. The figure's left is world -z (it faces -x).
   */
  const sidewaysPose = (
    pelvisSide: number, pelvisHeight: number,
    leftFoot: { side: number; lift: number }, rightFoot: { side: number; lift: number },
    plantedHeel: "heelLeft" | "heelRight",
  ): Pose => {
    let pose = standing();
    pose.pelvis.yaw = 180;
    pose.anchor = { joint: "pelvis", at: at(pelvisX, pelvisHeight, -pelvisSide) };

    const feet: Array<[Side, { side: number; lift: number }]> = [["Left", leftFoot], ["Right", rightFoot]];
    for (const [side, foot] of feet) {
      const outwards = foot.side - pelvisSide - (side === "Left" ? hipHalf : -hipHalf);
      pose = placeFoot(pose, side, { heel: at(pelvisX + BODY.heelBack, foot.lift, -foot.side) }, 0, { flex: 0, abduct: (side === "Left" ? 1 : -1) * outwards * 60, knee: 5, ankle: 0 }, -1);
    }

    // The left hand slides along the counter ahead of the figure.
    pose = restHand(pose, "Left", at(pelvisX - 0.52, WRIST_ON_COUNTER_Y, -(pelvisSide + 0.18)), at(-0.09, 0, 0), { flex: 35, abduct: 5, elbow: 45 });
    return reanchored(pose, plantedHeel);
  };

  const together0 = sidewaysPose(0, 0.9, { side: hipHalf, lift: 0 }, { side: -hipHalf, lift: 0 }, "heelRight");
  const leftOutHalf = sidewaysPose(0, 0.885, { side: hipHalf + sideStepMetres / 2, lift: 0.04 }, { side: -hipHalf, lift: 0 }, "heelRight");
  const leftOut = sidewaysPose(0, 0.875, { side: hipHalf + sideStepMetres, lift: 0 }, { side: -hipHalf, lift: 0 }, "heelRight");
  const rightInHalf = sidewaysPose(sideStepMetres / 2, 0.885, { side: hipHalf + sideStepMetres, lift: 0 }, { side: -hipHalf + sideStepMetres / 2, lift: 0.04 }, "heelLeft");
  const together1 = sidewaysPose(sideStepMetres, 0.9, { side: hipHalf + sideStepMetres, lift: 0 }, { side: -hipHalf + sideStepMetres, lift: 0 }, "heelLeft");

  return {
    exerciseId: "sideways_walking",
    cue: "One hand on the counter, step sideways and don't cross your feet.",
    ariaLabel: "Sideways walking: standing with a hand on the counter, then two side steps along it, the feet never crossing",
    view: "front",
    framing: "body",
    moving: ["thighLeft", "thighRight", "shinLeft", "shinRight", "footLeft", "footRight"],
    props: [{ kind: "counter", x: pelvisX - 1.05, height: COUNTER_HEIGHT }],
    steps: [
      hold(together0, START_HOLD_MS, "Start"),
      move(together0, leftOutHalf, 1000, "Step sideways"),
      move(leftOutHalf, leftOut, 1000, "Step sideways"),
      move(reanchored(leftOut, "heelLeft"), rightInHalf, 1000, "Bring the other foot in"),
      move(rightInHalf, together1, 1000, "Bring the other foot in"),
      hold(together1, END_HOLD_MS, "End"),
    ],
  };
}

// ---------------------------------------------------------------------------
// 10. Glute bridge hold
// ---------------------------------------------------------------------------

/** Mattress height in metres. */
const BED_HEIGHT = 0.5;
/** How high the shoulder line sits above the mattress surface, in metres (the shoulders sink into it a little). */
const SHOULDER_ABOVE_BED = 0.09;
/** The bridge: the trunk tilts this many degrees up from lying flat, hips high, until shoulder, hip and knee are in one line. */
export const BRIDGE_TILT_DEGREES = 22;

/**
 * Glute bridge hold: side view, lying on a bed. Knees bent and feet flat on
 * the bed; the hips lift until the shoulder, hip and knee are in a straight
 * line (the thigh is in line with the trunk, no arch) and are held there. The
 * shoulders and feet stay on the bed.
 *
 *   Start (lying)               Hold (hips lifted to a straight line)
 *     head ~~~ hips   knees              hips
 *   ====bed=====\_/======             head~~/ \ knees ... line: shoulder-hip-knee
 */
function buildGluteBridgeHold(): Demo {
  const shoulderX = 0.5;
  const shoulderY = BED_HEIGHT + SHOULDER_ABOVE_BED;
  const spineLength = BODY.spine;

  /** A lying pose with the trunk tilted `tilt` degrees (hips up), designed with the pelvis as the anchor. */
  const lyingPose = (tilt: number): Pose => {
    const tiltRadians = (tilt * Math.PI) / 180;
    const pose = standing();
    pose.pelvis.pitch = -90 - tilt;
    pose.anchor = { joint: "pelvis", at: at(shoulderX + spineLength * Math.cos(tiltRadians), shoulderY + spineLength * Math.sin(tiltRadians), 0) };
    // The head rests on the bed: chin tucked by the same angle the trunk has tilted.
    pose.neck.flex = tilt;
    // Arms lie on the bed beside the body.
    pose.armLeft = { flex: -tilt, abduct: 10, rotate: 0, elbow: 0, wrist: 0 };
    pose.armRight = { flex: -tilt, abduct: 10, rotate: 0, elbow: 0, wrist: 0 };
    return pose;
  };

  // Hold pose: thigh in line with the trunk (hip angle 0); feet flat on the bed, x free.
  let bridge = lyingPose(BRIDGE_TILT_DEGREES);
  for (const side of ["Left", "Right"] as const) {
    bridge[limbOf("leg", side)] = { flex: 0, abduct: 0, knee: 110, ankle: -20 } as never;
    bridge = solveLimb(bridge, limbOf("leg", side), { [`heel${side}`]: { y: BED_HEIGHT }, [`toe${side}`]: { y: BED_HEIGHT } }, ["knee", "ankle"]);
  }
  const heelX = where(bridge, "heelRight").x;

  // Start pose: lying flat, the same feet in the same places.
  let lying = lyingPose(0);
  for (const side of ["Left", "Right"] as const) {
    const sign = side === "Left" ? 1 : -1;
    lying[limbOf("leg", side)] = { flex: 55, abduct: 0, knee: 100, ankle: 0 } as never;
    lying = solveLimb(lying, limbOf("leg", side), {
      [`heel${side}`]: at(heelX, BED_HEIGHT, sign * BODY.pelvisHalfWidth), [`toe${side}`]: at(heelX + FOOT_SPAN, BED_HEIGHT, sign * BODY.pelvisHalfWidth),
    }, ["flex", "knee", "ankle"]);
  }

  const lyingPlanted = reanchored(lying, "heelRight");
  const bridgePlanted = reanchored(bridge, "heelRight");

  return {
    exerciseId: "glute_bridge_hold",
    cue: "Lying with knees bent, lift your hips into a straight line and hold.",
    ariaLabel: "Glute bridge hold: lying on the bed with knees bent, then the hips lifted to a straight line from shoulders to knees and held",
    view: "side",
    framing: "body",
    moving: ["trunk", "thighLeft", "thighRight"],
    props: [{ kind: "bed", x: shoulderX - 0.42, height: BED_HEIGHT, length: 2.0 }],
    steps: [
      hold(lyingPlanted, START_HOLD_MS, "Start"),
      move(lyingPlanted, bridgePlanted, MOVE_MS, "Lift your hips"),
      hold(bridgePlanted, HOLD_EXERCISE_MS, "Hold"),
      move(bridgePlanted, lyingPlanted, MOVE_MS, "Lower slowly"),
    ],
  };
}

// ---------------------------------------------------------------------------
// 11. Pallof press hold
// ---------------------------------------------------------------------------

/**
 * Pallof press hold: three-quarter view. A band is anchored at chest height on
 * the door frame beside the figure (its left post) and held in both hands. The
 * hands start at the chest and press straight out in front; the body does not
 * turn (pelvis yaw and trunk stay as they are), which is the point of the exercise.
 */
function buildPallofPressHold(): Demo {
  const doorX = 0.32;
  const chestHeight = 1.25;
  const anchor = at(doorX, chestHeight, 0.46);

  /** Both hands together at (`handX`, chest height) on the midline, elbows relaxed. */
  const handsAt = (handX: number, guess: Partial<ArmAngles>): Pose => {
    let pose = standing();
    for (const side of ["Left", "Right"] as const) {
      const sign = side === "Left" ? 1 : -1;
      pose[limbOf("arm", side)] = { ...RELAXED_ARM, ...guess } as never;
      pose = solveLimb(pose, limbOf("arm", side), { [`hand${side}`]: at(handX, chestHeight, sign * 0.04) }, ["flex", "abduct", "elbow", "wrist"]);
    }
    return pose;
  };
  const atChest = handsAt(doorX - 0.02, { flex: 25, abduct: 15, elbow: 110 });
  const pressedOut = handsAt(0.05 + 0.62, { flex: 80, abduct: 3, elbow: 5 });

  return {
    exerciseId: "pallof_press_hold",
    cue: "Side-on to the door, push your hands straight out and hold. Don't turn.",
    ariaLabel: "Pallof press hold: hands at the chest holding a band anchored in the door beside you, then arms pushed straight out in front and held",
    view: "threeQuarter",
    framing: "body",
    moving: ["armLeft", "armRight", "forearmLeft", "forearmRight", "handLeft", "handRight"],
    props: [
      { kind: "doorFrame", x: doorX },
      { kind: "band", anchor, toJoints: ["handLeft", "handRight"] },
    ],
    steps: [
      hold(atChest, START_HOLD_MS, "Start"),
      move(atChest, pressedOut, MOVE_MS, "Push your hands straight out"),
      hold(pressedOut, HOLD_EXERCISE_MS, "Hold"),
      move(pressedOut, atChest, MOVE_MS, "Bring your hands back"),
    ],
  };
}

// ---------------------------------------------------------------------------
// 17. Sit-to-stand
// ---------------------------------------------------------------------------

/** How far the trunk tips forward from the hips when leaning to stand, in degrees (the plan's limit is 30). */
export const SIT_TO_STAND_LEAN_DEGREES = 25;

/**
 * Sit-to-stand from a chair with arms, first (most supported) stage: both
 * hands on the chair arms. Seated; lean forward from the hips with a straight
 * back (pelvis pitch, spine flex stays 0); stand; then sit down slowly by
 * the same route. The feet stay flat and planted throughout.
 *
 *   Start      lean forward     End (standing)
 *     o            o                o
 *    /|_          /|              /|\
 *   [chair]      [chair]  ->        |
 *
 * Each of "Stand up" and "Sit down slowly" is two moves (lean, then rise) so
 * the lean is seen before the body leaves the seat; together each is 2.5 s,
 * so the loop is 8 s.
 */
function buildSitToStand(): Demo {
  const heelX = 0.29;

  // Seated, designed with the pelvis on the seat: knees bent 90, feet flat under the knees.
  let seated = standing();
  seated.anchor = { joint: "pelvis", at: at(0, SEATED_PELVIS_Y, 0) };
  for (const side of ["Left", "Right"] as const) {
    seated = placeFoot(seated, side, { heel: at(heelX, 0, side === "Left" ? BODY.pelvisHalfWidth : -BODY.pelvisHalfWidth) }, 0, { flex: 80, knee: 90, ankle: 10 });
  }

  const chairFrontX = 0.30;
  const chair: Prop = { kind: "chair", x: chairFrontX, seatHeight: SEAT_HEIGHT, withArms: true };
  const armRestWristX = chairFrontX - 0.25;
  const armRestWristY = SEAT_HEIGHT + 0.22 + 0.035;

  /** Both hands on the chair arm rests, wherever the shoulders are. */
  const handsOnChairArms = (pose: Pose): Pose => {
    let result = pose;
    for (const side of ["Left", "Right"] as const) {
      const sign = side === "Left" ? 1 : -1;
      result = restHand(result, side, at(armRestWristX, armRestWristY, sign * 0.245), at(0.09, 0, 0), { flex: 15, abduct: 8, elbow: 70 });
    }
    return result;
  };

  seated = handsOnChairArms(seated);

  // Lean: the pelvis tips forward about the hips; the legs keep their place in the world.
  let leaning = copyPose(seated);
  leaning.pelvis.pitch = SIT_TO_STAND_LEAN_DEGREES;
  leaning.legLeft.flex += SIT_TO_STAND_LEAN_DEGREES;
  leaning.legRight.flex += SIT_TO_STAND_LEAN_DEGREES;
  leaning = handsOnChairArms(leaning);

  // Planted feet: pin the heel, and put the standing figure's heels at the same spot.
  const seatedPlanted = reanchored(seated, "heelRight");
  const leaningPlanted = reanchored(leaning, "heelRight");
  const heelAnchor = seatedPlanted.anchor.at;
  const upright = standing(heelAnchor);

  return {
    exerciseId: "sit_to_stand",
    cue: "Lean forward a little, push through your feet and stand, then sit down slowly.",
    ariaLabel: "Sit-to-stand: sitting with both hands on the chair arms, then leaning forward and standing up, then sitting down slowly",
    view: "side",
    framing: "body",
    moving: ["trunk", "thighLeft", "thighRight", "shinLeft", "shinRight", "armLeft", "armRight"],
    props: [chair],
    steps: [
      hold(seatedPlanted, START_HOLD_MS, "Start"),
      move(seatedPlanted, leaningPlanted, 1000, "Stand up"),
      move(leaningPlanted, upright, 1500, "Stand up"),
      hold(upright, END_HOLD_MS, "End"),
      move(upright, leaningPlanted, 1500, "Sit down slowly"),
      move(leaningPlanted, seatedPlanted, 1000, "Sit down slowly"),
    ],
  };
}

// ---------------------------------------------------------------------------
// 18. Heel and toe raises
// ---------------------------------------------------------------------------

/** How far the foot tilts for the toe and heel raises, in degrees (about 7 cm of heel or toe lift). */
const RAISE_FOOT_DEGREES = 20;

/**
 * Heel and toe raises: side view, both hands on the counter in front. Up onto
 * the toes, back to flat, back onto the heels (toes up), back to flat. The
 * planted point changes (toes, then heels), and a move must keep one anchor,
 * so the flat pose is used twice: once anchored on the toe and once on the heel,
 * at the identical place.
 */
function buildHeelToeRaises(): Demo {
  /** Legs straight with both feet tilted `footTilt` degrees about the ankle (0 flat, positive toes up). */
  const withFeetTilted = (footTilt: number, anchorJoint: JointName, anchorAt: Vec3): Pose => {
    const pose = standing();
    pose.anchor = { joint: anchorJoint, at: anchorAt };
    pose.legLeft = legAngles({ thigh: 0, knee: 0, foot: footTilt });
    pose.legRight = legAngles({ thigh: 0, knee: 0, foot: footTilt });
    return bothHandsOnFrontCounter(pose);
  };

  const flatOnHeel = withFeetTilted(0, "heelRight", at(0, 0, -BODY.pelvisHalfWidth));
  const flatOnToe = reanchored(flatOnHeel, "toeRight");
  const onToes = withFeetTilted(-RAISE_FOOT_DEGREES, "toeRight", where(flatOnHeel, "toeRight"));
  const onHeels = withFeetTilted(RAISE_FOOT_DEGREES, "heelRight", at(0, 0, -BODY.pelvisHalfWidth));

  return {
    exerciseId: "heel_toe_raises",
    cue: "Hold the counter, rise onto your toes, then rock back onto your heels.",
    ariaLabel: "Heel and toe raises: standing holding the counter, up onto the toes, back to flat, back onto the heels with the toes up, and back to flat",
    view: "side",
    framing: "body",
    moving: ["footLeft", "footRight"],
    props: [{ kind: "counter", x: FRONT_COUNTER_X, height: COUNTER_HEIGHT }],
    steps: [
      hold(flatOnHeel, START_HOLD_MS, "Start"),
      move(flatOnToe, onToes, MOVE_MS, "Rise onto your toes"),
      hold(onToes, END_HOLD_MS, "Up on your toes"),
      move(onToes, flatOnToe, MOVE_MS, "Lower down"),
      move(flatOnHeel, onHeels, MOVE_MS, "Rock back onto your heels"),
      hold(onHeels, END_HOLD_MS, "Up on your heels"),
      move(onHeels, flatOnHeel, MOVE_MS, "Lower down"),
    ],
  };
}

// ---------------------------------------------------------------------------
// 19. Side hip raise
// ---------------------------------------------------------------------------

/** How far the raised leg goes out to the side, in degrees (the plan's limit is 30). */
export const SIDE_HIP_RAISE_DEGREES = 28;

/** Puts the left hand flat on the counter beside the figure (on its left), level with the pelvis. */
function leftHandOnSideCounter(pose: Pose): Pose {
  return restHand(pose, "Left", at(where(pose, "pelvis").x, WRIST_ON_COUNTER_Y, 0.40), at(0.09, 0, 0), { flex: 5, abduct: 30, elbow: 50 });
}

/**
 * Side hip raise: front view, counter beside the figure on its left. The left
 * leg is the standing leg and the left hand rests on the counter; the right
 * leg lifts straight out to its own side (away from the counter, so the front
 * camera sees it). Trunk and pelvis stay level: no leaning.
 */
function buildSideHipRaise(): Demo {
  const down = standing(at(0, 0, BODY.pelvisHalfWidth));
  down.anchor = { joint: "heelLeft", at: at(0, 0, BODY.pelvisHalfWidth) };
  const start = leftHandOnSideCounter(down);
  start.armRight = { ...RELAXED_ARM, abduct: 8 };

  const raised = copyPose(start);
  raised.legRight = { flex: 0, abduct: SIDE_HIP_RAISE_DEGREES, knee: 0, ankle: 0 };

  return {
    exerciseId: "side_hip_raise",
    cue: "Hold the counter and lift one straight leg out to the side. Don't lean.",
    ariaLabel: "Side hip raise: standing with a hand on the counter, then one straight leg lifted out to the side without leaning",
    view: "front",
    framing: "body",
    moving: ["thighRight", "shinRight", "footRight"],
    props: [{ kind: "counter", x: 0.28, height: COUNTER_HEIGHT, side: "left" }],
    steps: [
      hold(start, START_HOLD_MS, "Start"),
      move(start, raised, MOVE_MS, "Lift the leg out to the side"),
      hold(raised, END_HOLD_MS, "End"),
      move(raised, start, MOVE_MS, "Lower, then the other side"),
    ],
  };
}

// ---------------------------------------------------------------------------
// 27. Standing bird dog
// ---------------------------------------------------------------------------

/** How far the whole trunk is tipped forward from the hips (flat back) to reach the counter, in degrees. */
const BIRD_DOG_LEAN_DEGREES = 25;

/**
 * Standing bird dog at the counter: side view. Both hands on the counter, the
 * trunk tipped forward from the hips with a flat back, hips level. The right
 * leg slides straight back with the toe on, or just off, the floor (never
 * above 5 cm), in line with the back; the left leg stays planted.
 */
function buildStandingBirdDog(): Demo {
  const lean = BIRD_DOG_LEAN_DEGREES;
  const base = standing(at(0, 0, BODY.pelvisHalfWidth));
  base.anchor = { joint: "heelLeft", at: at(0, 0, BODY.pelvisHalfWidth) };
  base.pelvis.pitch = lean;
  base.legLeft = legAngles({ thigh: 0, knee: 0, foot: 0 }, lean);
  base.legRight = legAngles({ thigh: 0, knee: 0, foot: 0 }, lean);

  /** Both hands on the counter, wrists a shoulder-width apart. */
  const handsOnCounter = (pose: Pose): Pose => {
    let result = pose;
    for (const side of ["Left", "Right"] as const) {
      const sign = side === "Left" ? 1 : -1;
      result = restHand(result, side, at(FRONT_COUNTER_X + 0.08, WRIST_ON_COUNTER_Y, sign * 0.17), at(0.09, 0, 0), { flex: 50, abduct: 5, elbow: 60 });
    }
    return result;
  };
  const start = handsOnCounter(base);

  // End: right leg straight, trailing behind, foot pointed; the swing angle puts the toe 2 cm off the floor.
  let slidBack = copyPose(start);
  slidBack.legRight = { flex: -4, abduct: 0, knee: 0, ankle: -16 };
  slidBack = solveLimb(slidBack, "legRight", { toeRight: { y: 0.02 } }, ["flex"]);
  // Halfway: the leg is straight and half way back, and the ankle is set so the toe stays 3 cm up, clear of the floor all the way.
  let halfway = copyPose(start);
  halfway.legRight = { flex: (slidBack.legRight.flex + start.legRight.flex) / 2, abduct: 0, knee: 0, ankle: -8 };
  halfway = solveLimb(halfway, "legRight", { toeRight: { y: 0.03 } }, ["ankle"]);

  return {
    exerciseId: "standing_bird_dog",
    cue: "Hands on the counter, slide one leg straight back and hold. Keep your back flat.",
    ariaLabel: "Standing bird dog: both hands on the counter, then one leg slid straight back with the toes just off the floor and the back flat",
    view: "side",
    framing: "body",
    moving: ["thighRight", "shinRight", "footRight"],
    props: [{ kind: "counter", x: FRONT_COUNTER_X, height: COUNTER_HEIGHT }],
    steps: [
      hold(start, START_HOLD_MS, "Start"),
      move(start, halfway, MOVE_MS / 2, "Slide one leg straight back"),
      move(halfway, slidBack, MOVE_MS / 2, "Slide one leg straight back"),
      hold(slidBack, HOLD_EXERCISE_MS, "Hold"),
      move(slidBack, halfway, MOVE_MS / 2, "Foot back in, then the other side"),
      move(halfway, start, MOVE_MS / 2, "Foot back in, then the other side"),
    ],
  };
}

// ---------------------------------------------------------------------------
// 31 and 34. Walking
// ---------------------------------------------------------------------------

/**
 * Where one foot is at one instant of the walking step, relative to the
 * pelvis: its heel (x forward, height) and its tilt (0 flat, positive toes up,
 * negative toes down). The toe follows from the tilt.
 */
type FootInWalk = { heelX: number; heelY: number; tilt: number };

/** A pose of the walking step: pelvis height and both feet. */
type WalkSpec = { pelvisHeight: number; left: FootInWalk; right: FootInWalk; armSwingDegrees: number };

/** Halfway between two foot placements. */
function midFoot(a: FootInWalk, b: FootInWalk): FootInWalk {
  return { heelX: (a.heelX + b.heelX) / 2, heelY: (a.heelY + b.heelY) / 2, tilt: (a.tilt + b.tilt) / 2 };
}

/** Halfway between two walking poses (the pelvis stays at the higher of the two, because the push-off raises the ankle before the body drops); used so a foot pushing off the floor lifts its heel instead of scraping through the floor. */
function midWalk(a: WalkSpec, b: WalkSpec): WalkSpec {
  return {
    pelvisHeight: Math.max(a.pelvisHeight, b.pelvisHeight),
    left: midFoot(a.left, b.left),
    right: midFoot(a.right, b.right),
    armSwingDegrees: (a.armSwingDegrees + b.armSwingDegrees) / 2,
  };
}

/**
 * Builds one walking pose. It is designed with the pelvis as the anchor (the
 * figure walks on the spot, so the feet slide back under it like a treadmill
 * and the loop is seamless); the feet are fitted to their wanted places. The
 * right arm swings forward by `armSwingDegrees` and the left back (negative
 * for the other way), a little, with the elbows slightly bent.
 */
function walkPose(spec: WalkSpec): Pose {
  let pose = standing();
  pose.anchor = { joint: "pelvis", at: at(0, spec.pelvisHeight, 0) };

  const feet: Array<[Side, FootInWalk]> = [["Left", spec.left], ["Right", spec.right]];
  for (const [side, foot] of feet) {
    const z = side === "Left" ? BODY.pelvisHalfWidth : -BODY.pelvisHalfWidth;
    pose = placeFoot(pose, side, { heel: at(foot.heelX, foot.heelY, z) }, foot.tilt, { abduct: 0, flex: 0, knee: 15, ankle: 0 });
  }

  pose.armRight = { ...RELAXED_ARM, flex: spec.armSwingDegrees, elbow: 15 };
  pose.armLeft = { ...RELAXED_ARM, flex: -spec.armSwingDegrees, elbow: 15 };
  return pose;
}

/** Foot placements of the walking step (metres relative to the pelvis, degrees). */
const WALK_FRONT: FootInWalk = { heelX: 0.18, heelY: 0, tilt: 15 };
/** The back foot is pushing off: toe on the floor, heel raised (toe x = -0.16). */
const WALK_BACK: FootInWalk = { heelX: -0.16 - FOOT_SPAN * Math.cos((35 * Math.PI) / 180), heelY: FOOT_SPAN * Math.sin((35 * Math.PI) / 180), tilt: -35 };
const WALK_STANCE: FootInWalk = { heelX: -0.05, heelY: 0.012, tilt: -3 };
const WALK_SWING: FootInWalk = { heelX: -0.08, heelY: 0.17, tilt: -15 };

/**
 * Builds a walking demo: side view, two steps. Start holds in the "left foot
 * forward" pose; then each step is three moves (the body comes over the front
 * foot, the back foot pushes off, the other foot lands), and the second step
 * mirrors the first, ending back at the starting pose. `moveMs` is the time
 * of each of the six moves: longer for the slow walk.
 *
 *   leftForward -> leftStance -> leftPushOff -> rightForward -> rightStance -> rightPushOff -> (leftForward)
 */
function buildWalking(exerciseId: string, cue: string, ariaLabel: string, moveMs: number): Demo {
  const leftForward: WalkSpec = { pelvisHeight: 0.87, left: WALK_FRONT, right: WALK_BACK, armSwingDegrees: 18 };
  const leftStance: WalkSpec = { pelvisHeight: 0.89, left: WALK_STANCE, right: WALK_SWING, armSwingDegrees: 4 };
  const rightForward: WalkSpec = { pelvisHeight: 0.87, left: WALK_BACK, right: WALK_FRONT, armSwingDegrees: -18 };
  const rightStance: WalkSpec = { pelvisHeight: 0.89, left: WALK_SWING, right: WALK_STANCE, armSwingDegrees: -4 };

  const poses = [
    walkPose(leftForward),
    walkPose(leftStance),
    walkPose(midWalk(leftStance, rightForward)),
    walkPose(rightForward),
    walkPose(rightStance),
    walkPose(midWalk(rightStance, leftForward)),
  ] as const;
  const labels = ["Step", "Step", "Step", "Step again", "Step again", "Step again"];

  const moves = poses.map((from, index) => move(from, poses[(index + 1) % poses.length]!, moveMs, labels[index]!));

  return {
    exerciseId,
    cue,
    ariaLabel,
    view: "side",
    framing: "body",
    moving: ["thighLeft", "thighRight", "shinLeft", "shinRight", "footLeft", "footRight"],
    props: [],
    steps: [hold(poses[0], START_HOLD_MS, "Start"), ...moves],
  };
}

// ---------------------------------------------------------------------------
// 32. Calf stretch
// ---------------------------------------------------------------------------

/**
 * Calf stretch at the wall: side view. Hands on the wall at shoulder height.
 * The right foot goes back with the heel down and the leg straight, the left
 * knee bends a little, and the whole body leans gently in as one straight line
 * (a lean of 18 degrees, no more). The move into the stretch is as slow as any other.
 */
function buildCalfStretch(): Demo {
  const wallSurfaceX = 0.80;

  /** A body leaning `lean` degrees as a straight line from the back heel, hands on the wall. */
  const leaningPose = (lean: number): Pose => {
    const pose = standing();
    pose.pelvis.pitch = lean;
    pose.legRight = legAngles({ thigh: -lean, knee: 0, foot: 0 }, lean);
    pose.legLeft = legAngles({ thigh: -lean, knee: 0, foot: 0 }, lean);
    return pose;
  };

  /** Both hands flat on the wall at shoulder height, fingers up. */
  const handsOnWall = (pose: Pose): Pose => {
    let result = pose;
    const shoulderHeight = where(pose, "shoulderRight").y;
    for (const side of ["Left", "Right"] as const) {
      const sign = side === "Left" ? 1 : -1;
      result = restHand(result, side, at(wallSurfaceX - 0.03, shoulderHeight, sign * 0.18), at(0, 0.09, 0), { flex: 60, abduct: 5, elbow: 40 });
    }
    return result;
  };

  const start = handsOnWall(leaningPose(8));

  let stretch = leaningPose(18);
  stretch = placeFoot(stretch, "Left", { heel: at(0.38, 0, BODY.pelvisHalfWidth) }, 0, { flex: 15, knee: 25, ankle: 0 });
  stretch = handsOnWall(stretch);
  // The front foot is lifted a little halfway, so it clears the floor as it steps forward.
  const halfway = halfwayWithToeLifted(start, stretch, "Left", 0.06, 0.06);

  return {
    exerciseId: "calf_stretch",
    cue: "Hands on the wall, one foot back with the heel down, lean in gently and hold.",
    ariaLabel: "Calf stretch: hands on the wall, then one foot back with the heel down and the body leaning in gently, held",
    view: "side",
    framing: "body",
    moving: ["thighRight", "shinRight", "footRight"],
    props: [{ kind: "wall", x: wallSurfaceX + 0.06 }],
    steps: [
      hold(start, START_HOLD_MS, "Start"),
      move(start, halfway, MOVE_MS / 2, "Foot back, lean in gently"),
      move(halfway, stretch, MOVE_MS / 2, "Foot back, lean in gently"),
      hold(stretch, HOLD_EXERCISE_MS, "Hold"),
      move(stretch, halfway, MOVE_MS / 2, "Back up, then the other side"),
      move(halfway, start, MOVE_MS / 2, "Back up, then the other side"),
    ],
  };
}

// ---------------------------------------------------------------------------
// 33. Doorway chest stretch
// ---------------------------------------------------------------------------

/**
 * Doorway chest stretch: side view. The right forearm is up on the door frame
 * with the upper arm about horizontal and the elbow about 90 degrees; the
 * figure steps forward gently with the left foot and lets its weight move
 * forward, so the arm, held on the frame, is drawn back. The trunk stays
 * upright: no arching.
 */
function buildDoorwayChestStretch(): Demo {
  const doorX = 0.05;
  const elbowSide = 0.37;
  const pelvisSide = -0.08;
  /** The figure starts this far behind the frame so the near post does not hide it, with the upper arm angled a little forward. */
  const startHeelX = -0.18;

  /** The left forearm up the post (the far post from the camera, so it never hides the figure): elbow, wrist and fingertips on one vertical line at shoulder height and above. */
  const forearmOnFrame = (pose: Pose): Pose => {
    const shoulderHeight = where(pose, "shoulderLeft").y;
    const start = copyPose(pose);
    start.armLeft = { flex: 0, abduct: 85, rotate: 80, elbow: 90, wrist: 0 };
    return solveLimb(start, "armLeft", {
      elbowLeft: at(doorX, shoulderHeight, elbowSide),
      wristLeft: at(doorX, shoulderHeight + BODY.forearm, elbowSide),
      handLeft: at(doorX, shoulderHeight + BODY.forearm + BODY.hand, elbowSide),
    }, ["flex", "abduct", "rotate", "elbow", "wrist"]);
  };

  const anchorAt = at(startHeelX, 0, pelvisSide - BODY.pelvisHalfWidth);
  const start = forearmOnFrame(standing(anchorAt));

  // Step forward: weight moves forward over the right foot (leg leans 9 degrees) and the left foot steps ahead.
  let stepped = standing(anchorAt);
  stepped.legRight = legAngles({ thigh: -9, knee: 0, foot: 0 });
  stepped = placeFoot(stepped, "Left", { heel: at(startHeelX + 0.30, 0, pelvisSide + BODY.pelvisHalfWidth) }, 0, { flex: 15, knee: 15, ankle: 0 });
  stepped = forearmOnFrame(stepped);

  return {
    exerciseId: "doorway_chest_stretch",
    cue: "Forearm on the door frame, step forward gently until you feel a stretch, and hold.",
    ariaLabel: "Doorway chest stretch: forearm up on the door frame, then a gentle step forward, held",
    view: "side",
    framing: "body",
    moving: ["armLeft", "forearmLeft", "thighLeft", "shinLeft", "footLeft"],
    props: [{ kind: "doorFrame", x: doorX }],
    steps: [
      hold(start, START_HOLD_MS, "Start"),
      move(start, stepped, MOVE_MS, "Step forward gently"),
      hold(stepped, HOLD_EXERCISE_MS, "Hold"),
      move(stepped, start, MOVE_MS, "Step back, then the other side"),
    ],
  };
}

/** Every Steady Strength demo built so far, keyed by exercise id. */
export const steadyStrengthDemos: Record<string, Demo> = {
  head_turns: buildHeadTurns(),
  neck_retraction: buildNeckRetraction(),
  standing_back_extension: buildStandingBackExtension(),
  ankle_pumps: buildAnklePumps(),
  single_leg_stand: buildSingleLegStand(),
  heel_to_toe_stand: buildHeelToToeStand(),
  sideways_walking: buildSidewaysWalking(),
  high_wall_sit: buildHighWallSit(),
  glute_bridge_hold: buildGluteBridgeHold(),
  pallof_press_hold: buildPallofPressHold(),
  sit_to_stand: buildSitToStand(),
  heel_toe_raises: buildHeelToeRaises(),
  side_hip_raise: buildSideHipRaise(),
  standing_bird_dog: buildStandingBirdDog(),
  slow_walk: buildWalking("slow_walk", "Walk slowly for a few minutes.", "Slow walk: a slow walking step, left foot forward, then two unhurried steps, repeating", 800),
  calf_stretch: buildCalfStretch(),
  doorway_chest_stretch: buildDoorwayChestStretch(),
  comfortable_walk: buildWalking("comfortable_walk", "Walk at a pace where you can still talk.", "Walk at a comfortable pace: a walking step at a normal pace, two steps, repeating", 450),
};
