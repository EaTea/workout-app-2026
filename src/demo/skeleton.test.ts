import { describe, expect, it } from "vitest";
import type { JointName, Pose } from "./model";
import { ALL_JOINTS, BODY, angleAtJoint, distance, jointPositions, neutralStandingPose } from "./skeleton";

/** Neutral standing pose with some parts overridden, so each test states only what it changes. */
function poseWith(changes: Partial<Pose>): Pose {
  return { ...neutralStandingPose(), ...changes };
}

describe("neutral standing pose", () => {
  const joints = jointPositions(neutralStandingPose());

  it("has both heels on the floor at x = 0", () => {
    expect(joints.heelLeft.y).toBeCloseTo(0);
    expect(joints.heelRight.y).toBeCloseTo(0);
    expect(joints.heelLeft.x).toBeCloseTo(0);
  });

  it("has the toes on the floor in front of the heels", () => {
    expect(joints.toeLeft.y).toBeCloseTo(0);
    expect(joints.toeLeft.x).toBeGreaterThan(joints.heelLeft.x);
  });

  it("has the head as the highest joint", () => {
    for (const joint of ALL_JOINTS) {
      if (joint !== "head") expect(joints.head.y).toBeGreaterThanOrEqual(joints[joint].y);
    }
  });

  it("stands about 1.65 m tall", () => {
    expect(joints.head.y + 0.1).toBeGreaterThan(1.6);
    expect(joints.head.y + 0.1).toBeLessThan(1.72);
  });

  it("mirrors left and right in z, with the left side at +z", () => {
    const pairs: Array<[JointName, JointName]> = [
      ["hipLeft", "hipRight"], ["kneeLeft", "kneeRight"], ["ankleLeft", "ankleRight"],
      ["heelLeft", "heelRight"], ["toeLeft", "toeRight"], ["shoulderLeft", "shoulderRight"],
      ["elbowLeft", "elbowRight"], ["wristLeft", "wristRight"], ["handLeft", "handRight"],
    ];
    for (const [left, right] of pairs) {
      expect(joints[left].z).toBeGreaterThan(0);
      expect(joints[left].z).toBeCloseTo(-joints[right].z);
      expect(joints[left].x).toBeCloseTo(joints[right].x);
      expect(joints[left].y).toBeCloseTo(joints[right].y);
    }
  });

  it("has the arms hanging straight down", () => {
    expect(joints.handLeft.y).toBeLessThan(joints.shoulderLeft.y - 0.6);
    expect(joints.handLeft.x).toBeCloseTo(joints.shoulderLeft.x);
  });
});

