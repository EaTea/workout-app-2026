import { describe, expect, it } from "vitest";
import { loopLengthMs, frameAt } from "./timeline";
import { angleAtJoint, jointPositions } from "./skeleton";
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
