import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { loopLengthMs, frameAt, stillFrames } from "./timeline";
import { BODY, angleAtJoint, distance, jointPositions } from "./skeleton";
import { START_HOLD_MS, type Demo, type JointName, type Pose, type Vec3 } from "./model";
import { steadyStrengthDemos } from "./steadyStrength";
import { DEMO_EXERCISE_IDS, hasDemo, loadDemo } from "./registry";
import { propBoxes, type PropBox } from "./renderer";
import { centreOfMass, footMargins } from "./balance";

/** Every 100 ms across one whole loop, including the blended frames inside the moves. */
function sampleTimes(loopMs: number): number[] {
  const times: number[] = [];
  for (let time = 0; time < loopMs; time += 100) times.push(time);
  return times;
}

describe("registry", () => {
  it("loads a Steady Strength demo by program id and exercise id", async () => {
    expect(await loadDemo("steady-strength", "high_wall_sit")).toBe(steadyStrengthDemos.high_wall_sit);
  });

  it("builds each program's demos once and reuses them", async () => {
    expect(await loadDemo("steady-strength", "sit_to_stand")).toBe(await loadDemo("steady-strength", "sit_to_stand"));
  });

  it("has nothing for other programs, unknown exercises and inherited object keys", async () => {
    expect(hasDemo("explosive-endurance", "high_wall_sit")).toBe(false);
    expect(hasDemo("steady-strength", "pull_up")).toBe(false);
    expect(hasDemo("steady-strength", "toString")).toBe(false);
    expect(hasDemo("constructor", "high_wall_sit")).toBe(false);
    expect(await loadDemo("explosive-endurance", "high_wall_sit")).toBeUndefined();
    expect(await loadDemo("steady-strength", "toString")).toBeUndefined();
  });

  it("lists exactly the exercise ids of the built demos, so the cheap list cannot drift from them", () => {
    expect([...DEMO_EXERCISE_IDS["steady-strength"]!].sort()).toEqual(Object.keys(steadyStrengthDemos).sort());
  });
});

describe("high wall sit demo", () => {
  const demo = steadyStrengthDemos.high_wall_sit!;

  it("matches the plan: side view, body framing, wall, cue and the 10.5 s loop", () => {
    expect(demo.views[0]).toBe("side");
    expect(demo.framing).toBe("body");
    expect(demo.props.map((prop) => prop.kind)).toEqual(["wall"]);
    expect(demo.cue).toBe("Back on the wall, slide down a little and hold.");
    expect(demo.steps.map((step) => `${step.kind}:${step.ms}:${step.label}`)).toEqual([
      "hold:1500:Start", "move:2500:Slide down a little", "hold:4000:Hold", "move:2500:Slide back up",
    ]);
    expect(loopLengthMs(demo)).toBe(10500);
  });

  it("never bends the knee past a quarter: knee angle at least 135 degrees in every frame", () => {
    let smallestKneeAngle = 180;
    for (const time of sampleTimes(loopLengthMs(demo))) {
      const joints = jointPositions(frameAt(demo, time).pose);
      for (const side of ["Left", "Right"] as const) {
        const angle = angleAtJoint(joints[`hip${side}`], joints[`knee${side}`], joints[`ankle${side}`]);
        smallestKneeAngle = Math.min(smallestKneeAngle, angle);
        expect(angle).toBeGreaterThanOrEqual(135);
      }
    }
    // The hold really does bend the knees to about 140 degrees, so the test is not passing on a still figure.
    expect(smallestKneeAngle).toBeCloseTo(140, 0);
  });

  it("keeps both heels on the floor throughout", () => {
    for (const time of sampleTimes(loopLengthMs(demo))) {
      const joints = jointPositions(frameAt(demo, time).pose);
      expect(joints.heelLeft.y).toBeCloseTo(0, 2);
      expect(joints.heelRight.y).toBeCloseTo(0, 2);
    }
  });

  it("keeps the back flat on the wall: pelvis and chest stay within 1 cm of the same distance from the wall", () => {
    const wall = demo.props[0];
    if (wall?.kind !== "wall") throw new Error("expected a wall prop");

    const pelvisToWall: number[] = [];
    for (const time of sampleTimes(loopLengthMs(demo))) {
      const joints = jointPositions(frameAt(demo, time).pose);
      const pelvisGap = joints.pelvis.x - wall.x;
      const chestGap = joints.chest.x - wall.x;
      expect(Math.abs(pelvisGap - chestGap)).toBeLessThan(0.01);
      pelvisToWall.push(pelvisGap);
    }
    // The hip does not drift towards or away from the wall as the knees bend.
    expect(Math.max(...pelvisToWall) - Math.min(...pelvisToWall)).toBeLessThan(0.01);
  });
});

// ---------------------------------------------------------------------------
// Every demo
// ---------------------------------------------------------------------------

/** The cue, view and framing each demo must have: copied from the plan's table of 34 exercises. */
const PLAN_TABLE: Record<string, { cue: string; view: Demo["views"][number]; framing: Demo["framing"] }> = {
  head_turns: { cue: "Sit or stand tall and turn your head slowly to one side, then the other.", view: "front", framing: "closeUpHead" },
  neck_retraction: { cue: "With a hand on your chin, slide your head straight back.", view: "side", framing: "closeUpHead" },
  standing_back_extension: { cue: "Hands on your lower back, lean back just a little.", view: "side", framing: "body" },
  ankle_pumps: { cue: "Sitting, pull your toes up, then point them.", view: "side", framing: "closeUpFoot" },
  single_leg_stand: { cue: "Hold the counter and lift one foot a little off the floor.", view: "threeQuarter", framing: "body" },
  heel_to_toe_stand: { cue: "Hold the counter, put one foot right in front of the other and stand still.", view: "side", framing: "body" },
  sideways_walking: { cue: "One hand on the counter, step sideways and don't cross your feet.", view: "front", framing: "body" },
  high_wall_sit: { cue: "Back on the wall, slide down a little and hold.", view: "side", framing: "body" },
  glute_bridge_hold: { cue: "Lying with knees bent, lift your hips into a straight line and hold.", view: "side", framing: "body" },
  pallof_press_hold: { cue: "Side-on to the door, push your hands straight out and hold. Don't turn.", view: "threeQuarter", framing: "body" },
  sit_to_stand: { cue: "Lean forward a little, push through your feet and stand, then sit down slowly.", view: "side", framing: "body" },
  heel_toe_raises: { cue: "Hold the counter, rise onto your toes, then rock back onto your heels.", view: "side", framing: "body" },
  side_hip_raise: { cue: "Hold the counter and lift one straight leg out to the side. Don't lean.", view: "front", framing: "body" },
  standing_bird_dog: { cue: "Hands on the counter, slide one leg straight back and hold. Keep your back flat.", view: "side", framing: "body" },
  slow_walk: { cue: "Walk slowly for a few minutes.", view: "side", framing: "body" },
  calf_stretch: { cue: "Hands on the wall, one foot back with the heel down, lean in gently and hold.", view: "side", framing: "body" },
  doorway_chest_stretch: { cue: "Forearm on the door frame, step forward gently until you feel a stretch, and hold.", view: "threeQuarter", framing: "body" },
  comfortable_walk: { cue: "Walk at a pace where you can still talk.", view: "side", framing: "body" },
};

