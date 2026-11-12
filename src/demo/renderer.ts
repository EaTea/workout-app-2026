/**
 * What the two "Show me" renderers (3D and flat) have in common: the
 * interface the view talks to, the camera angles, and the geometry of the
 * furniture and camera framing, so both renderers draw the same scene.
 *
 *   demoView ──▶ createDemoRenderer (loadRenderer.ts)
 *                   ├─▶ render3d.ts    (three.js, lazily loaded)
 *                   └─▶ renderFlat.ts  (SVG, the no-WebGL fallback)
 *                         both implement DemoRenderer and both use the
 *                         helpers below (propBoxes, computeFraming, isMoving).
 *
 * Pure TypeScript with no DOM or three.js, so it is unit tested in Vitest.
 *
 * A note on handedness. model.ts puts +z on the figure's LEFT with x forward
 * and y up. That triple is left-handed, while three.js is right-handed. The
 * 3D renderer therefore draws every point at (x, y, -z), which makes the
 * picture the way a real person looks. The camera azimuth is measured in that
 * drawn world:
 *
 *      top view (looking down), figure faces +x, azimuth 0 = side view
 *
 *               front view (azimuth 90)
 *                       camera
 *                         |
 *       side view  --> figure -->  +x      side camera (azimuth 0) is on the
 *                                          figure's right-hand side, so the
 *                                          figure faces the viewer's right
 *
 * In the side view +x is on the viewer's right; in the front view the
 * figure's left (+z) is on the viewer's right, just as when facing a person.
 */
import { blendPoses } from "./timeline";
import { jointPositions } from "./skeleton";
import type { BodyPart, CameraView, Demo, JointName, Pose, Prop, Vec3 } from "./model";

/**
 * A running "Show me" picture. The view creates one per demo, calls `draw`
 * every animation frame (and when the camera is turned), `resize` when its
 * container changes size, and `dispose` when the overlay closes.
 */
export interface DemoRenderer {
  /** Draws the figure in `pose` as seen from `cameraAzimuthDegrees` (0 = side, 90 = front). */
  draw(pose: Pose, cameraAzimuthDegrees: number): void;
  /** Re-fits the picture to its container after the container changed size. */
  resize(): void;
  /** Frees everything (GPU memory, DOM nodes) and removes the picture from its container. */
  dispose(): void;
}

/** Camera azimuth in degrees for each named view (0 = side-on, 90 = front-on). */
export const CAMERA_AZIMUTH: Record<CameraView, number> = {
  side: 0,
  front: 90,
  threeQuarter: 40,
};

/** True if the demo wants this body part drawn yellow ("the bit that moves"). */
export function isMoving(demo: Demo, part: BodyPart): boolean {
  return demo.moving.includes(part);
}

// ---------------------------------------------------------------------------
// Furniture
// ---------------------------------------------------------------------------

/** An axis-aligned box in metres (model coordinates), used for every grey block. */
export type PropBox = { min: Vec3; max: Vec3 };

/** Shorthand used by the prop tables below. */
function box(minX: number, minY: number, minZ: number, maxX: number, maxY: number, maxZ: number): PropBox {
  return { min: { x: minX, y: minY, z: minZ }, max: { x: maxX, y: maxY, z: maxZ } };
}

/** Half the width (z) of a chair seat, stair or counter in front of the figure, in metres. */
const FURNITURE_HALF_WIDTH = 0.5;
const CHAIR_SEAT_DEPTH = 0.44;
const CHAIR_HALF_WIDTH = 0.25;

/**
 * The grey blocks that make up a furniture prop, as boxes in model
 * coordinates. Held things and the band are not furniture; they return an
 * empty list. Both renderers draw exactly these boxes.
 *
 * Interpretation notes: a "counter" with a `side` runs along x beside the
 * figure, and its `x` is then how far (in metres) its near edge is from the
 * figure's centre line; without a `side` it stands in front of the figure
 * with its near edge at x. A "stair" rises towards +x from its front edge.
 */
