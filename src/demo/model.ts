/**
 * Types for the "Show me" animations (see PLAN.md, PR 20 and PR 21).
 *
 * These are the INTERNAL types the skeleton, timeline and renderers
 * share. Demos are code, not program data, so nothing here crosses a wire
 * boundary and no DTOs are needed.
 *
 * Coordinate system (metres; note this triple is LEFT-handed):
 *
 *            y (up)
 *            |
 *            |      figure faces +x
 *            |
 *            +------ x (forward)
 *           /
 *          z  (the figure's LEFT side)
 *
 * The floor is y = 0. All angles are in degrees. Because +z is the figure's
 * left, x/y/z here is a left-handed set; the 3D renderer mirrors z when it
 * hands points to three.js (see renderer.ts), so the side view shows the
 * figure facing the viewer's right, as in the approved preview.
 */

/** A point or direction in the world, in metres. */
export type Vec3 = { x: number; y: number; z: number };

/**
 * Shoulder, elbow and wrist angles for one arm. The same numbers mean the
 * same movement on both sides: "abduct" is always "away from the body" and
 * "rotate" is always "outward positive", so mirrored poses are mirrored numbers.
 */
export type ArmAngles = {
  /** Swing forward from hanging straight down. 90 = horizontal forward, negative = behind. */
  flex: number;
  /** Swing out to the side. 90 = horizontal to the side. */
  abduct: number;
  /** Twist of the upper arm, outward positive. With the elbow bent 90 and the arm hanging, +60 swings the hand away from the body midline; negative brings it across the belly. */
  rotate: number;
  /** Elbow bend. 0 = straight. */
  elbow: number;
  /** Hand bend, positive = palm-side flexion (forearm forward, palm up: +40 lifts the hand). */
  wrist: number;
};

/** Hip, knee and ankle angles for one leg. */
export type LegAngles = {
  /** Hip swing forward. 90 = thigh horizontal forward, negative = leg behind. */
  flex: number;
  /** Hip swing out to that leg's own side. */
  abduct: number;
  /** Knee bend. 0 = straight, positive bends the shin backwards. */
  knee: number;
  /** Positive = toes pulled up (dorsiflexion), negative = toes pointed. */
  ankle: number;
};

/** Trunk bend relative to the pelvis. */
export type SpineAngles = {
  /** Positive = trunk leans forward, negative = backward arch. */
  flex: number;
  /** Positive = towards the figure's left (+z). */
  sideBend: number;
};

/** Head position relative to the trunk. */
export type NeckAngles = {
  /** Positive = chin down. */
  flex: number;
  /** Positive = face turns to the figure's left (+z). */
  turn: number;
  /** Metres the head slides straight back (0 to about 0.05). */
  retract: number;
};

/**
 * Orientation of the whole body about the pelvis. Applied in the order
 * roll, then pitch, then yaw (yaw outermost, about the world up axis).
 *
 * Yaw convention: positive yaw turns the figure to face its own LEFT, which
 * is towards +z. This is deliberately the same direction as `NeckAngles.turn`
 * (positive = towards +z), so "positive means left" everywhere.
 */
export type PelvisOrientation = {
  /** Positive tips the whole body forward about the z axis. -90 = lying on the back, face up, head towards -x, feet towards +x. */
  pitch: number;
  /** Positive tips the body towards the figure's left (+z). */
  roll: number;
  /** Positive turns the figure to face towards +z (its left). */
  yaw: number;
};

/** Every named point the skeleton computes. */
export type JointName =
  | "pelvis"
  | "hipLeft" | "hipRight"
  | "kneeLeft" | "kneeRight"
  | "ankleLeft" | "ankleRight"
  | "heelLeft" | "heelRight"
  | "toeLeft" | "toeRight"
  | "chest"
  | "neck"
  | "head"
  | "nose"
  | "shoulderLeft" | "shoulderRight"
  | "elbowLeft" | "elbowRight"
  | "wristLeft" | "wristRight"
  | "handLeft" | "handRight";

