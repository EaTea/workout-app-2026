/**
 * Forward kinematics for the "Show me" mannequin: turns a Pose (joint angles)
 * into 3D joint positions. Pure TypeScript with no dependencies, so the
 * safe-range tests run in Vitest and both renderers (3D and flat) draw from
 * the same numbers.
 *
 *   Pose ──jointPositions──▶ Record<JointName, Vec3> ──▶ renderers / safety tests
 *
 * Work goes outwards from the pelvis, with each segment a fixed length so a
 * pose can never stretch a limb:
 *
 *                 head ─ neck ─ chest ─┬─ shoulders ─ elbows ─ wrists ─ hands
 *                                      │
 *                                    pelvis ─ hips ─ knees ─ ankles ─ heel / toe
 *
 * Conventions are documented in model.ts (x forward, y up, +z = figure's left).
 */
import type { ArmAngles, JointName, LegAngles, Pose, Vec3 } from "./model";

/**
 * Segment lengths in metres for an older adult about 1.65 m tall.
 * Standing, the hip is 0.90 m up and the top of the head about 1.66 m.
 */
export const BODY = {
  thigh: 0.42,
  shin: 0.40,
  /** Ankle joint height above the sole of the foot. */
  ankleHeight: 0.08,
  /** Distance from the ankle joint back to the back of the heel. */
  heelBack: 0.05,
  /** Distance from the ankle joint forward to the toe tip. */
  footLength: 0.17,
  pelvisHalfWidth: 0.09,
  /** Pelvis to the top of the spine between the shoulders. */
  spine: 0.43,
  chestToNeck: 0.08,
  neckToHeadCentre: 0.14,
  /** Head centre to the nose point, straight ahead. */
  noseForward: 0.10,
  shoulderHalfWidth: 0.18,
  upperArm: 0.29,
  forearm: 0.26,
  hand: 0.09,
} as const;

// ---------------------------------------------------------------------------
// Small vector and rotation helpers. A Mat3 is stored as three row vectors.
// ---------------------------------------------------------------------------

/** A 3x3 rotation matrix stored as three rows. */
type Mat3 = readonly [Vec3, Vec3, Vec3];

const IDENTITY: Mat3 = [
  { x: 1, y: 0, z: 0 },
  { x: 0, y: 1, z: 0 },
  { x: 0, y: 0, z: 1 },
];

/** Converts degrees to radians; every angle in a Pose is in degrees. */
function toRadians(degrees: number): number {
  return (degrees * Math.PI) / 180;
}

/** Adds two vectors; used to step from one joint to the next. */
function add(a: Vec3, b: Vec3): Vec3 {
  return { x: a.x + b.x, y: a.y + b.y, z: a.z + b.z };
}

/** Subtracts b from a; used to compute offsets and segment vectors. */
function subtract(a: Vec3, b: Vec3): Vec3 {
  return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z };
}

/** Dot product of two vectors. */
function dot(a: Vec3, b: Vec3): number {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}

/** Rotation about the x axis (positive tips +y towards +z). */
function rotationAboutX(degrees: number): Mat3 {
  const c = Math.cos(toRadians(degrees));
  const s = Math.sin(toRadians(degrees));
  return [
    { x: 1, y: 0, z: 0 },
    { x: 0, y: c, z: -s },
    { x: 0, y: s, z: c },
  ];
}

/** Rotation about the y axis (positive tips +z towards +x, so +x towards -z). */
function rotationAboutY(degrees: number): Mat3 {
  const c = Math.cos(toRadians(degrees));
  const s = Math.sin(toRadians(degrees));
  return [
    { x: c, y: 0, z: s },
    { x: 0, y: 1, z: 0 },
    { x: -s, y: 0, z: c },
  ];
}

/** Rotation about the z axis (positive tips +x towards +y, so +y towards -x). */
function rotationAboutZ(degrees: number): Mat3 {
  const c = Math.cos(toRadians(degrees));
  const s = Math.sin(toRadians(degrees));
  return [
    { x: c, y: -s, z: 0 },
    { x: s, y: c, z: 0 },
    { x: 0, y: 0, z: 1 },
  ];
}

/** Applies a rotation to a vector. */
function rotate(matrix: Mat3, vector: Vec3): Vec3 {
  return { x: dot(matrix[0], vector), y: dot(matrix[1], vector), z: dot(matrix[2], vector) };
}

/** Combines rotations: the result applies `right` first, then `left`. */
function multiply(left: Mat3, right: Mat3): Mat3 {
  const column = (index: "x" | "y" | "z"): Vec3 => ({ x: right[0][index], y: right[1][index], z: right[2][index] });
  const columns = [column("x"), column("y"), column("z")];
  const row = (leftRow: Vec3): Vec3 => ({
    x: dot(leftRow, columns[0] as Vec3),
    y: dot(leftRow, columns[1] as Vec3),
    z: dot(leftRow, columns[2] as Vec3),
  });
  return [row(left[0]), row(left[1]), row(left[2])];
}

