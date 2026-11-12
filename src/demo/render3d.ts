/**
 * The 3D "Show me" renderer: a matt white wooden-mannequin figure, yellow for
 * the parts that move, plain grey furniture, on a black background.
 *
 * This is the ONLY module that imports three.js, and nothing else imports
 * this module statically: loadRenderer.ts loads it with `await import(...)`,
 * so three.js lands in its own chunk that is only fetched when someone opens
 * "Show me" (and is precached by the service worker).
 *
 *   Pose ──jointPositions (skeleton.ts)──▶ joint points ──▶ this file lays
 *   capsules / ellipsoids between them ──▶ WebGL canvas inside `container`
 *
 * The scene is built once. Every `draw` only moves and rotates the existing
 * meshes; limb lengths are fixed at build time, so no pose can stretch the
 * body. Model coordinates (x forward, y up, +z = figure's left) are mirrored
 * to (x, y, -z) on the way into three.js; see renderer.ts for why.
 */
import {
  BoxGeometry, BufferGeometry, CapsuleGeometry, Color, CylinderGeometry, DirectionalLight, HemisphereLight,
  Material, Matrix4, Mesh, MeshBasicMaterial, MeshStandardMaterial, PerspectiveCamera, PlaneGeometry, Quaternion, Scene,
  SphereGeometry, Vector3, WebGLRenderer,
} from "three";
import type { BodyPart, Demo, JointName, Pose, Vec3 } from "./model";
import { BODY, jointPositions } from "./skeleton";
import { computeFraming, isMoving, propBoxes, type DemoRenderer } from "./renderer";

const WHITE_COLOUR = 0xf4f4f4;
/** The dark band across the face that shows which way the head is turned. */
const VISOR_COLOUR = 0x1c2230;
const YELLOW_COLOUR = 0xffd60a;
const GREY_COLOUR = 0x5d636e;
/**
 * Floor: dark and only a little wider than a step, so it reads as "the
 * ground is here" without becoming a bright slab that competes with the
 * figure (the plan asks for a faint floor and nothing else).
 */
const FLOOR_COLOUR = 0x202329;
const FLOOR_WIDTH_METRES = 2.2;
const FLOOR_DEPTH_METRES = 0.8;

/** Vertical field of view of the camera, in degrees. */
const FIELD_OF_VIEW_DEGREES = 32;
/** The camera sits slightly above the look-at point, in degrees of elevation. */
const CAMERA_ELEVATION_DEGREES = 6;
/** Extra room around the framing sphere so nothing touches the edge of the square. */
const FRAMING_MARGIN = 1.1;

/** Mirrors a model point into the drawn world (see the file comment). */
function toScene(point: Vec3): Vector3 {
  return new Vector3(point.x, point.y, -point.z);
}

/** Degrees to radians. */
function radians(degrees: number): number {
  return (degrees * Math.PI) / 180;
}

/**
 * Builds a rotation whose local axes are x = `forward`, y = `up`, with z
 * following by the right-hand rule. Used to orient ellipsoids (chest,
 * pelvis, head). `lateral` only has to be roughly sideways; it is
 * re-orthogonalised so the result is a proper rotation.
 */
function orientation(forward: Vector3, up: Vector3, lateral: Vector3): Quaternion {
  const yAxis = up.clone().normalize();
  const xAxis = new Vector3().crossVectors(yAxis, lateral).normalize();
  const zAxis = new Vector3().crossVectors(xAxis, yAxis).normalize();
  // `forward` is only used to pick the sign of x (the cross product above can point backwards).
  if (xAxis.dot(forward) < 0) {
    xAxis.negate();
    zAxis.negate();
  }
  return new Quaternion().setFromRotationMatrix(new Matrix4().makeBasis(xAxis, yAxis, zAxis));
}

