/**
 * Portrait skin-shade flag (tsk_2f1eca863f8134f6, h1 rework).
 *
 * No onBeforeCompile skin shader existed in the tree (grep: onBeforeCompile
 * over packages/openclinxr/xr-scene/src = eye-shader only) — this module is
 * the first. It installs, behind a material flag consumed by
 * `applyMaterialOverrides` (isolated-subject-material-variants.ts), a
 * fragment-only skin treatment on the portrait skin material:
 *
 *   (a) pre-integrated-style diffuse approximation: curvature-indexed wrap /
 *       scatter lift. Curvature comes from the BAKED CURVATURE MAP that the
 *       skin-maps slice landed (aisha-curvature-1024.png, store skin-maps,
 *       maps-manifest.json): Blender Geometry Pointiness remapped
 *       0.35 -> 0 (concave) .. 0.65 -> 1 (convex), so 0.5 is flat
 *       (measured map median 131/255 = 0.51). h0 used screen-space
 *       derivatives (fwidth of the view normal); the orchestrator rejected
 *       that on sight (D1 FACETING: fwidth is piecewise constant per
 *       triangle, so the curvature index and the scatter jumped at every
 *       mesh edge). No derivative remains in the shader (grep fwidth =
 *       no hits outside this comment).
 *   (b) blurred normal: the lighting normal is mixed toward the smooth
 *       interpolated vertex normal (vSkinSmoothN = transformedNormal — a
 *       smoothed source, never a derivative). DEVIATION RECORDED: three.js
 *       MeshStandardMaterial feeds ONE normal to both diffuse and specular,
 *       so the blur softens both terms; the graded effect is the diffuse
 *       softening in the cheek crop (F2), the specular softening is the
 *       accepted side effect.
 *   (c) roughness T-zone: 0.62 - Tc*T clipped [0.3,0.8], the exact formula
 *       of the face-replay bake (tools/openclinxr/asset-pipeline/skin/
 *       face-replay/build_roughness.py: "0.62 - Tc*T + 0.08*C + 0.05*H
 *       clipped [0.3, 0.8]"). DEVIATION RECORDED: the +0.08*C (cavity/AO)
 *       and +0.05*H (albedo high-frequency) terms are omitted — neither the
 *       AO nor a frequency field is sampled in the portrait path — and the
 *       clip applies to the blended result. T is an analytic UV mask whose
 *       centres/radii mirror the bake: disks at nose-tip / chin / forehead
 *       (forehead = brow-end-inner mid pushed past the brows by
 *       FOREHEAD_PUSH 0.5), radii R_NOSE 0.035 / R_CHIN 0.030 / R_FOREHEAD
 *       0.055 of map size, same-file softening spirit (dilate-5/blur-12).
 *       Landmark UVs are Aisha-derived (realism-95 derive/A/landmarks-uv.json,
 *       size 4096, row v*S; MakeHuman UV is shared as-is per the skin-maps
 *       manifest, so the UVs transfer to the shipped Aisha GLB).
 *   (d) lips: roughness mixed toward 0.45 by the lip disk (same file:
 *       "lips 0.45"), so the mouth is not uniformly glossy.
 *   (e) nostrils: small emissive-side scatter lift from the cavity field
 *       plus the nostril disks (lift, not paint — albedo-modulated, no
 *       colour shift).
 *
 * The curvature map arrives through the portrait path's existing texture
 * loading (TextureLoader in applyMaterialOverrides, served to the page by
 * the capture tool's /__spike/ route like every other override texture):
 * MaterialOverride.skinShadeCurvatureUrl. A skinShade flag WITHOUT that URL
 * REFUSES (fail closed at the spec level); the hook itself tolerates a null
 * texture only so the node unit test (no image decoder) can prove
 * installation through the flag path with a DataTexture stand-in.
 * No scene.environment touch, no transmission term.
 * Flag OFF installs nothing: onBeforeCompile/customProgramCacheKey untouched.
 */

import type {
  MeshPhysicalMaterial,
  MeshStandardMaterial,
  Texture,
  WebGLProgramParametersWithUniforms,
  WebGLRenderer,
} from "three";

/** Default T-zone coefficient: build_roughness.py --tcoef default 0.08. */
export const SKIN_TCOEF_DEFAULT = 0.08;
/** Lip roughness: build_roughness.py docstring "lips 0.45". */
export const SKIN_LIP_ROUGHNESS = 0.45;
/** Bake formula anchor and clip: build_roughness.py. */
export const SKIN_ROUGH_BASE = 0.62;
export const SKIN_ROUGH_MIN = 0.3;
export const SKIN_ROUGH_MAX = 0.8;

