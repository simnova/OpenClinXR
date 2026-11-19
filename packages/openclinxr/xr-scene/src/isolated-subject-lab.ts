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
  ACESFilmicToneMapping,
  AmbientLight,
  Color,
  DirectionalLight,
  Mesh,
  MeshStandardMaterial,
  type Object3D,
  PerspectiveCamera,
  PlaneGeometry,
  Scene,
  Vector3,
  WebGLRenderer,
} from "three";
import type {
  ArticulatingHobMeasure,
} from "./articulating-hob-measure.js";
import { type CaptureView, computeMeshBounds } from "./camera-fit-to-bounds.js";
import { type PackFramingRecord, recordPackFraming } from "./isolated-pack-framing.js";
import { buildSubjectRoot } from "./isolated-subject-assembly.js";
import {
  dumpSupineJointState,
  round3,
  type SupineJointDump,
} from "./isolated-subject-debug-evidence.js";
import type { FocusRegion } from "./isolated-subject-focus.js";
import {
  applyMaterialOverrides,
  applySkinOverride,
  type MaterialOverride,
  type MaterialOverrideApplied,
  type SkinOverride,
  type SkinOverrideApplied,
} from "./isolated-subject-material-variants.js";
import { applyLabProductRig } from "./isolated-subject-product-rig.js";
import {
  applyRigOverride,
  type ProductLightingRigFns,
} from "./isolated-subject-rig-variants.js";
import { parseIsolatedSubjectSpec } from "./isolated-subject-spec-params.js";
import type { ParityReadback, ParityRigOverride, ParitySpecExtension } from "./parity/parity-types.js";

export type { ParityReadback };