/** The 16 exercises whose demos arrive in PR 22. */
const STILL_TO_COME = [
  "heel_to_toe_walk", "wall_push_hold", "grip_squeeze", "counter_plank", "split_stance_hold", "suitcase_hold", "band_row",
  "band_outward_rotation", "counter_push_up", "wrist_curl", "band_pull_apart", "stair_step_up", "back_knee_bend", "pallof_press",
  "wall_side_plank", "tall_sitting_hold",
];

/** Each limb as [upper joint, lower joint, its fixed length], used to check no pose stretches a limb. */
const LIMB_SEGMENTS: Array<[JointName, JointName, number]> = [
  ["hipLeft", "kneeLeft", BODY.thigh], ["kneeLeft", "ankleLeft", BODY.shin],
  ["hipRight", "kneeRight", BODY.thigh], ["kneeRight", "ankleRight", BODY.shin],
  ["shoulderLeft", "elbowLeft", BODY.upperArm], ["elbowLeft", "wristLeft", BODY.forearm],
  ["shoulderRight", "elbowRight", BODY.upperArm], ["elbowRight", "wristRight", BODY.forearm],
];

/** Every pose sampled each 100 ms across a demo's loop, with its world joints. */
function sampledFrames(demo: Demo): Array<{ pose: Pose; joints: Record<JointName, Vec3>; time: number }> {
  return sampleTimes(loopLengthMs(demo)).map((time) => {
    const pose = frameAt(demo, time).pose;
    return { pose, joints: jointPositions(pose), time };
  });
}

/** Angle in degrees of the trunk (pelvis to chest) from vertical. */
function trunkLeanDegrees(joints: Record<JointName, Vec3>): number {
  const up = { x: joints.chest.x - joints.pelvis.x, y: joints.chest.y - joints.pelvis.y, z: joints.chest.z - joints.pelvis.z };
  return (Math.acos(up.y / Math.hypot(up.x, up.y, up.z)) * 180) / Math.PI;
}

/** The radius of the foot capsule the 3D renderer draws, in metres (render3d.ts footRadius). */
const FOOT_RADIUS = 0.04;

/** Closest points between two 3D segments (clamped), as the two points; used to see whether two feet touch. */
function closestPointsBetweenSegments(a0: Vec3, a1: Vec3, b0: Vec3, b1: Vec3): [Vec3, Vec3] {
  const sub = (p: Vec3, q: Vec3): Vec3 => ({ x: p.x - q.x, y: p.y - q.y, z: p.z - q.z });
  const dotProduct = (p: Vec3, q: Vec3) => p.x * q.x + p.y * q.y + p.z * q.z;
  const along = (p: Vec3, direction: Vec3, t: number): Vec3 => ({ x: p.x + direction.x * t, y: p.y + direction.y * t, z: p.z + direction.z * t });
  const clamp01 = (value: number) => Math.min(1, Math.max(0, value));

  const d1 = sub(a1, a0);
  const d2 = sub(b1, b0);
  const r = sub(a0, b0);
  const lengthA = dotProduct(d1, d1);
  const lengthB = dotProduct(d2, d2);
  const f = dotProduct(d2, r);
  const c = dotProduct(d1, r);
  const b = dotProduct(d1, d2);
  const denominator = lengthA * lengthB - b * b;

  let s = denominator > 1e-12 ? clamp01((b * f - c * lengthB) / denominator) : 0;
  let t = (b * s + f) / lengthB;
  if (t < 0) { t = 0; s = clamp01(-c / lengthA); }
  else if (t > 1) { t = 1; s = clamp01((b - c) / lengthA); }
  return [along(a0, d1, s), along(b0, d2, t)];
}

/**
 * The part of a foot that can touch the other foot: the segment from just
 * behind the toe tip to just in front of the heel. The drawn foot is a capsule
 * of radius FOOT_RADIUS whose rounded ends reach the heel and toe points, so
 * the segment is pulled in by that radius at each end.
 */
function footCore(joints: Record<JointName, Vec3>, side: "Left" | "Right"): [Vec3, Vec3] {
  const heel = joints[`heel${side}`];
  const toe = joints[`toe${side}`];
  const length = distance(heel, toe);
  const pull = (from: Vec3, towards: Vec3): Vec3 => ({
    x: from.x + ((towards.x - from.x) / length) * FOOT_RADIUS,
    y: from.y + ((towards.y - from.y) / length) * FOOT_RADIUS,
    z: from.z + ((towards.z - from.z) / length) * FOOT_RADIUS,
  });
  return [pull(heel, toe), pull(toe, heel)];
}

/**
 * 0 if the point is outside the box; otherwise how deep inside it is: the
 * distance to the nearest face. A box standing on the floor has no way out
 * through its bottom face, so that face is not counted (a foot pushed into
 * a counter's lower front is deep in it even when it is near the floor).
 */
function depthInsideBox(point: Vec3, box: PropBox): number {
  const depths = [
    point.x - box.min.x, box.max.x - point.x,
    box.max.y - point.y,
    point.z - box.min.z, box.max.z - point.z,
  ];
  if (box.min.y > 0) depths.push(point.y - box.min.y);
  const shallowest = Math.min(...depths);
  return shallowest > 0 && point.y >= box.min.y ? shallowest : 0;
}

/** Joint pairs along which limb points are sampled for the furniture collision check. */
const LIMB_PAIRS: Array<[JointName, JointName]> = [
  ["shoulderLeft", "elbowLeft"], ["elbowLeft", "wristLeft"], ["wristLeft", "handLeft"],
  ["shoulderRight", "elbowRight"], ["elbowRight", "wristRight"], ["wristRight", "handRight"],
  ["hipLeft", "kneeLeft"], ["kneeLeft", "ankleLeft"], ["ankleLeft", "heelLeft"], ["ankleLeft", "toeLeft"], ["heelLeft", "toeLeft"],
  ["hipRight", "kneeRight"], ["kneeRight", "ankleRight"], ["ankleRight", "heelRight"], ["ankleRight", "toeRight"], ["heelRight", "toeRight"],
];

/** The chair seat height the sit-to-stand and ankle pump demos use, in metres (steadyStrength.ts SEAT_HEIGHT). */
const SEAT_HEIGHT_FOR_TESTS = 0.45;