/** Chains several rotations left to right (the rightmost is applied first). */
function chain(...matrices: Mat3[]): Mat3 {
  return matrices.reduce((accumulated, next) => multiply(accumulated, next), IDENTITY);
}

// ---------------------------------------------------------------------------
// Public measuring helpers (used by tests and later safety checks).
// ---------------------------------------------------------------------------

/** Straight-line distance between two points; used to check limbs keep their length. */
export function distance(a: Vec3, b: Vec3): number {
  const offset = subtract(a, b);
  return Math.sqrt(dot(offset, offset));
}

/**
 * Interior angle in degrees at joint `b` between the segments b→a and b→c.
 * 180 = straight, 90 = right angle. Used by the safe-range tests (for example
 * "knee angle at least 135 degrees" is angleAtJoint(hip, knee, ankle)).
 */
export function angleAtJoint(a: Vec3, b: Vec3, c: Vec3): number {
  const first = subtract(a, b);
  const second = subtract(c, b);
  const cosine = dot(first, second) / (Math.sqrt(dot(first, first)) * Math.sqrt(dot(second, second)));
  // Clamp against rounding error just outside [-1, 1], which would give NaN.
  return (Math.acos(Math.max(-1, Math.min(1, cosine))) * 180) / Math.PI;
}

/** Every joint name, handy for looping over a skeleton in tests and renderers. */
export const ALL_JOINTS: readonly JointName[] = [
  "pelvis", "hipLeft", "hipRight", "kneeLeft", "kneeRight", "ankleLeft", "ankleRight",
  "heelLeft", "heelRight", "toeLeft", "toeRight", "chest", "neck", "head", "nose",
  "shoulderLeft", "shoulderRight", "elbowLeft", "elbowRight", "wristLeft", "wristRight",
  "handLeft", "handRight",
];

// ---------------------------------------------------------------------------
// Forward kinematics
// ---------------------------------------------------------------------------

/** The joints of one arm, in world space. */
type ArmJoints = { elbow: Vec3; wrist: Vec3; hand: Vec3 };

/**
 * Works out one arm's elbow, wrist and hand from its shoulder.
 * `trunkFrame` is the chest's orientation; `side` is +1 for the left arm and
 * -1 for the right, so that "abduct" and "rotate" mean "outward" on both sides.
 *
 * Frames (each local frame has the limb along -y when straight, forward = +x):
 *   upperArmFrame = trunk · flex(z) · abduct(x) · twist(y)
 *   forearmFrame  = upperArmFrame · elbow(z)    (the palm faces local +x)
 *   hand          = forearmFrame · wrist(z)
 */
function armJoints(shoulder: Vec3, trunkFrame: Mat3, arm: ArmAngles, side: 1 | -1): ArmJoints {
  const upperArmFrame = chain(
    trunkFrame,
    rotationAboutZ(arm.flex),
    rotationAboutX(-side * arm.abduct),
    rotationAboutY(-side * arm.rotate),
  );
  const forearmFrame = multiply(upperArmFrame, rotationAboutZ(arm.elbow));
  const handFrame = multiply(forearmFrame, rotationAboutZ(arm.wrist));

  const elbow = add(shoulder, rotate(upperArmFrame, { x: 0, y: -BODY.upperArm, z: 0 }));
  const wrist = add(elbow, rotate(forearmFrame, { x: 0, y: -BODY.forearm, z: 0 }));
  const hand = add(wrist, rotate(handFrame, { x: 0, y: -BODY.hand, z: 0 }));

  return { elbow, wrist, hand };
}

/** The joints of one leg, in world space. */
type LegJoints = { knee: Vec3; ankle: Vec3; heel: Vec3; toe: Vec3 };

/**
 * Works out one leg's knee, ankle, heel and toe from its hip.
 * `pelvisFrame` is the pelvis orientation; `side` is +1 left, -1 right.
 * The foot is perpendicular to the shin at ankle 0, so a standing foot is flat.
 */
function legJoints(hip: Vec3, pelvisFrame: Mat3, leg: LegAngles, side: 1 | -1): LegJoints {
  const thighFrame = chain(pelvisFrame, rotationAboutZ(leg.flex), rotationAboutX(-side * leg.abduct));
  const shinFrame = multiply(thighFrame, rotationAboutZ(-leg.knee));
  const footFrame = multiply(shinFrame, rotationAboutZ(leg.ankle));

  const knee = add(hip, rotate(thighFrame, { x: 0, y: -BODY.thigh, z: 0 }));
  const ankle = add(knee, rotate(shinFrame, { x: 0, y: -BODY.shin, z: 0 }));
  const heel = add(ankle, rotate(footFrame, { x: -BODY.heelBack, y: -BODY.ankleHeight, z: 0 }));
  const toe = add(ankle, rotate(footFrame, { x: BODY.footLength, y: -BODY.ankleHeight, z: 0 }));

  return { knee, ankle, heel, toe };
}

