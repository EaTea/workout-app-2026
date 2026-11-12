/**
 * A simple centre-of-mass estimate for the "Show me" figure, used by the
 * demo tests to check that a standing-up or sitting-down movement never
 * leaves the body's weight outside its feet (which would be a fall).
 *
 *   joints (skeleton.ts) ──centreOfMassX──▶ metres forward, to compare with
 *                                           the heel and toe x of the feet
 *
 * The body is split into 13 segments. Each has a fraction of body mass
 * (Dempster's standard anthropometric table, as quoted in Winter's
 * "Biomechanics and Motor Control of Human Movement") and a point where that
 * mass is taken to sit. The fractions add up to 1.
 *
 *   segment                    mass fraction   where its mass sits
 *   head and neck                  0.081       head centre
 *   trunk (with pelvis)            0.497       middle of pelvis to neck
 *   upper arm (each of 2)          0.028       middle of shoulder to elbow
 *   forearm (each of 2)            0.016       43% of the way elbow to wrist
 *   hand (each of 2)               0.006       middle of wrist to hand
 *   thigh (each of 2)              0.100       43% of the way hip to knee
 *   shank (each of 2)              0.0465      43% of the way knee to ankle
 *   foot (each of 2)               0.0145      middle of heel to toe
 */
import type { JointName, Vec3 } from "./model";

/** All joint positions of one pose, as returned by jointPositions(). */
type WorldJoints = Record<JointName, Vec3>;

/** One body segment: its share of body mass and the point (between two joints) where it sits. */
type Segment = { massFraction: number; from: JointName; to: JointName; alongFromToTo: number };

/** The 13 segments described in the header comment, left and right written out. */
const SEGMENTS: Segment[] = [
  { massFraction: 0.081, from: "head", to: "head", alongFromToTo: 0 },
  { massFraction: 0.497, from: "pelvis", to: "neck", alongFromToTo: 0.5 },
  ...(["Left", "Right"] as const).flatMap((side): Segment[] => [
    { massFraction: 0.028, from: `shoulder${side}`, to: `elbow${side}`, alongFromToTo: 0.5 },
    { massFraction: 0.016, from: `elbow${side}`, to: `wrist${side}`, alongFromToTo: 0.43 },
    { massFraction: 0.006, from: `wrist${side}`, to: `hand${side}`, alongFromToTo: 0.5 },
    { massFraction: 0.100, from: `hip${side}`, to: `knee${side}`, alongFromToTo: 0.43 },
    { massFraction: 0.0465, from: `knee${side}`, to: `ankle${side}`, alongFromToTo: 0.43 },
    { massFraction: 0.0145, from: `heel${side}`, to: `toe${side}`, alongFromToTo: 0.5 },
  ]),
];

/**
 * The whole body's centre of mass in world metres: the mass-weighted average
 * of the segment points above. Props held by the figure are not counted
 * (none of the balance-critical demos carry any).
 */
export function centreOfMass(joints: WorldJoints): Vec3 {
  const total = { x: 0, y: 0, z: 0 };
  let massSum = 0;

  for (const segment of SEGMENTS) {
    const from = joints[segment.from];
    const to = joints[segment.to];
    const along = segment.alongFromToTo;

    total.x += segment.massFraction * (from.x + (to.x - from.x) * along);
    total.y += segment.massFraction * (from.y + (to.y - from.y) * along);
    total.z += segment.massFraction * (from.z + (to.z - from.z) * along);
    massSum += segment.massFraction;
  }

  return { x: total.x / massSum, y: total.y / massSum, z: total.z / massSum };
}

/**
 * How far forward of the heels and behind the toes the centre of mass is, as
 * the two margins in metres (both must be >= 0 for the weight to be over the
 * feet): `behindToes` = frontmost toe x - centre x, `aheadOfHeels` = centre x
 * - rearmost heel x. Used by the sit-to-stand test and its numbers in the PLAN.
 */
export function footMargins(joints: WorldJoints): { aheadOfHeels: number; behindToes: number } {
  const centre = centreOfMass(joints);
  const rearmostHeel = Math.min(joints.heelLeft.x, joints.heelRight.x);
  const frontmostToe = Math.max(joints.toeLeft.x, joints.toeRight.x);

  return { aheadOfHeels: centre.x - rearmostHeel, behindToes: frontmostToe - centre.x };
}
