import { describe, expect, it } from "vitest";
import type { Demo, Prop } from "./model";
import { CAMERA_AZIMUTH, FINGER_SEGMENT_METRES, computeFraming, fingerPoints, heldThingCentre, isMoving, propBoxes } from "./renderer";
import { distance, jointPositions, neutralStandingPose, palmDirections } from "./skeleton";

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
      { kind: "wall", x: 0.5, side: "left" },
      { kind: "wall", x: 0.5, side: "right" },
      { kind: "rail", z: 0.3, height: 1, fromX: -0.5, toX: 1 },
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

describe("walls beside the figure and rails", () => {
  it("puts a side wall's near face the given distance from the centre line, on the named side, thin and parallel to the figure's direction", () => {
    const [left] = propBoxes({ kind: "wall", x: 0.5, side: "left" });
    const [right] = propBoxes({ kind: "wall", x: 0.5, side: "right" });

    expect(left!.min.z).toBeCloseTo(0.5);
    expect(left!.max.z - left!.min.z).toBeCloseTo(0.06);
    expect(right!.max.z).toBeCloseTo(-0.5);
    expect(left!.max.x - left!.min.x).toBeGreaterThan(1);
  });

  it("a rail is a bar whose top is at its height with a post at each end standing on the floor", () => {
    const [bar, ...posts] = propBoxes({ kind: "rail", z: 0.3, height: 1, fromX: -0.5, toX: 1 });

    expect(bar!.max.y).toBeCloseTo(1);
    expect(bar!.min.x).toBeCloseTo(-0.5);
    expect(bar!.max.x).toBeCloseTo(1);
    expect(posts).toHaveLength(2);
    for (const post of posts) expect(post.min.y).toBe(0);
  });

  it("frames a demo whose band is tied to a joint (no fixed point) and one with a wall beside the figure", () => {
    const band = demoWith({ props: [{ kind: "band", anchor: "handLeft", toJoints: ["handRight"] }] });
    const wall = demoWith({ props: [{ kind: "wall", x: 0.5, side: "left" }] });

    expect(Number.isFinite(computeFraming(band).radius)).toBe(true);
    // The camera has to fit the figure and a wall half a metre to its side.
    expect(computeFraming(wall).centre.z).toBeGreaterThan(computeFraming(band).centre.z);
  });
});

describe("curled fingers and held things", () => {
  const withArm = (arm: Partial<typeof standing.armLeft>) => ({ ...standing, armLeft: { ...standing.armLeft, flex: 90, ...arm } });

  it("reads the palm direction from the hand: a hanging hand faces forward, and with the elbow bent a right angle the palm faces up", () => {
    expect(palmDirections(standing).Left.x).toBeCloseTo(1);
    expect(palmDirections(withArm({ flex: 0, elbow: 90 })).Left.y).toBeCloseTo(1);
  });

  it("finger points start at the hand, run straight on at grip 0 and curl towards the palm as the grip grows", () => {
    const pose = withArm({ elbow: 90 });
    const joints = jointPositions(pose);
    const palm = palmDirections(pose).Left;

    const open = fingerPoints(joints.wristLeft, joints.handLeft, palm, 0);
    const closed = fingerPoints(joints.wristLeft, joints.handLeft, palm, 1);
    expect(open[0]).toEqual(joints.handLeft);
    expect(distance(open[0], open[2])).toBeCloseTo(FINGER_SEGMENT_METRES[0] + FINGER_SEGMENT_METRES[1]);
    // Curled: the tips come back towards the palm side of the hand (palm . (tip - hand) grows).
    const towardsPalm = (point: { x: number; y: number; z: number }) => (point.x - joints.handLeft.x) * palm.x + (point.y - joints.handLeft.y) * palm.y + (point.z - joints.handLeft.z) * palm.z;
    expect(towardsPalm(closed[2])).toBeGreaterThan(towardsPalm(open[2]) + 0.04);
    expect(distance(closed[0], closed[2])).toBeLessThan(distance(open[0], open[2]));
  });

  it("seats a ball in the palm (on the palm side of the hand) and hangs a bag 12 cm below the hand", () => {
    const pose = withArm({ elbow: 90 });
    const joints = jointPositions(pose);
    const palms = palmDirections(pose);

    const ball = heldThingCentre({ kind: "ball", joint: "handLeft" }, joints, palms);
    expect(distance(ball, joints.handLeft)).toBeLessThan(0.1);
    expect((ball.x - joints.wristLeft.x) * palms.Left.x + (ball.y - joints.wristLeft.y) * palms.Left.y + (ball.z - joints.wristLeft.z) * palms.Left.z).toBeGreaterThan(0.05);

    const bag = heldThingCentre({ kind: "bag", joint: "handLeft" }, joints, palms);
    expect(bag).toEqual({ x: joints.handLeft.x, y: joints.handLeft.y - 0.12, z: joints.handLeft.z });
  });
});
