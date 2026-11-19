/**
 * Aisha-parity scene assembly (lane aisha-parity, P2): the capture-harness
 * blocks extracted from isolated-subject-lab.ts so that file stays within
 * its size-freeze ceiling. Moved verbatim — behaviour lives here, the lab
 * keeps thin call sites.
 *
 * Covers: parity scene guards, hideHair-only enforcement, masks/calib/HDRI
 * scene modes, the exact P1a camera, beauty levers, capture frame advance
 * (with the SSS view refresh), conditional GLB export, bind-pose readback,
 * the ParityReadback assembly, and the canvas-coverage measure.
 */

import {
  ACESFilmicToneMapping,
  AgXToneMapping,
  NeutralToneMapping,
  NoToneMapping,
  type Object3D,
  type PerspectiveCamera,
  type Scene,
  SRGBColorSpace,
  type Vector3,
  type WebGLRenderer,
} from "three";
import { GLTFExporter } from "three/addons/exporters/GLTFExporter.js";
import type { CalibReadback } from "./parity-calib.js";
import { installCalibSpheres } from "./parity-calib.js";
import {
  applyBrowLash,
  applyHairRim,
  applyMaskMaterials,
  type BrowLashReadback,
  type HairRimReadback,
  type MaskReadback,
} from "./parity-hair-mask.js";
import { applyParityEyeShade } from "./parity-eye-shade.js";
import type { EyeShadeReadback } from "./parity-types.js";
import { type HdriReadback, loadParityHdri } from "./parity-hdri.js";
import {
  applyClothPhysical,
  applyEyePhysical,
  applySkinPhysical,
  DEFAULT_SSS_WRAP,
} from "./parity-materials.js";
import { applyParityShadow } from "./parity-shadow.js";
import { updateSssViewUniforms } from "./parity-sss-uniforms.js";
import type {
  CameraOverride,
  ParityReadback,
  ParityRigOverride,
  ParitySkinParams,
  ParitySpecExtension,
} from "./parity-types.js";

/** The spec surface the parity scene assembly reads (a structural view of the lab spec). */
export type ParitySceneSpec = ParitySpecExtension & {
  rigOverride?: ParityRigOverride | null;
  exportGlb?: boolean;
};

/**
 * Parity scene flags + invariants. Throws exactly as the lab did: masks and
 * calib are mutually exclusive; any parity signal refuses the product rig.
 */
export function resolveParityScene(spec: ParitySceneSpec): {
  masksMode: boolean;
  calibMode: boolean;
  parityScene: boolean;
} {
  const masksMode = spec.masks === true;
  const calibMode = spec.calib != null;
  if (masksMode && calibMode) {
    throw new Error("parity masks + calib are mutually exclusive — refusing");
  }
  // Aisha-parity (P2): the P1a world has no ground plane (subject floats over
  // the HDRI background). Any parity signal implies the groundless scene.
  const parityScene =
    masksMode || calibMode || spec.cameraOverride != null || spec.rigOverride?.hdri != null || spec.parity != null;
  return { masksMode, calibMode, parityScene };
}

/** Refuses when the parity capture would use the product rig (HDRI world only). */
export function assertParityProductRigRefusal(
  args: { masksMode: boolean; calibMode: boolean; parityScene: boolean; productEnvironmentId: unknown },
): void {
  if (args.parityScene && args.productEnvironmentId) {
    throw new Error("parity capture refuses the product rig — HDRI world only");
  }
}

/**
 * Aisha-parity (P2 cap39): hideHair removes ONLY the scalp hair mesh — brows
 * and lashes stay. Enforces the guard and the eyebrow/eyelash survival check.
 */
export function enforceHideHairOnly(root: Object3D, hideHair: boolean, hiddenHairMeshes: string[]): void {
  if (hideHair !== true) return;
  for (const name of hiddenHairMeshes) {
    if (!/hair/i.test(name) || /brow|lash/i.test(name)) {
      throw new Error(`parity hideHair removed a non-hair mesh: ${name} — refusing`);
    }
  }
  const remaining: string[] = [];
  root.traverse((o) => {
    if ((o as { isMesh?: boolean }).isMesh === true) remaining.push((o as { name?: string }).name ?? "");
  });
  if (!remaining.some((n) => /eyebrow/i.test(n))) {
    throw new Error("parity hideHair left no eyebrow mesh — refusing");
  }
  if (!remaining.some((n) => /eyelash/i.test(n))) {
    throw new Error("parity hideHair left no eyelash mesh — refusing");
  }
}

