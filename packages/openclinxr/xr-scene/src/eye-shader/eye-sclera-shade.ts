/**
 * Eye sclera shade (card tsk_e0afe706b7a5f071): sclera-only envMap
 * attenuation + lid-margin contact darkening for the lab portrait path.
 *
 * Catch-light carrier, measured: the rendered eye is the GLOBE mesh only
 * (makeclothes_library_eyes_high_poly_globe_* with
 * mat_makeclothes_library_eyes_*). The lab scene carries no cornea Mesh
 * (GLTFLoader builds no Mesh for the 2 cornea nodes; slot list recorded in
 * the eye-realism bisect), so the scoped globe envMap IS the catch-light
 * surface and it lives on the iris-disc texels — not on a separate cornea
 * mesh, and not on the sclera texels.
 *
 * Two levers, both sclera-only (the iris disc keeps full light, so the
 * catch-light is untouched by construction):
 * (a) uniform sclera env attenuation (indirect IBL x 0.35 outside the iris
 *     disc) — closes the M1 flat-lift gap;
 * (b) lid-margin contact darkening: sclera texels within LID_BAND_M below
 *     the live upper-lid margin are darkened toward LID_DARKEN — the upper
 *     shadow gradient (M2b negative).
 *
 * Mechanism note (measured 2026-10-18): the first try was a key shadow map
 * (map 2048 over +-0.3m = 0.29mm texels, head-recentered axis). The
 * shadow-only ablation moved M2b by -0.05 (noise): the conformed lids sit
 * ~0-1mm off the globe AND the upper sclera meets the overhead key at
 * grazing incidence, so no shadow map resolves the occlusion. The contact
 * term replaces it: the margin plane is recomputed from live lid-vertex
 * positions every render (follows the lid under pose/gaze, never baked to
 * globe UV), masked to sclera texels (iris-sparing), with no skin mesh
 * touched. Recorded as shadowMechanism "lid-contact" with this reason.
 *
 * Iris-disc UV numerals: the mesh-derived eye-parallax centres
 * (EYE_IRIS_CENTER_L/R_UV, validated <=0.93px vs Cycles), re-measured
 * 2026-10-18 on iris-centred-c.png dark pupils: L (0.2920, 0.7074),
 * R (0.7074, 0.2963) in flipY=false convention (v=0 at image top) —
 * exactly the eye-parallax numerals. Duplicated here, NOT imported from
 * ./eye-parallax.js, per the rig-variants posture (pinned by text in the
 * eye-realism gate test). NOTE: the h1 iris-disc roughness numerals in
 * isolated-subject-rig-variants.ts use the v-flipped convention and are
 * intentionally NOT touched by this card (out of scope; recorded as a
 * follow-up in the report).
 */

import type {
  MeshStandardMaterial,
  WebGLProgramParametersWithUniforms,
  WebGLRenderer,
} from "three";

/** Sclera indirect-env multiplier; the iris disc keeps 1.0 (catch-light). */
export const EYE_SCLERA_ENV_ATTEN = 0.35;

/**
 * Lid-contact band below the upper-lid margin (metres, globe object
 * space) and full-contact darken fraction. Band 7mm covers the visible
 * upper strip on both subjects (margins sit +1.5..+3.2mm above the pupil,
 * measured live per capture) while sparing the lower strip; darken 0.85
 * drives M2b negative past its noise floor on all four cells while M1
 * keeps moving toward the goal (gate report).
 */
export const EYE_LID_BAND_M = 0.007;
export const EYE_LID_DARKEN = 0.85;

/** Iris disc centres, flipY=false (v=0 at image top) — see module note. */
export const EYE_SCLERA_CENTER_L_UV: readonly [number, number] = [
  299.55 / 1024, 724.0 / 1024,
];
export const EYE_SCLERA_CENTER_R_UV: readonly [number, number] = [
  724.65 / 1024, 302.72 / 1024,
];

/** Iris disc radius + limbus feather in texture UV (eye-parallax numerals). */
export const EYE_SCLERA_RADIUS_UV = 135 / 1024;
/**
 * Feather 8px: anti-alias only. The 30px first try kept the upper lid-side
 * texels bright (the lid-side visible strip sits inside the feather ring in
 * UV) while the lower strip attenuated fully — measured POST M2b +3.1 vs
 * PRE +2.0 on the hook-only ablation. Tight feather = uniform sclera dim.
 */
export const EYE_SCLERA_FEATHER_UV = 8 / 1024;

