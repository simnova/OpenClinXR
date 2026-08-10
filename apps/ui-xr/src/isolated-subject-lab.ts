/**
 * Isolated subject lab (#163 / #159) — render ONE subject (furniture builder, runtime posture,
 * or posture+furniture) with the product three.js stack and zero room/HUD/actors.
 *
 * Driven by URLSearchParams (same pattern as model-vetting-studio capture routes).
 * Builders/postures are imported from this app — never duplicated.
 *
 * #159: inclineDegrees is applied to the stretcher first (deck leads); body follows via
 * applyAndPlantSupineOnDeck live query — not a body-only tip against a flat mattress.
 *
 * claimScope: isolated harness capture for visual iteration + HOB measure.
 * notEvidenceFor: clinical validity, Quest readiness, multi-joint bed fidelity.
 */

import {
  AmbientLight,
  Box3,
  Color,
  DirectionalLight,
  Group,
  Mesh,
  MeshStandardMaterial,
  Object3D,
  PerspectiveCamera,
  PlaneGeometry,
  Scene,
  Vector3,
  WebGLRenderer,
} from "three";
import { GLTFExporter } from "three/addons/exporters/GLTFExporter.js";
import { MeshoptDecoder } from "three/addons/libs/meshopt_decoder.module.js";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import {
  measureArticulatingHob,
  type ArticulatingHobMeasure,
} from "./articulating-hob-measure.js";
import { buildPatientChair } from "./station-chair.js";
import {
  STRETCHER_DECK_TOP_METERS,
  STRETCHER_LENGTH_METERS,
  buildPatientStretcher,
} from "./station-stretcher.js";
import { applyAndPlantSupineOnDeck } from "./supine-deck-plant.js";
import { buildDeclaredEquipmentGeometry } from "./station-equipment-builders.js";

/**
 * Reference-pack capture views (#262). Mirrors the #232 pack view set
 * (front/side/two three-quarters) plus a back view — #254 measured that the
 * existing packs have no back view and the rear is where reconstruction fails.
 */
export type CaptureView =
  | "front"
  | "side"
  | "three_quarter_left"
  | "three_quarter_right"
  | "back";

export type IsolatedSubjectKind =
  | "furniture_builder"
  | "runtime_posture"
  | "posture_on_furniture"
  | "glb"
  | "equipment_builder";

export type IsolatedSubjectSpec = {
  subjectId: string;
  subjectKind: IsolatedSubjectKind;
  /** furniture_builder name when kind needs it. */
  builder?: "patient_stretcher" | "patient_chair";
  /** equipment_builder id (e.g. iv_pole_equipment) when kind needs it. */
  equipmentId?: string;
  /** posture when kind needs it. */
  posture?: "supine";
  /** Repo-public path under ui-xr public/, e.g. generated-humanoids/ed_chest_pain_adult_cast.glb */
  bodyGlb?: string;
  /**
   * Head-of-bed incline degrees. Applied to the stretcher SSOT first; body follows.
   * Not a product ship angle — contact sheet grades 0/15/30/45.
   */
  inclineDegrees?: number;
  /** Camera view for reference-pack renders (#262). Absent = legacy three-quarter framing. */
  view?: CaptureView;
  /** When true, serialize the rendered subject root to a GLB (base64 on window) — #262. */
  exportGlb?: boolean;
  /**
   * When true, render the subject WITHOUT the neutral ground plane (#265) — flat
   * background only, no ground geometry, no shadow catcher. The grounded render
   * is the #262 input defect: TRELLIS reconstructed the lit ground plane as
   * geometry instead of the pole. Absent/false = legacy grounded render.
   */
  subjectOnly?: boolean;
  label?: string;
};