/**
 * Aisha-parity (P2) test-harness scene modes. Mask mode swaps to flat P1a-table
 * ID colours (no AA, no tone mapping). Calib mode hides the subject and
 * renders the P1a chrome/grey spheres (requires HDRI + cameraOverride).
 */
export async function applyParitySceneModes(
  renderer: WebGLRenderer,
  scene: Scene,
  root: Object3D,
  spec: ParitySceneSpec,
  masksMode: boolean,
): Promise<{
  maskReadback: MaskReadback | null;
  calibReadback: CalibReadback | null;
  hdriReadback: HdriReadback | null;
}> {
  let maskReadback: MaskReadback | null = null;
  let calibReadback: CalibReadback | null = null;
  let hdriReadback: HdriReadback | null = null;
  if (masksMode) {
    if (spec.rigOverride?.hdri || spec.parity?.shadows || spec.parity?.ao || spec.parity?.physical) {
      throw new Error("parity mask mode refuses hdri/shadows/ao/physical — flat IDs only");
    }
    renderer.toneMapping = NoToneMapping;
    maskReadback = applyMaskMaterials(root);
    root.updateMatrixWorld(true);
  } else if (spec.rigOverride?.hdri) {
    hdriReadback = await loadParityHdri(renderer, scene, spec.rigOverride.hdri);
  }
  if (spec.calib != null) {
    if (!spec.cameraOverride || !hdriReadback) {
      throw new Error("parity calib requires cameraOverride + rigOverride.hdri — refusing");
    }
    calibReadback = installCalibSpheres(root, spec.calib.spheres);
    scene.updateMatrixWorld(true);
  }
  return { maskReadback, calibReadback, hdriReadback };
}

/** Aisha-parity: point the lab camera exactly at the P1a camera — no auto framing. */
export function applyParityCameraOverride(camera: PerspectiveCamera, co: CameraOverride): void {
  camera.fov = co.vfovDeg;
  camera.aspect = co.width / co.height;
  camera.near = co.near;
  camera.far = co.far;
  camera.position.set(co.position[0], co.position[1], co.position[2]);
  camera.up.set(co.up[0], co.up[1], co.up[2]);
  camera.lookAt(co.target[0], co.target[1], co.target[2]);
  camera.updateMatrixWorld(true);
  camera.updateProjectionMatrix();
}

/**
 * Aisha-parity beauty/calib levers (each OFF by default; beauty + calib only,
 * never masks). HDRI loads pre-camera (no camera dependence); everything else
 * resolves here, after the frame centre is known, before the first frame.
 */