export type ScleraShadeOptions = {
  /** Sclera indirect-env multiplier (default EYE_SCLERA_ENV_ATTEN). */
  attenuation?: number | undefined;
  /**
   * Upper-lid margin plane per eye chart (globe object-space Y, metres):
   * [L, R] selected by chart (vMapUv.x < 0.5 -> L). Fragments below the
   * margin within bandM darken toward `darken`.
   */
  lidMarginY?: readonly [number, number];
  /** Contact band below the margin (default EYE_LID_BAND_M). */
  bandM?: number | undefined;
  /** Full-contact darken fraction (default EYE_LID_DARKEN). */
  darken?: number | undefined;
};

export type ResolvedScleraShadeOptions = {
  attenuation: number;
  lidMarginY: readonly [number, number];
  bandM: number;
  darken: number;
};

/**
 * Fail-closed option resolution: attenuation must be a finite number in
 * [0, 1]; margins/band/darken finite, band positive, darken in [0, 1].
 */
export function resolveScleraShadeOptions(
  options: ScleraShadeOptions = {},
): ResolvedScleraShadeOptions {
  const attenuation = options.attenuation ?? EYE_SCLERA_ENV_ATTEN;
  if (typeof attenuation !== "number" || !Number.isFinite(attenuation)) {
    throw new Error(
      `scleraShade.attenuation must be a finite number, got ${JSON.stringify(attenuation)}`,
    );
  }
  if (attenuation < 0 || attenuation > 1) {
    throw new Error(
      `scleraShade.attenuation must be in [0, 1], got ${JSON.stringify(attenuation)}`,
    );
  }
  const lidMarginY = options.lidMarginY ?? [0, 0];
  if (
    !Array.isArray(lidMarginY) ||
    lidMarginY.length !== 2 ||
    lidMarginY.some((v) => typeof v !== "number" || !Number.isFinite(v))
  ) {
    throw new Error(
      `scleraShade.lidMarginY must be a pair of finite numbers, got ${JSON.stringify(lidMarginY)}`,
    );
  }
  const bandM = options.bandM ?? EYE_LID_BAND_M;
  if (typeof bandM !== "number" || !Number.isFinite(bandM) || bandM <= 0) {
    throw new Error(
      `scleraShade.bandM must be a finite number > 0, got ${JSON.stringify(bandM)}`,
    );
  }
  const darken = options.darken ?? EYE_LID_DARKEN;
  if (typeof darken !== "number" || !Number.isFinite(darken) || darken < 0 || darken > 1) {
    throw new Error(
      `scleraShade.darken must be in [0, 1], got ${JSON.stringify(darken)}`,
    );
  }
  return { attenuation, lidMarginY, bandM, darken };
}

const scleraInstalled = new WeakSet<object>();

/** True when applyScleraShade has hooked this material. */
export function scleraShadeInstalled(material: object): boolean {
  return scleraInstalled.has(material);
}

/**
 * Shared fragment prelude: iris mask (1 on the disc) + lid-contact factor
 * (0 far below the margin, `darken` at the margin), both sclera-masked so
 * the iris keeps full light. `vMapUv` selects the chart (x < 0.5 -> L);
 * `vEyeObjY` is the globe object-space height.
 */
export function scleraShadePreludeGlsl(): string {
  return /* glsl */ `
  float scleraDIrisL = distance( vMapUv, uScleraCenterL );
  float scleraDIrisR = distance( vMapUv, uScleraCenterR );
  float scleraDIris = min( scleraDIrisL, scleraDIrisR );
  float scleraIrisM = 1.0 - smoothstep( uScleraRadiusU, uScleraRadiusU + uScleraFeatherU, scleraDIris );
  float scleraMarginY = vMapUv.x < 0.5 ? uLidMarginYL : uLidMarginYR;
  float scleraBelowMargin = scleraMarginY - vEyeObjY;
  float scleraContact = ( 1.0 - smoothstep( 0.0, uLidBandM, scleraBelowMargin ) ) * step( 0.0, scleraBelowMargin ) * ( 1.0 - scleraIrisM );
  `;
}

/**
 * GLSL injected AFTER `#include <lights_fragment_maps>`: iris texels keep
 * full env, sclera texels are multiplied down (uniform atten), and the
 * lid-side sclera band darkens toward `darken` (contact).
 *
 * Injection point, measured in three r184 sources (not guessed): the
 * product path assigns a PMREM texture to material.envMap
 * (ENVMAP_TYPE_CUBE_UV), whose contribution enters through
 * `lights_fragment_maps` (`getIBLIrradiance` -> `iblIrradiance`,
 * `getIBLRadiance` -> `radiance`) — the `envmap_fragment` chunk is a
 * no-op for PMREM (cube path only), so hooking there compiles but changes
 * nothing (measured 2026-10-18: POST==PRE to +-2 levels). `iblIrradiance`
 * feeds diffuse IBL and `radiance` feeds specular IBL for the
 * Standard/Physical RE; ambient/hemisphere live in the separate
 * `irradiance` accumulator and are untouched.
 */