export type IsolatedSubjectEvidence = {
  source: "window.__openClinXrIsolatedSubjectEvidence";
  subjectId: string;
  subjectKind: IsolatedSubjectKind;
  label: string;
  roomGeometryPresent: false;
  hudPresent: false;
  extraActorIds: string[];
  meshCount: number;
  boundsMeters: { width: number; height: number; depth: number };
  frameCoverageHint: number;
  /** Non-clear pixel fraction of the capture canvas (subject + neutral ground). */
  frameCoverage: number;
  /** #270: larger projected AABB extent as a fraction of the square frame (pack views only). */
  frameSpanFraction: number | null;
  /** True when the neutral ground plane is in the scene (#265 subject-only discriminator). */
  groundPlanePresent: boolean;
  inclineDegrees: number | null;
  usesProductRenderer: true;
  productRenderer: "apps/ui-xr three.js WebGLRenderer + imported station builders / supine-pose";
  claimScope: "isolated_subject_harness_capture_only";
  notEvidenceFor: string[];
};

export type { ArticulatingHobMeasure };

declare global {
  interface Window {
    __openClinXrIsolatedSubjectEvidence?: IsolatedSubjectEvidence;
    __openClinXrArticulatingHobMeasure?: ArticulatingHobMeasure;
    __openClinXrIsolatedSceneRoot?: Object3D;
    __openClinXrExportedGlbBase64?: string;
  }
}

const WIDTH_LEGACY = 1280;
const HEIGHT_LEGACY = 960;
/** Reference-pack captures are square, matching the #232 pack shape (1024×1024). */
const PACK_WIDTH = 1024;
const PACK_HEIGHT = 1024;
const BG = "#18211d";

function parseSpec(): IsolatedSubjectSpec {
  const params = new URLSearchParams(window.location.search);
  const raw = params.get("subject");
  if (raw) {
    try {
      const parsed = JSON.parse(raw) as IsolatedSubjectSpec;
      if (parsed?.subjectId && parsed?.subjectKind) return parsed;
    } catch {
      // fall through to query fields
    }
  }
  const subjectId = params.get("subjectId") ?? "anonymous";
  const subjectKind = (params.get("subjectKind") ?? "furniture_builder") as IsolatedSubjectKind;
  const builder = (params.get("builder") as IsolatedSubjectSpec["builder"]) ?? undefined;
  const equipmentId = params.get("equipmentId") ?? undefined;
  const posture = (params.get("posture") as IsolatedSubjectSpec["posture"]) ?? undefined;
  const bodyGlb = params.get("bodyGlb") ?? undefined;
  const inclineRaw = params.get("inclineDegrees");
  const inclineDegrees = inclineRaw != null && inclineRaw !== "" ? Number(inclineRaw) : undefined;
  const viewRaw = params.get("view");
  const view = (viewRaw as CaptureView | null) ?? undefined;
  const exportGlbRaw = params.get("exportGlb");
  const subjectOnlyRaw = params.get("subjectOnly");
  return {
    subjectId,
    subjectKind,
    ...(builder ? { builder } : {}),
    ...(equipmentId ? { equipmentId } : {}),
    ...(posture ? { posture } : {}),
    ...(bodyGlb ? { bodyGlb } : {}),
    ...(inclineDegrees != null && Number.isFinite(inclineDegrees) ? { inclineDegrees } : {}),
    ...(view ? { view } : {}),
    ...(exportGlbRaw === "true" ? { exportGlb: true } : {}),
    ...(subjectOnlyRaw === "true" ? { subjectOnly: true } : {}),
    label: params.get("label") ?? subjectId,
  };
}

function computeMeshBounds(root: Object3D): Box3 {
  const bounds = new Box3();
  const point = new Vector3();
  root.updateMatrixWorld(true);
  root.traverse((object) => {
    if (!(object instanceof Mesh)) return;
    const position = object.geometry.getAttribute("position");
    if (!position) return;
    for (let i = 0; i < position.count; i += 1) {
      point.fromBufferAttribute(position, i).applyMatrix4(object.matrixWorld);
      bounds.expandByPoint(point);
    }
  });
  return bounds;
}

