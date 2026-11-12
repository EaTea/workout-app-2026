/**
 * The flat "Show me" renderer: the no-WebGL fallback. A thick-line figure in
 * an inline SVG, white on black, with the moving parts yellow and furniture
 * as plain grey rectangles. It draws from the same `jointPositions()` as the
 * 3D renderer and honours the same camera azimuth, so Turn still works.
 *
 *   Pose ──jointPositions──▶ joint points ──projectPoint──▶ 2D ──▶ SVG lines / circles
 *
 * Chosen over a 2D canvas because SVG needs no pixel-ratio handling, scales
 * with its container, and can be updated by changing a few attributes.
 */
import type { BodyPart, Demo, JointName, Pose, Prop, Vec3 } from "./model";
import { jointPositions } from "./skeleton";
import { computeFraming, isMoving, propBoxes, type DemoRenderer } from "./renderer";

/** A point on the screen in metres: `right` to the viewer's right, `up` up the screen. */
export type ScreenPoint = { right: number; up: number };

/**
 * Orthographic projection of a model point for a camera at `azimuthDegrees`
 * (0 = side view, 90 = front view). Depth is ignored.
 *
 *   right = x * cos(az) + z * sin(az)        up = y
 *
 * Side view (az 0): right = x, so +x (forward) is on the viewer's right and
 * the figure faces right. Front view (az 90): right = z, so the figure's left
 * (+z) is on the viewer's right, as when facing a person. In between the two
 * blend smoothly, which is the three-quarter view.
 */
export function projectPoint(point: Vec3, azimuthDegrees: number): ScreenPoint {
  const azimuth = (azimuthDegrees * Math.PI) / 180;
  return { right: point.x * Math.cos(azimuth) + point.z * Math.sin(azimuth), up: point.y };
}

/**
 * How near a point is to the camera (larger = nearer). Used only to decide
 * which limbs are drawn on top of which; it is not part of the projection.
 */
export function nearness(point: Vec3, azimuthDegrees: number): number {
  const azimuth = (azimuthDegrees * Math.PI) / 180;
  return point.x * Math.sin(azimuth) - point.z * Math.cos(azimuth);
}

const SVG_NAMESPACE = "http://www.w3.org/2000/svg";
/** The SVG's own coordinate size; it is scaled to fit whatever square it is placed in. */
const VIEW_SIZE = 360;
const LIMB_WIDTH = 14;
const TRUNK_WIDTH = 34;

/** One drawn line segment of the body: between two joints, in the colour of one body part. */
type Segment = { from: JointName; to: JointName; part: BodyPart; width: number; element: SVGLineElement };

/**
 * Creates the flat renderer inside `container`. Unlike the 3D one it can't
 * fail, which is why it is the fallback.
 */