export function applyParityBeautyLevers(args: {
  scene: Scene;
  renderer: WebGLRenderer;
  root: Object3D;
  spec: ParitySceneSpec;
  masksMode: boolean;
  calibMode: boolean;
  parityBeauty: boolean;
  frameCentre: Vector3;
  hdriReadback: HdriReadback | null;
}): {
  shadowReadback: ReturnType<typeof applyParityShadow> | null;
  eyesReadback: ReturnType<typeof applyEyePhysical> | null;
  clothReadback: ReturnType<typeof applyClothPhysical> | null;
  browLashReadback: BrowLashReadback[] | null;
  hairRimReadback: HairRimReadback[] | null;
  eyeShadeReadback: EyeShadeReadback | null;
  skinReadback: ReturnType<typeof applySkinPhysical> | null;
} {
  const { scene, renderer, root, spec, masksMode, calibMode, parityBeauty, frameCentre, hdriReadback } = args;
  let shadowReadback: ReturnType<typeof applyParityShadow> | null = null;
  let eyesReadback: ReturnType<typeof applyEyePhysical> | null = null;
  let clothReadback: ReturnType<typeof applyClothPhysical> | null = null;
  let browLashReadback: BrowLashReadback[] | null = null;
  let hairRimReadback: HairRimReadback[] | null = null;
  let eyeShadeReadback: EyeShadeReadback | null = null;
  let skinReadback: ReturnType<typeof applySkinPhysical> | null = null;
  if (masksMode || !(spec.parity != null || spec.cameraOverride != null || hdriReadback != null)) {
    return { shadowReadback, eyesReadback, clothReadback, browLashReadback, hairRimReadback, eyeShadeReadback, skinReadback };
  }
  renderer.outputColorSpace = SRGBColorSpace;
  if (spec.parity?.toneMapping) {
    renderer.toneMapping =
      spec.parity.toneMapping === "AgX"
        ? AgXToneMapping
        : spec.parity.toneMapping === "ACESFilmic"
          ? ACESFilmicToneMapping
          : spec.parity.toneMapping === "Neutral"
            ? NeutralToneMapping
            : NoToneMapping;
  }
  if (spec.parity?.exposure != null && Number.isFinite(spec.parity.exposure)) {
    renderer.toneMappingExposure = spec.parity.exposure;
  }
  const parityCentre = calibMode
    ? {
        x: (spec.calib!.spheres.chromeCenter[0] + spec.calib!.spheres.greyCenter[0]) / 2,
        y: (spec.calib!.spheres.chromeCenter[1] + spec.calib!.spheres.greyCenter[1]) / 2,
        z: (spec.calib!.spheres.chromeCenter[2] + spec.calib!.spheres.greyCenter[2]) / 2,
      }
    : { x: frameCentre.x, y: frameCentre.y, z: frameCentre.z };
  if (spec.parity?.physical && parityBeauty) {
    if (spec.parity.physical.eyes === true) {
      eyesReadback = applyEyePhysical(root, undefined, scene);
      root.updateMatrixWorld(true);
    } else if (spec.parity.physical.eyes != null && typeof spec.parity.physical.eyes === "object") {
      eyesReadback = applyEyePhysical(root, spec.parity.physical.eyes, scene);
      root.updateMatrixWorld(true);
    }
    if (spec.parity.physical.eyeShade != null) {
      eyeShadeReadback = applyParityEyeShade(root, spec.parity.physical.eyeShade);
      root.updateMatrixWorld(true);
    }
    if (spec.parity.physical.cloth === true) {
      clothReadback = applyClothPhysical(root);
      root.updateMatrixWorld(true);
    } else if (spec.parity.physical.cloth != null && typeof spec.parity.physical.cloth === "object") {
      clothReadback = applyClothPhysical(root, spec.parity.physical.cloth);
      root.updateMatrixWorld(true);
    }
    if (spec.parity.physical.browLash != null) {
      browLashReadback = applyBrowLash(root, spec.parity.physical.browLash);
      root.updateMatrixWorld(true);
    }
    if (spec.parity.physical.hairRim != null) {
      hairRimReadback = applyHairRim(root, spec.parity.physical.hairRim);
      root.updateMatrixWorld(true);
    }
    if (spec.parity.physical.skin === true || (spec.parity.physical.skin != null && typeof spec.parity.physical.skin === "object")) {
      const skinParams: ParitySkinParams = spec.parity.physical.skin === true ? {} : spec.parity.physical.skin;
      const sssDir =
        spec.parity.shadows?.direction ??
        hdriReadback?.brightestDir ??
        DEFAULT_SSS_WRAP.lightDirWorld;
      skinReadback = applySkinPhysical(
        root,
        {
          ...DEFAULT_SSS_WRAP,
          ...(skinParams.sssWrap !== undefined ? { wrap: skinParams.sssWrap } : {}),
          ...(skinParams.sssStrength !== undefined ? { strength: skinParams.sssStrength } : {}),
          lightDirWorld: sssDir,
        },
        skinParams.roughness,
      );
      root.updateMatrixWorld(true);
    }
  } else if (spec.parity?.physical && calibMode) {
    throw new Error("parity physical levers refuse calib mode — spheres only");
  }
  if (spec.parity?.shadows) {
    if (!hdriReadback) {
      throw new Error("parity shadows require rigOverride.hdri (HDR-derived direction) — refusing");
    }
    shadowReadback = applyParityShadow(
      scene,
      renderer,
      root,
      spec.parity.shadows,
      hdriReadback.brightestDir,
      [parityCentre.x, parityCentre.y, parityCentre.z],
    );
  }
  return { shadowReadback, eyesReadback, clothReadback, browLashReadback, hairRimReadback, eyeShadeReadback, skinReadback };
}

/**
 * Advance the capture frames: min 4 frames; when the SSS wrap is active its
 * light dir is view-space, so refresh the uniforms after the first compile
 * and render once more.
 */