/** Aisha landmark UVs (derive/A/landmarks-uv.json, size 4096, row v*S). */
export const SKIN_NOSE_UV: readonly [number, number] = [0.86579, 0.51683];
export const SKIN_NOSTRIL_L_UV: readonly [number, number] = [0.87877, 0.49666];
export const SKIN_NOSTRIL_R_UV: readonly [number, number] = [0.87877, 0.53701];
export const SKIN_CHIN_UV: readonly [number, number] = [0.95968, 0.51683];
export const SKIN_BROW_INNER_L_UV: readonly [number, number] = [0.82466, 0.50067];
export const SKIN_BROW_INNER_R_UV: readonly [number, number] = [0.82745, 0.53292];
export const SKIN_LIP_CORNER_L_UV: readonly [number, number] = [0.91006, 0.50143];
export const SKIN_LIP_CORNER_R_UV: readonly [number, number] = [0.90978, 0.53211];
/**
 * lip-mid-upper (0.92046, 0.9082) is EXCLUDED: its v jumps 0.39 off the
 * corner/lower-mid line (v~0.517), a seam-side outlier. Lip centre is the
 * corner midpoint, consistent with lip-mid-lower (0.90664, 0.51684).
 */
export const SKIN_LIP_UV: readonly [number, number] = [
  (0.91006 + 0.90978) / 2,
  (0.50143 + 0.53211) / 2,
];

/** Disk radii as fractions of map size S: build_roughness.py R_NOSE/R_CHIN/R_FOREHEAD. */
export const SKIN_R_NOSE = 0.035;
export const SKIN_R_CHIN = 0.03;
export const SKIN_R_FOREHEAD = 0.055;
/** Forehead push past the brows: build_roughness.py FOREHEAD_PUSH 0.5. */
export const SKIN_FOREHEAD_PUSH = 0.5;
/** Lip/nostril disk radii (recorded implementation constants, sweep-graded). */
export const SKIN_R_LIP = 0.02;
export const SKIN_R_NOSTRIL = 0.012;
/** Mask feather in UV: blur-12 at 4096 ~= 0.0029 (build_roughness.py). */
export const SKIN_FEATHER_UV = 0.004;

/** Curvature map channel: the bake is grayscale EMIT (R=G=B). */
export const SKIN_CURVATURE_CHANNEL = "r";
/** Flat-skin curvature: bake ramp maps pointiness 0.5 -> 0.5 (median 0.51 measured). */
export const SKIN_CURVATURE_FLAT = 0.5;

/** Forehead centre, mirroring build_roughness.py (brow-end-inner mid pushed past brows). */
export function skinForeheadUv(): readonly [number, number] {
  const midU = (SKIN_BROW_INNER_L_UV[0] + SKIN_BROW_INNER_R_UV[0]) / 2;
  const midV = (SKIN_BROW_INNER_L_UV[1] + SKIN_BROW_INNER_R_UV[1]) / 2;
  return [
    midU + (midU - SKIN_NOSE_UV[0]) * SKIN_FOREHEAD_PUSH,
    midV + (midV - SKIN_NOSE_UV[1]) * SKIN_FOREHEAD_PUSH,
  ];
}

export type SkinShadeOptions = {
  /** Multiplier on SKIN_TCOEF_DEFAULT (1 = bake-faithful 0.08). Must be finite and >= 0. */
  tZoneStrength?: number;
  /** Normal mix toward the smooth vertex normal (default 0.4, recorded constant). */
  blurMix?: number;
  /** Scatter gains (recorded constants, sweep-graded). */
  scatterConvex?: number;
  scatterCavity?: number;
  scatterNostril?: number;
  scatterLip?: number;
  /** Baked curvature texture (production always binds it; null only for the node unit test). */
  curvatureMap?: Texture | null;
};

export const SKIN_SHADE_DEFAULTS = {
  tZoneStrength: 1,
  blurMix: 0.4,
  scatterConvex: 0.06,
  scatterCavity: 0.1,
  scatterNostril: 0.04,
  scatterLip: 0.02,
};

export type ResolvedSkinShadeOptions = {
  tZoneStrength: number;
  blurMix: number;
  scatterConvex: number;
  scatterCavity: number;
  scatterNostril: number;
  scatterLip: number;
  curvatureMap: Texture | null;
};