import {
  finalizeIsolatedSubjectCapture,
  frameLabCamera,
} from "./parity/parity-finalize.js";
import { buildParityPipeline } from "./parity/parity-pipeline.js";
import {
  applyParityBeautyLevers,
  applyParityCameraOverride,
  applyParitySceneModes,
  assertParityProductRigRefusal,
  enforceHideHairOnly,
  resolveParityScene,
} from "./parity/parity-scene.js";

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
  /** Repo-public path under ui-xr public/, e.g. generated-humanoids/mpfb-gown-adult-patient.glb */
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
  /**
   * #354/#358: focus the camera on a region of the subject instead of the whole
   * body. "eyes" derives the eye box from meshes matching the eye channel;
   * "head" derives the head box from the body's own bounds (topmost band cut at
   * the neck — works on every rail, incl. Anny which has no eye geometry).
   * "forearm" derives the viewer-left lowerarm box from dominant-joint verts
   * (st-vitbody r4 body close-up); "neck" derives the neck + jaw-band box so
   * the frame straddles the body-mask boundary (st-vitbody r4).
   * Never literal coordinates (D1). An unresolvable focus REFUSES.
   */
  focus?: "eyes" | "head" | "mouth" | "forearm" | "neck";
  /** #495 ablation: when true, applySupinePose skips the 17 joint eulers (root basis only). */
  supineRootOnly?: boolean;
  /** Skin-realism portrait: hide fitted hair meshes matched by /hair/i before framing. */
  hideHair?: boolean;
  /** Skin-realism portrait: yaw about the vertical axis in degrees (0 = front). Overrides view direction. */
  yawDegrees?: number;
  /** Skin-realism portrait: square render size in px when view != null (default 1024). */
  renderSize?: number;
  /** Variant evaluator: override skin material maps/scalars after GLB load (no GLB write). */
  skinOverride?: SkinOverride;
  /**
   * Variant evaluator: generic material overrides after GLB load (no GLB write).
   * Each entry matches materials by regex over the material name OR the mesh name.
   */
  materialOverrides?: MaterialOverride[];
  /** Variant evaluator: override the light rig / tone mapping / environment. */
  rigOverride?: ParityRigOverride;
  /** Product rig lighting: light the subject with the shipped room rig (apps/ui-xr bridge). */
  productEnvironmentId?: string;
  /** Tight portrait framing: fov 24 at head-centre height, head fills 78% of frame height. */
  portrait?: boolean;
  /**
   * Eye runtime shading (card tsk_e0afe706b7a5f071): sclera-only globe
   * envMap attenuation + key shadow map onto the globe + ACES guard.
   * Defaults ON only for the portrait lab with a product rig (room-rig
   * portraits); every other harness path defaults OFF. Explicit false
   * renders the legacy eye (PRE). Requires a productEnvironmentId when
   * ON — refusing rather than shading a different rig.
   */
  eyeRuntimeShading?: boolean;
  /**
   * Ablation levers for the eye-shading report (default: follow
   * eyeRuntimeShading). scleraShade = globe onBeforeCompile attenuation;
   * lidShadow = lid-margin contact darkening. The shipped default is both ON.
   */
  eyeScleraShade?: boolean;
  eyeLidShadow?: boolean;
  /**
   * Value overrides for the eye-shading sweep (default: the shipped
   * constants). Fail closed via resolveScleraShadeOptions (attenuation in
   * [0,1], bandM > 0, darken in [0,1]); garbage refuses.
   */
  eyeScleraAtten?: number;
  eyeLidBandM?: number;
  eyeLidDarken?: number;
  /**
   * Fresnel-weighted cornea film (eye-finish): Schlick env lift on the
   * globe's iris disc, +0 head-on, ramping at grazing/yaw. Defaults to
   * following eyeScleraShade (shipped ON); explicit false renders legacy.
   * corneaFlat forces the head-on weight everywhere (counterweight: no
   * angular dependence, yaw lift must vanish).
   */
  eyeCorneaFresnel?: boolean;
  eyeCorneaFlat?: boolean;
  /**
   * Fresnel shaping overrides for the yaw sweep (default: the landed
   * constants). Fail closed via resolveCorneaFresnelOptions (gain >= 0,
   * exponent > 0); garbage refuses.
   */
  eyeCorneaFresnelGain?: number;
  eyeCorneaFresnelExponent?: number;
  label?: string;
} & ParitySpecExtension;




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
  /**
   * #354/#358: the region the camera framed when `focus` was requested — the
   * DERIVED eye box (matched eye meshes), the DERIVED head box (body bounds,
   * #358), or the legacy whole-subject fallback (pre-#358 artifacts only —
   * new runs refuse instead of falling back).
   */
  focusRegion: FocusRegion;
  inclineDegrees: number | null;
  usesProductRenderer: true;
  productRenderer: "apps/ui-xr three.js WebGLRenderer + imported station builders / supine-pose";
  claimScope: "isolated_subject_harness_capture_only";
  notEvidenceFor: string[];
  /**
   * Aisha-parity (P2) readback: every lever echoed live from the scene /
   * renderer. Absent when no parity/hdri/cameraOverride/calib/masks spec is
   * present (levers OFF by default).
   */
  parity?: ParityReadback;
};

export type { ArticulatingHobMeasure };


declare global {
  interface Window {
    __openClinXrIsolatedSubjectEvidence?: IsolatedSubjectEvidence;
    __openClinXrArticulatingHobMeasure?: ArticulatingHobMeasure;
    __openClinXrIsolatedSceneRoot?: Object3D;
    __openClinXrExportedGlbBase64?: string;
    __openClinXrSupineJointDump?: SupineJointDump;
    /** #495 ablation: the framed subject's live world AABB, recorded for every subject kind. */
    __openClinXrSubjectAabb?: { min: { x: number; y: number; z: number }; max: { x: number; y: number; z: number } };
    __openClinXrIsolatedRenderFrame?: () => void;
    __openClinXrIsolatedRuntimeDebug?: unknown;
  }
}

const WIDTH_LEGACY = 1280;
const HEIGHT_LEGACY = 960;
/** Reference-pack captures are square, matching the #232 pack shape (1024×1024). */
const PACK_WIDTH = 1024;
const BG = "#18211d";












