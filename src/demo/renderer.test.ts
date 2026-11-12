import { describe, expect, it } from "vitest";
import type { Demo, Prop } from "./model";
import { CAMERA_AZIMUTH, computeFraming, isMoving, propBoxes } from "./renderer";
import { jointPositions, neutralStandingPose } from "./skeleton";

const standing = neutralStandingPose();

/** A minimal demo holding one pose, for exercising framing. */
function demoWith(overrides: Partial<Demo>): Demo {
  return {
    exerciseId: "test", cue: "", ariaLabel: "", views: ["side"], framing: "body", moving: [], props: [],
    steps: [{ kind: "hold", pose: standing, ms: 1000, label: "Start" }],
    ...overrides,
  };
}

describe("CAMERA_AZIMUTH", () => {
  it("is 0 for side, 90 for front and 40 for three-quarter", () => {
    expect(CAMERA_AZIMUTH).toEqual({ side: 0, front: 90, threeQuarter: 40 });
  });
});

describe("isMoving", () => {
  it("is true only for the parts the demo lists", () => {
    const demo = demoWith({ moving: ["thighLeft"] });

    expect(isMoving(demo, "thighLeft")).toBe(true);
    expect(isMoving(demo, "thighRight")).toBe(false);
  });
});

describe("propBoxes", () => {
  it("gives every furniture kind at least one well-formed box and held things none", () => {
    const furniture: Prop[] = [
      { kind: "wall", x: -0.2 },
      { kind: "counter", x: 0.4, height: 0.9 },
      { kind: "counter", x: 0.3, height: 0.9, side: "left" },
      { kind: "chair", x: 0.2, seatHeight: 0.46, withArms: false },
      { kind: "chair", x: 0.2, seatHeight: 0.46, withArms: true },
      { kind: "doorFrame", x: 0.3 },
      { kind: "bed", x: -0.5, height: 0.5, length: 2 },
      { kind: "stair", x: 0.3, height: 0.18 },
    ];
    for (const prop of furniture) {
      const boxes = propBoxes(prop);
      expect(boxes.length).toBeGreaterThan(0);
      for (const { min, max } of boxes) {
        expect(max.x).toBeGreaterThan(min.x);
        expect(max.y).toBeGreaterThan(min.y);
        expect(max.z).toBeGreaterThan(min.z);
      }
    }

    expect(propBoxes({ kind: "ball", joint: "handLeft" })).toEqual([]);
    expect(propBoxes({ kind: "band", anchor: { x: 1, y: 1, z: 0 }, toJoints: ["wristLeft"] })).toEqual([]);
  });

  it("gives a chair with arms more blocks than one without", () => {
    const plain = propBoxes({ kind: "chair", x: 0.2, seatHeight: 0.46, withArms: false });
    const withArms = propBoxes({ kind: "chair", x: 0.2, seatHeight: 0.46, withArms: true });

    expect(withArms.length).toBeGreaterThan(plain.length);
  });

  it("puts a side counter on the figure's left (+z) or right (-z)", () => {
    const left = propBoxes({ kind: "counter", x: 0.3, height: 0.9, side: "left" })[0]!;
    const right = propBoxes({ kind: "counter", x: 0.3, height: 0.9, side: "right" })[0]!;

    expect(left.min.z).toBeGreaterThan(0);
    expect(right.max.z).toBeLessThan(0);
  });

  it("has a chair's seat front edge at x and its back towards -x", () => {
    const [seat, back] = propBoxes({ kind: "chair", x: 0.2, seatHeight: 0.46, withArms: false }) as [ReturnType<typeof propBoxes>[0], ReturnType<typeof propBoxes>[0]];

    expect(seat.max.x).toBeCloseTo(0.2);
    expect(back.max.x).toBeLessThan(seat.max.x);
  });
});

describe("computeFraming", () => {
  it("body framing contains every joint of the pose and the furniture", () => {
    const demo = demoWith({ props: [{ kind: "stair", x: 0.5, height: 0.18 }] });
    const { centre, radius } = computeFraming(demo);

    for (const point of Object.values(jointPositions(standing))) {
      expect(Math.hypot(point.x - centre.x, point.y - centre.y, point.z - centre.z)).toBeLessThanOrEqual(radius);
    }
    expect(Math.hypot(1.1 - centre.x, 0.18 - centre.y, 0.5 - centre.z)).toBeLessThanOrEqual(radius);
  });

  it("a head close-up is centred near the head and is tighter than the body framing", () => {
    const body = computeFraming(demoWith({}));
    const closeUp = computeFraming(demoWith({ framing: "closeUpHead" }));
    const head = jointPositions(standing).head;

    expect(closeUp.radius).toBeLessThan(body.radius);
    expect(Math.abs(closeUp.centre.y - head.y)).toBeLessThan(0.15);
  });

  it("a hand close-up follows the moving side", () => {
    const left = computeFraming(demoWith({ framing: "closeUpHand", moving: ["handLeft"] }));
    const right = computeFraming(demoWith({ framing: "closeUpHand", moving: ["handRight"] }));

    expect(left.centre.z).toBeGreaterThan(0);
    expect(right.centre.z).toBeLessThan(0);
  });
});

describe("computeFraming with a bed", () => {
  it("frames the near part of a long bed, so a 2 m bed does not shrink the figure", () => {
    const shortBed = computeFraming(demoWith({ props: [{ kind: "bed", x: 0, height: 0.5, length: 0.5 }] }));
    const longBed = computeFraming(demoWith({ props: [{ kind: "bed", x: 0, height: 0.5, length: 2.0 }] }));
    expect(longBed.radius).toBeLessThan(shortBed.radius + 0.35);
  });
});