function measureCanvasCoverage(renderer: WebGLRenderer): number {
  const canvas = renderer.domElement;
  const gl = renderer.getContext();
  const w = canvas.width;
  const h = canvas.height;
  if (w < 1 || h < 1) return 0;
  const pixels = new Uint8Array(w * h * 4);
  gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
  let nonBg = 0;
  for (let i = 0; i < pixels.length; i += 4) {
    const r = pixels[i]!;
    const g = pixels[i + 1]!;
    const b = pixels[i + 2]!;
    if (Math.abs(r - 0x18) + Math.abs(g - 0x21) + Math.abs(b - 0x1d) > 36) nonBg += 1;
  }
  return nonBg / (w * h);
}

/** Unit-ish camera direction per pack view: [dx, dz] on the XZ plane (front = +Z). */
const VIEW_DIRECTIONS: Record<CaptureView, [number, number]> = {
  front: [0, 1],
  back: [0, -1],
  side: [1, 0],
  three_quarter_left: [0.7071, 0.7071],
  three_quarter_right: [-0.7071, 0.7071],
};

/**
 * #270: pack views frame the subject to this fraction of the square frame's
 * shorter dimension (70-85% per the issue; 0.8 chosen mid-high for margin).
 */
const PACK_FRAME_TARGET = 0.8;

const UP_AXIS = new Vector3(0, 1, 0);

/** The 8 sign combinations of an AABB's 8 corners. */
const AABB_CORNER_SIGNS: ReadonlyArray<readonly [boolean, boolean, boolean]> = [
  [false, false, false],
  [false, false, true],
  [false, true, false],
  [false, true, true],
  [true, false, false],
  [true, false, true],
  [true, true, false],
  [true, true, true],
];

/**
 * Frame the camera for a subject. Legacy subjects keep the old framing exactly.
 *
 * #270 pack views: solve for the camera distance at which the subject's projected
 * bounding box spans PACK_FRAME_TARGET of the square frame's dimension, instead of
 * the old `radius * 2.4` (with a 0.4 m floor on radius). The old framing left a
 * 12x19 cm wall plate at ~5% frame coverage — the protruding outlet and recessed
 * gauge each occupied a handful of pixels and TRELLIS lost them. Same camera
 * angles (VIEW_DIRECTIONS), same 5 views, same subject-only rule.
 *
 * Returns the achieved span fraction (larger projected extent / frame dimension)
 * for pack views, or null for legacy framing — recorded in the evidence so the
 * 70-85% target is auditable, not just the pixel-coverage floor.
 */