/**
 * Computes every joint position for a pose. This is the single source of
 * truth for where the figure is: the renderers and the safety tests all call it.
 *
 * Steps: (1) build the pelvis orientation, (2) walk up the spine to the
 * chest, neck and head, and out to the arms, (3) walk down from the hips to
 * the legs, (4) translate everything so the anchor joint sits at the anchor point.
 */
export function jointPositions(pose: Pose): Record<JointName, Vec3> {
  // Roll first, then pitch, then yaw outermost. Negative signs convert our
  // "positive = forward / left" conventions to the standard right-handed axes.
  const pelvisFrame = chain(
    rotationAboutY(-pose.pelvis.yaw),
    rotationAboutZ(-pose.pelvis.pitch),
    rotationAboutX(pose.pelvis.roll),
  );
  const pelvis: Vec3 = { x: 0, y: 0, z: 0 };

  // Trunk: lean forward about z, side bend towards the left about x.
  const trunkFrame = chain(pelvisFrame, rotationAboutZ(-pose.spine.flex), rotationAboutX(pose.spine.sideBend));
  const chest = add(pelvis, rotate(trunkFrame, { x: 0, y: BODY.spine, z: 0 }));
  const neck = add(chest, rotate(trunkFrame, { x: 0, y: BODY.chestToNeck, z: 0 }));

  // Head: chin down about z, turn about y (positive towards +z); retract slides it back along the trunk.
  const headFrame = chain(trunkFrame, rotationAboutZ(-pose.neck.flex), rotationAboutY(-pose.neck.turn));
  const retraction = rotate(trunkFrame, { x: -pose.neck.retract, y: 0, z: 0 });
  const head = add(add(neck, rotate(headFrame, { x: 0, y: BODY.neckToHeadCentre, z: 0 })), retraction);
  const nose = add(head, rotate(headFrame, { x: BODY.noseForward, y: 0, z: 0 }));

  const shoulderLeft = add(chest, rotate(trunkFrame, { x: 0, y: 0, z: BODY.shoulderHalfWidth }));
  const shoulderRight = add(chest, rotate(trunkFrame, { x: 0, y: 0, z: -BODY.shoulderHalfWidth }));
  const armLeft = armJoints(shoulderLeft, trunkFrame, pose.armLeft, 1);
  const armRight = armJoints(shoulderRight, trunkFrame, pose.armRight, -1);

  const hipLeft = add(pelvis, rotate(pelvisFrame, { x: 0, y: 0, z: BODY.pelvisHalfWidth }));
  const hipRight = add(pelvis, rotate(pelvisFrame, { x: 0, y: 0, z: -BODY.pelvisHalfWidth }));
  const legLeft = legJoints(hipLeft, pelvisFrame, pose.legLeft, 1);
  const legRight = legJoints(hipRight, pelvisFrame, pose.legRight, -1);

  const unanchored: Record<JointName, Vec3> = {
    pelvis, hipLeft, hipRight,
    kneeLeft: legLeft.knee, kneeRight: legRight.knee,
    ankleLeft: legLeft.ankle, ankleRight: legRight.ankle,
    heelLeft: legLeft.heel, heelRight: legRight.heel,
    toeLeft: legLeft.toe, toeRight: legRight.toe,
    chest, neck, head, nose, shoulderLeft, shoulderRight,
    elbowLeft: armLeft.elbow, elbowRight: armRight.elbow,
    wristLeft: armLeft.wrist, wristRight: armRight.wrist,
    handLeft: armLeft.hand, handRight: armRight.hand,
  };

  // Translate so the anchor joint lands exactly on the anchor point.
  const shift = subtract(pose.anchor.at, unanchored[pose.anchor.joint]);
  const anchored = {} as Record<JointName, Vec3>;
  for (const joint of ALL_JOINTS) {
    anchored[joint] = add(unanchored[joint], shift);
  }
  return anchored;
}

// ---------------------------------------------------------------------------
// Starting pose
// ---------------------------------------------------------------------------

/**
 * A relaxed standing pose: every angle 0, arms hanging, feet flat under the
 * hips. Demos copy this and change only what differs, so each pose in a demo
 * reads as "neutral, except...". By default the right heel is anchored on the
 * floor at x = 0 directly under the right hip (z = -pelvisHalfWidth), which
 * puts both heels on the floor and the pelvis at z = 0.
 */
export function neutralStandingPose(anchorAt: Vec3 = { x: 0, y: 0, z: -BODY.pelvisHalfWidth }): Pose {
  const hangingArm: ArmAngles = { flex: 0, abduct: 0, rotate: 0, elbow: 0, wrist: 0 };
  const straightLeg: LegAngles = { flex: 0, abduct: 0, knee: 0, ankle: 0 };

  return {
    pelvis: { pitch: 0, roll: 0, yaw: 0 },
    spine: { flex: 0, sideBend: 0 },
    neck: { flex: 0, turn: 0, retract: 0 },
    armLeft: { ...hangingArm },
    armRight: { ...hangingArm },
    legLeft: { ...straightLeg },
    legRight: { ...straightLeg },
    anchor: { joint: "heelRight", at: anchorAt },
  };
}
