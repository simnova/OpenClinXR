import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { decodePng } from "../../../../../../tools/openclinxr/evidence/decode-png.js";

/**
 * Shared provided-albedo source-relative dark-texel measure (st-vitphys A2/A6).
 *
 * WHY: the deep family PNG now feeding the physician albedo carries scalp-stubble
 * speckle in the source itself (1.4% of occupancy texels < 0.35x median), so an
 * atlas-median dark-texel rule would fail an honest provided albedo. Bake-albedo
 * actors keep the 0.35x-median rule unchanged; an actor whose provenance sidecar
 * declares a provided albedo source (SKIN_FAMILY_ALBEDO_REPLACES_BAKE with path +
 * sha256) is measured source-relative instead: a GLB texel darker than 0.35x the
 * SAME texel of the sha-verified source (resampled to the GLB texture size with
 * the producer's Lanczos recipe) is painted occlusion. A source sha mismatch or
 * a missing source file FAILS, never skips.
 */

/** A skin texel darker than this fraction of its reference is baked occlusion. */
export const PROVIDED_ALBEDO_DARK_TEXEL_FRACTION = 0.35;

/** Provenance sidecar key declaring a provided albedo source. */
export const PROVIDED_ALBEDO_STAGE_KEY = "SKIN_FAMILY_ALBEDO_REPLACES_BAKE";

export type ProvidedAlbedoDeclaration = { path: string; sha256: string };

export type ProvidedSourceResult = {
  /** Sidecar declares a provided albedo source for this GLB. */
  declared: boolean;
  /** The file on disk matches the declared sha256 (false when undeclared). */
  shaOk: boolean;
  /** Human-readable disposition (missing file, sha mismatch, coverage count). */
  note: string;
  /** Fraction of covered GLB texels darker than 0.35x the same source texel. */
  sourceDarkFraction: number;
};

/** Read the SKIN_FAMILY_ALBEDO_REPLACES_BAKE declaration from the GLB's sidecar, if any. */
export function readProvidedAlbedoDeclaration(
  glbRelPath: string,
  repoRoot: string,
): ProvidedAlbedoDeclaration | null {
  try {
    const sc = JSON.parse(
      readFileSync(join(repoRoot, glbRelPath.replace(/\.glb$/, ".provenance.json")), "utf8"),
    );
    const block = sc?.[PROVIDED_ALBEDO_STAGE_KEY];
    if (block && typeof block.familyPath === "string" && typeof block.familySha256 === "string") {
      return { path: block.familyPath, sha256: block.familySha256 };
    }
  } catch {
    /* no sidecar or unreadable: not a provided-source actor */
  }
  return null;
}

/** Separable Lanczos-3 resample of a luminance plane (the producer's downsample recipe). */
export function lanczosResample(
  src: Float32Array,
  sw: number,
  sh: number,
  dw: number,
  dh: number,
): Float32Array {
  const a = 3;
  const kernel = (x: number): number => {
    if (x === 0) return 1;
    if (Math.abs(x) >= a) return 0;
    const pix = Math.PI * x;
    return (Math.sin(pix) / pix) * (Math.sin(pix / a) / (pix / a));
  };
  const tmp = new Float32Array(dw * sh);
  const sx = sw / dw;
  for (let y = 0; y < sh; y += 1) {
    for (let x = 0; x < dw; x += 1) {
      const cx = (x + 0.5) * sx - 0.5;
      const x0 = Math.floor(cx) - a + 1;
      let num = 0;
      let den = 0;
      for (let k = x0; k <= Math.floor(cx) + a; k += 1) {
        const w = kernel(cx - k);
        if (w === 0) continue;
        const kk = Math.min(sw - 1, Math.max(0, k));
        num += src[y * sw + kk]! * w;
        den += w;
      }
      tmp[y * dw + x] = den === 0 ? 0 : num / den;
    }
  }
  const out = new Float32Array(dw * dh);
  const sy = sh / dh;
  for (let y = 0; y < dh; y += 1) {
    const cy = (y + 0.5) * sy - 0.5;
    const y0 = Math.floor(cy) - a + 1;
    for (let x = 0; x < dw; x += 1) {
      let num = 0;
      let den = 0;
      for (let k = y0; k <= Math.floor(cy) + a; k += 1) {
        const w = kernel(cy - k);
        if (w === 0) continue;
        const kk = Math.min(sh - 1, Math.max(0, k));
        num += tmp[kk * dw + x]! * w;
        den += w;
      }
      out[y * dw + x] = den === 0 ? 0 : num / den;
    }
  }
  return out;
}

/**
 * Source-relative dark-texel measure for a provided-albedo actor. `glb` is the
 * decoded GLB base-colour luminance plane, `mask` its skin-coverage mask.
 */
export function measureProvidedSource(
  glb: { w: number; h: number; lum: Float32Array },
  mask: Uint8Array,
  glbRelPath: string,
  repoRoot: string,
): ProvidedSourceResult {
  const notDeclared: ProvidedSourceResult = {
    declared: false,
    shaOk: false,
    note: "bake-albedo",
    sourceDarkFraction: 0,
  };
  const declared = readProvidedAlbedoDeclaration(glbRelPath, repoRoot);
  if (!declared) return notDeclared;
  let srcBytes: Buffer | null = null;
  try {
    srcBytes = readFileSync(declared.path);
  } catch {
    srcBytes = null;
  }
  if (!srcBytes) {
    return {
      declared: true,
      shaOk: false,
      note: `source missing on disk: ${declared.path}`,
      sourceDarkFraction: 0,
    };
  }
  const actual = createHash("sha256").update(srcBytes).digest("hex");
  if (actual !== declared.sha256) {
    return {
      declared: true,
      shaOk: false,
      note: `source sha mismatch: file ${actual.slice(0, 12)} vs declared ${declared.sha256.slice(0, 12)}`,
      sourceDarkFraction: 0,
    };
  }
  const srcDec = decodePng(new Uint8Array(srcBytes));
  if (!srcDec) {
    return { declared: true, shaOk: false, note: "source PNG undecodable", sourceDarkFraction: 0 };
  }
  const srcAtSize = lanczosResample(srcDec.lum, srcDec.w, srcDec.h, glb.w, glb.h);
  let dark = 0;
  let n = 0;
  for (let y = 0; y < glb.h; y += 1) {
    for (let x = 0; x < glb.w; x += 1) {
      if (!mask[y * glb.w + x]) continue;
      n += 1;
      // 1 LSB tolerance: the in-test Lanczos reimplementation differs from the
      // producer's PIL LANCZOS by <=1 LSB on speckle edges (PIL ground truth:
      // fraction exactly 0). Occlusion (e.g. a black square) sits ~tens of LSB
      // below 0.35x source, so the probe still fails.
      if (
        glb.lum[y * glb.w + x]! <
        PROVIDED_ALBEDO_DARK_TEXEL_FRACTION * srcAtSize[y * glb.w + x]! - 1.0
      )
        dark += 1;
    }
  }
  return {
    declared: true,
    shaOk: true,
    note: `source-relative over ${n} covered texels`,
    sourceDarkFraction: n === 0 ? 0 : dark / n,
  };
}