function frameCamera(camera: PerspectiveCamera, bounds: Box3, view?: CaptureView): number | null {
  const center = bounds.getCenter(new Vector3());
  const size = bounds.getSize(new Vector3());
  const radius = Math.max(size.x, size.y, size.z, 0.4);
  if (!view) {
    // Legacy framing — unchanged for furniture/posture subjects.
    const distance = radius * 2.4;
    camera.position.set(center.x + distance * 0.55, center.y + radius * 0.35, center.z + distance * 0.85);
    camera.lookAt(center.x, center.y + size.y * 0.05, center.z);
    camera.near = 0.01;
    camera.far = Math.max(50, distance * 4);
    camera.updateProjectionMatrix();
    return null;
  }

  const [dx, dz] = VIEW_DIRECTIONS[view];
  const horiz = new Vector3(dx, 0, dz);
  // Proportional elevation (size.y, not the floored radius) — identical to the
  // old `radius * 0.35` for tall subjects, sane for small plates.
  const elevation = new Vector3(0, size.y * 0.35, 0);
  const target = new Vector3(center.x, center.y + size.y * 0.05, center.z);

  const tanHalf = Math.tan((camera.fov * Math.PI) / 360);
  const frameSpan = 2 * tanHalf;
  const wantSpan = frameSpan * PACK_FRAME_TARGET;

  // Iterate: the projected span is ~k / distance, so scaling distance by
  // span / wantSpan converges in a few steps even with perspective foreshortening.
  let distance = radius * 2.4;
  let spanFraction = PACK_FRAME_TARGET;
  for (let i = 0; i < 8; i += 1) {
    const pos = new Vector3(
      center.x + horiz.x * distance + elevation.x,
      center.y + elevation.y,
      center.z + horiz.z * distance + elevation.z,
    );
    const fwd = new Vector3().subVectors(target, pos).normalize();
    const right = new Vector3().crossVectors(fwd, UP_AXIS).normalize();
    const up = new Vector3().crossVectors(right, fwd).normalize();

    let minSx = Infinity;
    let maxSx = -Infinity;
    let minSy = Infinity;
    let maxSy = -Infinity;
    for (const [mx, my, mz] of AABB_CORNER_SIGNS) {
      const px = mx ? bounds.max.x : bounds.min.x;
      const py = my ? bounds.max.y : bounds.min.y;
      const pz = mz ? bounds.max.z : bounds.min.z;
      const vx = px - pos.x;
      const vy = py - pos.y;
      const vz = pz - pos.z;
      const depth = vx * fwd.x + vy * fwd.y + vz * fwd.z;
      if (depth < 1e-4) continue;
      const sx = (vx * right.x + vy * right.y + vz * right.z) / depth;
      const sy = (vx * up.x + vy * up.y + vz * up.z) / depth;
      if (sx < minSx) minSx = sx;
      if (sx > maxSx) maxSx = sx;
      if (sy < minSy) minSy = sy;
      if (sy > maxSy) maxSy = sy;
    }
    const span = Math.max(maxSx - minSx, maxSy - minSy);
    if (!Number.isFinite(span) || span < 1e-6) break;
    spanFraction = span / frameSpan;
    const next = distance * (span / wantSpan);
    if (Math.abs(next - distance) < Math.max(distance * 1e-4, 1e-6)) {
      distance = next;
      break;
    }
    distance = next;
  }

  camera.position.set(
    center.x + horiz.x * distance,
    center.y + elevation.y,
    center.z + horiz.z * distance,
  );
  camera.lookAt(target);
  camera.near = 0.01;
  camera.far = Math.max(50, distance * 4);
  camera.updateProjectionMatrix();
  return spanFraction;
}

async function loadHumanoid(bodyGlb: string): Promise<Object3D> {
  const loader = new GLTFLoader();
  loader.setMeshoptDecoder(MeshoptDecoder);
  const url = bodyGlb.startsWith("/") ? bodyGlb : `/${bodyGlb.replace(/^\.\//, "")}`;
  const gltf = await loader.loadAsync(url);
  const root = gltf.scene;
  root.name = "isolated_subject_humanoid";
  root.userData.openClinXrIsolatedSubject = true;
  return root;
}

function buildFurniture(
  builder: "patient_stretcher" | "patient_chair",
  inclineDegrees?: number,
): Group {
  if (builder === "patient_chair") {
    return buildPatientChair({
      slotId: "isolated_patient_chair",
      purpose: "isolated subject harness",
      position: { x: 0, y: 0, z: 0 },
      trimColor: 0x6b4f2a,
    });
  }
  return buildPatientStretcher({
    slotId: "isolated_ed_stretcher",
    purpose: "isolated subject harness",
    position: { x: 0, y: 0, z: 0 },
    trimColor: 0x3a7ca5,
    inclineDegrees: inclineDegrees ?? 0,
  });
}