/** Half the thickness of a hand, in metres: a hand resting on a surface has its joint point this far above it (render3d.ts hand radius). */
const HAND_RESTING_HEIGHT = 0.035;

/** True if the hand point rests on the top of one of the boxes: inside its x/z footprint, and at its surface (plus the hand's own thickness) within 2 cm. */
function handRestsOnTop(hand: Vec3, boxes: PropBox[]): boolean {
  return boxes.some((box) =>
    hand.x >= box.min.x && hand.x <= box.max.x && hand.z >= box.min.z && hand.z <= box.max.z &&
    Math.abs(hand.y - (box.max.y + HAND_RESTING_HEIGHT)) <= 0.02);
}

describe("every Steady Strength demo", () => {
  const demos = Object.values(steadyStrengthDemos);

  it("has a demo for every exercise in the program except the 16 that arrive in PR 22", () => {
    const programFile = JSON.parse(readFileSync("public/steady-strength.json", "utf8")) as { exercises: Record<string, unknown> };
    const missing = Object.keys(programFile.exercises).filter((id) => steadyStrengthDemos[id] === undefined);
    expect(missing.sort()).toEqual([...STILL_TO_COME].sort());
    for (const id of Object.keys(steadyStrengthDemos)) expect(programFile.exercises[id]).toBeDefined();
  });

  it("has exactly the 18 Day 1 and Day 2 demos", () => {
    expect(Object.keys(steadyStrengthDemos).sort()).toEqual(Object.keys(PLAN_TABLE).sort());
  });

  for (const demo of demos) {
    describe(demo.exerciseId, () => {
      it("matches the plan table: cue, view and framing", () => {
        const planned = PLAN_TABLE[demo.exerciseId]!;
        expect(demo.cue).toBe(planned.cue);
        expect(demo.views[0]).toBe(planned.view);
        expect(demo.framing).toBe(planned.framing);
        expect(demo.ariaLabel.length).toBeGreaterThan(20);
      });

      it("starts with a hold labelled Start, has a hold, and every move can be played (one anchor joint)", () => {
        expect(demo.steps[0]!.kind).toBe("hold");
        expect(demo.steps[0]!.label).toMatch(/^Start/);
        expect(stillFrames(demo).length).toBeGreaterThanOrEqual(1);
        // frameAt blends every move, and blendPoses throws if a move changes anchor joint.
        expect(() => sampledFrames(demo)).not.toThrow();
      });

      it("keeps the lower back neutral and the neck never tipped back in every frame, blends included", () => {
        // Extension (flex below 0) is capped at 0 (1 degree of rounding allowed) everywhere except the standing back extension.
        const spineRange: [number, number] = demo.exerciseId === "standing_back_extension" ? [-10, 0] : [-1, 5];
        for (const { pose } of sampledFrames(demo)) {
          expect(pose.spine.flex).toBeGreaterThanOrEqual(spineRange[0] - 1e-9);
          expect(pose.spine.flex).toBeLessThanOrEqual(spineRange[1] + 1e-9);
          expect(Math.abs(pose.spine.sideBend)).toBeLessThanOrEqual(5);
          expect(Math.abs(pose.pelvis.roll)).toBeLessThanOrEqual(5);
          expect(pose.neck.flex).toBeGreaterThanOrEqual(-5);
        }
      });

      it("keeps every limb its own length and nothing below the floor", () => {
        for (const { joints } of sampledFrames(demo)) {
          for (const [upper, lower, length] of LIMB_SEGMENTS) {
            expect(distance(joints[upper], joints[lower])).toBeCloseTo(length, 6);
          }
          for (const joint of ["heelLeft", "heelRight", "toeLeft", "toeRight", "ankleLeft", "ankleRight"] as const) {
            // Blending angles between two poses can dip a foot a few millimetres; 1 cm is invisible, more is a foot through the floor.
            expect(joints[joint].y).toBeGreaterThanOrEqual(-0.01);
          }
        }
      });

      it("never puts the two feet through each other: far enough apart, or one clearly higher", () => {
        for (const { joints, time } of sampledFrames(demo)) {
          const [leftTip, leftEnd] = footCore(joints, "Left");
          const [rightTip, rightEnd] = footCore(joints, "Right");
          const [onLeft, onRight] = closestPointsBetweenSegments(leftTip, leftEnd, rightTip, rightEnd);
          const apart = distance(onLeft, onRight);
          const heightDifference = Math.abs(onLeft.y - onRight.y);
          expect(apart >= 2 * FOOT_RADIUS || heightDifference >= 0.03, `${demo.exerciseId} at ${time} ms: feet ${apart.toFixed(3)} apart, ${heightDifference.toFixed(3)} difference in height`).toBe(true);
        }
      });

      it("keeps every limb out of the furniture: no point sampled each 3 cm sinks more than 1 cm into a block", () => {
        const boxes = demo.props.flatMap((prop) => propBoxes(prop));
        for (const { joints, time } of sampledFrames(demo)) {
          for (const [from, to] of LIMB_PAIRS) {
            const length = distance(joints[from], joints[to]);
            const samples = Math.max(1, Math.ceil(length / 0.03));
            for (let index = 0; index <= samples; index += 1) {
              const fraction = index / samples;
              const point = {
                x: joints[from].x + (joints[to].x - joints[from].x) * fraction,
                y: joints[from].y + (joints[to].y - joints[from].y) * fraction,
                z: joints[from].z + (joints[to].z - joints[from].z) * fraction,
              };
              for (const box of boxes) {
                expect(depthInsideBox(point, box), `${demo.exerciseId} at ${time} ms: ${from}-${to} point ${index}`).toBeLessThanOrEqual(0.01);
              }
            }
          }
        }
      });
    });
  }
});

// ---------------------------------------------------------------------------
// Safe ranges from the plan's table, per exercise
// ---------------------------------------------------------------------------

describe("head turns", () => {
  const frames = sampledFrames(steadyStrengthDemos.head_turns!);

  it("turns about 45 degrees each way, never more, and never tips the head back or down", () => {
    const turns = frames.map(({ pose }) => pose.neck.turn);
    expect(Math.max(...turns)).toBeGreaterThan(40);
    expect(Math.min(...turns)).toBeLessThan(-40);
    for (const { pose } of frames) {
      expect(Math.abs(pose.neck.turn)).toBeLessThanOrEqual(45 + 1e-9);
      expect(pose.neck.flex).toBe(0);
    }
  });
});