export async function advanceCaptureFrames(
  pipeline: { renderFrame: () => void },
  root: Object3D,
  camera: PerspectiveCamera,
  hasSkinReadback: boolean,
): Promise<number> {
  let framesAdvanced = 0;
  await new Promise<void>((resolve) => {
    const step = () => {
      pipeline.renderFrame();
      framesAdvanced += 1;
      if (framesAdvanced === 1 && hasSkinReadback) {
        // SSS wrap light dir is view-space: refresh after the first compile.
        updateSssViewUniforms(root, camera);
        pipeline.renderFrame();
        framesAdvanced += 1;
      }
      if (framesAdvanced >= 4) {
        resolve();
        return;
      }
      requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  });
  return framesAdvanced;
}

/**
 * Parametric-source serialization (#262): export the same rendered root to a
 * GLB so the bake output can be compared glTF-vs-glTF. No-op unless requested.
 */
export async function exportCaptureGlbIfRequested(root: Object3D, exportGlb: boolean | undefined): Promise<void> {
  if (exportGlb !== true) return;
  // Export the same root the harness rendered to a GLB so the bake output
  // can be compared with the same instrument (glTF-vs-glTF), not a
  // browser-side count vs a trimesh count.
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

/**
 * Aisha-parity bind pose: the lab instantiates no AnimationMixer and plays no
 * clips — skins render from the imported joint transforms (bind), matching
 * P1a (actions removed, armatures at REST). Read live.
 */
export function readBindPoseState(root: Object3D): {
  skinnedMeshes: number;
  bones: number;
  morphInfluencesAllZero: boolean;
} {
  let skinnedMeshes = 0;
  let bones = 0;
  let morphInfluencesAllZero = true;
  root.traverse((o) => {
    const skinned = o as unknown as {
      isSkinnedMesh?: boolean;
      skeleton?: { bones?: unknown[] };
      morphTargetInfluences?: number[];
    };
    if (skinned.isSkinnedMesh === true) {
      skinnedMeshes += 1;
      bones += skinned.skeleton?.bones?.length ?? 0;
      for (const w of skinned.morphTargetInfluences ?? []) {
        if (w !== 0) morphInfluencesAllZero = false;
      }
    }
  });
  return { skinnedMeshes, bones, morphInfluencesAllZero };
}

/** Assemble the ParityReadback from live scene/renderer values (never source-read). */
export function buildParityReadback(args: {
  camera: PerspectiveCamera;
  cameraOverride: CameraOverride | null | undefined;
  bindPose: { skinnedMeshes: number; bones: number; morphInfluencesAllZero: boolean };
  hdri: HdriReadback | null;
  renderer: WebGLRenderer;
  pipelineReadback: ParityReadback["pipeline"];
  shadows: ParityReadback["shadows"];
  masks: ParityReadback["masks"];
  calib: ParityReadback["calib"];
  eyes: ParityReadback["physical"]["eyes"];
  cloth: ParityReadback["physical"]["cloth"];
  browLash: ParityReadback["physical"]["browLash"];
  hairRim: ParityReadback["physical"]["hairRim"];
  eyeShade: ParityReadback["physical"]["eyeShade"];
  skin: ParityReadback["physical"]["skin"];
  wallMs: number;
}): ParityReadback {
  return {
    cameraOverride: args.cameraOverride
      ? {
          position: [...args.cameraOverride.position] as [number, number, number],
          target: [...args.cameraOverride.target] as [number, number, number],
          vfovDeg: args.cameraOverride.vfovDeg,
          width: args.cameraOverride.width,
          height: args.cameraOverride.height,
          matrixWorld: Array.from(args.camera.matrixWorld.toArray()),
          projectionMatrix: Array.from(args.camera.projectionMatrix.toArray()),
        }
      : null,
    bindPose: {
      animationClips: [],
      mixerCreated: false as const,
      skinnedMeshes: args.bindPose.skinnedMeshes,
      bones: args.bindPose.bones,
      morphInfluencesAllZero: args.bindPose.morphInfluencesAllZero,
    },
    hdri: args.hdri,
    toneMapping: args.renderer.toneMapping,
    toneMappingExposure: args.renderer.toneMappingExposure,
    outputColorSpace: args.renderer.outputColorSpace,
    pipeline: args.pipelineReadback,
    shadows: args.shadows,
    masks: args.masks,
    calib: args.calib,
    physical: {
      eyes: args.eyes,
      cloth: args.cloth,
      browLash: args.browLash,
      hairRim: args.hairRim,
      eyeShade: args.eyeShade,
      skin: args.skin,
    },
    wallMs: args.wallMs,
  } satisfies ParityReadback;
}

export function measureParityCanvasCoverage(renderer: WebGLRenderer): number {
  const canvas = renderer.domElement;
  const gl = renderer.getContext();
  const w = canvas.width;
  const h = canvas.height;
  if (w < 1 || h < 1) return 0;
  const pixels = new Uint8Array(w * h * 4);
  gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
  let nonBg = 0;
  for (let i = 0; i < pixels.length; i += 4) {
    const r = pixels[i] ?? 0;
    const g = pixels[i + 1] ?? 0;
    const b = pixels[i + 2] ?? 0;
    if (Math.abs(r - 0x18) + Math.abs(g - 0x21) + Math.abs(b - 0x1d) > 36) nonBg += 1;
  }
  return nonBg / (w * h);
}

