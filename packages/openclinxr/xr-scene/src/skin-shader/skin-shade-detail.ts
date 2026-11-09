/**
 * Detail-normal carrier for the portrait skin-shade flag (face tile from
 * st-vitpore, body tile from st-vitbody).
 *
 * Split from skin-shade.ts (file-size zone budget 500): this module owns
 * the detail-normal options, the body GLSL snippets, the body cache-key
 * fragment, and the map preparation the hook in skin-shade.ts consumes;
 * nothing outside skin-shader imports it.
 *
 * Carrier rule (unchanged): the body tile rides INSIDE the face detail
 * block through the same cotangent frame, mixed by the B channel of the
 * curvature/cavity/body-mask texture the carrier packs (B = 255 where the
 * texel's triangle is dominated by a non-head joint, 0 for head). Absent
 * bodyDetailNormalTexture or strength 0 compiles the exact face-only
 * program, and face off compiles the exact pre-detail program (the
 * strength-0 tests in the-skin-shader-flag-is-read-back.test.ts pin both).
 */

import type { Texture } from "three";
import { RepeatWrapping } from "three";
import { SKIN_BODY_DETAIL_TILES_PER_METRE } from "./skin-shade-triplanar.js";

/** Detail-normal XY strength defaults: 0 = the corresponding program off (byte-identical). */
export const SKIN_SHADE_DETAIL_DEFAULTS = {
  detailNormalStrength: 0,
  bodyDetailNormalStrength: 0,
};

/**
 * Body-only stochastic sampler constants. Keep these pinned to the numpy
 * emulator in E/s15_hex_tiling_r7.py through the read-back test.
 */
export const SKIN_BODY_HEX = {
  gridScale: 3.4641016151377544,
  skewXy: -0.57735027,
  skewY: 1.15470054,
  hashRow0: [127.1, 311.7] as const,
  hashRow1: [269.5, 183.3] as const,
  hashMultiplier: 43758.5453,
  falloffContrast: 0.6,
  exponent: 3,
} as const;

export interface SkinDetailOptions {
  /** Tiled tangent-space pore normal. Absent leaves the pre-detail shader unchanged. */
  detailNormalMap?: Texture | null;
  /** Detail-normal XY strength. Defaults to 0 so an omitted extension is an identity. */
  detailNormalStrength?: number;
  /** Body-region tiled tangent-space pore normal (forearm-derived). Absent = face tile everywhere. */
  bodyDetailNormalMap?: Texture | null;
  /** Body-detail XY strength. Defaults to 0; absent map or 0 keeps the face-only program byte-identical. */
  bodyDetailNormalStrength?: number;
}

export interface ResolvedSkinDetail {
  detailNormalMap: Texture | null;
  detailNormalStrength: number;
  bodyDetailNormalMap: Texture | null;
  bodyDetailNormalStrength: number;
}

/** Fail-closed strength check (same refusal shape as the shade resolver). */
function detailNum(v: unknown, name: string, fallback: number): number {
  if (v === undefined) return fallback;
  if (typeof v !== "number" || !Number.isFinite(v) || v < 0) {
    throw new Error(`skinShade.${name} must be a finite number >= 0, got ${JSON.stringify(v)}`);
  }
  return v;
}

export function resolveSkinDetailOptions(
  options: SkinDetailOptions = {},
): ResolvedSkinDetail {
  return {
    detailNormalMap: options.detailNormalMap ?? null,
    detailNormalStrength: detailNum(
      options.detailNormalStrength,
      "detailNormalStrength",
      SKIN_SHADE_DETAIL_DEFAULTS.detailNormalStrength,
    ),
    bodyDetailNormalMap: options.bodyDetailNormalMap ?? null,
    bodyDetailNormalStrength: detailNum(
      options.bodyDetailNormalStrength,
      "bodyDetailNormalStrength",
      SKIN_SHADE_DETAIL_DEFAULTS.bodyDetailNormalStrength,
    ),
  };
}

