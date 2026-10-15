/**
 * Penner & Borshukov pre-integrated skin LUT (tsk_44e25e12108c307e).
 *
 * Split from skin-shade.ts (file-size zone budget 500): this module owns
 * the LUT bake binding, the lut sub-flag options, and the LUT GLSL. The
 * hook in skin-shade.ts consumes it; nothing outside skin-shader imports it.
 *
 * LUT layout (build_skin_lut.py, generated ONCE in numpy):
 * skin-lut.png (128 x 16 R8), u = NdotL in [-1,1] -> [0,1], v = curvature
 * deviation |curv - 0.5| * 2 in [0,1]. Row 0 (v 0, file top, flipY=false)
 * is the flat identity ramp, so flat surfaces sample saturate(NdotL) up to
 * 8-bit storage (G1 epsilon 1/255).
 */

import type { Texture } from "three";
import {
  ClampToEdgeWrapping,
  DataTexture,
  LinearFilter,
  NoColorSpace,
  RedFormat,
} from "three";
import {
  SKIN_LUT_BYTES_BASE64,
  SKIN_LUT_HEIGHT,
  SKIN_LUT_WIDTH,
} from "./skin-lut-data.js";

/** Flat-skin curvature: bake ramp maps pointiness 0.5 -> 0.5 (median 0.51 measured). */
export const SKIN_CURVATURE_FLAT = 0.5;
/** Default LUT strength: 1 = the true pre-integrated factor (recorded constant). */
export const SKIN_LUT_STRENGTH_DEFAULT = 1;
/**
 * Portrait key-light direction (world, toward the light): the h1 portrait
 * rig readout (h1/skinshade-on.json record.lights: key DirectionalLight
 * 2.2 at (3.2, 5.2, 4.1)) normalized. The shader normalize()s it again,
 * so these 4dp values are exact on use.
 */
export const SKIN_LUT_KEY_DIR_DEFAULT: readonly [number, number, number] =
  // biome-ignore lint/suspicious/noApproximativeNumericConstant: measured rig readout (3.2, 5.2, 4.1) normalized, not an approximable constant
  [0.4351, 0.707, 0.5574];

export type SkinLutOptions = {
  /**
   * Penner & Borshukov LUT sub-flag: when true the curvature-indexed wrap
   * term (convex/cavity gains) is REPLACED by the pre-integrated LUT sample
   * (difference from Lambert, so flat surfaces are untouched). Default
   * false: the wrap path stays selectable.
   */
  lut?: boolean;
  /** LUT strength multiplier (default 1 = the true pre-integrated factor). Must be finite and >= 0. */
  lutStrength?: number;
  /**
   * LUT texture override. Production binds the embedded bake (the
   * skin-lut.png bytes in skin-lut-data.ts, no serving needed); null only
   * for the node unit-test stand-in path (mirrors curvatureMap).
   */
  lutMap?: Texture | null;
  /** World-space key-light direction (toward the light). Defaults to the portrait rig key. */
  lutKeyDir?: readonly [number, number, number];
};

export const SKIN_LUT_DEFAULTS = {
  lut: false,
  lutStrength: SKIN_LUT_STRENGTH_DEFAULT,
};

export type ResolvedSkinLutOptions = {
  lut: boolean;
  lutStrength: number;
  lutMap: Texture | null;
  lutKeyDir: readonly [number, number, number];
};

/** Fail-closed LUT option resolution: non-finite or negative strengths refuse. */
export function resolveSkinLutOptions(options: SkinLutOptions = {}): ResolvedSkinLutOptions {
  const num = (v: unknown, name: string, fallback: number): number => {
    if (v === undefined) return fallback;
    if (typeof v !== "number" || !Number.isFinite(v) || v < 0) {
      throw new Error(`skinShade.${name} must be a finite number >= 0, got ${JSON.stringify(v)}`);
    }
    return v;
  };
  const keyDir = options.lutKeyDir ?? SKIN_LUT_KEY_DIR_DEFAULT;
  if (
    !Array.isArray(keyDir) ||
    keyDir.length !== 3 ||
    keyDir.some((c) => typeof c !== "number" || !Number.isFinite(c))
  ) {
    throw new Error(`skinShade.lutKeyDir must be a finite [x,y,z] triple, got ${JSON.stringify(keyDir)}`);
  }
  const [keyX, keyY, keyZ] = keyDir;
  return {
    lut: options.lut ?? false,
    lutStrength: num(options.lutStrength, "lutStrength", SKIN_LUT_DEFAULTS.lutStrength),
    lutMap: options.lutMap ?? null,
    lutKeyDir: [keyX as number, keyY as number, keyZ as number],
  };
}