describe("neck retraction", () => {
  const demo = steadyStrengthDemos.neck_retraction!;
  const frames = sampledFrames(demo);

  it("slides the head straight back about 4 cm with the chin level", () => {
    const retractions = frames.map(({ pose }) => pose.neck.retract);
    expect(Math.min(...retractions)).toBe(0);
    expect(Math.max(...retractions)).toBeCloseTo(0.04, 5);
    for (const { pose } of frames) expect(pose.neck.flex).toBe(0);
  });

  it("keeps a fingertip within 3 cm of the chin in the start and the hold", () => {
    for (const still of stillFrames(demo)) {
      const joints = jointPositions(still.pose);
      const chin = { x: joints.head.x + 0.075, y: joints.head.y - 0.085, z: -0.08 };
      expect(distance(joints.handRight, chin)).toBeLessThan(0.03);
    }
  });
});

describe("standing back extension", () => {
  const frames = sampledFrames(steadyStrengthDemos.standing_back_extension!);

  it("arches back no more than 10 degrees, and the trunk really does lean back", () => {
    const flexes = frames.map(({ pose }) => pose.spine.flex);
    expect(Math.min(...flexes)).toBeGreaterThanOrEqual(-10);
    expect(Math.min(...flexes)).toBeLessThan(-5);
    for (const { joints } of frames) expect(joints.chest.x).toBeLessThanOrEqual(joints.pelvis.x + 1e-9);
  });

  it("keeps the knees straight and the pelvis still, with both hands near the lower back", () => {
    const first = frames[0]!.joints.pelvis;
    for (const { pose, joints } of frames) {
      expect(pose.legLeft.knee).toBe(0);
      expect(distance(joints.pelvis, first)).toBeLessThan(1e-9);
      for (const side of ["Left", "Right"] as const) {
        expect(joints[`hand${side}`].x).toBeLessThan(joints.pelvis.x);
        expect(Math.abs(joints[`hand${side}`].y - joints.pelvis.y - 0.17)).toBeLessThan(0.06);
      }
    }
  });
});

describe("ankle pumps", () => {
  const demo = steadyStrengthDemos.ankle_pumps!;
  const frames = sampledFrames(demo);

  it("sits on a chair and keeps the pumping leg almost still while only the ankle moves", () => {
    const first = frames[0]!.pose.legRight;
    for (const { pose } of frames) {
      expect(pose.legRight.knee).toBe(first.knee);
      // The hip angle is re-fitted by a degree or two so the heel stays on the floor as the foot pivots.
      expect(Math.abs(pose.legRight.flex - first.flex)).toBeLessThan(3);
    }
    expect(demo.props.map((prop) => prop.kind)).toEqual(["chair"]);
  });

  it("keeps the heel resting on the floor for the whole set: not a leg raise", () => {
    for (const { joints, time } of frames) {
      expect(joints.heelRight.y, `heel at ${time} ms`).toBeLessThanOrEqual(0.01);
    }
  });

  it("pulls the toes up then points them, with the toes always clear of the floor", () => {
    const toeHeights = frames.map(({ joints }) => joints.toeRight.y);
    // Relaxed the toe is about 9 cm up; pulled up it rises to 16 cm; pointed it comes down to about 1 cm but not through the floor.
    expect(Math.max(...toeHeights)).toBeGreaterThan(0.13);
    expect(Math.min(...toeHeights)).toBeLessThan(0.03);
    expect(Math.min(...toeHeights)).toBeGreaterThanOrEqual(0);
  });
});

describe("single-leg stand and side hip raise", () => {
  it("lifts the foot only a little off the floor, standing knee soft", () => {
    const frames = sampledFrames(steadyStrengthDemos.single_leg_stand!);
    const lifts = frames.map(({ joints }) => Math.min(joints.heelRight.y, joints.toeRight.y));
    // Lowest point of the lifted foot never goes above 15 cm; the heel is up about 10 cm.
    const heelLifts = frames.map(({ joints }) => joints.heelRight.y);
    expect(Math.max(...heelLifts)).toBeGreaterThan(0.05);
    expect(Math.max(...heelLifts)).toBeLessThan(0.15);
    expect(Math.max(...lifts)).toBeLessThan(0.1);
    for (const { pose, joints } of frames) {
      expect(pose.legLeft.knee).toBeGreaterThan(3);
      expect(joints.heelLeft.y).toBeCloseTo(0, 5);
    }
  });

  it("side hip raise: leg out no more than 30 degrees, toes forward, no leaning", () => {
    const frames = sampledFrames(steadyStrengthDemos.side_hip_raise!);
    const abducts = frames.map(({ pose }) => pose.legRight.abduct);
    expect(Math.max(...abducts)).toBeGreaterThan(25);
    for (const { pose, joints } of frames) {
      expect(pose.legRight.abduct).toBeLessThanOrEqual(30);
      expect(pose.pelvis.roll).toBe(0);
      expect(pose.spine.sideBend).toBe(0);
      expect(Math.abs(joints.chest.z - joints.pelvis.z)).toBeLessThan(1e-9);
      expect(joints.toeRight.x).toBeGreaterThan(joints.heelRight.x);
    }
  });
});

describe("hands on supports", () => {
  /** The grey blocks of the demo's first prop of this kind, as boxes. */
  const boxesOf = (demo: Demo, kind: string): PropBox[] => demo.props.filter((prop) => prop.kind === kind).flatMap((prop) => propBoxes(prop));

  /** Checks the named hands rest on top of the boxes in every sampled frame whose time is inside one of the windows. */
  function expectHandsOnTop(id: string, hands: Array<"handLeft" | "handRight">, boxes: PropBox[], windows: Array<[number, number]> = [[0, Infinity]]): void {
    const demo = steadyStrengthDemos[id]!;
    let checked = 0;
    for (const { joints, time } of sampledFrames(demo)) {
      if (!windows.some(([from, to]) => time >= from && time <= to)) continue;
      for (const hand of hands) {
        const point = joints[hand];
        expect(handRestsOnTop(point, boxes), `${id} at ${time} ms: ${hand} at ${point.x.toFixed(2)}, ${point.y.toFixed(3)}, ${point.z.toFixed(2)} is not on the support`).toBe(true);
        checked += 1;
      }
    }
    expect(checked).toBeGreaterThan(10);
  }

  it("keeps the hands on the counter top in every frame of the counter exercises", () => {
    expectHandsOnTop("single_leg_stand", ["handLeft"], boxesOf(steadyStrengthDemos.single_leg_stand!, "counter"));
    expectHandsOnTop("heel_to_toe_stand", ["handLeft"], boxesOf(steadyStrengthDemos.heel_to_toe_stand!, "counter"));
    expectHandsOnTop("heel_toe_raises", ["handLeft", "handRight"], boxesOf(steadyStrengthDemos.heel_toe_raises!, "counter"));
    expectHandsOnTop("side_hip_raise", ["handLeft"], boxesOf(steadyStrengthDemos.side_hip_raise!, "counter"));
    expectHandsOnTop("standing_bird_dog", ["handLeft", "handRight"], boxesOf(steadyStrengthDemos.standing_bird_dog!, "counter"));
    expectHandsOnTop("sideways_walking", ["handLeft"], boxesOf(steadyStrengthDemos.sideways_walking!, "counter"));
  });

  it("keeps the hands on the chair arms from the start until the hips are clearly up, and again from the reach back until the end", () => {
    const demo = steadyStrengthDemos.sit_to_stand!;
    const armRests = boxesOf(demo, "chair").filter((box) => box.max.y - box.min.y < 0.05 && box.min.y > SEAT_HEIGHT_FOR_TESTS + 0.15);
    expect(armRests.length).toBe(2);
    // Stand up: Start hold and the first four moves end at 1500 + 350 + 350 + 300 + 300 = 2800 ms; sit down: the hands are back on the arms from 5500 + 600 + 600 = 6700 ms.
    expectHandsOnTop("sit_to_stand", ["handLeft", "handRight"], armRests, [[0, 2800], [6700, 8000]]);
  });

  it("keeps both hands on the wall face in every frame of the calf stretch", () => {
    const demo = steadyStrengthDemos.calf_stretch!;
    const wall = boxesOf(demo, "wall")[0]!;
    for (const { joints, time } of sampledFrames(demo)) {
      for (const hand of ["handLeft", "handRight"] as const) {
        const point = joints[hand];
        const onFace = Math.abs(point.x - (wall.min.x - HAND_RESTING_HEIGHT)) <= 0.02 && point.y >= wall.min.y && point.y <= wall.max.y && point.z >= wall.min.z && point.z <= wall.max.z;
        expect(onFace, `calf stretch at ${time} ms: ${hand} x ${point.x.toFixed(3)} (wall face ${wall.min.x})`).toBe(true);
      }
    }
  });
});

