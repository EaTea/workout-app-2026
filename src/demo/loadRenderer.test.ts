import { describe, expect, it, vi } from "vitest";
import type { Demo } from "./model";
import type { DemoRenderer } from "./renderer";
import { neutralStandingPose } from "./skeleton";

// The flat renderer needs a DOM; here it is replaced by a marker so the
// fallback decision can be tested in plain Node.
const flatRenderer: DemoRenderer = { draw: vi.fn(), resize: vi.fn(), dispose: vi.fn() };
vi.mock("./renderFlat", () => ({ createRendererFlat: vi.fn(() => flatRenderer) }));

import { createDemoRenderer } from "./loadRenderer";
import { createRendererFlat } from "./renderFlat";

const demo: Demo = {
  exerciseId: "test", cue: "", ariaLabel: "", view: "side", framing: "body", moving: [], props: [],
  steps: [{ kind: "hold", pose: neutralStandingPose(), ms: 1000, label: "Start" }],
};
const container = {} as HTMLElement;

describe("createDemoRenderer", () => {
  it("uses the 3D renderer when it can be created", async () => {
    const threeD: DemoRenderer = { draw: vi.fn(), resize: vi.fn(), dispose: vi.fn() };

    const result = await createDemoRenderer(container, demo, () => threeD);

    expect(result.kind).toBe("3d");
    expect(result.renderer).toBe(threeD);
  });

  it("falls back to flat when creating the 3D renderer throws (no WebGL)", async () => {
    const result = await createDemoRenderer(container, demo, () => {
      throw new Error("Error creating WebGL context.");
    });

    expect(result.kind).toBe("flat");
    expect(result.renderer).toBe(flatRenderer);
    expect(createRendererFlat).toHaveBeenCalledWith(container, demo);
  });

  it("falls back to flat when the 3D module can't be loaded (rejected promise)", async () => {
    const result = await createDemoRenderer(container, demo, () => Promise.reject(new Error("Failed to fetch dynamically imported module")));

    expect(result.kind).toBe("flat");
  });
});
