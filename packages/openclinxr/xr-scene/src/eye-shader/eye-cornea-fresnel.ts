/**
 * Eye cornea fresnel (eye-finish): Schlick-weighted env lift on the globe's
 * iris disc in the product-rig path.
 *
 * Problem (verified): the baked cornea film (openclinxr_eye_cornea_mat,
 * alpha 0.08 flat) never renders in the portrait product path — the two
 * cornea nodes (148/149) are scene orphans, so GLTFLoader builds no Mesh for
 * them — and strengthening the film to compensate renders a grey dome
 * (EEVEE transmissive-shell trial: a transmissive shell resolves as a
 * protruding ball). The optically correct look is: invisible head-on, with
 * the compact catch-light dot preserved, reflective only at grazing angles.
 *
 * This module adds the missing angular term WITHOUT geometry and WITHOUT a
 * transmission pass (Quest cost rejected): the globe's iris-disc texels are
 * the optical cornea surface in this path (the PMREM catch-light lives
 * there, not on a separate mesh), so a fresnel weight multiplies the scoped
 * globe PMREM env response there. Head-on the weight is EXACTLY zero
 * (Schlick minus F0 at cosθ=1), so head-on pixels keep today's response
 * bit-for-bit; at grazing/yaw the env ramps smoothly. The scoped globe
 * PMREM env stays the dot source — nothing about the dot changes head-on.
 *
 * F0 cites Gullstrand exact schematic eye cornea IOR 1.376 (same optic as
 * eye-parallax.ts EYE_CORNEA_IOR). Duplicated here, NOT imported from
 * ./eye-parallax.js: that module is entrypoint-unreachable, and importing it
 * from this (reachable, via eye-lid-contact.js) module would promote it and
 * push the xr-scene testInternalImports ceiling 10 -> 11. Same posture as
 * eye-sclera-shade.ts (which duplicates the iris numerals). The cornea-env
 * gate test pins the IOR literal + formula by source text, not by import.
 *
 * Iris-disc mask numerals follow the rig-v0-at-top convention (the same
 * texels eye-sclera-shade.ts masks): imported from ./eye-sclera-shade.js,
 * which is already entrypoint-reachable, so no ceiling moves.
 */

import type {
  MeshStandardMaterial,
  WebGLProgramParametersWithUniforms,
  WebGLRenderer,
} from "three";
import {
  EYE_SCLERA_CENTER_L_UV,
  EYE_SCLERA_CENTER_R_UV,
  EYE_SCLERA_FEATHER_UV,
  EYE_SCLERA_RADIUS_UV,
} from "./eye-sclera-shade.js";

/** Gullstrand exact schematic eye cornea IOR (AAO/PMC3972707; eye-parallax cites the same). */
export const EYE_CORNEA_FRESNEL_IOR = 1.376;

/** Normal-incidence reflectance F0 = ((n-1)/(n+1))^2 ≈ 0.02504. Passed as a uniform; the gate pins the formula. */
export const EYE_CORNEA_FRESNEL_F0 =
  ((EYE_CORNEA_FRESNEL_IOR - 1) / (EYE_CORNEA_FRESNEL_IOR + 1)) **
  2;

/**
 * Landed shaping exponent (yaw-sweep sourced, recorded in
 * cornea-env/catchlight-fresnel-report.json): k=1, linear in (1-cosθ).
 * Physical Schlick fixes k=5, which is ~0 below 30° and cannot produce the
 * gated ±25° lift; k=1 is the smallest smooth shape that clears the noise
 * floor there while staying exactly zero head-on.
 */
export const EYE_CORNEA_FRESNEL_EXPONENT = 1;

/**
 * Landed gain (yaw-sweep sourced, recorded in the fresnel report): the
 * smallest gain whose ±25° disc lift clears 5x the determinism noise while
 * the 230+ dot core keeps extent ratio <= 1.5.
 */
export const EYE_CORNEA_FRESNEL_GAIN = 2;

export type CorneaFresnelOptions = {
  /** Env-lift gain (default EYE_CORNEA_FRESNEL_GAIN). Must be finite and >= 0. */
  gain?: number | undefined;
  /** Schlick shaping exponent (default EYE_CORNEA_FRESNEL_EXPONENT). Must be finite and > 0. */
  exponent?: number | undefined;
  /**
   * Counterweight ablation: force the fresnel weight to its head-on value
   * (F0) at every angle — a genuinely CONSTANT term, no angular dependence.
   * Head-on response is unchanged (still +0), the yaw lift must vanish.
   */
  flat?: boolean | undefined;
};

export type ResolvedCorneaFresnelOptions = {
  gain: number;
  exponent: number;
  flat: boolean;
};

/**
 * Fail-closed option resolution: garbage refuses before any hook installs.
 * Exponent 0 would make pow(0,0) (undefined in GLSL) at head-on, so the
 * floor is strictly positive.
 */