describe("heel to toe stand", () => {
  const demo = steadyStrengthDemos.heel_to_toe_stand!;

  it("ends with the front heel touching the back toe, in one line, both feet flat", () => {
    const hold = stillFrames(demo)[1]!;
    const joints = jointPositions(hold.pose);
    expect(Math.abs(joints.heelLeft.x - joints.toeRight.x)).toBeLessThan(0.02);
    expect(Math.abs(joints.heelLeft.z - joints.heelRight.z)).toBeLessThan(0.02);
    expect(joints.heelLeft.y).toBeCloseTo(0, 2);
    expect(joints.toeLeft.y).toBeCloseTo(0, 2);
  });

  it("lifts the stepping foot and swings it forward past the standing foot, never sliding through it", () => {
    const frames = sampledFrames(demo);
    // The stepping (left) foot goes at least 3 cm up and more than a foot length beyond the standing toe on the way.
    expect(Math.max(...frames.map(({ joints }) => joints.heelLeft.y))).toBeGreaterThan(0.05);
    expect(Math.max(...frames.map(({ joints }) => joints.heelLeft.x - joints.toeRight.x))).toBeGreaterThan(0.1);
    // And the standing (right) foot never moves.
    const first = frames[0]!.joints;
    for (const { joints } of frames) {
      expect(distance(joints.heelRight, first.heelRight)).toBeLessThan(1e-9);
      expect(distance(joints.toeRight, first.toeRight)).toBeLessThan(0.005);
    }
  });
});

describe("sideways walking", () => {
  const demo = steadyStrengthDemos.sideways_walking!;
  const frames = sampledFrames(demo);

  it("steps out twice then back twice without ever crossing the feet, about 18 cm per step each way", () => {
    for (const { joints } of frames) {
      // Facing -x, the figure's left is world -z: the left foot stays further left than the right.
      expect(joints.ankleLeft.z).toBeLessThan(joints.ankleRight.z - 0.1);
    }
    // The pelvis goes out about 36 cm (twice 18) and comes all the way back.
    const sideways = frames.map(({ joints }) => joints.pelvis.z);
    expect(Math.min(...sideways)).toBeLessThan(-0.33);
    expect(Math.max(...sideways)).toBeCloseTo(0, 6);
  });

  it("goes both ways: the pelvis moves to the left for a while and then back to the right", () => {
    const sideways = frames.map(({ joints }) => joints.pelvis.z);
    const steps = sideways.slice(1).map((value, index) => value - sideways[index]!);
    expect(Math.min(...steps)).toBeLessThan(-0.01); // to the figure's left (world -z)
    expect(Math.max(...steps)).toBeGreaterThan(0.01); // and back
    // The farthest point is somewhere in the middle of the loop, not at either end.
    const farthest = sideways.indexOf(Math.min(...sideways));
    expect(farthest).toBeGreaterThan(sideways.length * 0.3);
    expect(farthest).toBeLessThan(sideways.length * 0.7);
  });

  it("ends exactly where it began, so the loop restart does not jump", () => {
    const first = demo.steps[0]!;
    const last = demo.steps[demo.steps.length - 1]!;
    if (first.kind !== "hold" || last.kind !== "move") throw new Error("expected a hold first and a move last");
    expect(last.to.anchor.joint).toBe(first.pose.anchor.joint);
    expect(distance(last.to.anchor.at, first.pose.anchor.at)).toBeLessThan(1e-9);
    for (const part of ["pelvis", "spine", "neck", "armLeft", "armRight", "legLeft", "legRight"] as const) {
      const wanted = first.pose[part] as Record<string, number>;
      const got = last.to[part] as Record<string, number>;
      for (const key of Object.keys(wanted)) expect(got[key]).toBeCloseTo(wanted[key]!, 9);
    }
    // And the figure itself moves by almost nothing across the wrap (largest step in 20 ms).
    const justBefore = jointPositions(frameAt(demo, loopLengthMs(demo) - 20).pose);
    const justAfter = jointPositions(frameAt(demo, 0).pose);
    expect(distance(justBefore.pelvis, justAfter.pelvis)).toBeLessThan(0.01);
  });

  it("keeps a hand on the counter and the whole figure over the counter's width", () => {
    const counter = demo.props.find((prop) => prop.kind === "counter");
    expect(counter).toBeDefined();
    for (const { joints } of frames) {
      expect(Math.abs(joints.pelvis.z)).toBeLessThan(0.6);
    }
  });
});

/**
 * Signed distance in metres of the pelvis from the straight line through the
 * shoulders' middle and the knees' middle, measured in the vertical (x, y)
 * plane. Positive = the pelvis is ABOVE the line (an arch), negative = below
 * it (a sag), 0 = the shoulder, hip and knee are in one straight line.
 */
