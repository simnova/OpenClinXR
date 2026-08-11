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
  Color,
  DirectionalLight,
  Group,
  Mesh,
  MeshStandardMaterial,
  type Object3D,
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
  type ArticulatingHobMeasure,
  measureArticulatingHob,
} from "./articulating-hob-measure.js";
import { type CaptureView, computeMeshBounds, frameCamera } from "./camera-fit-to-bounds.js";
import { type PackFramingRecord, recordPackFraming } from "./isolated-pack-framing.js";
import { buildPatientChair } from "./station-chair.js";
import { buildDeclaredEquipmentGeometry } from "./station-equipment-builders.js";
import {
  buildPatientStretcher,
  STRETCHER_DECK_TOP_METERS,
  STRETCHER_LENGTH_METERS,
} from "./station-stretcher.js";
import { applyAndPlantSupineOnDeck } from "./supine-deck-plant.js";

/**
 * Reference-pack capture views (#262). Mirrors the #232 pack view set
 * (front/side/two three-quarters) plus a back view — #254 measured that the
 * existing packs have no back view and the rear is where reconstruction fails.
 * Type moved to ./camera-fit-to-bounds.ts (#315 shared framing module).
 */
export type { CaptureView } from "./camera-fit-to-bounds.js";

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
  /** #280: pack camera + world AABB corners — additive framing audit record. */
  packFraming: PackFramingRecord;
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

  // #280: record the framing the code chose (recording only — frameCamera math untouched).
  const packFraming = recordPackFraming(camera, bounds, spec.view);

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
    packFraming,
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