export function resolveCorneaFresnelOptions(
  options: CorneaFresnelOptions = {},
): ResolvedCorneaFresnelOptions {
  const gain = options.gain ?? EYE_CORNEA_FRESNEL_GAIN;
  if (typeof gain !== "number" || !Number.isFinite(gain) || gain < 0) {
    throw new Error(
      `corneaFresnel.gain must be a finite number >= 0, got ${JSON.stringify(gain)}`,
    );
  }
  const exponent = options.exponent ?? EYE_CORNEA_FRESNEL_EXPONENT;
  if (typeof exponent !== "number" || !Number.isFinite(exponent) || exponent <= 0) {
    throw new Error(
      `corneaFresnel.exponent must be a finite number > 0, got ${JSON.stringify(exponent)}`,
    );
  }
  const flat = options.flat ?? false;
  if (typeof flat !== "boolean") {
    throw new Error(
      `corneaFresnel.flat must be a boolean, got ${JSON.stringify(flat)}`,
    );
  }
  return { gain, exponent, flat };
}

const corneaInstalled = new WeakSet<object>();

/** True when applyCorneaFresnel has hooked this material. */
export function corneaFresnelInstalled(material: object): boolean {
  return corneaInstalled.has(material);
}

/**
 * GLSL injected AFTER `#include <lights_fragment_maps>`: the scoped PMREM
 * env has already accumulated into `radiance` (same injection point the
 * sclera hook attenuates at). The iris disc keeps a fresnel-weighted share:
 * head-on the weight is exactly 0 (factor 1.0, bit-identical pixels);
 * off-axis the env ramps by gain * (F - F0).
 *
 * Available varyings at this point (three r184 meshphysical main order):
 * geometryNormal + geometryViewDir (lights_fragment_begin), vMapUv
 * (USE_MAP, the globe always carries the iris map). The sclera hook targets
 * the same point, and both keep the `#include` line so chained hooks compose.
 */
export function corneaFresnelGlsl(): string {
  return /* glsl */ `
  #if defined( USE_MAP ) && defined( USE_ENVMAP )
  {
    float corneaDIris = min( distance( vMapUv, uCorneaCenterL ), distance( vMapUv, uCorneaCenterR ) );
    float corneaIrisM = 1.0 - smoothstep( uCorneaRadiusU, uCorneaRadiusU + uCorneaFeatherU, corneaDIris );
    float corneaCosT = clamp( dot( normalize( geometryNormal ), normalize( geometryViewDir ) ), 0.0, 1.0 );
    float corneaF = uCorneaF0 + ( 1.0 - uCorneaF0 ) * pow( 1.0 - corneaCosT, uCorneaExp );
    float corneaW = ( uCorneaFlat > 0.5 ) ? 0.0 : max( corneaF - uCorneaF0, 0.0 );
    radiance *= 1.0 + uCorneaGain * corneaIrisM * corneaW;
  }
  #endif
  `;
}

/**
 * Hook a globe material. Chains with any existing onBeforeCompile (the
 * product path co-installs the sclera hook on the same material) and
 * COMPOSES with any existing customProgramCacheKey (last-writer-wins would
 * otherwise alias the sclera-only and sclera+fresnel programs). Refuses when
 * the material carries no color map (vMapUv would be undefined and the hook
 * would silently do nothing).
 */
export function applyCorneaFresnel(
  material: MeshStandardMaterial,
  options: CorneaFresnelOptions = {},
): MeshStandardMaterial {
  const resolved = resolveCorneaFresnelOptions(options);
  const { gain, exponent, flat } = resolved;
  if (material.map == null) {
    throw new Error(
      `corneaFresnel needs a color map on ${material.name} (the iris mask reads vMapUv) — refusing rather than installing a silent no-op`,
    );
  }
  const prev = material.onBeforeCompile?.bind(material);
  material.onBeforeCompile = (
    shader: WebGLProgramParametersWithUniforms,
    renderer: WebGLRenderer,
  ) => {
    prev?.(shader, renderer);
    shader.uniforms["uCorneaCenterL"] = {
      value: [EYE_SCLERA_CENTER_L_UV[0], EYE_SCLERA_CENTER_L_UV[1]],
    };
    shader.uniforms["uCorneaCenterR"] = {
      value: [EYE_SCLERA_CENTER_R_UV[0], EYE_SCLERA_CENTER_R_UV[1]],
    };
    shader.uniforms["uCorneaRadiusU"] = { value: EYE_SCLERA_RADIUS_UV };
    shader.uniforms["uCorneaFeatherU"] = { value: EYE_SCLERA_FEATHER_UV };
    shader.uniforms["uCorneaF0"] = { value: EYE_CORNEA_FRESNEL_F0 };
    shader.uniforms["uCorneaExp"] = { value: exponent };
    shader.uniforms["uCorneaGain"] = { value: gain };
    shader.uniforms["uCorneaFlat"] = { value: flat ? 1 : 0 };
    shader.fragmentShader = shader.fragmentShader
      .replace(
        "#include <common>",
        "#include <common>\nuniform vec2 uCorneaCenterL;\nuniform vec2 uCorneaCenterR;\nuniform float uCorneaRadiusU;\nuniform float uCorneaFeatherU;\nuniform float uCorneaF0;\nuniform float uCorneaExp;\nuniform float uCorneaGain;\nuniform float uCorneaFlat;",
      )
      .replace(
        "#include <lights_fragment_maps>",
        `#include <lights_fragment_maps>\n${corneaFresnelGlsl()}`,
      );
  };
  const prevKey = material.customProgramCacheKey?.bind(material);
  material.customProgramCacheKey = () =>
    `${prevKey?.() ?? ""}|openclinxr-eye-cornea-fresnel:v1`;
  material.needsUpdate = true;
  corneaInstalled.add(material);
  return material;
}