/**
 * Builds the WebGL mannequin renderer inside `container`. Throws if WebGL
 * can't be created, so the caller (loadRenderer.ts) can fall back to the
 * flat renderer. The container should be square (the view sizes it); the
 * canvas fills it and `resize()` re-fits it.
 */
export function createRenderer3d(container: HTMLElement, demo: Demo): DemoRenderer {
  const webglRenderer = new WebGLRenderer({ antialias: true });
  const scene = new Scene();

  try {
    return buildRenderer(container, demo, webglRenderer, scene);
  } catch (error) {
    // Don't leave a half-built canvas or GPU context behind when the caller falls back.
    freeScene(scene, webglRenderer);
    throw error;
  }
}

/** Frees every geometry and material in `scene`, then the WebGL context, and removes the canvas. */
function freeScene(scene: Scene, webglRenderer: WebGLRenderer): void {
  const geometries = new Set<BufferGeometry>();
  const materials = new Set<Material>();

  scene.traverse((object) => {
    if (object instanceof Mesh) {
      geometries.add(object.geometry);
      for (const material of Array.isArray(object.material) ? object.material : [object.material]) materials.add(material);
    }
  });

  geometries.forEach((geometry) => geometry.dispose());
  materials.forEach((material) => material.dispose());
  webglRenderer.dispose();
  webglRenderer.forceContextLoss();
  webglRenderer.domElement.remove();
}

/** Does the real work of createRenderer3d once the WebGL renderer exists (split out so failures can be cleaned up). */
function buildRenderer(container: HTMLElement, demo: Demo, webglRenderer: WebGLRenderer, scene: Scene): DemoRenderer {
  webglRenderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  webglRenderer.setClearColor(new Color(0x000000));
  webglRenderer.domElement.style.display = "block";
  webglRenderer.domElement.style.width = "100%";
  webglRenderer.domElement.style.height = "100%";
  container.append(webglRenderer.domElement);

  // ---- materials (shared by many meshes; disposed once in freeScene) ----
  const white = new MeshStandardMaterial({ color: WHITE_COLOUR, roughness: 0.85, metalness: 0 });
  const yellow = new MeshStandardMaterial({ color: YELLOW_COLOUR, roughness: 0.8, metalness: 0 });
  const grey = new MeshStandardMaterial({ color: GREY_COLOUR, roughness: 0.95, metalness: 0 });
  const floorMaterial = new MeshBasicMaterial({ color: FLOOR_COLOUR });
  /** White, or yellow if the demo says this part is one of the moving ones. */
  const materialFor = (part: BodyPart) => (isMoving(demo, part) ? yellow : white);

  // ---- lights: soft from above and the front; the key light follows the camera ----
  scene.add(new HemisphereLight(0xffffff, 0x303030, 1.6));
  const keyLight = new DirectionalLight(0xffffff, 1.9);
  scene.add(keyLight);
  scene.add(keyLight.target);

  // ---- camera: fixed look-at point and distance for the whole loop ----
  const framing = computeFraming(demo);
  const lookAt = toScene(framing.centre);
  const distance = (framing.radius / Math.sin(radians(FIELD_OF_VIEW_DEGREES / 2))) * FRAMING_MARGIN;
  const camera = new PerspectiveCamera(FIELD_OF_VIEW_DEGREES, 1, 0.05, distance * 4 + 10);

  // ---- floor and furniture ----
  const floor = new Mesh(new PlaneGeometry(FLOOR_WIDTH_METRES, FLOOR_DEPTH_METRES), floorMaterial);
  floor.rotation.x = -Math.PI / 2;
  scene.add(floor);

  for (const prop of demo.props) {
    for (const { min, max } of propBoxes(prop)) {
      const block = new Mesh(new BoxGeometry(max.x - min.x, max.y - min.y, max.z - min.z), grey);
      block.position.copy(toScene({ x: (min.x + max.x) / 2, y: (min.y + max.y) / 2, z: (min.z + max.z) / 2 }));
      scene.add(block);
    }
  }

  const heldThings = buildHeldThings(scene, demo, yellow);
  const mannequin = buildMannequin(scene, materialFor);

  /** Fits the canvas to the (square) container. */
  function resize(): void {
    const width = container.clientWidth;
    const height = container.clientHeight;
    const side = Math.max(1, Math.round(width > 0 && height > 0 ? Math.min(width, height) : Math.max(width, height, 360)));
    webglRenderer.setSize(side, side, false);
    camera.aspect = 1;
    camera.updateProjectionMatrix();
  }
  resize();

  /** Puts the camera round the figure at `azimuthDegrees` and points the key light along with it. */
  function placeCamera(azimuthDegrees: number): void {
    const azimuth = radians(azimuthDegrees);
    const elevation = radians(CAMERA_ELEVATION_DEGREES);
    camera.position.set(
      lookAt.x + distance * Math.cos(elevation) * Math.sin(azimuth),
      lookAt.y + distance * Math.sin(elevation),
      lookAt.z + distance * Math.cos(elevation) * Math.cos(azimuth),
    );
    camera.lookAt(lookAt);
    camera.updateMatrixWorld();

    // Light from above, a little to the camera's right: the visible side is always the lit side.
    const cameraRight = new Vector3().setFromMatrixColumn(camera.matrixWorld, 0);
    keyLight.position.copy(camera.position).addScaledVector(cameraRight, 0.7).add(new Vector3(0, 2.2, 0));
    keyLight.target.position.copy(lookAt);
  }

  return {
    draw(pose: Pose, cameraAzimuthDegrees: number): void {
      const joints = jointPositions(pose);
      mannequin(joints);
      heldThings(joints);
      placeCamera(cameraAzimuthDegrees);
      webglRenderer.render(scene, camera);
    },
    resize,
    dispose(): void {
      freeScene(scene, webglRenderer);
    },
  };
}

