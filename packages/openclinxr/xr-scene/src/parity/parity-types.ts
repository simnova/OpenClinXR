/**
 * Aisha-parity levers (lane aisha-parity, P2): best-case three.js match of the
 * Blender P1a reference for the SAME shipped Aisha GLB. Test harness only.
 *
 * Every lever is OFF by default; every applied lever is read back live from
 * the scene/renderer into the lab evidence (proved by readback, not source).
 */

import type { CalibReadback, CalibSpheres } from "./parity-calib.js";
import type { HdriReadback } from "./parity-hdri.js";
import type {
  BrowLashReadback,
  HairRimReadback,
  MaskReadback,
} from "./parity-hair-mask.js";
import type { PhysicalSwapReadback } from "./parity-materials.js";
import type { PipelineReadback } from "./parity-pipeline.js";
import type { ShadowReadback } from "./parity-shadow.js";

export type CameraOverride = {
  position: [number, number, number];
  target: [number, number, number];
  up: [number, number, number];
  vfovDeg: number;
  width: number;
  height: number;
  near: number;
  far: number;
};

/** HDRI rig: the P1a world (studio HDRI, strength 1, Z rotation 0). */
export type HdriRig = {
  /** Public URL under the dev server (gitignored symlink, never committed). */
  url: string;
  /** Y rotation in degrees applied to BOTH scene.environmentRotation and
   * scene.backgroundRotation (three Y-up == Blender world-Z). */
  rotationYDeg: number;
  /** Multiplier on the baked PMREM environment (scene.environmentIntensity). */
  intensity: number;
  /** True: the equirect texture itself is scene.background (P1a shows the
   * HDRI behind the subject; film_transparent=False). */
  background: boolean;
};

export type ParityAa = "msaa" | "smaa" | "ssaa";

/**
 * Aisha-parity (P2b step 3): SSAA kernel options. Default (absent) is the
 * landed 2x exact box downsample — old presets are unaffected. scale 3/4
 * with the gauss15 kernel reproduces the Cycles 1.5px pixel filter for
 * subpixel strands (brows/lashes, cap rim): each native pixel gathers
 * hires texels within 0.75px native radius, Gaussian-weighted (sigma 0.37).
 */
export type ParitySsaa = {
  /** Super-sample factor (default 2). 3 = 4608px hires at 1536px native. */
  scale?: 2 | 3 | 4;
  /** Downsample kernel (default "box": exact 2x2 mean, scale 2 only). */
  filter?: "box" | "gauss15";
};

export type ParityAo = {
  kind: "gtao";
  radius: number;
  intensity: number;
};

export type ParityShadows = {
  /** DirectionalLight shadow map. Defaults: PCFSoft, 4096, bias tuned. */
  type?: "pcfsoft" | "vsm";
  mapSize?: number;
  bias?: number;
  /** When absent, derived so the P1a grey sphere matches (recorded). */
  intensity?: number;
  /** When absent, computed from the HDR brightest texel (recorded). */
  direction?: [number, number, number];
};