describe("joint semantics", () => {
  it("hip flex 90 puts the knee in front of the hip at hip height", () => {
    const pose = poseWith({ legLeft: { flex: 90, abduct: 0, knee: 0, ankle: 0 } });
    const joints = jointPositions(pose);
    expect(joints.kneeLeft.x - joints.hipLeft.x).toBeCloseTo(BODY.thigh);
    expect(joints.kneeLeft.y).toBeCloseTo(joints.hipLeft.y);
  });

  it("hip abduct 90 puts the knee out to that leg's own side", () => {
    const left = jointPositions(poseWith({ legLeft: { flex: 0, abduct: 90, knee: 0, ankle: 0 } }));
    expect(left.kneeLeft.z - left.hipLeft.z).toBeCloseTo(BODY.thigh);
    const right = jointPositions(poseWith({ legRight: { flex: 0, abduct: 90, knee: 0, ankle: 0 } }));
    expect(right.kneeRight.z - right.hipRight.z).toBeCloseTo(-BODY.thigh);
  });

  it("knee 90 with hip flex 90 puts the ankle straight below the knee", () => {
    const joints = jointPositions(poseWith({ legLeft: { flex: 90, abduct: 0, knee: 90, ankle: 0 } }));
    expect(joints.ankleLeft.x).toBeCloseTo(joints.kneeLeft.x);
    expect(joints.ankleLeft.y).toBeCloseTo(joints.kneeLeft.y - BODY.shin);
  });

  it("knee bend with the hip straight bends the shin backwards", () => {
    const joints = jointPositions(poseWith({ legLeft: { flex: 0, abduct: 0, knee: 60, ankle: 0 } }));
    expect(joints.ankleLeft.x).toBeLessThan(joints.kneeLeft.x);
  });

  it("ankle +20 raises the toe", () => {
    const flat = jointPositions(neutralStandingPose());
    const raised = jointPositions(poseWith({ legLeft: { flex: 0, abduct: 0, knee: 0, ankle: 20 } }));
    expect(raised.toeLeft.y - raised.ankleLeft.y).toBeGreaterThan(flat.toeLeft.y - flat.ankleLeft.y + 0.04);
  });

  it("ankle negative points the toe down", () => {
    const flat = jointPositions(neutralStandingPose());
    const pointed = jointPositions(poseWith({ legLeft: { flex: 0, abduct: 0, knee: 0, ankle: -20 } }));
    expect(pointed.toeLeft.y).toBeLessThan(flat.toeLeft.y + flat.ankleLeft.y - pointed.ankleLeft.y - 0.01);
  });

  it("arm flex 90 points the hand forward at shoulder height", () => {
    const joints = jointPositions(poseWith({ armLeft: { flex: 90, abduct: 0, rotate: 0, elbow: 0, wrist: 0 } }));
    expect(joints.handLeft.y).toBeCloseTo(joints.shoulderLeft.y);
    expect(joints.handLeft.x - joints.shoulderLeft.x).toBeCloseTo(BODY.upperArm + BODY.forearm + BODY.hand);
  });

  it("arm flex negative swings the arm behind", () => {
    const joints = jointPositions(poseWith({ armLeft: { flex: -30, abduct: 0, rotate: 0, elbow: 0, wrist: 0 } }));
    expect(joints.handLeft.x).toBeLessThan(joints.shoulderLeft.x);
  });

  it("arm abduct 90 puts the hand out to that side", () => {
    const left = jointPositions(poseWith({ armLeft: { flex: 0, abduct: 90, rotate: 0, elbow: 0, wrist: 0 } }));
    expect(left.handLeft.z - left.shoulderLeft.z).toBeCloseTo(BODY.upperArm + BODY.forearm + BODY.hand);
    expect(left.handLeft.y).toBeCloseTo(left.shoulderLeft.y);
    const right = jointPositions(poseWith({ armRight: { flex: 0, abduct: 90, rotate: 0, elbow: 0, wrist: 0 } }));
    expect(right.handRight.z - right.shoulderRight.z).toBeCloseTo(-(BODY.upperArm + BODY.forearm + BODY.hand));
  });

  it("elbow 90 with the arm hanging points the forearm forward", () => {
    const joints = jointPositions(poseWith({ armLeft: { flex: 0, abduct: 0, rotate: 0, elbow: 90, wrist: 0 } }));
    expect(joints.wristLeft.x - joints.elbowLeft.x).toBeCloseTo(BODY.forearm);
    expect(joints.wristLeft.y).toBeCloseTo(joints.elbowLeft.y);
    expect(joints.wristLeft.z).toBeCloseTo(joints.elbowLeft.z);
  });

  it("positive rotate with the elbow at 90 moves each hand away from the midline", () => {
    const joints = jointPositions(poseWith({
      armLeft: { flex: 0, abduct: 0, rotate: 60, elbow: 90, wrist: 0 },
      armRight: { flex: 0, abduct: 0, rotate: 60, elbow: 90, wrist: 0 },
    }));
    expect(joints.wristLeft.z).toBeGreaterThan(joints.elbowLeft.z + 0.1);
    expect(joints.wristRight.z).toBeLessThan(joints.elbowRight.z - 0.1);
  });

  it("negative rotate brings the hand across the belly", () => {
    const joints = jointPositions(poseWith({ armLeft: { flex: 0, abduct: 0, rotate: -60, elbow: 90, wrist: 0 } }));
    expect(joints.wristLeft.z).toBeLessThan(joints.elbowLeft.z - 0.1);
  });

  it("wrist +40 with the forearm forward and palm up lifts the hand", () => {
    const joints = jointPositions(poseWith({ armLeft: { flex: 0, abduct: 0, rotate: 0, elbow: 90, wrist: 40 } }));
    expect(joints.handLeft.y).toBeGreaterThan(joints.wristLeft.y + 0.04);
  });

  it("spine flex +30 moves the chest forward and -10 moves it back", () => {
    const forward = jointPositions(poseWith({ spine: { flex: 30, sideBend: 0 } }));
    expect(forward.chest.x - forward.pelvis.x).toBeCloseTo(BODY.spine * Math.sin(Math.PI / 6));
    const back = jointPositions(poseWith({ spine: { flex: -10, sideBend: 0 } }));
    expect(back.chest.x).toBeLessThan(back.pelvis.x);
  });

  it("spine sideBend positive moves the chest towards the left (+z)", () => {
    const joints = jointPositions(poseWith({ spine: { flex: 0, sideBend: 20 } }));
    expect(joints.chest.z).toBeGreaterThan(0.1);
  });

  it("neck turn +45 moves the nose towards +z", () => {
    const joints = jointPositions(poseWith({ neck: { flex: 0, turn: 45, retract: 0 } }));
    expect(joints.nose.z - joints.head.z).toBeCloseTo(BODY.noseForward * Math.sin(Math.PI / 4));
    expect(joints.nose.x - joints.head.x).toBeGreaterThan(0);
  });

  it("neck flex positive tips the chin down", () => {
    const joints = jointPositions(poseWith({ neck: { flex: 30, turn: 0, retract: 0 } }));
    expect(joints.nose.y).toBeLessThan(joints.head.y);
  });

  it("neck retract moves the head towards -x", () => {
    const joints = jointPositions(poseWith({ neck: { flex: 0, turn: 0, retract: 0.05 } }));
    const neutral = jointPositions(neutralStandingPose());
    expect(joints.head.x - neutral.head.x).toBeCloseTo(-0.05);
  });

  it("pelvis pitch -90 lies the figure on its back, head towards -x, toes up", () => {
    const joints = jointPositions(poseWith({
      pelvis: { pitch: -90, roll: 0, yaw: 0 },
      anchor: { joint: "pelvis", at: { x: 0, y: 0.5, z: 0 } },
    }));
    expect(joints.head.x).toBeLessThan(-0.6);
    expect(joints.head.y).toBeCloseTo(0.5, 1);
    expect(joints.ankleLeft.x).toBeGreaterThan(0.6);
    expect(joints.toeLeft.y - joints.heelLeft.y).toBeCloseTo(BODY.footLength + BODY.heelBack);
  });

  it("pelvis pitch positive tips the body forward", () => {
    const joints = jointPositions(poseWith({ pelvis: { pitch: 30, roll: 0, yaw: 0 } }));
    expect(joints.head.x).toBeGreaterThan(0.2);
  });

  it("pelvis roll positive tips the body towards +z", () => {
    const joints = jointPositions(poseWith({ pelvis: { pitch: 0, roll: 30, yaw: 0 } }));
    expect(joints.head.z).toBeGreaterThan(0.2);
  });

  it("pelvis yaw positive turns the figure to face +z, like neck turn", () => {
    const joints = jointPositions(poseWith({ pelvis: { pitch: 0, roll: 0, yaw: 90 } }));
    expect(joints.nose.z - joints.head.z).toBeCloseTo(BODY.noseForward);
    expect(joints.hipLeft.x).toBeLessThan(0); // left hip swings round to the back
  });
});