function pelvisAboveShoulderKneeLine(joints: Record<JointName, Vec3>): number {
  const shoulder = { x: (joints.shoulderLeft.x + joints.shoulderRight.x) / 2, y: (joints.shoulderLeft.y + joints.shoulderRight.y) / 2 };
  const knee = { x: (joints.kneeLeft.x + joints.kneeRight.x) / 2, y: (joints.kneeLeft.y + joints.kneeRight.y) / 2 };
  const along = { x: knee.x - shoulder.x, y: knee.y - shoulder.y };
  const length = Math.hypot(along.x, along.y);
  // Left-hand normal of the shoulder-to-knee direction; flipped so that "up" is positive whichever way the line runs.
  const normal = along.x >= 0 ? { x: -along.y / length, y: along.x / length } : { x: along.y / length, y: -along.x / length };
  return (joints.pelvis.x - shoulder.x) * normal.x + (joints.pelvis.y - shoulder.y) * normal.y;
}

describe("glute bridge hold", () => {
  const demo = steadyStrengthDemos.glute_bridge_hold!;
  const frames = sampledFrames(demo);
  const bed = demo.props.find((prop) => prop.kind === "bed");
  if (bed?.kind !== "bed") throw new Error("expected a bed");

  it("the line test can tell an arch from a straight line (so the hip test below can fail)", () => {
    const hold = jointPositions(stillFrames(demo)[1]!.pose);
    expect(Math.abs(pelvisAboveShoulderKneeLine(hold))).toBeLessThan(0.03);
    // Arch the hips 10 degrees past the line: lift the pelvis straight up by what 10 degrees means over the thigh.
    const arched = { ...hold, pelvis: { ...hold.pelvis, y: hold.pelvis.y + BODY.thigh * Math.sin((10 * Math.PI) / 180) } };
    expect(pelvisAboveShoulderKneeLine(arched)).toBeGreaterThan(0.03);
    // A sagging pelvis reads as negative.
    expect(pelvisAboveShoulderKneeLine({ ...hold, pelvis: { ...hold.pelvis, y: hold.pelvis.y - 0.1 } })).toBeLessThan(-0.05);
  });

  it("never lifts the hips above the straight shoulder-to-knee line (no arch), and in the hold is within 3 cm of it", () => {
    for (const { joints, time } of frames) {
      expect(pelvisAboveShoulderKneeLine(joints), `at ${time} ms`).toBeLessThanOrEqual(0.01);
    }
    const hold = jointPositions(stillFrames(demo)[1]!.pose);
    expect(Math.abs(pelvisAboveShoulderKneeLine(hold))).toBeLessThanOrEqual(0.03);
    // And the hips really are lifted off the bed in the hold compared with the start.
    const start = jointPositions(stillFrames(demo)[0]!.pose);
    expect(hold.pelvis.y).toBeGreaterThan(start.pelvis.y + 0.1);
  });

  it("keeps the feet flat on the bed and the shoulders on it, within 3 cm", () => {
    const shoulderHeights = frames.map(({ joints }) => joints.shoulderRight.y);
    expect(Math.max(...shoulderHeights) - Math.min(...shoulderHeights)).toBeLessThan(0.03);
    for (const { joints } of frames) {
      for (const joint of ["heelLeft", "heelRight", "toeLeft", "toeRight"] as const) {
        expect(Math.abs(joints[joint].y - bed.height)).toBeLessThan(0.03);
      }
    }
  });
});

describe("pallof press hold", () => {
  const demo = steadyStrengthDemos.pallof_press_hold!;
  const band = demo.props.find((prop) => prop.kind === "band");
  if (band?.kind !== "band") throw new Error("expected a band");

  it("presses the hands straight out in front, parallel to the door, while the body does not turn", () => {
    const frames = sampledFrames(demo);
    const firstHands = frames[0]!.joints;
    for (const { pose, joints } of frames) {
      expect(pose.pelvis.yaw).toBe(0);
      expect(pose.spine.flex).toBe(0);
      expect(Math.abs(joints.handLeft.z + joints.handRight.z)).toBeLessThan(0.02);
      // The hands travel along x only: their sideways position never changes by more than 2 cm.
      expect(Math.abs(joints.handLeft.z - firstHands.handLeft.z)).toBeLessThanOrEqual(0.02);
      expect(Math.abs(joints.handRight.z - firstHands.handRight.z)).toBeLessThanOrEqual(0.02);
    }
    const [atChest, pressedOut] = stillFrames(demo).map((still) => jointPositions(still.pose));
    expect(pressedOut!.handLeft.x - atChest!.handLeft.x).toBeGreaterThan(0.25);
    // Arms are about straight in the hold.
    expect(angleAtJoint(pressedOut!.shoulderLeft, pressedOut!.elbowLeft, pressedOut!.wristLeft)).toBeGreaterThan(165);
  });

  it("anchors the band at chest height to the figure's side: out to the left of the body and level with the chest, so the band runs sideways", () => {
    expect(band.toJoints).toEqual(["handLeft", "handRight"]);
    expect(band.anchor.y).toBeCloseTo(1.25, 2);
    for (const { joints } of sampledFrames(demo)) {
      const midline = (joints.shoulderLeft.z + joints.shoulderRight.z) / 2;
      expect(Math.abs(band.anchor.z - midline)).toBeGreaterThanOrEqual(0.5);
      expect(Math.abs(band.anchor.x - joints.chest.x)).toBeLessThanOrEqual(0.15);
    }
  });

  it("does not draw the door frame across the figure's front (it would put the hands through the doorway)", () => {
    expect(demo.props.map((prop) => prop.kind)).toEqual(["band"]);
  });
});

