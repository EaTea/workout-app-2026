import { describe, expect, it } from "vitest";
import { nearness, projectPoint } from "./renderFlat";

describe("projectPoint", () => {
  it("side view (azimuth 0): +x is on the viewer's right, height is up, z is ignored", () => {
    const forward = projectPoint({ x: 0.5, y: 1, z: 0.3 }, 0);

    expect(forward.right).toBeCloseTo(0.5);
    expect(forward.up).toBe(1);
  });

  it("front view (azimuth 90): the figure's left (+z) is on the viewer's right, x is ignored", () => {
    const left = projectPoint({ x: 0.5, y: 1, z: 0.3 }, 90);

    expect(left.right).toBeCloseTo(0.3);
    expect(projectPoint({ x: 0, y: 0, z: -0.3 }, 90).right).toBeCloseTo(-0.3);
  });

  it("three-quarter view blends the two", () => {
    const point = projectPoint({ x: 1, y: 0, z: 1 }, 40);

    expect(point.right).toBeCloseTo(Math.cos((40 * Math.PI) / 180) + Math.sin((40 * Math.PI) / 180));
  });
});

describe("nearness", () => {
  it("side view: the figure's right side (-z) is nearer the camera than its left", () => {
    expect(nearness({ x: 0, y: 0, z: -0.1 }, 0)).toBeGreaterThan(nearness({ x: 0, y: 0, z: 0.1 }, 0));
  });

  it("front view: a point further forward (+x) is nearer the camera", () => {
    expect(nearness({ x: 0.2, y: 0, z: 0 }, 90)).toBeGreaterThan(nearness({ x: -0.2, y: 0, z: 0 }, 90));
  });
});