// ---------------------------------------------------------------------------
// Shape helpers
// ---------------------------------------------------------------------------

const UP = new Vector3(0, 1, 0);

/**
 * A capsule of fixed length that is laid between two points each draw.
 * `length` is the straight part; the rounded ends add `radius` at each end,
 * which also hides the seams at joints.
 */
function makeCapsule(scene: Scene, radius: number, length: number, material: Material) {
  const mesh = new Mesh(new CapsuleGeometry(radius, length, 8, 20), material);
  scene.add(mesh);

  return {
    /** Lays the capsule's axis from `from` to `to` (scene coordinates); ignores a zero-length request. */
    place(from: Vector3, to: Vector3): void {
      const direction = to.clone().sub(from);
      if (direction.lengthSq() < 1e-10) return;
      mesh.position.copy(from).add(to).multiplyScalar(0.5);
      mesh.quaternion.setFromUnitVectors(UP, direction.normalize());
    },
  };
}

/** A sphere scaled into an ellipsoid (semi-axes along local x = forward, y = up, z = sideways). */
function makeBlob(scene: Scene, semiAxes: [number, number, number], material: Material): Mesh {
  const mesh = new Mesh(new SphereGeometry(1, 32, 20), material);
  mesh.scale.set(...semiAxes);
  scene.add(mesh);
  return mesh;
}

// ---------------------------------------------------------------------------
// The mannequin
// ---------------------------------------------------------------------------

/**
 * Builds every body part once and returns a function that poses them from
 * a set of joint positions.
 *
 *            head (ellipsoid) + big nose + dark visor band
 *            neck
 *      shoulder bar ── chest (ellipsoid)
 *      upper arm        waist (capsule)
 *      forearm, hand    pelvis (ellipsoid)
 *                       thigh ── knee ── shin ── foot
 */