export function propBoxes(prop: Prop): PropBox[] {
  switch (prop.kind) {
    case "wall":
      return [box(prop.x - 0.06, 0, -0.8, prop.x, 2.2, 0.8)];

    case "counter": {
      if (prop.side === undefined) {
        return [box(prop.x, 0, -0.6, prop.x + 0.6, prop.height, 0.6)];
      }
      const nearEdge = prop.x;
      const [minZ, maxZ] = prop.side === "left" ? [nearEdge, nearEdge + 0.5] : [-nearEdge - 0.5, -nearEdge];
      return [box(-0.8, 0, minZ, 0.8, prop.height, maxZ)];
    }

    case "chair": {
      const frontX = prop.x;
      const backX = frontX - CHAIR_SEAT_DEPTH;
      const seatTop = prop.seatHeight;
      const seatBottom = seatTop - 0.05;
      const boxes: PropBox[] = [
        // Seat and back rest.
        box(backX, seatBottom, -CHAIR_HALF_WIDTH, frontX, seatTop, CHAIR_HALF_WIDTH),
        box(backX - 0.05, seatTop, -CHAIR_HALF_WIDTH, backX, seatTop + 0.5, CHAIR_HALF_WIDTH),
      ];
      // Four legs, set in a little from the seat corners.
      for (const legX of [frontX - 0.05, backX + 0.01]) {
        for (const legZ of [CHAIR_HALF_WIDTH - 0.05, -CHAIR_HALF_WIDTH + 0.01]) {
          boxes.push(box(legX, 0, legZ, legX + 0.04, seatBottom, legZ + 0.04));
        }
      }
      if (prop.withArms) {
        for (const sideSign of [1, -1]) {
          const outer = sideSign * (CHAIR_HALF_WIDTH + 0.02);
          const inner = sideSign * (CHAIR_HALF_WIDTH - 0.03);
          const [minZ, maxZ] = outer < inner ? [outer, inner] : [inner, outer];
          boxes.push(box(backX + 0.04, seatTop + 0.18, minZ, frontX - 0.04, seatTop + 0.22, maxZ)); // arm rest
          boxes.push(box(frontX - 0.12, seatTop, minZ, frontX - 0.08, seatTop + 0.18, maxZ)); // arm support
        }
      }
      return boxes;
    }

    case "doorFrame":
      return [
        box(prop.x - 0.05, 0, 0.42, prop.x + 0.05, 2.0, 0.5), // left post
        box(prop.x - 0.05, 0, -0.5, prop.x + 0.05, 2.0, -0.42), // right post
        box(prop.x - 0.05, 2.0, -0.5, prop.x + 0.05, 2.08, 0.5), // lintel
      ];

    case "bed":
      return [
        box(prop.x, 0, -0.45, prop.x + prop.length, prop.height - 0.2, 0.45), // base
        box(prop.x, prop.height - 0.2, -0.5, prop.x + prop.length, prop.height, 0.5), // mattress
        box(prop.x - 0.06, 0, -0.5, prop.x, prop.height + 0.5, 0.5), // headboard
      ];

    case "stair":
      return [box(prop.x, 0, -FURNITURE_HALF_WIDTH, prop.x + 0.6, prop.height, FURNITURE_HALF_WIDTH)];

    case "band":
    case "ball":
    case "bag":
    case "tin":
      return [];
  }
}

// ---------------------------------------------------------------------------
// Camera framing
// ---------------------------------------------------------------------------

/**
 * Where the camera looks and how much it must fit: a sphere around the
 * interesting stuff. A sphere looks the same from every azimuth, so a camera
 * placed to fit the sphere never clips the figure however it is turned.
 */
export type CameraFraming = { centre: Vec3; radius: number };

/** Padding in metres added around the sampled points to cover limb thickness. */
const FRAMING_PADDING = 0.12;
/** Smallest radius for the close-ups, so they never zoom in so far that nothing is recognisable. */
const CLOSE_UP_MIN_RADIUS = { closeUpHead: 0.4, closeUpHand: 0.4, closeUpFoot: 0.45 } as const;