export function createRendererFlat(container: HTMLElement, demo: Demo): DemoRenderer {
  const svg = document.createElementNS(SVG_NAMESPACE, "svg");
  svg.setAttribute("viewBox", `0 0 ${VIEW_SIZE} ${VIEW_SIZE}`);
  svg.setAttribute("width", "100%");
  svg.setAttribute("height", "100%");
  svg.setAttribute("focusable", "false");
  svg.style.display = "block";
  svg.style.background = "#000";

  const framing = computeFraming(demo);
  // Pixels per metre: the framing sphere's diameter fills the square.
  const scale = VIEW_SIZE / 2 / framing.radius;

  /** Converts a model point to SVG coordinates (y grows downwards on screen). */
  function toSvg(point: Vec3, azimuthDegrees: number, centreOnScreen: ScreenPoint): { x: number; y: number } {
    const projected = projectPoint(point, azimuthDegrees);
    return {
      x: VIEW_SIZE / 2 + (projected.right - centreOnScreen.right) * scale,
      y: VIEW_SIZE / 2 - (projected.up - centreOnScreen.up) * scale,
    };
  }

  /** Makes an SVG element with the given attributes. */
  function create<K extends keyof SVGElementTagNameMap>(tag: K, attributes: Record<string, string>): SVGElementTagNameMap[K] {
    const element = document.createElementNS(SVG_NAMESPACE, tag);
    for (const [name, value] of Object.entries(attributes)) element.setAttribute(name, value);
    return element;
  }

  // ---- furniture: one rectangle per grey block, re-fitted on every draw ----
  const furniture = demo.props.flatMap((prop) =>
    propBoxes(prop).map((box) => ({ box, element: create("rect", { fill: "#5d636e" }) })),
  );
  const floorLine = create("line", { stroke: "#3a3f48", "stroke-width": "3" });

  // ---- held things and band ----
  type HeldThing = { prop: Prop; element: SVGElement };
  const heldThings = demo.props.flatMap((prop): HeldThing[] => {
    if (prop.kind === "band") return [{ prop, element: create("line", { stroke: "#FFD60A", "stroke-width": "4", "stroke-linecap": "round" }) }];
    if (prop.kind === "ball") return [{ prop, element: create("circle", { fill: "#FFD60A", r: String(0.07 * scale) }) }];
    if (prop.kind === "bag") return [{ prop, element: create("rect", { fill: "#FFD60A", width: String(0.18 * scale), height: String(0.22 * scale) }) }];
    if (prop.kind === "tin") return [{ prop, element: create("rect", { fill: "#FFD60A", width: String(0.08 * scale), height: String(0.11 * scale) }) }];
    return [];
  });

  // ---- the figure ----
  const limb = (from: JointName, to: JointName, part: BodyPart, width = LIMB_WIDTH): Segment => ({
    from, to, part, width,
    element: create("line", { "stroke-linecap": "round", "stroke-width": String(width) }),
  });
  const segments: Segment[] = [
    limb("pelvis", "chest", "trunk", TRUNK_WIDTH),
    limb("shoulderLeft", "shoulderRight", "trunk"),
    limb("chest", "head", "head", LIMB_WIDTH - 4),
    limb("hipLeft", "kneeLeft", "thighLeft"), limb("kneeLeft", "ankleLeft", "shinLeft"), limb("heelLeft", "toeLeft", "footLeft"),
    limb("hipRight", "kneeRight", "thighRight"), limb("kneeRight", "ankleRight", "shinRight"), limb("heelRight", "toeRight", "footRight"),
    limb("shoulderLeft", "elbowLeft", "armLeft"), limb("elbowLeft", "wristLeft", "forearmLeft"), limb("wristLeft", "handLeft", "handLeft"),
    limb("shoulderRight", "elbowRight", "armRight"), limb("elbowRight", "wristRight", "forearmRight"), limb("wristRight", "handRight", "handRight"),
  ];
  const headCircle = create("circle", { r: String(0.1 * scale) });
  const noseDot = create("circle", { r: String(0.025 * scale) });

  for (const segment of segments) segment.element.setAttribute("stroke", isMoving(demo, segment.part) ? "#FFD60A" : "#f4f4f4");
  const headColour = isMoving(demo, "head") ? "#FFD60A" : "#f4f4f4";
  headCircle.setAttribute("fill", headColour);
  noseDot.setAttribute("fill", headColour);

  svg.append(floorLine, ...furniture.map((item) => item.element));
  container.append(svg);

  return {
    draw(pose: Pose, cameraAzimuthDegrees: number): void {
      const joints = jointPositions(pose);
      const centreOnScreen = projectPoint(framing.centre, cameraAzimuthDegrees);
      const place = (point: Vec3) => toSvg(point, cameraAzimuthDegrees, centreOnScreen);

      // Floor: a line along the ground, right across the square.
      const floorY = place({ x: 0, y: 0, z: 0 }).y;
      floorLine.setAttribute("x1", "0");
      floorLine.setAttribute("x2", String(VIEW_SIZE));
      floorLine.setAttribute("y1", String(floorY));
      floorLine.setAttribute("y2", String(floorY));

      // Furniture: the bounding rectangle of each projected box.
      for (const { box, element } of furniture) {
        const corners = [box.min.x, box.max.x].flatMap((x) =>
          [box.min.y, box.max.y].flatMap((y) => [box.min.z, box.max.z].map((z) => place({ x, y, z }))),
        );
        const xs = corners.map((corner) => corner.x);
        const ys = corners.map((corner) => corner.y);
        element.setAttribute("x", String(Math.min(...xs)));
        element.setAttribute("y", String(Math.min(...ys)));
        element.setAttribute("width", String(Math.max(...xs) - Math.min(...xs)));
        element.setAttribute("height", String(Math.max(...ys) - Math.min(...ys)));
      }

      // Body: far segments first so near ones are drawn on top.
      const ordered = [...segments].sort(
        (first, second) =>
          nearness(joints[first.from], cameraAzimuthDegrees) + nearness(joints[first.to], cameraAzimuthDegrees) -
          (nearness(joints[second.from], cameraAzimuthDegrees) + nearness(joints[second.to], cameraAzimuthDegrees)),
      );
      for (const segment of ordered) {
        const start = place(joints[segment.from]);
        const end = place(joints[segment.to]);
        segment.element.setAttribute("x1", String(start.x));
        segment.element.setAttribute("y1", String(start.y));
        segment.element.setAttribute("x2", String(end.x));
        segment.element.setAttribute("y2", String(end.y));
        svg.append(segment.element); // Re-appending moves it to the top of the stack.
      }

      const headPoint = place(joints.head);
      const nosePoint = place(joints.nose);
      headCircle.setAttribute("cx", String(headPoint.x));
      headCircle.setAttribute("cy", String(headPoint.y));
      noseDot.setAttribute("cx", String(nosePoint.x));
      noseDot.setAttribute("cy", String(nosePoint.y));
      svg.append(headCircle, noseDot);

      // Held things and the band sit on top of the figure.
      for (const { prop, element } of heldThings) {
        if (prop.kind === "band") {
          const joinedAt = prop.toJoints.reduce((sum, name) => ({ x: sum.x + joints[name].x, y: sum.y + joints[name].y, z: sum.z + joints[name].z }), { x: 0, y: 0, z: 0 });
          const count = Math.max(1, prop.toJoints.length);
          const start = place(prop.anchor);
          const end = place({ x: joinedAt.x / count, y: joinedAt.y / count, z: joinedAt.z / count });
          element.setAttribute("x1", String(start.x));
          element.setAttribute("y1", String(start.y));
          element.setAttribute("x2", String(end.x));
          element.setAttribute("y2", String(end.y));
        } else if (prop.kind === "ball") {
          const at = place(joints[prop.joint]);
          element.setAttribute("cx", String(at.x));
          element.setAttribute("cy", String(at.y));
        } else if (prop.kind === "bag" || prop.kind === "tin") {
          const at = place(joints[prop.joint]);
          const hangs = prop.kind === "bag" ? 0.12 * scale : 0;
          const width = Number(element.getAttribute("width"));
          const height = Number(element.getAttribute("height"));
          element.setAttribute("x", String(at.x - width / 2));
          element.setAttribute("y", String(at.y + hangs - height / 2));
        }
        svg.append(element);
      }
    },

    resize(): void {
      // The SVG scales itself to its container through its viewBox; nothing to do.
    },

    dispose(): void {
      svg.remove();
    },
  };
}