function buildMannequin(scene: Scene, materialFor: (part: BodyPart) => Material): (joints: Record<JointName, Vec3>) => void {
  const sides = ["Left", "Right"] as const;

  const arms = sides.map((side) => ({
    shoulder: makeBlob(scene, [0.058, 0.058, 0.058], materialFor(`arm${side}`)),
    upperArm: makeCapsule(scene, 0.048, BODY.upperArm, materialFor(`arm${side}`)),
    elbow: makeBlob(scene, [0.05, 0.05, 0.05], materialFor(`forearm${side}`)),
    forearm: makeCapsule(scene, 0.042, BODY.forearm, materialFor(`forearm${side}`)),
    hand: makeCapsule(scene, 0.035, BODY.hand, materialFor(`hand${side}`)),
  }));

  const footRadius = 0.04;
  const legs = sides.map((side) => ({
    hip: makeBlob(scene, [0.08, 0.08, 0.08], materialFor(`thigh${side}`)),
    thigh: makeCapsule(scene, 0.075, BODY.thigh, materialFor(`thigh${side}`)),
    knee: makeBlob(scene, [0.062, 0.062, 0.062], materialFor(`shin${side}`)),
    shin: makeCapsule(scene, 0.055, BODY.shin, materialFor(`shin${side}`)),
    foot: makeCapsule(scene, footRadius, BODY.heelBack + BODY.footLength - 2 * footRadius, materialFor(`foot${side}`)),
  }));

  const trunkMaterial = materialFor("trunk");
  const pelvis = makeBlob(scene, [0.115, 0.1, 0.16], trunkMaterial);
  const waist = makeCapsule(scene, 0.1, 0.16, trunkMaterial);
  const chest = makeBlob(scene, [0.125, 0.17, 0.19], trunkMaterial);
  const shoulderBar = makeCapsule(scene, 0.055, BODY.shoulderHalfWidth * 2 - 0.02, trunkMaterial);

  const headMaterial = materialFor("head");
  const neck = makeCapsule(scene, 0.042, 0.06, headMaterial);
  const head = makeBlob(scene, [0.095, 0.115, 0.09], headMaterial);
  // A big nose and a dark visor band across the face make a 45 degree head turn obvious from any angle.
  const nose = makeBlob(scene, [0.04, 0.04, 0.04], headMaterial);
  const visor = makeBlob(scene, [0.03, 0.024, 0.078], new MeshStandardMaterial({ color: VISOR_COLOUR, roughness: 0.6, metalness: 0 }));

  return (joints) => {
    const point = (name: JointName): Vector3 => toScene(joints[name]);

    sides.forEach((side, index) => {
      const arm = arms[index]!;
      arm.shoulder.position.copy(point(`shoulder${side}`));
      arm.upperArm.place(point(`shoulder${side}`), point(`elbow${side}`));
      arm.elbow.position.copy(point(`elbow${side}`));
      arm.forearm.place(point(`elbow${side}`), point(`wrist${side}`));
      arm.hand.place(point(`wrist${side}`), point(`hand${side}`));

      const leg = legs[index]!;
      leg.hip.position.copy(point(`hip${side}`));
      leg.thigh.place(point(`hip${side}`), point(`knee${side}`));
      leg.knee.position.copy(point(`knee${side}`));
      leg.shin.place(point(`knee${side}`), point(`ankle${side}`));

      // The foot capsule runs heel to toe, lifted off the sole by its own radius (towards the ankle).
      const heel = point(`heel${side}`);
      const toe = point(`toe${side}`);
      const towardsAnkle = point(`ankle${side}`).sub(heel.clone().add(toe).multiplyScalar(0.5)).normalize().multiplyScalar(footRadius);
      leg.foot.place(heel.add(towardsAnkle), toe.add(towardsAnkle));
    });

    // Trunk: ellipsoids oriented from the spine direction and the line across hips / shoulders.
    const pelvisPoint = point("pelvis");
    const chestPoint = point("chest");
    const spineUp = chestPoint.clone().sub(pelvisPoint).normalize();
    const hipsAcross = point("hipRight").sub(point("hipLeft"));
    const shouldersAcross = point("shoulderRight").sub(point("shoulderLeft"));
    // Which way the figure faces, from the hips: used only to pick the sign of the ellipsoid's forward axis.
    const facing = new Vector3().crossVectors(hipsAcross, spineUp).negate();

    pelvis.position.copy(pelvisPoint).addScaledVector(spineUp, 0.02);
    pelvis.quaternion.copy(orientation(facing, spineUp, hipsAcross));
    waist.place(pelvisPoint.clone().addScaledVector(spineUp, 0.08), pelvisPoint.clone().addScaledVector(spineUp, 0.24));
    chest.position.copy(chestPoint).addScaledVector(spineUp, -0.13);
    chest.quaternion.copy(orientation(facing, spineUp, shouldersAcross));
    shoulderBar.place(point("shoulderLeft"), point("shoulderRight"));

    // Head: its own forward axis is the nose direction, so a head turn is visible.
    const headPoint = point("head");
    const headForward = point("nose").sub(headPoint).normalize();
    const headUp = headPoint.clone().sub(point("neck")).normalize();
    // Sideways = up x forward is the figure's right in scene space; orientation() re-orthogonalises it.
    const headSideways = new Vector3().crossVectors(headUp, headForward).negate();
    neck.place(chestPoint, point("neck").addScaledVector(headUp, 0.04));
    head.position.copy(headPoint);
    head.quaternion.copy(orientation(headForward, headUp, headSideways));
    nose.position.copy(point("nose"));
    visor.position.copy(headPoint).addScaledVector(headForward, 0.068).addScaledVector(headUp, 0.025);
    visor.quaternion.copy(head.quaternion);
  };
}