/** Every pose worth sampling: each hold's pose, and a move's ends and quarter points. */
function samplePoses(demo: Demo): Pose[] {
  const poses: Pose[] = [];
  for (const step of demo.steps) {
    if (step.kind === "hold") {
      poses.push(step.pose);
    } else {
      for (const fraction of [0, 0.25, 0.5, 0.75, 1]) {
        poses.push(blendPoses(step.from, step.to, fraction));
      }
    }
  }
  return poses;
}

/** Which side ("Left" or "Right") a close-up should look at: the first moving part of that body region, else Left. */
function closeUpSide(moving: BodyPart[], regionNames: readonly string[]): "Left" | "Right" {
  for (const part of moving) {
    if (part.endsWith("Left") && regionNames.includes(part.slice(0, -"Left".length))) return "Left";
    if (part.endsWith("Right") && regionNames.includes(part.slice(0, -"Right".length))) return "Right";
  }
  return "Left";
}

/** Joints the close-up looks at, for each close-up framing. */
function closeUpJoints(demo: Demo): JointName[] {
  switch (demo.framing) {
    case "closeUpHead":
      return ["head", "nose"];
    case "closeUpHand": {
      const side = closeUpSide(demo.moving, ["hand", "forearm", "arm"]);
      return [`wrist${side}`, `hand${side}`];
    }
    case "closeUpFoot": {
      const side = closeUpSide(demo.moving, ["foot", "shin", "thigh"]);
      return [`ankle${side}`, `heel${side}`, `toe${side}`];
    }
    case "body":
      return [];
  }
}

/** Corner points of all furniture, and for a wall just a column of points at its x (a wall is far wider than the figure). */
function furniturePointsForFraming(prop: Prop): Vec3[] {
  if (prop.kind === "wall") {
    return [{ x: prop.x, y: 0, z: 0 }, { x: prop.x, y: 1.7, z: 0 }];
  }
  if (prop.kind === "band") {
    return [prop.anchor];
  }
  const points: Vec3[] = [];
  for (const { min, max } of propBoxes(prop)) {
    for (const x of [min.x, max.x]) for (const y of [min.y, max.y]) for (const z of [min.z, max.z]) points.push({ x, y, z });
  }
  return points;
}

/**
 * The sphere the camera must fit for this demo. "body" covers every joint
 * of every sampled pose plus the furniture; the close-ups cover only the
 * area of interest (head, hand or foot) over the whole loop. Fixed for the
 * whole loop, so the camera never moves by itself.
 */
export function computeFraming(demo: Demo): CameraFraming {
  const poses = samplePoses(demo);
  const points: Vec3[] = [];

  if (demo.framing === "body") {
    for (const pose of poses) points.push(...Object.values(jointPositions(pose)));
    for (const prop of demo.props) points.push(...furniturePointsForFraming(prop));
    points.push({ x: 0, y: 0, z: 0 });
  } else {
    const joints = closeUpJoints(demo);
    for (const pose of poses) {
      const positions = jointPositions(pose);
      for (const joint of joints) points.push(positions[joint]);
    }
  }

  const low = { x: Infinity, y: Infinity, z: Infinity };
  const high = { x: -Infinity, y: -Infinity, z: -Infinity };
  for (const point of points) {
    low.x = Math.min(low.x, point.x); high.x = Math.max(high.x, point.x);
    low.y = Math.min(low.y, point.y); high.y = Math.max(high.y, point.y);
    low.z = Math.min(low.z, point.z); high.z = Math.max(high.z, point.z);
  }
  const centre = { x: (low.x + high.x) / 2, y: (low.y + high.y) / 2, z: (low.z + high.z) / 2 };

  let farthest = 0;
  for (const point of points) {
    farthest = Math.max(farthest, Math.hypot(point.x - centre.x, point.y - centre.y, point.z - centre.z));
  }

  const minimumRadius = demo.framing === "body" ? 0 : CLOSE_UP_MIN_RADIUS[demo.framing];
  return { centre, radius: Math.max(farthest + FRAMING_PADDING, minimumRadius) };
}