/**
 * Embedded Penner & Borshukov LUT as a linear R8 DataTexture, built once
 * from the build_skin_lut.py bytes (no serving, no capture-tool key: the
 * 128x16 bake is 2 KB, far under the 150 KB store rule). LinearFilter so
 * NdotL/curvature sample smoothly; flipY=false so data row 0 (v 0) is the
 * flat identity row.
 */
let cachedSkinLut: DataTexture | null = null;
export function skinLutTexture(): DataTexture {
  if (!cachedSkinLut) {
    const raw = Uint8Array.from(atob(SKIN_LUT_BYTES_BASE64), (c) => c.charCodeAt(0));
    if (raw.length !== SKIN_LUT_WIDTH * SKIN_LUT_HEIGHT) {
      throw new Error(
        `skin LUT bytes ${raw.length} != ${SKIN_LUT_WIDTH}x${SKIN_LUT_HEIGHT} (skin-lut-data.ts out of sync with build_skin_lut.py?)`,
      );
    }
    const tex = new DataTexture(raw, SKIN_LUT_WIDTH, SKIN_LUT_HEIGHT, RedFormat);
    tex.needsUpdate = true;
    tex.magFilter = LinearFilter;
    tex.minFilter = LinearFilter;
    tex.wrapS = ClampToEdgeWrapping;
    tex.wrapT = ClampToEdgeWrapping;
    tex.colorSpace = NoColorSpace;
    cachedSkinLut = tex;
  }
  return cachedSkinLut;
}

/** LUT uniforms (appended to the pars block only when the lut sub-flag is on). */
export function skinShadeLutParsGlsl(): string {
  return /* glsl */ `
uniform sampler2D uSkinLutMap;
uniform vec3 uSkinKeyDirWorld;
uniform float uSkinLutStrength;
`;
}

/**
 * LUT scatter (replaces the wrap scatter when the lut sub-flag is on, same
 * `#include <emissivemap_fragment>` anchor). The LUT holds the ABSOLUTE
 * pre-integrated diffuse factor, so the added term is (LUT - Lambert): at
 * flat curvature the sample is the identity row and the lift is exactly
 * zero (G1 holds in-shader, not just in the bake). Nostril/lip disk lifts
 * are orthogonal to the wrap term and stay. DEVIATION RECORDED: Penner &
 * Borshukov replace the direct-diffuse term per light; here the key-light
 * NdotL difference rides the existing albedo-modulated emissive lift, so
 * the diffuse pipeline (and the wrap render) is untouched.
 */
export function skinShadeLutScatterGlsl(): string {
  return /* glsl */ `
{
  vec3 skinKeyDirView = normalize((viewMatrix * vec4(uSkinKeyDirWorld, 0.0)).xyz);
  float skinKeyNdl = clamp(dot(normalize(normal), skinKeyDirView), -1.0, 1.0);
  vec2 skinLutUv = vec2(
    clamp(skinKeyNdl * 0.5 + 0.5, 0.0, 1.0),
    clamp(abs(skinCurv - ${SKIN_CURVATURE_FLAT}) * 2.0, 0.0, 1.0));
  float skinLutF = texture2D(uSkinLutMap, skinLutUv).r;
  float skinLutLift = (skinLutF - clamp(skinKeyNdl, 0.0, 1.0)) * uSkinLutStrength;
  totalEmissiveRadiance += diffuseColor.rgb * (skinLutLift + skinNos * uSkinScatterNos + skinLip * uSkinScatterLip);
}
`;
}