export type ParityPhysical = {
  /**
   * Lever e (physical.eyes): clearcoat/ior/specular swap on the eye-globe
   * slot (meshlow-poly). `true` = the landed P2 values (clearcoat 1/0.03,
   * ior 1.376, specularIntensity 1, roughness kept). An object overrides
   * per-field; the P1b manifest values are roughness 0.05, specular 0.5,
   * coat 1/0.02/1.376 (P2b step 3: GLB eye roughness is 0.5 — ten times the
   * P1b value — which scatters the HDRI into flat bright sclera).
   */
  eyes?: boolean | ParityEyeParams;
  /**
   * Lever f (physical.cloth): `true` = landed P2 values (sheen 1 /
   * sheenRoughness 0.8, sheenColor = map mean). An object overrides
   * per-field (P2b step 5: sheen sweep 0/0.1/0.25/0.5, sheenColorScale,
   * sheenRoughness 0.5-0.9). Absent fields keep the landed values.
   */
  cloth?: boolean | ParityClothParams;
  skin?: boolean | ParitySkinParams;
  /**
   * Aisha-parity (P2b step 2): brow/lash compensation. The GLB brow/lash
   * albedo is faithful in three (readback #3f3027/#272727 == baseColorFactor)
   * but renders ~5x too bright vs Blender Cycles AgX (strand-core L* 24.6 vs
   * 6.8): three.js AgX toe + MSAA-vs-Cycles-filter on subpixel strands.
   * Scales the fitted brow/lash albedo and cuts their IBL response. OFF by
   * default; old presets unaffected.
   */
  browLash?: ParityBrowLash;
  /**
   * Aisha-parity (P2b step 4F): hair-cap rim z-fight fix. The fitted scalp
   * cap sits ~sub-mm off the forehead/cheek; rasterization alternates
   * hair/skin winners along the rim (dotted dark fringe, runtime only;
   * Cycles resolves exact nearest hits). polygonOffset pulls the scalp hair
   * toward the camera in depth. Scalp hair mat only (brows/lashes untouched).
   * OFF by default.
   */
  hairRim?: ParityHairRim;
  /**
   * Aisha-parity (P4a): sclera env-reflection suppression + lid occlusion.
   * Runs the product sclera hook (applyEyeShading: sclera env attenuation
   * EYE_SCLERA_ENV_ATTEN-style value, lid band EYE_LID_BAND_M-style value,
   * darken EYE_LID_DARKEN-style value) on the parity globe material in the
   * HDRI world. Runs AFTER the eyes lever so it hooks the final globe
   * material. corneaFresnel defaults to true (follows scleraShade in the
   * product hook); explicit false renders the legacy cornea. OFF by default.
   */
  eyeShade?: ParityEyeShade;
};

/** Eye-lever params: every field optional; absent = the landed P2 value. */
export type ParityEyeParams = {
  roughness?: number;
  envMapIntensity?: number;
  specularIntensity?: number;
  clearcoat?: number;
  clearcoatRoughness?: number;
};

/** Cloth-lever params: every field optional; absent = the landed P2 value. */
export type ParityClothParams = {
  sheen?: number;
  /** Multiplier on the map-mean sheenColor (P2b step 5: 0.5). */
  sheenColorScale?: number;
  sheenRoughness?: number;
};

/**
 * Skin-lever params: every field optional; absent = the landed P2 value
 * (SSS wrap 0.45 / strength 0.06, roughness kept). P2b step 6 sweep.
 */
export type ParitySkinParams = {
  sssWrap?: number;
  sssStrength?: number;
  roughness?: number;
};

/** Brow/lash lever params: albedo multiplier (linear), IBL scale, roughness. */
export type ParityBrowLash = {
  colorScale: number;
  envMapIntensity: number;
  roughness: number;
};

/** Hair-rim lever params: polygonOffset pull of the scalp hair toward camera. */
export type ParityHairRim = {
  factor: number;
  units: number;
};

/**
 * Eye-shade lever params (P4a): every field required except corneaFresnel.
 * scleraAtten in [0,1], lidBandM > 0 (metres, globe object space),
 * lidDarken in [0,1]. Product defaults: 0.35 / 0.007 / 0.85.
 */
export type ParityEyeShade = {
  scleraAtten: number;
  lidBandM: number;
  lidDarken: number;
  corneaFresnel?: boolean;
};

/** Live readback for one parity eyeShade install (values + match record). */
export type EyeShadeReadback = {
  matched: string[];
  margins: number;
  scleraAtten: number;
  lidBandM: number;
  lidDarken: number;
  corneaFresnel: boolean;
};

/**
 * Parity levers, each OFF by default. `toneMapping` reuses the RigOverride
 * vocabulary (AgX + exposure, outputColorSpace sRGB recorded).
 */
export type ParityLevers = {
  toneMapping?: "None" | "ACESFilmic" | "AgX" | "Neutral";
  exposure?: number;
  aa?: ParityAa;
  /** SSAA kernel options; only read when aa === "ssaa". Absent = 2x box. */
  ssaa?: ParitySsaa;
  ao?: ParityAo;
  shadows?: ParityShadows;
  physical?: ParityPhysical;
};

/** Flat-ID mask categories: the exact P1a colour table (linear 0/1). */
export const PARITY_MASK_TABLE = {
  skin: [1, 0, 0],
  eyes: [0, 1, 0],
  clothing: [0, 0, 1],
  hair: [1, 1, 0],
  teeth: [1, 0, 1],
  hidden: [0, 0, 0],
} as const;

