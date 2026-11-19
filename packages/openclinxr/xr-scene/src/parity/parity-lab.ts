/**
 * Aisha-parity boot (lane aisha-parity, P2): the parity capture path, moved out of
 * isolated-subject-lab.ts so that file stays byte-identical to origin/main (the cornea
 * pin assertStrictLabSourceBinding accepts only the origin/main bytes). Moved verbatim
 * from the branch lab: shared behaviour stays in the modules the lab already imported
 * (isolated-subject-assembly, -debug-evidence, -focus, -material-variants, -product-rig,
 * camera-fit-to-bounds, parity/*) — nothing is copied here, only called.
 *
 * Entry: X/src/parity/parity-lab-entry.ts routes parity specs here and plain specs to
 * the restored lab. Every capture on this path carries the parity readback (a plain-lab
 * boot of a parity spec renders but records no readback).
 */

import {
  ACESFilmicToneMapping,
  AmbientLight,
  Color,
  DirectionalLight,
  Mesh,
  MeshStandardMaterial,
  PerspectiveCamera,
  PlaneGeometry,
  Scene,
  Vector3,
  WebGLRenderer,
} from "three";
import { computeMeshBounds } from "../camera-fit-to-bounds.js";
import { buildSubjectRoot } from "../isolated-subject-assembly.js";
import {
  dumpSupineJointState,
  round3,
} from "../isolated-subject-debug-evidence.js";
import {
  applyMaterialOverrides,
  applySkinOverride,
  type MaterialOverrideApplied,
  type SkinOverrideApplied,
} from "../isolated-subject-material-variants.js";
import {
  applyRigOverride,
  type ProductLightingRigFns,
} from "../isolated-subject-rig-variants.js";
import { applyLabProductRig } from "../isolated-subject-product-rig.js";
import { recordPackFraming } from "../isolated-pack-framing.js";
import type { IsolatedSubjectSpec } from "../isolated-subject-lab.js";
import type {
  ParityRigOverride,
  ParitySpecExtension,
} from "./parity-types.js";
import {
  finalizeIsolatedSubjectCapture,
  frameLabCamera,
  type ParityCaptureEvidence,
} from "./parity-finalize.js";
import { buildParityPipeline } from "./parity-pipeline.js";
import {
  applyParityBeautyLevers,
  applyParityCameraOverride,
  applyParitySceneModes,
  assertParityProductRigRefusal,
  enforceHideHairOnly,
  resolveParityScene,
} from "./parity-scene.js";

/** Spec surface the parity boot reads: the lab spec plus the parity-only keys. */
export type ParityLabSpec = Omit<IsolatedSubjectSpec, "rigOverride"> &
  ParitySpecExtension & {
    rigOverride?: ParityRigOverride;
  };

// Capture-canvas constants mirrored from isolated-subject-lab.ts (that file stays
// byte-pinned to origin/main, so the parity boot carries its own copy).
const WIDTH_LEGACY = 1280;
const HEIGHT_LEGACY = 960;
/** Reference-pack captures are square, matching the #232 pack shape (1024×1024). */
const PACK_WIDTH = 1024;
const BG = "#18211d";

async function renderParitySubject(mount: HTMLElement, spec: ParityLabSpec): Promise<ParityCaptureEvidence> {
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

/** Boot the parity capture into #app for an already-parsed parity spec. */
export function bootParityLab(spec: ParityLabSpec): void {
  const app = document.querySelector<HTMLDivElement>("#app");
  if (!app) throw new Error("Missing #app");
  void renderParitySubject(app, spec).catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    app.textContent = `Isolated subject lab error: ${message}`;
    console.error(error);
  });
}