/** Fail-closed option resolution: non-finite or negative strengths refuse. */
export function resolveSkinShadeOptions(options: SkinShadeOptions = {}): ResolvedSkinShadeOptions {
  const num = (v: unknown, name: string, fallback: number): number => {
    if (v === undefined) return fallback;
    if (typeof v !== "number" || !Number.isFinite(v) || v < 0) {
      throw new Error(`skinShade.${name} must be a finite number >= 0, got ${JSON.stringify(v)}`);
    }
    return v;
  };
  return {
    tZoneStrength: num(options.tZoneStrength, "tZoneStrength", SKIN_SHADE_DEFAULTS.tZoneStrength),
    blurMix: num(options.blurMix, "blurMix", SKIN_SHADE_DEFAULTS.blurMix),
    scatterConvex: num(options.scatterConvex, "scatterConvex", SKIN_SHADE_DEFAULTS.scatterConvex),
    scatterCavity: num(options.scatterCavity, "scatterCavity", SKIN_SHADE_DEFAULTS.scatterCavity),
    scatterNostril: num(options.scatterNostril, "scatterNostril", SKIN_SHADE_DEFAULTS.scatterNostril),
    scatterLip: num(options.scatterLip, "scatterLip", SKIN_SHADE_DEFAULTS.scatterLip),
    curvatureMap: options.curvatureMap ?? null,
  };
}

/** Effective T-zone coefficient: bake default scaled by the sweep strength. */
export function skinEffectiveTCoef(resolved: ResolvedSkinShadeOptions): number {
  return SKIN_TCOEF_DEFAULT * resolved.tZoneStrength;
}

/** Fragment helpers + mask functions (injected after `#include <common>`). */
export function skinShadeParsGlsl(): string {
  return /* glsl */ `
varying vec3 vSkinSmoothN;
uniform float uSkinTCoef;
uniform float uSkinBlurMix;
uniform float uSkinScatterCvx;
uniform float uSkinScatterCav;
uniform float uSkinScatterNos;
uniform float uSkinScatterLip;
uniform sampler2D uSkinCurvMap;
uniform vec2 uSkinNoseUv;
uniform vec2 uSkinChinUv;
uniform vec2 uSkinForeheadUv;
uniform vec2 uSkinLipUv;
uniform vec2 uSkinNosLUv;
uniform vec2 uSkinNosRUv;
float skinShadeDisk(vec2 uv, vec2 centre, float radius) {
  float d = distance(uv, centre);
  return 1.0 - smoothstep(radius - ${SKIN_FEATHER_UV}, radius + ${SKIN_FEATHER_UV}, d);
}
float skinShadeTZone(vec2 uv) {
  return max(max(
    skinShadeDisk(uv, uSkinNoseUv, ${SKIN_R_NOSE}),
    skinShadeDisk(uv, uSkinChinUv, ${SKIN_R_CHIN})),
    skinShadeDisk(uv, uSkinForeheadUv, ${SKIN_R_FOREHEAD}));
}
`;
}

/** Zone/curvature locals (injected after `#include <map_fragment>`, inside main). */
export function skinShadeSampleGlsl(): string {
  return /* glsl */ `
vec2 skinUv = vec2(-1.0, -1.0);
#ifdef USE_MAP
skinUv = vMapUv;
#endif
float skinTz = skinShadeTZone(skinUv);
float skinLip = skinShadeDisk(skinUv, uSkinLipUv, ${SKIN_R_LIP});
float skinNos = max(
  skinShadeDisk(skinUv, uSkinNosLUv, ${SKIN_R_NOSTRIL}),
  skinShadeDisk(skinUv, uSkinNosRUv, ${SKIN_R_NOSTRIL}));
float skinCurv = texture2D(uSkinCurvMap, skinUv).${SKIN_CURVATURE_CHANNEL};
float skinConvex = clamp((skinCurv - ${SKIN_CURVATURE_FLAT}) * 2.0, 0.0, 1.0);
float skinCav = clamp((${SKIN_CURVATURE_FLAT} - skinCurv) * 2.0, 0.0, 1.0);
`;
}

/** T-zone + lip roughness (injected after `#include <roughnessmap_fragment>`). */
export function skinShadeRoughnessGlsl(): string {
  return /* glsl */ `
{
  float skinZoneW = clamp(skinTz + skinLip, 0.0, 1.0);
  if (skinZoneW > 0.0) {
    float skinTarget = ${SKIN_ROUGH_BASE} - uSkinTCoef * skinTz;
    skinTarget = mix(skinTarget, ${SKIN_LIP_ROUGHNESS}, clamp(skinLip / max(skinZoneW, 1e-4), 0.0, 1.0));
    roughnessFactor = clamp(mix(roughnessFactor, skinTarget, skinZoneW), ${SKIN_ROUGH_MIN}, ${SKIN_ROUGH_MAX});
  }
}
`;
}

/** Blurred lighting normal (injected after `#include <normal_fragment_maps>`). */
export function skinShadeNormalGlsl(): string {
  return /* glsl */ `
normal = normalize(mix(normal, normalize(vSkinSmoothN), uSkinBlurMix));
`;
}

/** Curvature-indexed scatter + nostril/lip lift (after `#include <emissivemap_fragment>`). */
export function skinShadeScatterGlsl(): string {
  return /* glsl */ `
totalEmissiveRadiance += diffuseColor.rgb * (skinConvex * uSkinScatterCvx + skinCav * uSkinScatterCav + skinNos * uSkinScatterNos + skinLip * uSkinScatterLip);
`;
}