export type ParityMaskCategory = keyof typeof PARITY_MASK_TABLE;

const SKIN_MATS = new Set(["mpfb_skin_ob_patient_aisha_v1"]);
const EYE_RE = /^mat_makeclothes_library_eyes_/;
const CLOTHING_MATS = new Set([
  "mat_makeclothes_library_female_tight_jeans_pants",
  "mat_makeclothes_library_footwear_toigo_mj_cloth_shoes",
  "mat_makeclothes_library_toigo_t_shirt",
]);
const HAIR_MATS = new Set([
  "openclinxr_fitted_hair_toigo_blunt_bob_with_bangs_mpfb_ob_patient_aisha_v1_mat",
  "openclinxr_fitted_eyebrow_mindfront_eyebrows_05_mpfb_ob_patient_aisha_v1_mat",
  "openclinxr_fitted_eyelash_mindfront_eyelashes_01_mpfb_ob_patient_aisha_v1_mat",
]);
const TEETH_MATS = new Set([
  "mat_openclinxr_hm08_teeth_mpfb_ob_patient_aisha_v1_mesh",
  "mat_openclinxr_hm08_tongue_mpfb_ob_patient_aisha_v1_mesh",
  "mat_openclinxr_fitted_teeth_mpfb_ob_patient_aisha_mesh",
  "mat_openclinxr_fitted_tongue_mpfb_ob_patient_aisha_mesh",
]);

/** Same category table as blender_reference.py mask_category (GLB material name -> mask colour). */
export function parityMaskCategory(materialName: string): ParityMaskCategory | null {
  if (SKIN_MATS.has(materialName)) return "skin";
  if (EYE_RE.test(materialName)) return "eyes";
  if (CLOTHING_MATS.has(materialName)) return "clothing";
  if (HAIR_MATS.has(materialName)) return "hair";
  if (TEETH_MATS.has(materialName)) return "teeth";
  if (materialName.startsWith("openclinxr_hidden_")) return "hidden";
  return null;
}

/**
 * Aisha-parity spec fields (P2). Intersected into IsolatedSubjectSpec so the
 * lab file stays within its size-freeze ceiling; the fields live here.
 */
export type ParitySpecExtension = {
  /**
   * Aisha-parity (P2): exact camera + drawing-buffer size, bypassing all auto
   * framing. When present the lab sizes the buffer to width x height at
   * pixelRatio 1 and uses exactly this camera. Evidence records
   * camera.matrixWorld + projectionMatrix.
   */
  cameraOverride?: CameraOverride;
  /**
   * Aisha-parity calibration mode (P1a calib/spheres): hide the subject and
   * render chrome + grey spheres at the recorded centres. Requires
   * cameraOverride + rigOverride.hdri.
   */
  calib?: { spheres: CalibSpheres };
  /** Aisha-parity mask mode: flat P1a-table ID colours, no AA, no tone mapping. */
  masks?: boolean;
  /** Aisha-parity levers, each OFF by default, each read back in evidence. */
  parity?: ParityLevers;
};

/** Live readback for one parity capture (values read from the scene, never source-read). */
export type ParityReadback = {
  cameraOverride: {
    position: [number, number, number];
    target: [number, number, number];
    vfovDeg: number;
    width: number;
    height: number;
    matrixWorld: number[];
    projectionMatrix: number[];
  } | null;
  bindPose: {
    animationClips: string[];
    mixerCreated: false;
    skinnedMeshes: number;
    bones: number;
    morphInfluencesAllZero: boolean;
  };
  hdri: HdriReadback | null;
  toneMapping: number;
  toneMappingExposure: number;
  outputColorSpace: string;
  pipeline: PipelineReadback;
  shadows: ShadowReadback | null;
  masks: MaskReadback | null;
  calib: CalibReadback | null;
  physical: {
    eyes: PhysicalSwapReadback[] | null;
    cloth: PhysicalSwapReadback[] | null;
    browLash: BrowLashReadback[] | null;
    hairRim: HairRimReadback[] | null;
    eyeShade: EyeShadeReadback | null;
    skin: Array<
      PhysicalSwapReadback & {
        skinShadeHookPresent: boolean;
        sssChainedOntoHook: boolean;
        sssCacheKey: string;
      }
    > | null;
  };
  wallMs: number;
};