/** Body-detail uniform declarations (emitted inside the face detail block). */
export function skinShadeBodyParsGlsl(): string {
  return `uniform sampler2D uSkinBodyDetailNormalMap; uniform float uSkinBodyDetailNormalStrength;
uniform mat3 uSkinBodyDetailUvTransform;
/*
 * Stochastic normal-map port from mmikk/hextile-demo commit 43c3ed7e:
 * hextile-demo/hextiling.h:10-43 and 62-102 (Copyright (c) 2022 mmikk,
 * MIT License). Rotation is deliberately disabled; offsets, derivative-based
 * falloff, and the three-tap barycentric contrast blend are retained.
 */
vec2 skinBodyHexHash(vec2 p) {
  vec2 r = vec2(dot(p, vec2(${SKIN_BODY_HEX.hashRow0.join(", ")})), dot(p, vec2(${SKIN_BODY_HEX.hashRow1.join(", ")})));
  return fract(sin(r) * ${SKIN_BODY_HEX.hashMultiplier});
}
void skinBodyHexGrid(vec2 st, out vec3 w, out vec2 v1, out vec2 v2, out vec2 v3) {
  st *= ${SKIN_BODY_HEX.gridScale};
  vec2 skewed = vec2(st.x + ${SKIN_BODY_HEX.skewXy} * st.y, ${SKIN_BODY_HEX.skewY} * st.y);
  vec2 baseId = floor(skewed), f = fract(skewed);
  float z = 1.0 - f.x - f.y;
  float upper = step(0.0, -z), signSide = 2.0 * upper - 1.0;
  w = vec3(-z * signSide, upper - f.y * signSide, upper - f.x * signSide);
  v1 = baseId + vec2(upper, upper);
  v2 = baseId + vec2(upper, 1.0 - upper);
  v3 = baseId + vec2(1.0 - upper, upper);
}
vec3 skinBodyHexNormal(vec2 st) {
  vec3 bary; vec2 v1; vec2 v2; vec2 v3;
  skinBodyHexGrid(st, bary, v1, v2, v3);
  vec2 dx = dFdx(st), dy = dFdy(st);
  vec3 n1 = textureGrad(uSkinBodyDetailNormalMap, st + skinBodyHexHash(v1), dx, dy).xyz * 2.0 - 1.0;
  vec3 n2 = textureGrad(uSkinBodyDetailNormalMap, st + skinBodyHexHash(v2), dx, dy).xyz * 2.0 - 1.0;
  vec3 n3 = textureGrad(uSkinBodyDetailNormalMap, st + skinBodyHexHash(v3), dx, dy).xyz * 2.0 - 1.0;
  n1.xy *= uSkinBodyDetailNormalStrength; n2.xy *= uSkinBodyDetailNormalStrength; n3.xy *= uSkinBodyDetailNormalStrength;
  n1 = normalize(n1); n2 = normalize(n2); n3 = normalize(n3);
  vec2 d1 = -n1.xy / max(n1.z, 1.0 / 255.0);
  vec2 d2 = -n2.xy / max(n2.z, 1.0 / 255.0);
  vec2 d3 = -n3.xy / max(n3.z, 1.0 / 255.0);
  vec3 slope = sqrt(vec3(dot(d1, d1), dot(d2, d2), dot(d3, d3)) / (1.0 + vec3(dot(d1, d1), dot(d2, d2), dot(d3, d3))));
  slope = mix(vec3(1.0), slope, ${SKIN_BODY_HEX.falloffContrast});
  vec3 weights = slope * pow(max(bary, vec3(0.0)), vec3(${SKIN_BODY_HEX.exponent}.0));
  weights /= max(dot(weights, vec3(1.0)), 1e-6);
  vec2 deriv = weights.x * d1 + weights.y * d2 + weights.z * d3;
  return normalize(vec3(-deriv, 1.0));
}`;
}

