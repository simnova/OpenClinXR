/**
 * Aisha-parity finalization (lane aisha-parity, P2): the lab-split framing
 * and finalize blocks, second half of the parity-scene split (zone budget).
 * Moved verbatim — behaviour lives here, the lab keeps thin call sites.
 */

import type {
  Box3,
  Object3D,
  PerspectiveCamera,
  Scene,
  Vector3,
  WebGLRenderer,
} from "three";
import { measureArticulatingHob } from "../articulating-hob-measure.js";
import {
  type CaptureView,
  frameCamera,
  framePortraitCamera,
} from "../camera-fit-to-bounds.js";
import type { PackFramingRecord } from "../isolated-pack-framing.js";
import { collectRuntimeDebug, projectBoxPx } from "../isolated-subject-debug-evidence.js";
import { type FocusRegion, resolveFocus } from "../isolated-subject-focus.js";
import type {
  IsolatedSubjectEvidence,
  IsolatedSubjectKind,
} from "../isolated-subject-lab.js";
/** Parity capture evidence: the lab evidence plus the live parity readback. */
export type ParityCaptureEvidence = IsolatedSubjectEvidence & {
  parity?: ParityReadback;
};
import type {
  MaterialOverrideApplied,
  SkinOverrideApplied,
} from "../isolated-subject-material-variants.js";
import type { ProductRigApplied } from "../isolated-subject-rig-variants.js";
import type { HdriReadback } from "./parity-hdri.js";
import {
  advanceCaptureFrames,
  buildParityReadback,
  exportCaptureGlbIfRequested,
  measureParityCanvasCoverage,
  type ParitySceneSpec,
  readBindPoseState,
} from "./parity-scene.js";
import type {
  CameraOverride,
  ParityReadback,
  ParitySpecExtension,
} from "./parity-types.js";

/** Portrait frame record (matches the lab evidence/live-debug shape). */
export type LabPortraitFrame = {
  fovDeg: number;
  fillTarget: number;
  distanceM: number;
  headHeightPx: number;
  headBoxPx: { x0: number; y0: number; x1: number; y1: number };
  yawDegrees: number;
} | null;

/**
 * Lab-split framing: resolve the focus region, then frame the camera.
 * Moved verbatim from the lab — #354/#358 focus framing (the frame is driven
 * to the DERIVED region, never a literal camera position; an unresolvable
 * focus REFUSES instead of silently falling back), the portrait head path,
 * or the legacy auto frame. Aisha-parity cameraOverride skips auto framing.
 */
export function frameLabCamera(args: {
  camera: PerspectiveCamera;
  spec: ParitySceneSpec & {
    focus?: "eyes" | "head" | "mouth" | "forearm" | "neck";
    portrait?: boolean;
    yawDegrees?: number;
    view?: CaptureView;
  };
  root: Object3D;
  bounds: Box3;
  renderer: WebGLRenderer;
}): {
  focusRegion: FocusRegion;
  frameBounds: Box3;
  frameSpanFraction: number | null;
  portrait: LabPortraitFrame;
} {
  const { camera, spec, root, bounds, renderer } = args;
  // #354/#358: focus framing — the frame is driven to the DERIVED region, never
  // a literal camera position. An unresolvable focus REFUSES (#358) instead of
  // silently falling back; the evidence records which framing was actually used.
  const { focusRegion, frameBounds } = resolveFocus(root, spec.focus, bounds);

  let frameSpanFraction: number | null;
  let portrait: LabPortraitFrame = null;
  if (spec.cameraOverride) {
    // Aisha-parity: the P1a camera is used verbatim — no auto framing.
    frameSpanFraction = null;
  } else if (spec.portrait === true) {
    // Head path: chin-to-crown. st-vitbody r4: forearm / neck-close frameBounds.
    const framed = framePortraitCamera(camera, frameBounds, spec.yawDegrees ?? 0);
    frameSpanFraction = null;
    const boxPx = projectBoxPx(camera, frameBounds, renderer.domElement.width, renderer.domElement.height);
    portrait = {
      fovDeg: 24,
      fillTarget: 0.78,
      distanceM: framed.distanceM,
      headHeightPx: boxPx.heightPx,
      headBoxPx: { x0: boxPx.x0, y0: boxPx.y0, x1: boxPx.x1, y1: boxPx.y1 },
      yawDegrees: spec.yawDegrees ?? 0,
    };
  } else {
    frameSpanFraction = frameCamera(camera, frameBounds, spec.view, spec.yawDegrees);
  }
  return { focusRegion, frameBounds, frameSpanFraction, portrait };
}

/**
 * Lab-split finalization: HOB measure, optional GLB export, coverage, bind
 * pose, evidence assembly, and window publication. Moved verbatim from the
 * lab (the boot/render/evidence split the size-freeze entry asked for).
 */
