import { describe, expect, it } from "vitest";
import { copyPose, legAngles, reanchored, solveLimb } from "./poseTools";
import { distance, jointPositions, neutralStandingPose } from "./skeleton";

describe("solveLimb", () => {
  it("puts a hand on a reachable point", () => {
    const start = neutralStandingPose();
    start.armLeft = { flex: 30, abduct: 0, rotate: 0, elbow: 60, wrist: 0 };
    const target = { x: 0.45, y: 0.95, z: 0.18 };
    const solved = solveLimb(start, "armLeft", { handLeft: target }, ["flex", "abduct", "elbow"]);
    expect(distance(jointPositions(solved).handLeft, target)).toBeLessThan(0.005);
  });

  it("puts a foot flat on a point on the floor and leaves the input untouched", () => {
    const start = neutralStandingPose();
    start.legLeft = { flex: 30, abduct: 0, knee: 30, ankle: 0 };
    const before = copyPose(start);
    const solved = solveLimb(start, "legLeft", { heelLeft: { x: 0.0, y: 0, z: 0.09 }, toeLeft: { x: 0.22, y: 0, z: 0.09 } }, ["flex", "knee", "ankle"]);
    const joints = jointPositions(solved);
    expect(joints.heelLeft.y).toBeCloseTo(0, 2);
    expect(joints.toeLeft.y).toBeCloseTo(0, 2);
    expect(start).toEqual(before);
  });
});

describe("reanchored", () => {
  it("changes the anchor joint without moving the figure", () => {
    const pose = neutralStandingPose();
    pose.legRight = { flex: 10, abduct: 0, knee: 20, ankle: -10 };
    const other = reanchored(pose, "toeRight");
    expect(other.anchor.joint).toBe("toeRight");
    const a = jointPositions(pose);
    const b = jointPositions(other);
    expect(distance(a.head, b.head)).toBeLessThan(1e-9);
    expect(distance(a.heelLeft, b.heelLeft)).toBeLessThan(1e-9);
  });
});

describe("legAngles", () => {
  it("keeps the leg still in the world when the pelvis tips forward", () => {
    const upright = neutralStandingPose({ x: 0, y: 0.9, z: 0 });
    upright.anchor = { joint: "pelvis", at: { x: 0, y: 0.9, z: 0 } };
    upright.legLeft = legAngles({ thigh: 20, knee: 10, foot: 0 });
    const tipped = neutralStandingPose();
    tipped.anchor = { joint: "pelvis", at: { x: 0, y: 0.9, z: 0 } };
    tipped.pelvis.pitch = 25;
    tipped.legLeft = legAngles({ thigh: 20, knee: 10, foot: 0 }, 25);
    const a = jointPositions(upright);
    const b = jointPositions(tipped);
    expect(distance(a.ankleLeft, b.ankleLeft)).toBeLessThan(1e-9);
    expect(b.toeLeft.y - b.heelLeft.y).toBeCloseTo(0, 6);
  });
});
