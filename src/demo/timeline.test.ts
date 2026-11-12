import { describe, expect, it } from "vitest";
import type { Demo, Pose } from "./model";
import { HOLD_EXERCISE_MS, MOVE_MS, START_HOLD_MS } from "./model";
import { neutralStandingPose } from "./skeleton";
import { blendPoses, ease, frameAt, holdStartTimes, loopLengthMs, nextHoldTime, stillFrames } from "./timeline";

const standing: Pose = neutralStandingPose();
const sitting: Pose = {
  ...neutralStandingPose(),
  legLeft: { flex: 40, abduct: 0, knee: 80, ankle: 0 },
  legRight: { flex: 40, abduct: 0, knee: 80, ankle: 0 },
  anchor: { joint: "heelRight", at: { x: 0.2, y: 0, z: -0.09 } },
};

/** A demo shaped like the plan's high wall sit: hold, move, long hold, move back. */
const wallSit: Demo = {
  exerciseId: "wall-sit",
  cue: "Back on the wall, slide down a little and hold.",
  ariaLabel: "High wall sit",
  view: "side",
  framing: "body",
  moving: ["thighLeft", "thighRight"],
  props: [{ kind: "wall", x: -0.15 }],
  steps: [
    { kind: "hold", pose: standing, ms: START_HOLD_MS, label: "Start" },
    { kind: "move", from: standing, to: sitting, ms: MOVE_MS, label: "Slide down" },
    { kind: "hold", pose: sitting, ms: HOLD_EXERCISE_MS, label: "Hold" },
    { kind: "move", from: sitting, to: standing, ms: MOVE_MS, label: "Slide up" },
  ],
};

describe("ease", () => {
  it("maps 0, 0.5 and 1 to themselves and is slow at the ends", () => {
    expect(ease(0)).toBe(0);
    expect(ease(0.5)).toBeCloseTo(0.5);
    expect(ease(1)).toBeCloseTo(1);
    expect(ease(0.1)).toBeLessThan(0.1);
    expect(ease(0.9)).toBeGreaterThan(0.9);
  });
});

describe("blendPoses", () => {
  it("returns the ends at t = 0 and 1 and the midpoint at 0.5", () => {
    expect(blendPoses(standing, sitting, 0)).toEqual(standing);
    expect(blendPoses(standing, sitting, 1)).toEqual(sitting);
    const middle = blendPoses(standing, sitting, 0.5);
    expect(middle.legLeft.knee).toBeCloseTo(40);
    expect(middle.anchor.at.x).toBeCloseTo(0.1);
    expect(middle.anchor.joint).toBe("heelRight");
  });

  it("throws a clear error when the anchors name different joints", () => {
    const other: Pose = { ...sitting, anchor: { joint: "pelvis", at: { x: 0, y: 1, z: 0 } } };
    expect(() => blendPoses(standing, other, 0.5)).toThrow(/different joints/);
  });
});

describe("loop timing", () => {
  it("adds up the step lengths", () => {
    expect(loopLengthMs(wallSit)).toBe(10500);
  });

  it("starts on step 0 with its label", () => {
    const frame = frameAt(wallSit, 0);
    expect(frame.stepIndex).toBe(0);
    expect(frame.label).toBe("Start");
    expect(frame.pose).toEqual(standing);
  });

  it("is exactly the eased midpoint half way through a move", () => {
    const frame = frameAt(wallSit, START_HOLD_MS + MOVE_MS / 2);
    expect(frame.stepIndex).toBe(1);
    expect(frame.label).toBe("Slide down");
    expect(frame.pose).toEqual(blendPoses(standing, sitting, ease(0.5)));
    expect(frame.pose.legLeft.knee).toBeCloseTo(40);
  });

  it("holds the end pose during the long hold", () => {
    const frame = frameAt(wallSit, 6000);
    expect(frame.stepIndex).toBe(2);
    expect(frame.label).toBe("Hold");
    expect(frame.pose).toEqual(sitting);
  });

  it("wraps back to step 0 at the end of the loop", () => {
    expect(frameAt(wallSit, 10500).stepIndex).toBe(0);
    expect(frameAt(wallSit, 10500 + 1250).stepIndex).toBe(0);
    expect(frameAt(wallSit, 21000 + 2000).stepIndex).toBe(1);
  });

  it("treats negative elapsed time as wrapping from the end", () => {
    expect(frameAt(wallSit, -100).stepIndex).toBe(3);
  });

  it("throws for a demo with no steps", () => {
    expect(() => frameAt({ ...wallSit, steps: [] }, 0)).toThrow(/no steps/);
  });
});

describe("hold navigation for reduced motion", () => {
  it("lists the hold start times", () => {
    expect(holdStartTimes(wallSit)).toEqual([0, 4000]);
  });

  it("finds the next hold start strictly after the current position, wrapping", () => {
    expect(nextHoldTime(wallSit, 3000)).toBe(4000);
    expect(nextHoldTime(wallSit, 5000)).toBe(10500);
    expect(nextHoldTime(wallSit, 12000)).toBe(14500);
    expect(nextHoldTime(wallSit, 0)).toBe(4000);
    expect(nextHoldTime(wallSit, 4000)).toBe(10500);
  });

  it("returns the hold poses and labels as stills", () => {
    const stills = stillFrames(wallSit);
    expect(stills.map((still) => still.label)).toEqual(["Start", "Hold"]);
    expect(stills[0]?.pose).toEqual(standing);
    expect(stills[1]?.pose).toEqual(sitting);
  });

  it("throws from nextHoldTime when there are no holds", () => {
    const movesOnly: Demo = { ...wallSit, steps: [{ kind: "move", from: standing, to: sitting, ms: 1000, label: "Go" }] };
    expect(() => nextHoldTime(movesOnly, 0)).toThrow(/no hold/);
  });
});
