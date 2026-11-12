/**
 * Picks the "Show me" renderer: the 3D one if it can be loaded and WebGL
 * works, otherwise the flat SVG one. The view (ui/demoView.ts) calls this
 * once when it opens.
 *
 *   createDemoRenderer ──▶ import("./render3d") ──▶ createRenderer3d ──ok──▶ { kind: "3d" }
 *                              │ import fails (offline before the chunk was cached)
 *                              └─ or WebGL can't be created ──────────▶ createRendererFlat { kind: "flat" }
 *
 * render3d.ts (and so three.js) is only ever reached through the dynamic
 * import below, which keeps it in its own chunk, out of the main bundle.
 */
import type { Demo } from "./model";
import type { DemoRenderer } from "./renderer";
import { createRendererFlat } from "./renderFlat";

/** Something that builds the 3D renderer; injectable so tests need no WebGL. */
export type Renderer3dFactory = (container: HTMLElement, demo: Demo) => DemoRenderer | Promise<DemoRenderer>;

/** The real factory: loads the three.js chunk on first use, then builds the renderer. */
const loadRenderer3d: Renderer3dFactory = async (container, demo) => {
  const { createRenderer3d } = await import("./render3d");
  return createRenderer3d(container, demo);
};

/**
 * Creates the best available renderer inside `container`. Any failure of the
 * 3D path (the chunk can't be fetched, WebGL is missing or blocked) falls back
 * to the flat renderer, which cannot fail. `kind` tells the view which one it
 * got. `create3d` is for tests.
 */
export async function createDemoRenderer(
  container: HTMLElement,
  demo: Demo,
  create3d: Renderer3dFactory = loadRenderer3d,
): Promise<{ renderer: DemoRenderer; kind: "3d" | "flat" }> {
  try {
    return { renderer: await create3d(container, demo), kind: "3d" };
  } catch {
    return { renderer: createRendererFlat(container, demo), kind: "flat" };
  }
}