describe("sit-to-stand", () => {
  const demo = steadyStrengthDemos.sit_to_stand!;
  const frames = sampledFrames(demo);

  it("matches the plan's 8 second loop: Start 1.5 s, Stand up 2.5 s, End 1.5 s, Sit down slowly 2.5 s", () => {
    expect(loopLengthMs(demo)).toBe(8000);
    const lengthOf = (label: string) => demo.steps.filter((step) => step.label === label).reduce((total, step) => total + step.ms, 0);
    expect(lengthOf("Start")).toBe(1500);
    expect(lengthOf("Stand up")).toBe(2500);
    expect(lengthOf("End")).toBe(1500);
    expect(lengthOf("Sit down slowly")).toBe(2500);
    expect(demo.steps[0]!.label).toBe("Start");
    expect(demo.steps.map((step) => step.label).filter((label, index, all) => all.indexOf(label) === index)).toEqual(["Start", "Stand up", "End", "Sit down slowly"]);
  });

  it("tips the trunk forward from the hips no more than 30 degrees with the spine flexed within 5 degrees", () => {
    let mostLean = 0;
    for (const { pose, joints } of frames) {
      const lean = trunkLeanDegrees(joints);
      mostLean = Math.max(mostLean, lean);
      expect(lean).toBeLessThanOrEqual(30);
      expect(Math.abs(pose.spine.flex)).toBeLessThanOrEqual(5);
    }
    expect(mostLean).toBeGreaterThan(20);
  });

  it("keeps the feet flat and planted, with the hands on the chair arms at the start", () => {
    const first = frames[0]!.joints;
    for (const { joints } of frames) {
      for (const joint of ["heelLeft", "heelRight"] as const) {
        expect(distance(joints[joint], first[joint])).toBeLessThan(1e-6);
        expect(joints[joint].y).toBeCloseTo(0, 3);
      }
      expect(Math.abs(joints.toeRight.y - joints.heelRight.y)).toBeLessThan(0.02);
    }
    expect(first.handRight.y).toBeGreaterThan(0.65);
    expect(first.handRight.y).toBeLessThan(0.75);
  });

  it("starts seated on the chair and ends standing tall", () => {
    const [seated, standingUp] = stillFrames(demo).map((still) => jointPositions(still.pose));
    expect(seated!.pelvis.y).toBeCloseTo(0.55, 2);
    expect(standingUp!.pelvis.y).toBeGreaterThan(0.85);
  });

  it("tucks the feet back under the knees: the heels are well behind the knees at the start", () => {
    const seated = jointPositions(stillFrames(demo)[0]!.pose);
    // Tucked: the ankle is under or behind the knee by 15 to 25 cm (the first version had the feet at the knees).
    const tuck = seated.kneeRight.x - seated.ankleRight.x;
    expect(tuck).toBeGreaterThan(0.15);
    expect(tuck).toBeLessThan(0.30);
  });

  it("keeps the body's centre of mass between the heels and toes whenever the hips are off the seat and neither hand is on a chair arm", () => {
    const chair = demo.props.find((prop) => prop.kind === "chair");
    if (chair?.kind !== "chair") throw new Error("expected a chair");
    const armRests = propBoxes(chair).filter((box) => box.max.y - box.min.y < 0.05 && box.min.y > SEAT_HEIGHT_FOR_TESTS + 0.15);
    const seatedPelvisHeight = frames[0]!.joints.pelvis.y;

    let checked = 0;
    let smallestMargin = Infinity;
    for (const { joints, time } of frames) {
      const hipsOffSeat = joints.pelvis.y > seatedPelvisHeight + 0.03;
      const handOnArm = (["handLeft", "handRight"] as const).some((hand) => handRestsOnTop(joints[hand], armRests));
      if (!hipsOffSeat || handOnArm) continue;

      const margins = footMargins(joints);
      smallestMargin = Math.min(smallestMargin, margins.aheadOfHeels, margins.behindToes);
      expect(margins.aheadOfHeels, `centre of mass behind the heels at ${time} ms`).toBeGreaterThanOrEqual(-0.01);
      expect(margins.behindToes, `centre of mass beyond the toes at ${time} ms`).toBeGreaterThanOrEqual(-0.01);
      checked += 1;
    }
    expect(checked).toBeGreaterThan(20);
    expect(smallestMargin).toBeGreaterThanOrEqual(0);
  });

  it("keeps the weight over the feet before the hips leave the seat, so the lean really comes first", () => {
    // At the moment the pelvis starts to rise (hands still on the arms) the centre of mass is already ahead of the heels.
    const seatedPelvisHeight = frames[0]!.joints.pelvis.y;
    const firstRise = frames.find(({ joints }) => joints.pelvis.y > seatedPelvisHeight + 0.03)!;
    expect(footMargins(firstRise.joints).aheadOfHeels).toBeGreaterThan(0.02);
    expect(centreOfMass(firstRise.joints).x).toBeLessThan(Math.max(firstRise.joints.toeLeft.x, firstRise.joints.toeRight.x));
  });
});

describe("heel and toe raises", () => {
  const demo = steadyStrengthDemos.heel_toe_raises!;
  const frames = sampledFrames(demo);

  it("goes up onto the toes (heels lifted, toes on the floor) and onto the heels (toes lifted, heels on the floor)", () => {
    const [flat, onToes, onHeels] = stillFrames(demo).map((still) => jointPositions(still.pose));
    expect(flat!.heelLeft.y).toBeCloseTo(0, 3);
    expect(onToes!.heelLeft.y).toBeGreaterThan(0.05);
    expect(onToes!.toeLeft.y).toBeCloseTo(0, 3);
    expect(onHeels!.toeLeft.y).toBeGreaterThan(0.05);
    expect(onHeels!.heelLeft.y).toBeCloseTo(0, 3);
  });

  it("changes anchor mid-loop only at identical world points (no jump)", () => {
    // The two flat poses (toe anchored and heel anchored) put the head in the same place.
    const toeAnchored = demo.steps.find((step) => step.kind === "move" && step.from.anchor.joint === "toeRight" && step.label === "Lower down");
    const heelAnchored = demo.steps.find((step) => step.kind === "move" && step.from.anchor.joint === "heelRight" && step.label === "Rock back onto your heels");
    if (toeAnchored?.kind !== "move" || heelAnchored?.kind !== "move") throw new Error("expected both moves");
    expect(distance(jointPositions(toeAnchored.to).head, jointPositions(heelAnchored.from).head)).toBeLessThan(1e-9);
    expect(frames.length).toBeGreaterThan(0);
  });
});

describe("standing bird dog", () => {
  const demo = steadyStrengthDemos.standing_bird_dog!;
  const frames = sampledFrames(demo);

  it("slides the leg back with the toe on or just off the floor (at most 5 cm), hips level, back flat", () => {
    let furthestBack = 0;
    for (const { pose, joints } of frames) {
      expect(joints.toeRight.y).toBeLessThanOrEqual(0.05);
      expect(pose.pelvis.roll).toBe(0);
      expect(Math.abs(pose.spine.flex)).toBeLessThanOrEqual(5);
      expect(Math.abs(joints.hipLeft.y - joints.hipRight.y)).toBeLessThan(1e-9);
      furthestBack = Math.max(furthestBack, joints.hipRight.x - joints.ankleRight.x);
    }
    expect(furthestBack).toBeGreaterThan(0.3);
  });

  it("keeps both hands on the counter and the trunk tipped forward no more than 30 degrees", () => {
    for (const { joints } of frames) {
      expect(trunkLeanDegrees(joints)).toBeLessThanOrEqual(30);
      expect(Math.abs(joints.handLeft.y - 0.935)).toBeLessThan(0.03);
      expect(Math.abs(joints.handRight.y - 0.935)).toBeLessThan(0.03);
    }
  });
});

