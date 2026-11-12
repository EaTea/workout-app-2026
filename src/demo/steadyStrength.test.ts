import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { loopLengthMs, frameAt, stillFrames } from "./timeline";
import { BODY, angleAtJoint, distance, jointPositions } from "./skeleton";
import type { Demo, JointName, Pose, Vec3 } from "./model";
import { steadyStrengthDemos } from "./steadyStrength";
import { demoFor } from "./registry";

/** Every 100 ms across one whole loop, including the blended frames inside the moves. */
function sampleTimes(loopMs: number): number[] {
  const times: number[] = [];
  for (let time = 0; time < loopMs; time += 100) times.push(time);
  return times;
}

describe("registry", () => {
  it("finds a Steady Strength demo by program id and exercise id", () => {
    expect(demoFor("steady-strength", "high_wall_sit")).toBe(steadyStrengthDemos.high_wall_sit);
  });

  it("returns nothing for other programs, unknown exercises and inherited object keys", () => {
    expect(demoFor("explosive-endurance", "high_wall_sit")).toBeUndefined();
    expect(demoFor("steady-strength", "pull_up")).toBeUndefined();
    expect(demoFor("steady-strength", "toString")).toBeUndefined();
    expect(demoFor("constructor", "high_wall_sit")).toBeUndefined();
  });
});

