import { describe, expect, it } from "vitest";
import { centreOfMass, footMargins } from "./balance";
import { jointPositions, neutralStandingPose } from "./skeleton";

describe("centreOfMass", () => {
  it("sits over the middle of the feet for a relaxed standing figure, near the pelvis height", () => {
    const joints = jointPositions(neutralStandingPose());
    const centre = centreOfMass(joints);

    // Feet are flat from heel (x = -0.05 relative to the ankle) to toe (+0.17); the centre of mass is above them.
    expect(centre.x).toBeGreaterThan(joints.heelRight.x);
    expect(centre.x).toBeLessThan(joints.toeRight.x);
    // Left and right are symmetric.
    expect(centre.z).toBeCloseTo(joints.pelvis.z, 6);
    // Roughly at the hips (a bit above, because the trunk and head are heavy).
    expect(centre.y).toBeGreaterThan(joints.pelvis.y);
    expect(centre.y).toBeLessThan(joints.pelvis.y + 0.25);
  });

  it("moves forward when the trunk leans forward and back when it leans back (legs unchanged)", () => {
    const upright = neutralStandingPose();
    const forward = neutralStandingPose();
    forward.spine.flex = 30;
    const backward = neutralStandingPose();
    backward.spine.flex = -30;

    const centreX = (pose: ReturnType<typeof neutralStandingPose>) => centreOfMass(jointPositions(pose)).x;
    expect(centreX(forward)).toBeGreaterThan(centreX(upright) + 0.05);
    expect(centreX(backward)).toBeLessThan(centreX(upright) - 0.05);
  });
});

describe("footMargins", () => {
  it("is positive both ways for a standing figure and negative behind the heels when leaning back", () => {
    const standing = footMargins(jointPositions(neutralStandingPose()));
    expect(standing.aheadOfHeels).toBeGreaterThan(0);
    expect(standing.behindToes).toBeGreaterThan(0);

    // Leaning the whole body back about the pelvis with the legs vertical (hips tilted back, legs compensating) puts the weight behind the heels.
    const leaning = neutralStandingPose();
    leaning.pelvis.pitch = -60;
    leaning.legLeft.flex = 60;
    leaning.legRight.flex = 60;
    expect(footMargins(jointPositions(leaning)).aheadOfHeels).toBeLessThan(0);
  });
});