export function scleraShadeGlsl(): string {
  return /* glsl */ `
  #if defined( USE_MAP ) && defined( USE_ENVMAP )
  {
    ${scleraShadePreludeGlsl()}
    float scleraEnvK = mix( uScleraEnvAtten, 1.0, scleraIrisM );
    float scleraContactK = 1.0 - uLidDarken * scleraContact;
    iblIrradiance *= scleraEnvK * scleraContactK;
    radiance *= scleraEnvK * scleraContactK;
  }
  #endif
  `;
}

/**
 * GLSL injected AFTER `#include <lights_fragment_end>`: the lid-contact
 * band also scales the DIRECT key/fill light on sclera texels (the upper
 * shadow must bite into the direct light, not just the env, to move M2b).
 * Guarded by USE_MAP like the maps-stage edit.
 */
export function scleraShadeDirectGlsl(): string {
  return /* glsl */ `
  #ifdef USE_MAP
  {
    ${scleraShadePreludeGlsl()}
    float scleraDirectK = 1.0 - uLidDarken * scleraContact;
    reflectedLight.directDiffuse *= scleraDirectK;
    reflectedLight.directSpecular *= scleraDirectK;
  }
  #endif
  `;
}

/** Vertex-stage GLSL: globe object-space height for the margin term. */
export function scleraShadeVertexGlsl(): string {
  return /* glsl */ `
  vEyeObjY = position.y;
  `;
}

/**
 * Hook a globe material. Chains with any existing onBeforeCompile. Refuses
 * when the material carries no color map (vMapUv would be undefined and the
 * hook would silently do nothing). No new mesh, no texture edit, no
 * iris-texture change; skin materials untouched (only globe-matched
 * materials are passed in by the caller).
 */
export function applyScleraShade(
  material: MeshStandardMaterial,
  options: ScleraShadeOptions = {},
): MeshStandardMaterial {
  const resolved = resolveScleraShadeOptions(options);
  const { attenuation, lidMarginY, bandM, darken } = resolved;
  if (material.map == null) {
    throw new Error(
      `scleraShade needs a color map on ${material.name} (the iris mask reads vMapUv) — refusing rather than installing a silent no-op`,
    );
  }
  const prev = material.onBeforeCompile?.bind(material);
  material.onBeforeCompile = (
    shader: WebGLProgramParametersWithUniforms,
    renderer: WebGLRenderer,
  ) => {
    prev?.(shader, renderer);
    shader.uniforms["uScleraCenterL"] = {
      value: [EYE_SCLERA_CENTER_L_UV[0], EYE_SCLERA_CENTER_L_UV[1]],
    };
    shader.uniforms["uScleraCenterR"] = {
      value: [EYE_SCLERA_CENTER_R_UV[0], EYE_SCLERA_CENTER_R_UV[1]],
    };
    shader.uniforms["uScleraRadiusU"] = { value: EYE_SCLERA_RADIUS_UV };
    shader.uniforms["uScleraFeatherU"] = { value: EYE_SCLERA_FEATHER_UV };
    shader.uniforms["uScleraEnvAtten"] = { value: attenuation };
    shader.uniforms["uLidMarginYL"] = { value: lidMarginY[0] };
    shader.uniforms["uLidMarginYR"] = { value: lidMarginY[1] };
    shader.uniforms["uLidBandM"] = { value: bandM };
    shader.uniforms["uLidDarken"] = { value: darken };
    shader.vertexShader = shader.vertexShader
      .replace(
        "#include <common>",
        "#include <common>\nvarying float vEyeObjY;",
      )
      .replace(
        "#include <begin_vertex>",
        `#include <begin_vertex>\n${scleraShadeVertexGlsl()}`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        "#include <common>",
        "#include <common>\nvarying float vEyeObjY;\nuniform vec2 uScleraCenterL;\nuniform vec2 uScleraCenterR;\nuniform float uScleraRadiusU;\nuniform float uScleraFeatherU;\nuniform float uScleraEnvAtten;\nuniform float uLidMarginYL;\nuniform float uLidMarginYR;\nuniform float uLidBandM;\nuniform float uLidDarken;",
      )
      .replace(
        "#include <lights_fragment_maps>",
        `#include <lights_fragment_maps>\n${scleraShadeGlsl()}`,
      )
      .replace(
        "#include <lights_fragment_end>",
        `#include <lights_fragment_end>\n${scleraShadeDirectGlsl()}`,
      );
  };
  material.customProgramCacheKey = () =>
    `openclinxr-eye-sclera-shade:a${attenuation}:d${darken}:b${bandM}:m${lidMarginY[0]},${lidMarginY[1]}`;
  material.needsUpdate = true;
  scleraInstalled.add(material);
  return material;
}