async function renderIsolatedSubject(mount: HTMLElement, spec: IsolatedSubjectSpec): Promise<IsolatedSubjectEvidence> {
  mount.replaceChildren();
  const canvas = document.createElement("canvas");
  canvas.id = "isolated-subject-capture-canvas";
  mount.append(canvas);

  const wallT0 = Date.now();
  const { masksMode, calibMode, parityScene } = resolveParityScene(spec);
  assertParityProductRigRefusal({ masksMode, calibMode, parityScene, productEnvironmentId: spec.productEnvironmentId });

  const renderer = new WebGLRenderer({ antialias: masksMode ? false : true, canvas, preserveDrawingBuffer: true });
  // Product rig call order per apps/ui-xr/src/main.ts: ACES first, right after
  // renderer creation, so the rig exposure value takes effect.
  if (spec.productEnvironmentId) {
    const fns = (window as unknown as { __openClinXrProductLightingRigFns?: ProductLightingRigFns })
      .__openClinXrProductLightingRigFns;
    if (!fns) {
      throw new Error(
        "productEnvironmentId requested but the apps-side product-lighting bridge is absent — refusing rather than inventing a rig",
      );
    }
    fns.configureStationRendererToneMapping(renderer);
  }
  const square = spec.view != null;
  const packSize = spec.renderSize != null && Number.isFinite(spec.renderSize)
    ? Math.min(4096, Math.max(512, Math.round(spec.renderSize)))
    : PACK_WIDTH;
  // Aisha-parity: exact drawing buffer, pixelRatio 1, no auto framing.
  const width = spec.cameraOverride?.width ?? (square ? packSize : WIDTH_LEGACY);
  const height = spec.cameraOverride?.height ?? (square ? packSize : HEIGHT_LEGACY);
  renderer.setSize(width, height, false);
  renderer.setClearColor(new Color(masksMode ? "#000000" : BG));
  renderer.setPixelRatio(1);

  const scene = new Scene();
  scene.background = new Color(masksMode ? "#000000" : BG);
  // Variant evaluator: removeDefaultLights drops this exact default rig (identical otherwise).
  // A product rig or a studio rig also replaces the lab defaults. Parity HDRI /
  // calib / masks captures run lightless (HDRI env or unlit) — no lab defaults.
  if (spec.rigOverride?.removeDefaultLights !== true && !spec.productEnvironmentId && !spec.rigOverride?.studio && !spec.rigOverride?.hdri && !masksMode && !calibMode) {
    scene.add(new AmbientLight("#dceee6", 1.45));
    const key = new DirectionalLight("#ffffff", 2.2);
    key.position.set(3.2, 5.2, 4.1);
    scene.add(key);
    const fill = new DirectionalLight("#b6d8ca", 1.1);
    fill.position.set(-3.5, 2.8, -2.2);
    scene.add(fill);
  }

  // #265: subject-only mode skips the neutral ground plane entirely. The grounded
  // render is the #262 input defect — TRELLIS reconstructed the lit ground plane as
  // geometry, which is what every #262 metric read as "pole lost". One variable:
  // subject geometry only, flat background, nothing else changes.
  // Aisha-parity (P2): P1a has no ground — parity scenes are always groundless.
  if (spec.subjectOnly !== true && !parityScene) {
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
    ground.userData["openClinXrNeutralGround"] = true;
    scene.add(ground);
  }

  const { root, meshCount, humanoid, hairHidden, hiddenHairMeshes } = await buildSubjectRoot(spec);
  // P2 cap39 hideHair: ONLY the scalp hair mesh; brows and lashes stay (enforced).
  enforceHideHairOnly(root, spec.hideHair === true, hiddenHairMeshes);
  scene.add(root);
  window.__openClinXrIsolatedSceneRoot = root;
  root.updateMatrixWorld(true);

  // Variant evaluator: skin maps/scalars post-load, never a GLB write.
  let skinOverrideApplied: SkinOverrideApplied | null = null;
  if (spec.skinOverride) {
    skinOverrideApplied = await applySkinOverride(root, spec.skinOverride);
    root.updateMatrixWorld(true);
  }

  // Variant evaluator: generic material overrides post-load, never a GLB write.
  let materialOverridesApplied: MaterialOverrideApplied[] | null = null;
  if (spec.materialOverrides) {
    materialOverridesApplied = await applyMaterialOverrides(root, spec.materialOverrides);
    root.updateMatrixWorld(true);
  }

  // P2 test-harness modes: flat P1a-table masks, or calib spheres (needs HDRI + cameraOverride).
  const { maskReadback, calibReadback, hdriReadback } = await applyParitySceneModes(renderer, scene, root, spec, masksMode);

  if (humanoid && (spec.subjectKind === "runtime_posture" || spec.subjectKind === "posture_on_furniture")) {
    window.__openClinXrSupineJointDump = dumpSupineJointState(
      humanoid,
      spec.bodyGlb ?? "generated-humanoids/mpfb-gown-adult-patient.glb",
      spec.subjectKind,
    );
  }

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

  // #495 ablation: the framed subject AABB for every kind (glb "standing" cell has
  // no supine dump, so the report reads this instead).
  window.__openClinXrSubjectAabb = {
    min: { x: round3(bounds.min.x), y: round3(bounds.min.y), z: round3(bounds.min.z) },
    max: { x: round3(bounds.max.x), y: round3(bounds.max.y), z: round3(bounds.max.z) },
  };

  const camera = new PerspectiveCamera(35, width / height, 0.01, 100);
  if (spec.cameraOverride) {
    // Aisha-parity: exactly the P1a camera — no auto framing.
    applyParityCameraOverride(camera, spec.cameraOverride);
  }
  const { focusRegion, frameBounds, frameSpanFraction, portrait } = frameLabCamera({
    camera, spec, root, bounds, renderer,
  });

  // Variant evaluator: rig lights resolve AFTER focus so relativeToHead offsets
  // anchor to the framed head centre (portable across humanoids); tone mapping
  // and environment apply here, before the first frame renders.
  if (spec.rigOverride) {
    applyRigOverride(scene, renderer, spec.rigOverride, frameBounds.getCenter(new Vector3()));
  }

  // Aisha-parity levers (each OFF by default; beauty + calib only, never masks).
  const parityBeauty = !masksMode && !calibMode;
  const { shadowReadback, eyesReadback, clothReadback, browLashReadback, hairRimReadback, eyeShadeReadback, skinReadback } = applyParityBeautyLevers({
    scene, renderer, root, spec, masksMode, calibMode, parityBeauty,
    frameCentre: frameBounds.getCenter(new Vector3()), hdriReadback,
  });

  const pipeline = buildParityPipeline(
    renderer,
    scene,
    camera,
    parityBeauty ? spec.parity : undefined,
    width,
    height,
  );

  // Product rig through the PRODUCT functions (see
  // ./isolated-subject-product-rig.ts — split by the file-size budget).
  const { productRig, eyeRuntimeShading } = await applyLabProductRig(
    scene,
    renderer,
    spec,
    frameBounds.getCenter(new Vector3()),
  );

  // ACES guard (card tsk_e0afe706b7a5f071): the shaded eye is graded under
  // ACESFilmic (the bisect measured toneMapping=None as blowout, M2b +9.0).
  // Fails loudly — a non-ACES portrait with eye shading refuses.
  if (eyeRuntimeShading && renderer.toneMapping !== ACESFilmicToneMapping) {
    throw new Error(
      `eyeRuntimeShading requires ACESFilmic tone mapping (got ${renderer.toneMapping}) — refusing rather than grading a blowout eye`,
    );
  }

  const packFraming = recordPackFraming(camera, frameBounds, spec.view);

  // Boot/render/evidence split (size-freeze): finalization lives in parity-scene.
  return finalizeIsolatedSubjectCapture({
    pipeline, root, camera, renderer, scene, spec,
    meshCount, size, packFraming, frameSpanFraction, groundPlanePresent, focusRegion, portrait,
    hairHidden, hiddenHairMeshes, skinOverrideApplied, materialOverridesApplied, productRig,
    masksMode, calibMode, wallT0,
    readbacks: {
      hdri: hdriReadback, shadow: shadowReadback, mask: maskReadback, calib: calibReadback,
      eyes: eyesReadback, cloth: clothReadback, browLash: browLashReadback, hairRim: hairRimReadback, eyeShade: eyeShadeReadback, skin: skinReadback,
    },
  });
}


export function bootIsolatedSubjectLab(): void {
  const app = document.querySelector<HTMLDivElement>("#app");
  if (!app) throw new Error("Missing #app");
  const spec = parseIsolatedSubjectSpec();
  void renderIsolatedSubject(app, spec).catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    app.textContent = `Isolated subject lab error: ${message}`;
    console.error(error);
  });
}