// ---------------------------------------------------------------------------
// Held things and the band
// ---------------------------------------------------------------------------

/**
 * Builds the yellow band / ball / bag / tin props and returns a function
 * that moves them with the figure's joints each draw. Furniture is static
 * and built separately (it comes from `propBoxes`).
 */
function buildHeldThings(scene: Scene, demo: Demo, yellow: Material): (joints: Record<JointName, Vec3>) => void {
  const updaters: Array<(joints: Record<JointName, Vec3>) => void> = [];

  for (const prop of demo.props) {
    switch (prop.kind) {
      case "band": {
        // A thin tube of unit length and radius, stretched between the anchor and the joints' midpoint.
        const tube = new Mesh(new CylinderGeometry(1, 1, 1, 12), yellow);
        tube.scale.set(0.012, 1, 0.012);
        scene.add(tube);
        updaters.push((joints) => {
          const end = new Vector3();
          for (const name of prop.toJoints) end.add(toScene(joints[name]));
          tube.visible = prop.toJoints.length > 0;
          if (!tube.visible) return;
          end.divideScalar(prop.toJoints.length);

          const start = toScene(prop.anchor);
          const span = end.clone().sub(start);
          tube.scale.y = Math.max(span.length(), 1e-4);
          tube.position.copy(start).add(end).multiplyScalar(0.5);
          if (span.lengthSq() > 1e-10) tube.quaternion.setFromUnitVectors(UP, span.normalize());
        });
        break;
      }

      case "ball":
      case "bag":
      case "tin": {
        const geometry =
          prop.kind === "ball" ? new SphereGeometry(0.07, 24, 16) : prop.kind === "tin" ? new CylinderGeometry(0.04, 0.04, 0.11, 20) : new BoxGeometry(0.1, 0.22, 0.18);
        const held = new Mesh(geometry, yellow);
        scene.add(held);
        // A bag hangs from the hand; ball and tin are gripped, so they sit on the hand point.
        const drop = prop.kind === "bag" ? 0.12 : 0;
        updaters.push((joints) => {
          held.position.copy(toScene(joints[prop.joint])).add(new Vector3(0, -drop, 0));
        });
        break;
      }

      default:
        break; // Furniture: drawn once from propBoxes.
    }
  }

  return (joints) => updaters.forEach((update) => update(joints));
}