async function buildSubjectRoot(spec: IsolatedSubjectSpec): Promise<{
  root: Object3D;
  meshCount: number;
}> {
  const container = new Group();
  container.name = `isolated_subject.${spec.subjectId}`;
  const incline = spec.inclineDegrees ?? 0;

  if (spec.subjectKind === "furniture_builder") {
    const builder = spec.builder ?? "patient_stretcher";
    container.add(buildFurniture(builder, incline));
  } else if (spec.subjectKind === "runtime_posture" || spec.subjectKind === "posture_on_furniture") {
    const bodyGlb = spec.bodyGlb ?? "generated-humanoids/ed_chest_pain_adult_cast.glb";
    const humanoid = await loadHumanoid(bodyGlb);
    let stretcher: Group | null = null;
    if (spec.subjectKind === "posture_on_furniture" || spec.builder === "patient_stretcher") {
      // Deck leads: incline on the stretcher builder, not a body-only tip.
      stretcher = buildFurniture("patient_stretcher", incline);
      container.add(stretcher);
    }
    const pillowWorldX = -STRETCHER_LENGTH_METERS * 0.38;
    applyAndPlantSupineOnDeck(humanoid, {
      deckTopWorldY: STRETCHER_DECK_TOP_METERS,
      deckCenter: { x: 0, z: 0 },
      pillowWorldX,
      ...(stretcher ? { stretcher } : { inclineDegrees: incline }),
    });
    humanoid.updateMatrixWorld(true);
    // Framing: lateral (Z) recenter only. X recenter after hinge tip slides the body along
    // the long axis and reopens the back-plane gap (gap ∝ sinθ offset) — plant owns X.
    const hb = computeMeshBounds(humanoid);
    const hc = hb.getCenter(new Vector3());
    humanoid.position.z -= hc.z;
    if (Math.abs(incline) < 1e-3) {
      humanoid.position.x -= hc.x;
    }
    humanoid.updateMatrixWorld(true);
    container.add(humanoid);
  } else if (spec.subjectKind === "equipment_builder") {
    const equipmentId = spec.equipmentId;
    if (!equipmentId) {
      throw new Error("equipment_builder requires equipmentId");
    }
    container.add(buildDeclaredEquipmentGeometry(equipmentId));
  } else if (spec.subjectKind === "glb") {
    const bodyGlb = spec.bodyGlb ?? "generated-humanoids/ed_chest_pain_adult_cast.glb";
    container.add(await loadHumanoid(bodyGlb));
  } else {
    throw new Error(`Unsupported subjectKind: ${spec.subjectKind}`);
  }

  let meshCount = 0;
  container.traverse((o) => {
    if (o instanceof Mesh) meshCount += 1;
  });
  return { root: container, meshCount };
}

