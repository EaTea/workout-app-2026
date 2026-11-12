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
    views: ["side", "threeQuarter", "front"],
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
    views: ["front", "threeQuarter"],
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
    views: ["side", "threeQuarter"],
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
    views: ["side", "threeQuarter"],
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

/** How far the foot is tilted up from the floor (in the world) in each ankle-pump pose, in degrees. Pointed is 3 degrees so the toes stay clear of the floor. */
const ANKLE_PUMP_TILTS = { relaxed: 25, toesUp: 47, toesPointed: 3 } as const;

/**
 * Ankle pumps: side view, close up on the right foot. The figure sits on a
 * chair with the right leg stretched out in front and the HEEL RESTING ON
 * THE FLOOR; only the ankle moves, tilting the foot toes up, then toes
 * pointed. The shin slopes well forward (knee fairly straight, the foot
 * about 25 degrees up when relaxed), so even a pointed foot keeps its toes
 * above the floor instead of going through it. The leg's hip angle is
 * re-fitted for each foot tilt (a degree or two) so the heel stays on the
 * floor as the foot pivots about it. The other foot rests flat on the floor.
 */
function buildAnklePumps(): Demo {
  const pose = neutralStandingPose();
  pose.anchor = { joint: "pelvis", at: at(0, SEATED_PELVIS_Y, 0) };
  pose.armLeft = { ...RELAXED_ARM };
  pose.armRight = { ...RELAXED_ARM };

  // Resting foot: flat on the floor under the knee.
  const seated = placeFoot(pose, "Left", { heel: at(0.30, 0, BODY.pelvisHalfWidth) }, 0, { flex: 80, knee: 90, ankle: 10 });

  // Pumping leg: thigh a little below horizontal along the seat, knee bent about 50 degrees, heel on the floor.
  seated.legRight = { flex: 75, abduct: 0, knee: 50, ankle: 0 };

  /** The seated pose with the right foot tilted `footTilt` degrees in the world (0 = flat, positive = toes up) and the hip angle fitted to keep the heel on the floor. */
  const withFootTilt = (footTilt: number): Pose => {
    const copy = copyPose(seated);
    copy.legRight.ankle = footTilt - copy.legRight.flex + copy.legRight.knee;
    // Fit the hip angle only: a tilted foot moves its heel, and the hip swing brings it back down onto the floor.
    const fitted = solveLimb(copy, "legRight", { heelRight: { y: 0 } }, ["flex"]);
    // Keep the foot's world tilt as asked after the hip angle changed.
    fitted.legRight.ankle = footTilt - fitted.legRight.flex + fitted.legRight.knee;
    return solveLimb(fitted, "legRight", { heelRight: { y: 0 } }, ["flex"]);
  };
  const flat = withFootTilt(ANKLE_PUMP_TILTS.relaxed);
  const toesUp = withFootTilt(ANKLE_PUMP_TILTS.toesUp);
  const toesPointed = withFootTilt(ANKLE_PUMP_TILTS.toesPointed);

  // Hands rest on the thighs, just above where each thigh is.
  let withHands = flat;
  for (const side of ["Left", "Right"] as const) {
    const sign = side === "Left" ? 1 : -1;
    const hip = where(withHands, `hip${side}`);
    const knee = where(withHands, `knee${side}`);
    const onThigh = at(hip.x + 0.2, hip.y + (knee.y - hip.y) * (0.2 / (knee.x - hip.x)) + 0.09, sign * 0.12);
    withHands[limbOf("arm", side)] = { flex: 35, abduct: 5, rotate: 0, elbow: 55, wrist: 0 } as never;
    withHands = solveLimb(withHands, limbOf("arm", side), { [`hand${side}`]: onThigh }, ["flex", "abduct", "elbow", "wrist"]);
  }
  for (const target of [flat, toesUp, toesPointed]) {
    target.armLeft = { ...withHands.armLeft };
    target.armRight = { ...withHands.armRight };
  }

  return {
    exerciseId: "ankle_pumps",
    cue: "Sitting, pull your toes up, then point them.",
    ariaLabel: "Ankle pumps: sitting with the heel on the floor and the foot relaxed, then the toes pulled up, then the toes pointed",
    views: ["side", "threeQuarter"],
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
    views: ["threeQuarter", "front", "side"],
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
 * Heel-to-toe stand: side view, counter beside the figure on its left (the
 * far side, so it never hides the feet, and the line of feet never runs
 * under it). The left hand holds the counter. Start with the feet side by
 * side; end with the left foot stepped in front so its heel touches the right
 * toe, feet in one line, weight shared between them.
 *
 * The stepping foot must not slide through the standing one, so it goes round
 * in two moves (seen from above, the right foot is planted at z = -0.09):
 *
 *   1 weight over the right foot, left foot lifted and swung forward past the right toe
 *   2 left foot comes back a little, across in line, and down heel to toe
 *
 *     start        after move 1      end
 *     L R            R  L(up)        R L
 */
function buildHeelToToeStand(): Demo {
  const apart = leftHandOnSideCounter(standing());
  apart.armRight = { ...RELAXED_ARM, abduct: 8 };

  // End: weight moves over the line of the feet, so the pelvis sits above the line (z = -0.09).
  let together = standing();
  together.legRight = { flex: 0, abduct: -6.3, knee: 0, ankle: 0 };
  together = solveLimb(together, "legRight", { pelvis: { x: 0.16, y: 0.88 }, toeRight: { y: 0 } }, ["flex", "knee", "ankle"]);
  const rightToe = where(together, "toeRight");
  together = placeFoot(together, "Left", { heel: at(rightToe.x + 0.005, 0, -BODY.pelvisHalfWidth) }, 0, { flex: 20, abduct: -6, knee: 5, ankle: 15 });
  together = leftHandOnSideCounter(together);
  together.armRight = { ...RELAXED_ARM, abduct: 8 };

  // Halfway: weight already over the right foot, the left foot flat in the air 6 cm up, 12 cm past the right toe and still on its own side of the line.
  let swung = standing();
  swung.legRight = { flex: 0, abduct: -6.3, knee: 0, ankle: 0 };
  swung = solveLimb(swung, "legRight", { pelvis: { x: 0.12, y: 0.88 }, toeRight: { y: 0 } }, ["flex", "knee", "ankle"]);
  swung = placeFoot(swung, "Left", { heel: at(rightToe.x + 0.12, 0.06, 0.04) }, 0, { flex: 25, abduct: 0, knee: 10, ankle: 15 });
  swung = leftHandOnSideCounter(swung);
  swung.armRight = { ...RELAXED_ARM, abduct: 8 };

  return {
    exerciseId: "heel_to_toe_stand",
    cue: "Hold the counter, put one foot right in front of the other and stand still.",
    ariaLabel: "Heel-to-toe stand: feet side by side holding the counter, then one foot lifted and placed in front of the other with the heel touching the toe",
    views: ["side", "threeQuarter"],
    framing: "body",
    moving: ["thighLeft", "shinLeft", "footLeft"],
    props: [{ kind: "counter", x: 0.28, height: COUNTER_HEIGHT, side: "left" }],
    steps: [
      hold(apart, START_HOLD_MS, "Start"),
      move(apart, swung, MOVE_MS / 2, "Put one foot in front"),
      move(swung, together, MOVE_MS / 2, "Put one foot in front"),
      hold(together, HOLD_EXERCISE_MS, "Hold"),
      move(together, swung, MOVE_MS / 2, "Feet apart, then the other side"),
      move(swung, apart, MOVE_MS / 2, "Feet apart, then the other side"),
    ],
  };
}

// ---------------------------------------------------------------------------
// 8. Sideways walking
// ---------------------------------------------------------------------------

/**
 * Sideways walking along the counter: front camera angle. The figure faces
 * AWAY from the camera (yaw 180) towards a counter in front of it, because a counter
 * between the camera and the figure would hide the legs. It steps sideways
 * to its left twice (left foot out, right foot in, then again) and then back
 * to the right twice by exactly the reverse route, so the last pose is the
 * first and the loop is seamless, showing both directions. The feet never cross.
 *
 *   camera ──▶   [figure, seen from behind]   ──▶   [counter]
 *   figure's left = viewer's left
 *
 *   Start   step 1     step 2     step 3     step 4 (= Start)
 *    L R    L-> R->     L-> R->    <-R <-L    <-R <-L
 */
function buildSidewaysWalking(): Demo {
  /** Pelvis x: the figure faces -x, so the counter is at lower x. */
  const pelvisX = 0.0;
  const sideStepMetres = 0.18;
  const hipHalf = BODY.pelvisHalfWidth;

  /**
   * One pose of the side-step, designed with the pelvis as the anchor.
   * `pelvisSide` is how far the pelvis is to the figure's left; each foot has
   * its own `side` (also to the left) and `lift` off the floor. The figure's
   * left is world -z (it faces -x). The caller pins the pose by the planted
   * heel with `reanchored` before using it in a move.
   */
  const sidewaysPose = (
    pelvisSide: number, pelvisHeight: number,
    leftFoot: { side: number; lift: number }, rightFoot: { side: number; lift: number },
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
    return restHand(pose, "Left", at(pelvisX - 0.27, WRIST_ON_COUNTER_Y, -(pelvisSide + 0.18)), at(-0.09, 0, 0), { flex: 35, abduct: 5, elbow: 45 });
  };

  /** The poses of one outward step starting with the body `shift` metres to the left: left foot half way out, left foot out, right foot half way in, right foot in. */
  const outwardStepPoses = (shift: number) => ({
    leftHalfOut: sidewaysPose(shift, 0.885, { side: hipHalf + shift + sideStepMetres / 2, lift: 0.04 }, { side: -hipHalf + shift, lift: 0 }),
    leftOut: sidewaysPose(shift, 0.875, { side: hipHalf + shift + sideStepMetres, lift: 0 }, { side: -hipHalf + shift, lift: 0 }),
    rightHalfIn: sidewaysPose(shift + sideStepMetres / 2, 0.885, { side: hipHalf + shift + sideStepMetres, lift: 0 }, { side: -hipHalf + shift + sideStepMetres / 2, lift: 0.04 }),
    together: sidewaysPose(shift + sideStepMetres, 0.9, { side: hipHalf + shift + sideStepMetres, lift: 0 }, { side: -hipHalf + shift + sideStepMetres, lift: 0 }),
  });

  const start = sidewaysPose(0, 0.9, { side: hipHalf, lift: 0 }, { side: -hipHalf, lift: 0 });
  const first = outwardStepPoses(0);
  const second = outwardStepPoses(sideStepMetres);

  /** A move in which `plantedHeel` stays put: both ends are pinned by that heel. */
  const stepMove = (from: Pose, to: Pose, plantedHeel: "heelLeft" | "heelRight", label: string): Step =>
    move(reanchored(from, plantedHeel), reanchored(to, plantedHeel), 400, label);

  // One outward step is four moves (left foot out in two, right foot in in two).
  const outwardMoves = (from: Pose, poses: ReturnType<typeof outwardStepPoses>): Step[] => [
    stepMove(from, poses.leftHalfOut, "heelRight", "Step sideways"),
    stepMove(poses.leftHalfOut, poses.leftOut, "heelRight", "Step sideways"),
    stepMove(poses.leftOut, poses.rightHalfIn, "heelLeft", "Bring the other foot in"),
    stepMove(poses.rightHalfIn, poses.together, "heelLeft", "Bring the other foot in"),
  ];
  const outward = [...outwardMoves(start, first), ...outwardMoves(first.together, second)];

  // Coming back is the same moves played backwards, so the loop ends exactly where it began.
  const backward: Step[] = [...outward].reverse().map((step) => {
    if (step.kind !== "move") throw new Error("expected only moves");
    return { ...step, from: step.to, to: step.from, label: step.label === "Step sideways" ? "Bring the foot back in" : "Step back sideways" };
  });

  return {
    exerciseId: "sideways_walking",
    cue: "One hand on the counter, step sideways and don't cross your feet.",
    ariaLabel: "Sideways walking: standing with a hand on the counter, two side steps along it one way and two back the other way, the feet never crossing",
    views: ["front"],
    framing: "body",
    moving: ["thighLeft", "thighRight", "shinLeft", "shinRight", "footLeft", "footRight"],
    props: [{ kind: "counter", x: pelvisX - 0.85, height: COUNTER_HEIGHT }],
    steps: [hold(reanchored(start, "heelRight"), START_HOLD_MS, "Start"), ...outward, ...backward],
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
    views: ["side"],
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
 * Pallof press hold: three-quarter view. The figure stands SIDE-ON to the
 * door: the band is anchored at chest height on the door at the figure's
 * left, so it runs sideways across the body, and the hands press straight
 * forward, parallel to the door. The body does not turn (pelvis yaw and
 * trunk stay as they are), which is the point of the exercise: the band
 * tries to twist the body towards the door and the figure resists it.
 *
 *        door ─────────────●anchor (left of the figure, chest height)
 *                           ╲  band
 *                            ╲
 *                  figure ───●═══▶  hands press forward (+x), parallel to the door
 *
 * Only the band anchor is drawn: the door frame prop stands across the
 * figure's front (in the plane x), so it cannot be placed along the figure's
 * side. A door-edge prop parallel to the figure would need a new Prop kind.
 */
function buildPallofPressHold(): Demo {
  const chestHeight = 1.25;
  /** The anchor is level with the chest (x = 0 is the chest) and 0.8 m out to the figure's left. */
  const anchor = at(0, chestHeight, 0.8);

  /** Both hands together at (`handX`, chest height) on the midline, elbows relaxed. */
  const handsAt = (handX: number, guess: Partial<ArmAngles>): Pose => {
    let pose = standing();
    for (const side of ["Left", "Right"] as const) {
      const sign = side === "Left" ? 1 : -1;
      pose[limbOf("arm", side)] = { ...RELAXED_ARM, ...guess } as never;
      pose = solveLimb(pose, limbOf("arm", side), { [`hand${side}`]: at(handX, chestHeight, sign * 0.04) }, ["flex", "abduct", "rotate", "elbow", "wrist"]);
    }
    return pose;
  };
  // Blending joint angles straight between the chest and the full press would swing the hands apart on the way (they bulge
  // sideways by 7 cm), so the press goes through waypoints with the hands re-fitted to the midline each time.
  const chestGuess = { flex: 40, abduct: 0, rotate: -40, elbow: 110 };
  const pressedGuess = { flex: 80, abduct: -12, rotate: 0, elbow: 5 };
  const chestHandX = 0.28;
  const pressedHandX = 0.05 + 0.62;
  const pressPoses = [0, 0.25, 0.5, 0.75, 1].map((fraction) => {
    const mix = (from: number, to: number) => from + (to - from) * fraction;
    return handsAt(mix(chestHandX, pressedHandX), {
      flex: mix(chestGuess.flex, pressedGuess.flex),
      abduct: mix(chestGuess.abduct, pressedGuess.abduct),
      rotate: mix(chestGuess.rotate, pressedGuess.rotate),
      elbow: mix(chestGuess.elbow, pressedGuess.elbow),
    });
  });
  const atChest = pressPoses[0]!;
  const pressedOut = pressPoses[4]!;
  /** The press (or the return) as four equal moves through the waypoints. */
  const pressMoves = (poses: Pose[], label: string): Step[] =>
    poses.slice(1).map((to, index) => move(poses[index]!, to, MOVE_MS / 4, label));

  return {
    exerciseId: "pallof_press_hold",
    cue: "Side-on to the door, push your hands straight out and hold. Don't turn.",
    ariaLabel: "Pallof press hold: standing side-on to the door with a band anchored beside you, hands at the chest, then arms pushed straight out in front, parallel to the door, and held",
    views: ["threeQuarter", "front"],
    framing: "body",
    moving: ["armLeft", "armRight", "forearmLeft", "forearmRight", "handLeft", "handRight"],
    props: [{ kind: "band", anchor, toJoints: ["handLeft", "handRight"] }],
    steps: [
      hold(atChest, START_HOLD_MS, "Start"),
      ...pressMoves(pressPoses, "Push your hands straight out"),
      hold(pressedOut, HOLD_EXERCISE_MS, "Hold"),
      ...pressMoves([...pressPoses].reverse(), "Bring your hands back"),
    ],
  };
}

// ---------------------------------------------------------------------------
// 17. Sit-to-stand
// ---------------------------------------------------------------------------

/** How far the trunk tips forward from the hips when leaning to stand, in degrees (the plan's limit is 30). */
export const SIT_TO_STAND_LEAN_DEGREES = 28;

/** Heel x of the planted feet in the sit-to-stand: tucked back under the knees so the weight can get over them (0.13 m; the first version had 0.29 and the body fell back into the chair). */
const SIT_TO_STAND_HEEL_X = 0.13;

/**
 * Sit-to-stand from a chair with arms, first (most supported) stage. The
 * order matters for safety: the weight has to be over the feet BEFORE the
 * hips leave the seat, and the hands stay on the chair arms until it is.
 *
 *   1 lean         2 lift, lean held     3 rise, hands let go     4 straighten
 *     o                  o                       o                    o
 *    /|__              /|                      /|                    |
 *   [seat] feet       [seat]  feet            feet under hips      feet   (End)
 *   tucked back       (hands on arms)         (hands free)
 *
 * Seated with the feet tucked a little behind the knees; lean forward from
 * the hips with a straight back (pelvis pitch, spine flex stays 0); lift
 * with the lean held; let go of the arms; straighten. Sitting down mirrors
 * it: lean, reach back for the arms, lower slowly, sit tall. The feet stay
 * flat and planted throughout. Each of "Stand up" and "Sit down slowly" is
 * four moves, 2.5 s in all, so the loop is 8 s. The test balance check uses
 * balance.ts (centre of mass over the feet whenever the hips are off the seat
 * and the hands are not on the arms).
 */
function buildSitToStand(): Demo {
  const lean = SIT_TO_STAND_LEAN_DEGREES;
  const heelX = SIT_TO_STAND_HEEL_X;
  const hipHalf = BODY.pelvisHalfWidth;

  // The figure sits near the front edge of the seat (the usual advice before standing), so that when it stands the
  // shins are in front of the chair rather than inside it.
  const chairFrontX = 0.12;
  const chair: Prop = { kind: "chair", x: chairFrontX, seatHeight: SEAT_HEIGHT, withArms: true };
  /** The fingertips grip the front end of the arm rest (which stops 4 cm short of the seat edge), where the leaning shoulders can reach. */
  const armRestFingertipX = chairFrontX - 0.05;
  const armRestWristY = SEAT_HEIGHT + 0.22 + 0.035;

  /** Both hands on the chair arm rests, wherever the shoulders are. */
  const handsOnChairArms = (pose: Pose): Pose => {
    let result = pose;
    for (const side of ["Left", "Right"] as const) {
      const sign = side === "Left" ? 1 : -1;
      // The upper arm hangs about straight down in the world, so relative to a leaning trunk it swings back by the lean.
      // Only the fingertips are pinned to the arm rest: with the trunk leaning, a flat hand would need the wrist bent past its limit.
      const limb = limbOf("arm", side);
      const start = copyPose(result);
      start[limb] = { ...start[limb], flex: 15 - pose.pelvis.pitch, abduct: 8, elbow: 70 } as never;
      result = solveLimb(start, limb, { [`hand${side}`]: at(armRestFingertipX, armRestWristY + 0.005, sign * 0.245) }, ["flex", "abduct", "elbow", "wrist"]);
    }
    return result;
  };

  /**
   * The figure with the trunk tipped `trunkLean` degrees forward from the hips
   * (straight back: only the pelvis pitches), the pelvis at (`pelvisX`,
   * `pelvisY`) and both feet flat on the floor at the tucked heel position.
   * Designed with the pelvis as anchor, then pinned by the right heel.
   */
  const withPelvisAt = (trunkLean: number, pelvisX: number, pelvisY: number): Pose => {
    let pose = standing();
    pose.pelvis.pitch = trunkLean;
    pose.anchor = { joint: "pelvis", at: at(pelvisX, pelvisY, 0) };
    for (const side of ["Left", "Right"] as const) {
      const sign = side === "Left" ? 1 : -1;
      pose = placeFoot(pose, side, { heel: at(heelX, 0, sign * hipHalf) }, 0, { flex: 80 + trunkLean, knee: 90, ankle: 10 });
    }
    // Pin the right heel exactly on the floor spot so every pose shares the same planted foot.
    pose.anchor = { joint: "heelRight", at: at(heelX, 0, -hipHalf) };
    return pose;
  };

  // The pelvis x at each stage: on the seat, then moving forward over the feet as the hips rise.
  const seatedUpright = handsOnChairArms(withPelvisAt(0, 0, SEATED_PELVIS_Y));
  const seatedLeaning = handsOnChairArms(withPelvisAt(lean, 0, SEATED_PELVIS_Y));
  const hipsClearlyUp = handsOnChairArms(withPelvisAt(lean, 0.08, 0.72));

  // Risen with the lean held and the hands let go: arms hang forward from the leaning shoulders.
  const risenLeaning = standing(at(heelX, 0, -hipHalf));
  risenLeaning.pelvis.pitch = lean;
  risenLeaning.legLeft = legAngles({ thigh: 0, knee: 0, foot: 0 }, lean);
  risenLeaning.legRight = legAngles({ thigh: 0, knee: 0, foot: 0 }, lean);
  risenLeaning.armLeft = { ...RELAXED_ARM, flex: -lean + 20 };
  risenLeaning.armRight = { ...RELAXED_ARM, flex: -lean + 20 };
  const upright = standing(at(heelX, 0, -hipHalf));

  // The hands must stay ON the arm rests through the lean and the first lift, but blending joint angles straight between two such
  // poses lets a hand sink a few centimetres into the arm on the way, so each of those moves goes through a halfway pose re-fitted to the arms.
  const leaningHalfway = handsOnChairArms(blendPoses(seatedUpright, seatedLeaning, 0.5));
  const liftingHalfway = handsOnChairArms(blendPoses(seatedLeaning, hipsClearlyUp, 0.5));

  /** The poses from sitting upright to standing upright, in order; sitting down plays them backwards. */
  const route = [seatedUpright, leaningHalfway, seatedLeaning, liftingHalfway, hipsClearlyUp, risenLeaning, upright];
  /** How long each move of the route takes going up (ms); they add up to 2500. Going down the same times are used. */
  const routeMs = [350, 350, 300, 300, 600, 600];
  const standUpMoves = routeMs.map((ms, index) => move(route[index]!, route[index + 1]!, ms, "Stand up"));
  const reversedRoute = [...route].reverse();
  const sitDownMoves = [...routeMs].reverse().map((ms, index) => move(reversedRoute[index]!, reversedRoute[index + 1]!, ms, "Sit down slowly"));

  return {
    exerciseId: "sit_to_stand",
    cue: "Lean forward a little, push through your feet and stand, then sit down slowly.",
    ariaLabel: "Sit-to-stand: sitting with both hands on the chair arms and the feet tucked back, then leaning forward, lifting with the lean held, letting go of the arms and standing tall, then sitting down slowly by the same route",
    views: ["side", "threeQuarter", "front"],
    framing: "body",
    moving: ["trunk", "thighLeft", "thighRight", "shinLeft", "shinRight", "armLeft", "armRight"],
    props: [chair],
    steps: [
      hold(seatedUpright, START_HOLD_MS, "Start"),
      ...standUpMoves,
      hold(upright, END_HOLD_MS, "End"),
      ...sitDownMoves,
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
    views: ["side"],
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
    views: ["front", "threeQuarter"],
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
    views: ["side"],
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

/** Each step is three moves, so a cadence of N steps a minute makes each move 60000 / (3 N) ms. */
const moveMsForCadence = (stepsPerMinute: number): number => Math.round(60000 / (3 * stepsPerMinute));
/** The slow walk is about 70 steps a minute. */
export const WALK_SLOW_MOVE_MS = moveMsForCadence(70);
/** The comfortable walk is about 95 steps a minute. */
export const WALK_COMFORTABLE_MOVE_MS = moveMsForCadence(95);

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
    views: ["side"],
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
 * The LEFT foot is the front foot and stays planted. The RIGHT foot (the
 * highlighted leg) slides back with the leg straight and the heel kept
 * down, the left knee bends a little, and the whole body leans in gently as
 * one straight line from the back heel (18 degrees, no more). The move into
 * the stretch is as slow as any other.
 *
 *   Start (feet together)        Hold (right foot slid back)
 *        |wall                        |wall
 *     o  |                          o |
 *    /|--|                         /|-|
 *     |  |                        / |  |      front foot stays where it is
 *    / \ |                      __/   \ ... back heel down
 */
function buildCalfStretch(): Demo {
  const wallSurfaceX = 0.80;
  const handHeightFromWall = 0.03;
  /** How far the right heel slides back from beside the left heel, in metres. */
  const SLIDE_BACK_METRES = 0.34;

  /** A body leaning `lean` degrees as a straight line from the heel, both legs straight, with `anchor` as the pelvis. */
  const straightLeaning = (lean: number): Pose => {
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
      result = restHand(result, side, at(wallSurfaceX - handHeightFromWall, shoulderHeight, sign * 0.18), at(0, 0.09, 0), { flex: 60, abduct: 5, elbow: 40 });
    }
    return result;
  };

  // Hold: right leg straight and back, body in one line from the back heel; left foot flat in front with a slightly bent knee.
  let stretch = straightLeaning(18);
  stretch = placeFoot(stretch, "Left", { heel: at(where(stretch, "heelRight").x + SLIDE_BACK_METRES, 0, BODY.pelvisHalfWidth) }, 0, { flex: 15, knee: 25, ankle: 0 });

  // The front (left) heel is where it stays in both poses. Standing upright at the start the shoulders are 0.05 m ahead of the heel and the
  // arms slightly bent (0.42 m from the hands); in the hold the leaning body brings the shoulders a few centimetres nearer the wall.
  const frontHeelX = wallSurfaceX - handHeightFromWall - 0.42 - 0.05;
  stretch.anchor = { joint: "heelLeft", at: at(frontHeelX, 0, BODY.pelvisHalfWidth) };
  stretch = handsOnWall(stretch);

  // Start: both feet together at the front heel, body upright, hands on the wall.
  const start = straightLeaning(0);
  start.anchor = { joint: "heelLeft", at: at(frontHeelX, 0, BODY.pelvisHalfWidth) };
  const startOnWall = handsOnWall(start);

  // Halfway: the right foot is lifted a little as it slides back, so it clears the floor.
  const halfway = halfwayWithToeLifted(startOnWall, stretch, "Right", 0.06, 0.06);

  return {
    exerciseId: "calf_stretch",
    cue: "Hands on the wall, one foot back with the heel down, lean in gently and hold.",
    ariaLabel: "Calf stretch: hands on the wall, then one foot slid back with the heel down and the body leaning in gently, held",
    views: ["side"],
    framing: "body",
    moving: ["thighRight", "shinRight", "footRight"],
    props: [{ kind: "wall", x: wallSurfaceX + 0.06 }],
    steps: [
      hold(startOnWall, START_HOLD_MS, "Start"),
      move(startOnWall, halfway, MOVE_MS / 2, "Foot back, lean in gently"),
      move(halfway, stretch, MOVE_MS / 2, "Foot back, lean in gently"),
      hold(stretch, HOLD_EXERCISE_MS, "Hold"),
      move(stretch, halfway, MOVE_MS / 2, "Back up, then the other side"),
      move(halfway, startOnWall, MOVE_MS / 2, "Back up, then the other side"),
    ],
  };
}

// ---------------------------------------------------------------------------
// 33. Doorway chest stretch
// ---------------------------------------------------------------------------

/**
 * Doorway chest stretch: three-quarter view (so the near post cannot hide the
 * arm). The left forearm is flat on the FRONT face of the door frame's left
 * post (the face towards the figure), vertical, with the upper arm about
 * horizontal out to the side. At the start the elbow is in front of the
 * shoulder line; the figure steps forward gently with the left foot and
 * lets its weight move forward, so the shoulder passes the elbow and the elbow
 * ends slightly BEHIND the shoulder line: that is the stretch across the
 * chest. The trunk stays upright, no arching.
 *
 *   top view        start               hold
 *                    post                post
 *                  ┌──┐ elbow          ┌──┐ elbow
 *     shoulders ──────●  (ahead)  ──────●   (behind the shoulder line)
 */
function buildDoorwayChestStretch(): Demo {
  const doorX = 0.05;
  /** Where the forearm lies: 2 cm in front of the post's front face (the face towards the figure is at doorX - 0.05). */
  const forearmX = doorX - 0.05 - 0.018;
  /** The post spans z = 0.42 to 0.5; the forearm is along its inner half so the near side of the arm shows. */
  const forearmZ = 0.44;
  /** How far the shoulder line is behind the elbow at the start, and ahead of it at the hold, in metres. */
  const START_ELBOW_AHEAD_OF_SHOULDER = 0.07;
  const HOLD_ELBOW_BEHIND_SHOULDER = 0.04;

  /** The left forearm vertical on the post's front face: elbow at shoulder height, wrist and fingertips straight above it. */
  const forearmOnFrame = (pose: Pose): Pose => {
    const shoulderHeight = where(pose, "shoulderLeft").y;
    const start = copyPose(pose);
    start.armLeft = { flex: 0, abduct: 85, rotate: 80, elbow: 90, wrist: 0 };
    return solveLimb(start, "armLeft", {
      elbowLeft: at(forearmX, shoulderHeight, forearmZ),
      wristLeft: at(forearmX, shoulderHeight + BODY.forearm, forearmZ),
      handLeft: at(forearmX, shoulderHeight + BODY.forearm + BODY.hand, forearmZ),
    }, ["flex", "abduct", "rotate", "elbow", "wrist"]);
  };

  // Start: the shoulders are 7 cm behind the elbow. The right heel is planted and the pelvis stands over it.
  const startPelvisX = forearmX - START_ELBOW_AHEAD_OF_SHOULDER;
  const anchorAt = at(startPelvisX - BODY.heelBack, 0, -BODY.pelvisHalfWidth);
  const start = forearmOnFrame(standing(anchorAt));

  // Hold: the weight moves forward over the right foot (the leg leans) until the shoulders are 4 cm past the elbow, and the left foot steps ahead.
  const forwardShift = START_ELBOW_AHEAD_OF_SHOULDER + HOLD_ELBOW_BEHIND_SHOULDER;
  const legLeanDegrees = (Math.asin(forwardShift / (BODY.thigh + BODY.shin)) * 180) / Math.PI;
  let stepped = standing(anchorAt);
  stepped.legRight = legAngles({ thigh: -legLeanDegrees, knee: 0, foot: 0 });
  stepped = placeFoot(stepped, "Left", { heel: at(anchorAt.x + 0.30, 0, BODY.pelvisHalfWidth) }, 0, { flex: 15, knee: 15, ankle: 0 });
  stepped = forearmOnFrame(stepped);

  return {
    exerciseId: "doorway_chest_stretch",
    cue: "Forearm on the door frame, step forward gently until you feel a stretch, and hold.",
    ariaLabel: "Doorway chest stretch: forearm flat on the door frame, then a gentle step forward so the elbow ends just behind the shoulder, held",
    views: ["threeQuarter", "front"],
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
  slow_walk: buildWalking("slow_walk", "Walk slowly for a few minutes.", "Slow walk: a slow walking step, left foot forward, then two unhurried steps, repeating", WALK_SLOW_MOVE_MS),
  calf_stretch: buildCalfStretch(),
  doorway_chest_stretch: buildDoorwayChestStretch(),
  comfortable_walk: buildWalking("comfortable_walk", "Walk at a pace where you can still talk.", "Walk at a comfortable pace: a walking step at a normal pace, two steps, repeating", WALK_COMFORTABLE_MOVE_MS),
};
