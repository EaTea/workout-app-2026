import { describe, expect, it } from "vitest";
import { steadyStrengthDemos } from "../demo/steadyStrength";
import {
  MAX_FRAME_DELTA_MS, TURN_DURATION_MS, advanceClock, frameDeltaMs, nextView, pauseButtonLabel,
  speedButtonLabel, stillIndexForStep, turnAzimuth, turnButtonLabel, viewCycle,
} from "./demoViewLogic";

describe("viewCycle and nextView", () => {
  it("starts with the demo's own view, then the other two in side, front, angle order", () => {
    expect(viewCycle("side")).toEqual(["side", "front", "threeQuarter"]);
    expect(viewCycle("threeQuarter")).toEqual(["threeQuarter", "side", "front"]);
    expect(viewCycle("front")).toEqual(["front", "side", "threeQuarter"]);
  });

  it("wraps round after the last view", () => {
    const cycle = viewCycle("threeQuarter");
    expect(nextView(cycle, "threeQuarter")).toBe("side");
    expect(nextView(cycle, "side")).toBe("front");
    expect(nextView(cycle, "front")).toBe("threeQuarter");
  });
});

describe("button labels", () => {
  it("names the next view on Turn", () => {
    expect(turnButtonLabel("front")).toBe("↻ Turn (front)");
    expect(turnButtonLabel("threeQuarter")).toBe("↻ Turn (angle)");
  });

  it("names what a tap does for speed and pause", () => {
    expect(speedButtonLabel(1)).toBe("Slower");
    expect(speedButtonLabel(0.5)).toBe("Normal speed");
    expect(pauseButtonLabel(false)).toBe("❚❚ Pause");
    expect(pauseButtonLabel(true)).toBe("▶ Play");
  });
});

describe("clock", () => {
  it("advances by real time times speed", () => {
    expect(advanceClock(1000, 100, 1, false)).toBe(1100);
    expect(advanceClock(1000, 100, 0.5, false)).toBe(1050);
  });

  it("stands still while paused", () => {
    expect(advanceClock(3000, 100, 1, true)).toBe(3000);
  });

  it("counts the first frame as zero and caps long gaps so the clock never jumps", () => {
    expect(frameDeltaMs(null, 5000)).toBe(0);
    expect(frameDeltaMs(1000, 1016)).toBe(16);
    expect(frameDeltaMs(1000, 60000)).toBe(MAX_FRAME_DELTA_MS);
    expect(frameDeltaMs(1000, 900)).toBe(0);
  });
});

describe("turnAzimuth", () => {
  it("eases from the old angle to the new one over the turn duration", () => {
    expect(turnAzimuth(0, 90, 0)).toBe(0);
    expect(turnAzimuth(0, 90, TURN_DURATION_MS / 2)).toBeCloseTo(45);
    expect(turnAzimuth(0, 90, TURN_DURATION_MS)).toBe(90);
    expect(turnAzimuth(0, 90, TURN_DURATION_MS * 3)).toBe(90);
  });

  it("is slower at the ends than the middle", () => {
    expect(turnAzimuth(0, 90, TURN_DURATION_MS * 0.1)).toBeLessThan(9);
  });
});

describe("stillIndexForStep", () => {
  const demo = steadyStrengthDemos.high_wall_sit!;

  it("numbers the holds and gives -1 for moves", () => {
    expect(stillIndexForStep(demo, 0)).toBe(0);
    expect(stillIndexForStep(demo, 1)).toBe(-1);
    expect(stillIndexForStep(demo, 2)).toBe(1);
    expect(stillIndexForStep(demo, 3)).toBe(-1);
  });
});