describe("high wall sit demo", () => {
  const demo = steadyStrengthDemos.high_wall_sit!;

  it("matches the plan: side view, body framing, wall, cue and the 10.5 s loop", () => {
    expect(demo.view).toBe("side");
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
const PLAN_TABLE: Record<string, { cue: string; view: Demo["view"]; framing: Demo["framing"] }> = {
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
  doorway_chest_stretch: { cue: "Forearm on the door frame, step forward gently until you feel a stretch, and hold.", view: "side", framing: "body" },
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
        expect(demo.view).toBe(planned.view);
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
        const spineRange: [number, number] = demo.exerciseId === "standing_back_extension" ? [-10, 0] : [-5, 5];
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

  it("sits on a chair and keeps the pumping leg still while only the ankle moves", () => {
    const first = frames[0]!.pose.legRight;
    for (const { pose } of frames) {
      expect(pose.legRight.flex).toBe(first.flex);
      expect(pose.legRight.knee).toBe(first.knee);
    }
    expect(demo.props.map((prop) => prop.kind)).toEqual(["chair"]);
  });

  it("pulls the toes up then points them, with the toes clear of the floor", () => {
    const toeHeights = frames.map(({ joints }) => joints.toeRight.y);
    // Flat the toe is about 7 cm up; pulled up it rises to 15 cm; pointed it comes down to the floor but not through it.
    expect(Math.max(...toeHeights)).toBeGreaterThan(0.13);
    expect(Math.min(...toeHeights)).toBeLessThan(0.02);
    expect(Math.min(...toeHeights)).toBeGreaterThanOrEqual(-0.01);
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
  /** The highest point of the counter's top, from its props. */
  it("keeps the hand within 3 cm of the counter top in the holds of the counter exercises", () => {
    for (const id of ["single_leg_stand", "heel_to_toe_stand", "heel_toe_raises", "side_hip_raise", "standing_bird_dog"]) {
      for (const still of stillFrames(steadyStrengthDemos[id]!)) {
        const joints = jointPositions(still.pose);
        const lowestHandHeight = Math.min(...(["handLeft", "handRight"] as const).map((hand) => joints[hand].y));
        const handsOnCounter = (["handLeft", "handRight"] as const).filter((hand) => Math.abs(joints[hand].y - 0.935) < 0.03);
        expect(handsOnCounter.length, `${id}: ${still.label} (lowest hand ${lowestHandHeight.toFixed(3)})`).toBeGreaterThanOrEqual(1);
      }
    }
  });
});

describe("heel to toe stand", () => {
  it("ends with the front heel touching the back toe, in one line, both feet flat", () => {
    const hold = stillFrames(steadyStrengthDemos.heel_to_toe_stand!)[1]!;
    const joints = jointPositions(hold.pose);
    expect(Math.abs(joints.heelLeft.x - joints.toeRight.x)).toBeLessThan(0.02);
    expect(Math.abs(joints.heelLeft.z - joints.heelRight.z)).toBeLessThan(0.02);
    expect(joints.heelLeft.y).toBeCloseTo(0, 2);
    expect(joints.toeLeft.y).toBeCloseTo(0, 2);
  });
});

describe("sideways walking", () => {
  const demo = steadyStrengthDemos.sideways_walking!;
  const frames = sampledFrames(demo);

  it("steps out then in without ever crossing the feet, and travels about 20 cm per step", () => {
    for (const { joints } of frames) {
      // Facing -x, the figure's left is world -z: the left foot stays further left than the right.
      expect(joints.ankleLeft.z).toBeLessThan(joints.ankleRight.z - 0.1);
    }
    const first = frames[0]!.joints.pelvis.z;
    const last = frames[frames.length - 1]!.joints.pelvis.z;
    expect(first - last).toBeGreaterThan(0.1);
  });

  it("keeps a hand on the counter and the whole figure over the counter's width", () => {
    const counter = demo.props.find((prop) => prop.kind === "counter");
    expect(counter).toBeDefined();
    for (const { joints } of frames) {
      expect(Math.abs(joints.handLeft.y - 0.935)).toBeLessThan(0.04);
      expect(Math.abs(joints.pelvis.z)).toBeLessThan(0.6);
    }
  });
});

describe("glute bridge hold", () => {
  const demo = steadyStrengthDemos.glute_bridge_hold!;
  const frames = sampledFrames(demo);
  const bed = demo.props.find((prop) => prop.kind === "bed");
  if (bed?.kind !== "bed") throw new Error("expected a bed");

  /** Interior angle chest-pelvis-knees (the knees' midpoint keeps the three points in one plane). */
  const bridgeAngle = (joints: Record<JointName, Vec3>): number => {
    const kneeMiddle = { x: (joints.kneeLeft.x + joints.kneeRight.x) / 2, y: (joints.kneeLeft.y + joints.kneeRight.y) / 2, z: (joints.kneeLeft.z + joints.kneeRight.z) / 2 };
    return angleAtJoint(joints.chest, joints.pelvis, kneeMiddle);
  };

  it("lifts the hips to a straight shoulder-hip-knee line and no higher", () => {
    for (const { joints } of frames) expect(bridgeAngle(joints)).toBeLessThanOrEqual(182);
    const hold = jointPositions(stillFrames(demo)[1]!.pose);
    expect(bridgeAngle(hold)).toBeGreaterThanOrEqual(170);
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

  it("presses the hands straight out in front while the body does not turn", () => {
    const frames = sampledFrames(demo);
    for (const { pose, joints } of frames) {
      expect(pose.pelvis.yaw).toBe(0);
      expect(pose.spine.flex).toBe(0);
      expect(Math.abs(joints.handLeft.z + joints.handRight.z)).toBeLessThan(0.02);
    }
    const [atChest, pressedOut] = stillFrames(demo).map((still) => jointPositions(still.pose));
    expect(pressedOut!.handLeft.x - atChest!.handLeft.x).toBeGreaterThan(0.25);
    // Arms are about straight in the hold.
    expect(angleAtJoint(pressedOut!.shoulderLeft, pressedOut!.elbowLeft, pressedOut!.wristLeft)).toBeGreaterThan(165);
  });

  it("holds a band from the door post at chest height to both hands", () => {
    const band = demo.props.find((prop) => prop.kind === "band");
    expect(band).toEqual(expect.objectContaining({ toJoints: ["handLeft", "handRight"] }));
    if (band?.kind === "band") expect(band.anchor.y).toBeCloseTo(1.25, 2);
    expect(demo.props.map((prop) => prop.kind)).toContain("doorFrame");
  });
});

describe("sit-to-stand", () => {
  const demo = steadyStrengthDemos.sit_to_stand!;
  const frames = sampledFrames(demo);

  it("matches the plan's 8 second loop", () => {
    expect(loopLengthMs(demo)).toBe(8000);
    expect(demo.steps.map((step) => step.label)).toEqual(["Start", "Stand up", "Stand up", "End", "Sit down slowly", "Sit down slowly"]);
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

  it("keeps the back heel on the floor, leans no more than 20 degrees, with the hands on the wall", () => {
    const wall = demo.props[0];
    if (wall?.kind !== "wall") throw new Error("expected a wall");
    for (const { joints } of frames) {
      expect(joints.heelRight.y).toBeCloseTo(0, 5);
      expect(trunkLeanDegrees(joints)).toBeLessThanOrEqual(20);
    }
    for (const still of stillFrames(demo)) {
      const joints = jointPositions(still.pose);
      expect(Math.abs(joints.handLeft.x - (wall.x - 0.06))).toBeLessThan(0.04);
      expect(Math.abs(joints.handRight.x - (wall.x - 0.06))).toBeLessThan(0.04);
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

  it("keeps the forearm up the door frame, the upper arm about horizontal and the trunk upright", () => {
    for (const still of stillFrames(demo)) {
      const joints = jointPositions(still.pose);
      // Forearm about vertical, upper arm about level with the shoulder.
      expect(Math.abs(joints.wristLeft.x - joints.elbowLeft.x)).toBeLessThan(0.04);
      expect(joints.wristLeft.y - joints.elbowLeft.y).toBeGreaterThan(0.22);
      expect(Math.abs(joints.elbowLeft.y - joints.shoulderLeft.y)).toBeLessThan(0.08);
      expect(angleAtJoint(joints.shoulderLeft, joints.elbowLeft, joints.wristLeft)).toBeGreaterThan(75);
      expect(angleAtJoint(joints.shoulderLeft, joints.elbowLeft, joints.wristLeft)).toBeLessThan(105);
    }
    for (const { pose } of sampledFrames(demo)) expect(pose.spine.flex).toBe(0);
  });

  it("steps forward in the hold: the body is ahead of where it started", () => {
    const [start, hold] = stillFrames(demo).map((still) => jointPositions(still.pose));
    expect(hold!.pelvis.x).toBeGreaterThan(start!.pelvis.x + 0.08);
    expect(hold!.heelLeft.x).toBeGreaterThan(start!.heelLeft.x + 0.2);
  });
});