export async function finalizeIsolatedSubjectCapture(args: {
  pipeline: { renderFrame: () => void; readback: ParityReadback["pipeline"] };
  root: Object3D;
  camera: PerspectiveCamera;
  renderer: WebGLRenderer;
  scene: Scene;
  spec: ParitySceneSpec & {
    subjectId: string;
    subjectKind: IsolatedSubjectKind;
    label?: string;
    inclineDegrees?: number;
  };
  meshCount: number;
  size: Vector3;
  packFraming: PackFramingRecord;
  frameSpanFraction: number | null;
  groundPlanePresent: boolean;
  focusRegion: FocusRegion;
  portrait: LabPortraitFrame;
  hairHidden: boolean;
  hiddenHairMeshes: string[];
  skinOverrideApplied: SkinOverrideApplied | null;
  materialOverridesApplied: MaterialOverrideApplied[] | null;
  productRig: ProductRigApplied | null;
  masksMode: boolean;
  calibMode: boolean;
  wallT0: number;
  readbacks: {
    hdri: HdriReadback | null;
    shadow: ParityReadback["shadows"];
    mask: ParityReadback["masks"];
    calib: ParityReadback["calib"];
    eyes: ParityReadback["physical"]["eyes"];
    cloth: ParityReadback["physical"]["cloth"];
    browLash: ParityReadback["physical"]["browLash"];
    hairRim: ParityReadback["physical"]["hairRim"];
    eyeShade: ParityReadback["physical"]["eyeShade"];
    skin: ParityReadback["physical"]["skin"];
  };
}): Promise<ParityCaptureEvidence> {
  const { pipeline, root, camera, renderer, scene, spec } = args;
  window.__openClinXrIsolatedRenderFrame = () => { pipeline.renderFrame(); };

  const framesAdvanced = await advanceCaptureFrames(
    pipeline,
    root,
    camera,
    args.readbacks.skin != null,
  );

  const requestedDeg = spec.inclineDegrees ?? 0;
  window.__openClinXrArticulatingHobMeasure = measureArticulatingHob(root, requestedDeg, framesAdvanced);

  await exportCaptureGlbIfRequested(root, spec.exportGlb);

  const frameCoverageHint = Math.min(
    0.95,
    Math.max(0.05, (args.size.x * args.size.y) / Math.max(args.size.length() * args.size.length() * 0.35, 0.01)),
  );
  const frameCoverage = measureParityCanvasCoverage(renderer);

  // Aisha-parity bind pose: the lab instantiates no AnimationMixer and plays
  // no clips — skins render from the imported joint transforms (bind),
  // matching P1a (actions removed, armatures at REST). Read live.
  const { skinnedMeshes, bones, morphInfluencesAllZero } = readBindPoseState(root);

  const parityWanted =
    args.masksMode || args.calibMode || spec.cameraOverride != null || args.readbacks.hdri != null || spec.parity != null;
  camera.updateMatrixWorld(true);
  const evidence: ParityCaptureEvidence = {
    source: "window.__openClinXrIsolatedSubjectEvidence",
    subjectId: spec.subjectId,
    subjectKind: spec.subjectKind,
    label: spec.label ?? spec.subjectId,
    roomGeometryPresent: false,
    hudPresent: false,
    extraActorIds: [],
    meshCount: args.meshCount,
    boundsMeters: {
      width: Math.round(args.size.x * 1000) / 1000,
      height: Math.round(args.size.y * 1000) / 1000,
      depth: Math.round(args.size.z * 1000) / 1000,
    },
    packFraming: args.packFraming,
    frameCoverageHint,
    frameCoverage,
    frameSpanFraction: args.frameSpanFraction,
    groundPlanePresent: args.groundPlanePresent,
    focusRegion: args.focusRegion,
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
    ...(parityWanted
      ? {
          parity: buildParityReadback({
            camera,
            cameraOverride: spec.cameraOverride,
            bindPose: { skinnedMeshes, bones, morphInfluencesAllZero },
            hdri: args.readbacks.hdri,
            renderer,
            pipelineReadback: pipeline.readback,
            shadows: args.readbacks.shadow,
            masks: args.readbacks.mask,
            calib: args.readbacks.calib,
            eyes: args.readbacks.eyes,
            cloth: args.readbacks.cloth,
            browLash: args.readbacks.browLash,
            hairRim: args.readbacks.hairRim,
            eyeShade: args.readbacks.eyeShade,
            skin: args.readbacks.skin,
            wallMs: Date.now() - args.wallT0,
          }),
        }
      : {}),
  };
  window.__openClinXrIsolatedSubjectEvidence = evidence;
  const liveDebug = collectRuntimeDebug({
    renderer, scene, root,
    hairHidden: args.hairHidden,
    hiddenHairMeshes: args.hiddenHairMeshes,
    skinOverrideApplied: args.skinOverrideApplied,
    materialOverridesApplied: args.materialOverridesApplied,
    productRig: args.productRig,
    portrait: args.portrait,
  }) as Record<string, unknown>;
  if (parityWanted) {
    liveDebug["parity"] = evidence.parity;
    liveDebug["parityCamera"] = evidence.parity?.cameraOverride;
  }
  window.__openClinXrIsolatedRuntimeDebug = liveDebug;
  return evidence;
}