describe("measurement helpers", () => {
  it("distance is the straight-line length", () => {
    expect(distance({ x: 0, y: 0, z: 0 }, { x: 3, y: 4, z: 0 })).toBeCloseTo(5);
  });

  it("angleAtJoint gives the interior angle", () => {
    expect(angleAtJoint({ x: 1, y: 0, z: 0 }, { x: 0, y: 0, z: 0 }, { x: 0, y: 1, z: 0 })).toBeCloseTo(90);
    expect(angleAtJoint({ x: -1, y: 0, z: 0 }, { x: 0, y: 0, z: 0 }, { x: 1, y: 0, z: 0 })).toBeCloseTo(180);
  });

  it("a knee bend of 45 reads as an interior angle of 135", () => {
    const joints = jointPositions(poseWith({ legLeft: { flex: 0, abduct: 0, knee: 45, ankle: 0 } }));
    expect(angleAtJoint(joints.hipLeft, joints.kneeLeft, joints.ankleLeft)).toBeCloseTo(135);
  });
});

describe("limb lengths", () => {
  const variedPoses: Pose[] = [
    neutralStandingPose(),
    poseWith({
      pelvis: { pitch: 25, roll: -10, yaw: 40 },
      spine: { flex: 20, sideBend: 8 },
      neck: { flex: 15, turn: -30, retract: 0.03 },
      armLeft: { flex: 70, abduct: 30, rotate: 40, elbow: 100, wrist: 30 },
      armRight: { flex: -20, abduct: 80, rotate: -50, elbow: 20, wrist: -20 },
      legLeft: { flex: 60, abduct: 10, knee: 80, ankle: 15 },
      legRight: { flex: -25, abduct: 20, knee: 10, ankle: -30 },
      anchor: { joint: "pelvis", at: { x: 1, y: 2, z: 3 } },
    }),
    poseWith({
      pelvis: { pitch: -90, roll: 0, yaw: 0 },
      armLeft: { flex: 120, abduct: 90, rotate: 90, elbow: 130, wrist: 60 },
      legRight: { flex: 90, abduct: 0, knee: 90, ankle: 0 },
      anchor: { joint: "heelLeft", at: { x: -0.4, y: 0.6, z: 0.2 } },
    }),
  ];

  it("keeps every segment the same length whatever the angles", () => {
    const segments: Array<[JointName, JointName, number]> = [
      ["hipLeft", "kneeLeft", BODY.thigh], ["kneeLeft", "ankleLeft", BODY.shin],
      ["hipRight", "kneeRight", BODY.thigh], ["kneeRight", "ankleRight", BODY.shin],
      ["pelvis", "chest", BODY.spine], ["chest", "neck", BODY.chestToNeck],
      ["chest", "shoulderLeft", BODY.shoulderHalfWidth], ["chest", "shoulderRight", BODY.shoulderHalfWidth],
      ["shoulderLeft", "elbowLeft", BODY.upperArm], ["elbowLeft", "wristLeft", BODY.forearm],
      ["wristLeft", "handLeft", BODY.hand],
      ["shoulderRight", "elbowRight", BODY.upperArm], ["elbowRight", "wristRight", BODY.forearm],
      ["wristRight", "handRight", BODY.hand],
      ["hipLeft", "hipRight", 2 * BODY.pelvisHalfWidth],
      ["head", "nose", BODY.noseForward],
    ];
    for (const pose of variedPoses) {
      const joints = jointPositions(pose);
      for (const [from, to, length] of segments) {
        expect(distance(joints[from], joints[to])).toBeCloseTo(length, 9);
      }
    }
  });
});

describe("anchor", () => {
  it("puts the named joint exactly at the given point", () => {
    const target = { x: 0.7, y: 0.45, z: -0.2 };
    const joints = jointPositions(poseWith({
      armLeft: { flex: 45, abduct: 10, rotate: 0, elbow: 30, wrist: 0 },
      anchor: { joint: "handLeft", at: target },
    }));
    expect(joints.handLeft.x).toBeCloseTo(target.x, 12);
    expect(joints.handLeft.y).toBeCloseTo(target.y, 12);
    expect(joints.handLeft.z).toBeCloseTo(target.z, 12);
  });
});