/**
 * After forward kinematics with the pelvis at the origin, the whole figure is
 * translated so `joint` lands exactly at `at` (for example the right heel on
 * the floor, or the pelvis at a bed height).
 */
export type Anchor = { joint: JointName; at: Vec3 };

/** The complete description of the figure at one instant. */
export type Pose = {
  pelvis: PelvisOrientation;
  spine: SpineAngles;
  neck: NeckAngles;
  armLeft: ArmAngles;
  armRight: ArmAngles;
  legLeft: LegAngles;
  legRight: LegAngles;
  anchor: Anchor;
};

/** Body parts that a demo can highlight (yellow) as "the bit that moves". */
export type BodyPart =
  | "head" | "trunk"
  | "armLeft" | "armRight"
  | "forearmLeft" | "forearmRight"
  | "handLeft" | "handRight"
  | "thighLeft" | "thighRight"
  | "shinLeft" | "shinRight"
  | "footLeft" | "footRight";

/**
 * One stage of a demo's loop: either stand still in a pose ("hold") or ease
 * from one pose to another ("move"). `label` is the big step label shown
 * under the figure ("Start", "Stand up", "Hold").
 */
export type Step =
  | { kind: "hold"; pose: Pose; ms: number; label: string }
  | { kind: "move"; from: Pose; to: Pose; ms: number; label: string };

/** Where the camera sits. */
export type CameraView = "side" | "front" | "threeQuarter";

/** How much of the scene the camera fills the panel with. */
export type Framing = "body" | "closeUpHead" | "closeUpHand" | "closeUpFoot";

/**
 * Furniture and held things, as plain data (positions in metres). Both
 * renderers (renderFlat.ts, render3d.ts) draw every kind; a new kind must be
 * added to both. Furniture is drawn grey,
 * held things yellow.
 */
export type Prop =
  /** A wall plane behind the figure, perpendicular to x. */
  | { kind: "wall"; x: number }
  /** A kitchen counter whose front edge is at x; `side` places it to the figure's left or right when it is side-on. */
  | { kind: "counter"; x: number; height: number; side?: "left" | "right" }
  /** A chair with its seat front edge at x and its back towards -x. */
  | { kind: "chair"; x: number; seatHeight: number; withArms: boolean }
  /** A door frame in the plane x. */
  | { kind: "doorFrame"; x: number }
  /** A bed whose head end is at x, running `length` towards +x. */
  | { kind: "bed"; x: number; height: number; length: number }
  /** A single stair step whose front edge is at x. */
  | { kind: "stair"; x: number; height: number }
  /** A resistance band from a fixed point to one or more joints. */
  | { kind: "band"; anchor: Vec3; toJoints: JointName[] }
  /** A soft ball held in the hand at `joint`. */
  | { kind: "ball"; joint: JointName }
  /** A shopping bag carried by the hand at `joint`. */
  | { kind: "bag"; joint: JointName }
  /** A tin of food held by the hand at `joint`. */
  | { kind: "tin"; joint: JointName };

/** One exercise's whole animation: what to show, from where, and the loop of steps. */
export type Demo = {
  exerciseId: string;
  /** The one-line cue shown under the step label. */
  cue: string;
  /** Spoken description of the movement for screen readers. */
  ariaLabel: string;
  view: CameraView;
  framing: Framing;
  /** Parts drawn yellow. */
  moving: BodyPart[];
  props: Prop[];
  steps: Step[];
};

/** How long the starting position is held, in ms. */
export const START_HOLD_MS = 1500;
/** How long a slow move between positions takes, in ms. */
export const MOVE_MS = 2500;
/** How long the end position is held, in ms. */
export const END_HOLD_MS = 1500;
/** How long the end position is held when the exercise is itself a hold, in ms. */
export const HOLD_EXERCISE_MS = 4000;