describe("walking demos", () => {
  it("walk at about 70 (slow) and 95 (comfortable) steps a minute", () => {
    // Each demo shows two steps per loop; the loop is the Start hold plus six moves.
    const stepsPerMinute = (id: string) => (60000 * 2) / (loopLengthMs(steadyStrengthDemos[id]!) - START_HOLD_MS);
    expect(stepsPerMinute("slow_walk")).toBeGreaterThan(66);
    expect(stepsPerMinute("slow_walk")).toBeLessThan(74);
    expect(stepsPerMinute("comfortable_walk")).toBeGreaterThan(90);
    expect(stepsPerMinute("comfortable_walk")).toBeLessThan(100);
  });

  it("the comfortable walk is quicker per step than the slow walk", () => {
    const slow = steadyStrengthDemos.slow_walk!;
    const comfortable = steadyStrengthDemos.comfortable_walk!;
    expect(loopLengthMs(comfortable)).toBeLessThan(loopLengthMs(slow));
    const arms = sampledFrames(slow).map(({ pose }) => pose.armRight.flex);
    expect(Math.max(...arms) - Math.min(...arms)).toBeGreaterThan(20);
  });

  it("loops back to where it started, with the feet always on or above the floor and the body upright", () => {
    for (const id of ["slow_walk", "comfortable_walk"]) {
      const demo = steadyStrengthDemos[id]!;
      const start = jointPositions(frameAt(demo, 0).pose);
      const wrapped = jointPositions(frameAt(demo, loopLengthMs(demo)).pose);
      expect(distance(start.head, wrapped.head)).toBeLessThan(1e-9);
      for (const { joints } of sampledFrames(demo)) expect(trunkLeanDegrees(joints)).toBeLessThan(1);
    }
  });
});

describe("calf stretch", () => {
  const demo = steadyStrengthDemos.calf_stretch!;
  const frames = sampledFrames(demo);

  it("moves the highlighted right leg: its heel slides at least 30 cm back from Start to Hold while the front (left) foot does not move", () => {
    expect(demo.moving).toEqual(["thighRight", "shinRight", "footRight"]);
    const [start, hold] = stillFrames(demo).map((still) => jointPositions(still.pose));
    expect(start!.heelRight.x - hold!.heelRight.x).toBeGreaterThanOrEqual(0.3);
    const first = frames[0]!.joints;
    for (const { joints } of frames) {
      expect(distance(joints.heelLeft, first.heelLeft)).toBeLessThan(1e-9);
      expect(distance(joints.toeLeft, first.toeLeft)).toBeLessThan(1e-3);
    }
  });

  it("keeps the front heel on the floor, the back heel down at the start and in the hold, and leans no more than 20 degrees", () => {
    for (const { joints } of frames) {
      expect(Math.abs(joints.heelLeft.y)).toBeLessThan(0.002);
      expect(trunkLeanDegrees(joints)).toBeLessThanOrEqual(20);
    }
    for (const still of stillFrames(demo)) {
      expect(Math.abs(jointPositions(still.pose).heelRight.y)).toBeLessThan(0.002);
    }
  });

  it("has the back foot behind the front foot and the front knee bent a little in the hold", () => {
    const hold = jointPositions(stillFrames(demo)[1]!.pose);
    expect(hold.heelRight.x).toBeLessThan(hold.heelLeft.x - 0.2);
    expect(hold.heelLeft.y).toBeCloseTo(0, 2);
    expect(angleAtJoint(hold.hipLeft, hold.kneeLeft, hold.ankleLeft)).toBeLessThan(178);
  });
});

describe("doorway chest stretch", () => {
  const demo = steadyStrengthDemos.doorway_chest_stretch!;
  const doorFrame = demo.props.find((prop) => prop.kind === "doorFrame");
  if (doorFrame?.kind !== "doorFrame") throw new Error("expected a door frame");
  /** The left post, and its front face (the face towards the figure, at the post's lowest x). */
  const leftPost = propBoxes(doorFrame).find((box) => box.min.z > 0.4)!;
  const frontFaceX = leftPost.min.x;

  it("keeps the forearm up the door frame, the upper arm about horizontal and the trunk upright, no arching", () => {
    for (const still of stillFrames(demo)) {
      const joints = jointPositions(still.pose);
      // Forearm about vertical, upper arm about level with the shoulder.
      expect(Math.abs(joints.wristLeft.x - joints.elbowLeft.x)).toBeLessThan(0.04);
      expect(joints.wristLeft.y - joints.elbowLeft.y).toBeGreaterThan(0.22);
      expect(Math.abs(joints.elbowLeft.y - joints.shoulderLeft.y)).toBeLessThan(0.08);
      expect(angleAtJoint(joints.shoulderLeft, joints.elbowLeft, joints.wristLeft)).toBeGreaterThan(75);
      expect(angleAtJoint(joints.shoulderLeft, joints.elbowLeft, joints.wristLeft)).toBeLessThan(105);
    }
    for (const { pose } of sampledFrames(demo)) {
      expect(pose.spine.flex).toBeGreaterThanOrEqual(0);
      expect(pose.spine.flex).toBeLessThanOrEqual(5);
    }
  });

  it("lays the forearm flat on the front face of the post (the face towards the figure): elbow and wrist within 2 cm of it, inside the post's width", () => {
    for (const still of stillFrames(demo)) {
      const joints = jointPositions(still.pose);
      for (const joint of ["elbowLeft", "wristLeft"] as const) {
        expect(Math.abs(joints[joint].x - frontFaceX), `${still.label}: ${joint}`).toBeLessThanOrEqual(0.02);
        expect(joints[joint].x, `${still.label}: ${joint} must be in front of the face, not inside the post`).toBeLessThanOrEqual(frontFaceX);
        expect(joints[joint].z).toBeGreaterThanOrEqual(leftPost.min.z);
        expect(joints[joint].z).toBeLessThanOrEqual(leftPost.max.z);
      }
    }
  });

  it("shows the stretch: the elbow is in front of the shoulder line at the start and slightly behind it in the hold", () => {
    const [start, hold] = stillFrames(demo).map((still) => jointPositions(still.pose));
    expect(start!.elbowLeft.x - start!.shoulderLeft.x).toBeGreaterThan(0.03);
    const behind = hold!.shoulderLeft.x - hold!.elbowLeft.x;
    expect(behind).toBeGreaterThan(0.02);
    expect(behind, "slightly behind, not hauled back").toBeLessThan(0.12);
  });

  it("steps forward in the hold: the body is ahead of where it started", () => {
    const [start, hold] = stillFrames(demo).map((still) => jointPositions(still.pose));
    expect(hold!.pelvis.x).toBeGreaterThan(start!.pelvis.x + 0.08);
    expect(hold!.heelLeft.x).toBeGreaterThan(start!.heelLeft.x + 0.2);
  });

  it("opens in a view where the moving arm is not hidden by the near post", () => {
    expect(demo.views[0]).not.toBe("side");
  });
});