/** Hex-sample every bind-space projected plane and mix by the existing B mask. */
export function skinShadeBodyNormalGlsl(): string {
  const bodyFrequency = SKIN_BODY_DETAIL_TILES_PER_METRE.toFixed(14);
  return `  vec2 skinBodyUvX = skinTriplanarUvX(vSkinBindPos, ${bodyFrequency});
  vec2 skinBodyUvY = skinTriplanarUvY(vSkinBindPos, ${bodyFrequency});
  vec2 skinBodyUvZ = skinTriplanarUvZ(vSkinBindPos, ${bodyFrequency});
  vec3 skinBodyNormalX = skinBodyHexNormal(skinBodyUvX);
  vec3 skinBodyNormalY = skinBodyHexNormal(skinBodyUvY);
  vec3 skinBodyNormalZ = skinBodyHexNormal(skinBodyUvZ);
  vec3 skinBodyDetailObjectNormal = skinTriplanarWhiteout(
    skinBodyNormalX, skinBodyNormalY, skinBodyNormalZ, skinBindNormal
  );
  float skinBodyMask = texture2D(uSkinCurvMap, skinUv).b;
  skinDetailObjectNormal = normalize(mix(skinDetailObjectNormal, skinBodyDetailObjectNormal, skinBodyMask));
`;
}

/** Body cache-key fragment: empty unless the body path is active. */
export function skinShadeBodyCacheFragment(resolved: {
  detailNormalMap: Texture | null;
  detailNormalStrength: number;
  bodyDetailNormalMap: Texture | null;
  bodyDetailNormalStrength: number;
}): string {
  const faceActive = !!resolved.detailNormalMap && resolved.detailNormalStrength > 0;
  const bodyActive =
    faceActive && !!resolved.bodyDetailNormalMap && resolved.bodyDetailNormalStrength > 0;
  return `${bodyActive ? `:b${resolved.bodyDetailNormalStrength}:h${SKIN_BODY_HEX.exponent}` : ""}`;
}

export interface PreparedSkinDetailMaps {
  detailNormalMap: Texture | null;
  hasDetailNormal: boolean;
  bodyDetailNormalMap: Texture | null;
  hasBodyDetailNormal: boolean;
}

/**
 * Gate the detail maps and set repeat wrapping. Strength zero and absent
 * maps compile as the exact pre-detail program. Body rides inside the face
 * detail block (same cotangent frame); face off or body off both compile
 * the exact face-only program. The carrier always stamps both strengths
 * together, so a body-only extension has no carrier path.
 */
export function prepareSkinDetailMaps(resolved: {
  detailNormalMap: Texture | null;
  detailNormalStrength: number;
  bodyDetailNormalMap: Texture | null;
  bodyDetailNormalStrength: number;
}): PreparedSkinDetailMaps {
  const detailNormalMap = resolved.detailNormalStrength > 0 ? resolved.detailNormalMap : null;
  const hasDetailNormal = detailNormalMap !== null;
  const bodyDetailNormalMap =
    hasDetailNormal && resolved.bodyDetailNormalStrength > 0
      ? resolved.bodyDetailNormalMap
      : null;
  const hasBodyDetailNormal = bodyDetailNormalMap !== null;
  if (hasDetailNormal) {
    detailNormalMap.wrapS = RepeatWrapping;
    detailNormalMap.wrapT = RepeatWrapping;
    detailNormalMap.updateMatrix();
    if (hasBodyDetailNormal) {
      bodyDetailNormalMap.wrapS = RepeatWrapping;
      bodyDetailNormalMap.wrapT = RepeatWrapping;
      bodyDetailNormalMap.updateMatrix();
    }
  }
  return { detailNormalMap, hasDetailNormal, bodyDetailNormalMap, hasBodyDetailNormal };
}

/** Bind the gated detail maps as uniforms (no-op when the face block is off). */
export function assignSkinDetailUniforms(
  uniforms: Record<string, { value: unknown }>,
  maps: PreparedSkinDetailMaps,
  resolved: { detailNormalStrength: number; bodyDetailNormalStrength: number },
): void {
  if (maps.hasDetailNormal) {
    uniforms["uSkinDetailNormalMap"] = { value: maps.detailNormalMap };
    uniforms["uSkinDetailNormalStrength"] = { value: resolved.detailNormalStrength };
    uniforms["uSkinDetailUvTransform"] = { value: maps.detailNormalMap!.matrix };
    if (maps.hasBodyDetailNormal) {
      uniforms["uSkinBodyDetailNormalMap"] = { value: maps.bodyDetailNormalMap };
      uniforms["uSkinBodyDetailNormalStrength"] = {
        value: resolved.bodyDetailNormalStrength,
      };
      uniforms["uSkinBodyDetailUvTransform"] = { value: maps.bodyDetailNormalMap!.matrix };
    }
  }
}