async function renderIsolatedSubject(mount: HTMLElement, spec: IsolatedSubjectSpec): Promise<IsolatedSubjectEvidence> {
  mount.replaceChildren();
  const canvas = document.createElement("canvas");
  canvas.id = "isolated-subject-capture-canvas";
  mount.append(canvas);

  const renderer = new WebGLRenderer({ antialias: true, canvas, preserveDrawingBuffer: true });
  const square = spec.view != null;
  const width = square ? PACK_WIDTH : WIDTH_LEGACY;
  const height = square ? PACK_HEIGHT : HEIGHT_LEGACY;
  renderer.setSize(width, height, false);
  renderer.setClearColor(new Color(BG));
  renderer.setPixelRatio(1);

  const scene = new Scene();
  scene.background = new Color(BG);
  scene.add(new AmbientLight("#dceee6", 1.45));
  const key = new DirectionalLight("#ffffff", 2.2);
  key.position.set(3.2, 5.2, 4.1);
  scene.add(key);
  const fill = new DirectionalLight("#b6d8ca", 1.1);
  fill.position.set(-3.5, 2.8, -2.2);
  scene.add(fill);

  // #265: subject-only mode skips the neutral ground plane entirely. The grounded
  // render is the #262 input defect — TRELLIS reconstructed the lit ground plane as
  // geometry, which is what every #262 metric read as "pole lost". One variable:
  // subject geometry only, flat background, nothing else changes.
  if (spec.subjectOnly !== true) {
    const ground = new Mesh(
      new PlaneGeometry(6, 6),
      new MeshStandardMaterial({
        color: 0x24302b,
        roughness: 0.95,
        metalness: 0.02,
      }),
    );
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = 0;
    ground.name = "isolated_neutral_ground";
    ground.userData.openClinXrNeutralGround = true;
    scene.add(ground);
  }

  const { root, meshCount } = await buildSubjectRoot(spec);
  scene.add(root);
  window.__openClinXrIsolatedSceneRoot = root;
  root.updateMatrixWorld(true);

  // Measured from the SCENE, not the spec flag — the evidence records what was
  // actually rendered (#265 subject-only discriminator).
  let groundPlanePresent = false;
  scene.traverse((o) => {
    if (o.name === "isolated_neutral_ground") groundPlanePresent = true;
  });

  const bounds = computeMeshBounds(root);
  if (!Number.isFinite(bounds.min.x)) {
    throw new Error(`Subject ${spec.subjectId} produced empty mesh bounds`);
  }
  const size = bounds.getSize(new Vector3());

  const camera = new PerspectiveCamera(35, width / height, 0.01, 100);
  const frameSpanFraction = frameCamera(camera, bounds, spec.view);

  let framesAdvanced = 0;
  await new Promise<void>((resolve) => {
    const step = () => {
      renderer.render(scene, camera);
      framesAdvanced += 1;
      if (framesAdvanced >= 4) {
        resolve();
        return;
      }
      requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  });

  const requestedDeg = spec.inclineDegrees ?? 0;
  window.__openClinXrArticulatingHobMeasure = measureArticulatingHob(root, requestedDeg, framesAdvanced);

  if (spec.exportGlb === true) {
    // Parametric-source serialization (#262): export the same root the harness
    // rendered to a GLB so the bake output can be compared with the same
    // instrument (glTF-vs-glTF), not a browser-side count vs a trimesh count.
    const exporter = new GLTFExporter();
    await new Promise<void>((resolve) => {
      exporter.parse(
        root,
        (result) => {
          if (result instanceof ArrayBuffer) {
            const bytes = new Uint8Array(result);
            let binary = "";
            const CHUNK = 0x8000;
            for (let i = 0; i < bytes.length; i += CHUNK) {
              binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
            }
            window.__openClinXrExportedGlbBase64 = btoa(binary);
          }
          resolve();
        },
        (error: unknown) => {
          console.error("GLB export failed", error);
          resolve();
        },
        { binary: true },
      );
    });
  }

  const frameCoverageHint = Math.min(
    0.95,
    Math.max(0.05, (size.x * size.y) / Math.max(size.length() * size.length() * 0.35, 0.01)),
  );
  const frameCoverage = measureCanvasCoverage(renderer);

  const evidence: IsolatedSubjectEvidence = {
    source: "window.__openClinXrIsolatedSubjectEvidence",
    subjectId: spec.subjectId,
    subjectKind: spec.subjectKind,
    label: spec.label ?? spec.subjectId,
    roomGeometryPresent: false,
    hudPresent: false,
    extraActorIds: [],
    meshCount,
    boundsMeters: {
      width: Math.round(size.x * 1000) / 1000,
      height: Math.round(size.y * 1000) / 1000,
      depth: Math.round(size.z * 1000) / 1000,
    },
    frameCoverageHint,
    frameCoverage,
    frameSpanFraction,
    groundPlanePresent,
    inclineDegrees: spec.inclineDegrees ?? null,
    usesProductRenderer: true,
    productRenderer: "apps/ui-xr three.js WebGLRenderer + imported station builders / supine-pose",
    claimScope: "isolated_subject_harness_capture_only",
    notEvidenceFor: [
      "clinical_validity",
      "quest_readiness",
      "learner_readiness",
      "semi_fowler_product_ship",
      "visual_realism_b_plus",
      "multi_joint_articulation",
    ],
  };
  window.__openClinXrIsolatedSubjectEvidence = evidence;
  return evidence;
}

const app = document.querySelector<HTMLDivElement>("#app");
if (!app) throw new Error("Missing #app");
const spec = parseSpec();
void renderIsolatedSubject(app, spec).catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  app.textContent = `Isolated subject lab error: ${message}`;
  console.error(error);
});