/** Vertex varying (injected after `#include <fog_vertex>`; transformedNormal is defined above it). */
export function skinShadeVertexGlsl(): string {
  return /* glsl */ `
vSkinSmoothN = normalize(transformedNormal);
`;
}

const installed = new WeakSet<object>();
const curvatureOf = new WeakMap<object, Texture | null>();

/** True when applySkinShade has hooked this material (drives the readback, not JSON). */
export function skinShadeInstalled(material: object): boolean {
  return installed.has(material);
}

/** Curvature texture bound by applySkinShade (null = unit-test stand-in path). */
export function skinShadeCurvature(material: object): Texture | null {
  return curvatureOf.get(material) ?? null;
}

export function skinShadeCacheKey(resolved: ResolvedSkinShadeOptions): string {
  return (
    `openclinxr-skin-shade:t${resolved.tZoneStrength}:b${resolved.blurMix}` +
    `:c${resolved.scatterConvex},${resolved.scatterCavity},${resolved.scatterNostril},${resolved.scatterLip}`
  );
}

/**
 * Hook a portrait skin material. Chains with any existing onBeforeCompile.
 * Never touches transmission, environment, or emissive colour — only adds a
 * small albedo-modulated scatter lift. Flag OFF path never calls this, so the
 * default program is byte-identical to origin/main (CW1).
 */
export function applySkinShade(
  material: MeshStandardMaterial | MeshPhysicalMaterial,
  options: SkinShadeOptions = {},
): MeshStandardMaterial | MeshPhysicalMaterial {
  const resolved = resolveSkinShadeOptions(options);
  const tcoef = skinEffectiveTCoef(resolved);
  const forehead = skinForeheadUv();
  const prev = material.onBeforeCompile?.bind(material);
  material.onBeforeCompile = (
    shader: WebGLProgramParametersWithUniforms,
    renderer: WebGLRenderer,
  ) => {
    prev?.(shader, renderer);
    shader.uniforms["uSkinTCoef"] = { value: tcoef };
    shader.uniforms["uSkinBlurMix"] = { value: resolved.blurMix };
    shader.uniforms["uSkinScatterCvx"] = { value: resolved.scatterConvex };
    shader.uniforms["uSkinScatterCav"] = { value: resolved.scatterCavity };
    shader.uniforms["uSkinScatterNos"] = { value: resolved.scatterNostril };
    shader.uniforms["uSkinScatterLip"] = { value: resolved.scatterLip };
    shader.uniforms["uSkinCurvMap"] = { value: resolved.curvatureMap };
    shader.uniforms["uSkinNoseUv"] = { value: [SKIN_NOSE_UV[0], SKIN_NOSE_UV[1]] };
    shader.uniforms["uSkinChinUv"] = { value: [SKIN_CHIN_UV[0], SKIN_CHIN_UV[1]] };
    shader.uniforms["uSkinForeheadUv"] = { value: [forehead[0], forehead[1]] };
    shader.uniforms["uSkinLipUv"] = { value: [SKIN_LIP_UV[0], SKIN_LIP_UV[1]] };
    shader.uniforms["uSkinNosLUv"] = { value: [SKIN_NOSTRIL_L_UV[0], SKIN_NOSTRIL_L_UV[1]] };
    shader.uniforms["uSkinNosRUv"] = { value: [SKIN_NOSTRIL_R_UV[0], SKIN_NOSTRIL_R_UV[1]] };
    shader.vertexShader = shader.vertexShader
      .replace(
        "#include <common>",
        "#include <common>\nvarying vec3 vSkinSmoothN;",
      )
      .replace("#include <fog_vertex>", `#include <fog_vertex>\n${skinShadeVertexGlsl()}`);
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", `#include <common>\n${skinShadeParsGlsl()}`)
      .replace("#include <map_fragment>", `#include <map_fragment>\n${skinShadeSampleGlsl()}`)
      .replace(
        "#include <roughnessmap_fragment>",
        `#include <roughnessmap_fragment>\n${skinShadeRoughnessGlsl()}`,
      )
      .replace(
        "#include <normal_fragment_maps>",
        `#include <normal_fragment_maps>\n${skinShadeNormalGlsl()}`,
      )
      .replace(
        "#include <emissivemap_fragment>",
        `#include <emissivemap_fragment>\n${skinShadeScatterGlsl()}`,
      );
  };
  material.customProgramCacheKey = () => skinShadeCacheKey(resolved);
  material.needsUpdate = true;
  installed.add(material);
  curvatureOf.set(material, resolved.curvatureMap);
  return material;
}
