/**
 * Iris-disc roughness map for the scoped globe material (h1).
 *
 * Extracted from isolated-subject-rig-variants.ts by the file-size budget
 * (zone 500): the variant module owns the rig; this module owns the disc
 * profile, its upload, and its readback. eye-parallax.ts stays untouched
 * and entrypoint-unreachable — this module does NOT import it (its -c-era
 * numerals are only cited in comments and pinned by the cornea gate test).
 */
import {
  DataTexture,
  LinearFilter,
  NoColorSpace,
} from "three";

/**
 * h1 iris-disc UV numerals (v=0 at image top, the flipY=false glTF
 * convention — GLTFLoader sets flipY=false on ALL textures in three 0.184,
 * verified in source, so the colour map and this DataTexture, which keeps
 * the default flipY=false, sample the same texel).
 *
 * Measured 2026-10-21 on the extracted iris-centred-f texture shipped in
 * the F-bake GLB (dark-blob centroids (296.9,723.9)/(722.7,302.5) px-top,
 * r~133.5 by radial gradient, limbus edge r=130-137): these are the TRUE
 * blob positions. The previous literals (299.55,300.0)/(724.65,721.28)
 * were their v-mirror (1024-723.9=300.1, 1024-302.5=721.5) and sampled
 * uniform sclera — every roughness conclusion rendered from a mis-sampled
 * map (full-disc 0.0-1.0 renders bit-identical; split-map u<0.5 diagnostic
 * proved mis-sampling). The -c-era eye-parallax.ts numerals
 * (299.55,724.0)/(724.65,302.72) agree within ~3px (same UV layout,
 * earlier bake) and share this orientation — they are NOT mirrors.
 * Source of truth for the F-bake numerals is this file; the cornea gate
 * test pins these literals here by text.
 */
export const IRIS_CENTER_L_UV: readonly [number, number] = [296.9 / 1024, 723.9 / 1024];
export const IRIS_CENTER_R_UV: readonly [number, number] = [722.7 / 1024, 302.5 / 1024];
export const IRIS_RADIUS_UV = 133.5 / 1024;
export const LIMBUS_WIDTH_UV = 30 / 1024;

/**
 * h1 iris-disc roughness texel inside the disc (effective roughness =
 * globe scalar x texel). The globe scalar stays 0.5 (sclera unchanged);
 * the disc drops to 0.06 so the PMREM env resolves to a specular spot
 * instead of a flat lift.
 */
export const ROUGH_DISC_INNER = 0.12;

/** Procedural map size (px); the iris disc spans ~2x133.5/1024 of it. */
export const ROUGH_MAP_SIZE = 256;

/**
 * h1: procedural iris-disc roughness map for the scoped globe material.
 * White (1.0) outside the iris keeps the authored scalar (sclera: 0.5);
 * the iris disc multiplies down to glossy (0.06 effective) with a
 * limbus-width smoothstep feather so no ring shows. UV convention follows
 * the glTF colour map (flipY=false, v=0 at image top — the measured
 * F-bake numerals above), and the DataTexture keeps the default
 * flipY=false so both maps sample the same texel. Generated in memory: no
 * iris-texture edit, no new mesh, skin untouched. The shipped eye material
 * carries no authored roughnessMap (baseColor only), so nothing is
 * overwritten.
 *
 * Upload (quadonly lesson): three's roughnessMap samples the GREEN channel
 * of an RGBA texture, so the buffer is S*S*4 with G = profile and A = 255
 * (R/B carry G too — a grayscale RGBA robust to any channel sampling). A
 * bare S*S buffer under-uploads RGBA and renders garbage (the old build
 * read back mirror-flat). LinearFilter on both min/mag (no mipmaps):
 * Nearest would alias the limbus feather into a hard step.
 */
export function buildIrisDiscRoughnessMap(): DataTexture {
  const S = ROUGH_MAP_SIZE;
  const data = new Uint8Array(S * S * 4);
  const centres = [IRIS_CENTER_L_UV, IRIS_CENTER_R_UV];
  const rFull = IRIS_RADIUS_UV;
  const rOut = IRIS_RADIUS_UV + LIMBUS_WIDTH_UV;
  for (let y = 0; y < S; y += 1) {
    const v = (y + 0.5) / S;
    for (let x = 0; x < S; x += 1) {
      const u = (x + 0.5) / S;
      let g = 1;
      for (const c of centres) {
        const r = Math.hypot(u - c[0], v - c[1]);
        if (r < rOut) {
          const t = Math.min(Math.max((r - rFull) / Math.max(rOut - rFull, 1e-9), 0), 1);
          const s = t * t * (3 - 2 * t);
          g = Math.min(g, ROUGH_DISC_INNER + (1 - ROUGH_DISC_INNER) * s);
        }
      }
      const g255 = Math.round(g * 255);
      const i = (y * S + x) * 4;
      data[i] = g255;
      data[i + 1] = g255;
      data[i + 2] = g255;
      data[i + 3] = 255;
    }
  }
  const tex = new DataTexture(data, S, S);
  tex.flipY = false;
  tex.colorSpace = NoColorSpace;
  tex.magFilter = LinearFilter;
  tex.minFilter = LinearFilter;
  tex.generateMipmaps = false;
  tex.needsUpdate = true;
  return tex;
}

/** G-channel texel of a built disc map at a UV (row 0 = v 0 = image top). */
function discTexelG(tex: DataTexture, u: number, v: number): number {
  const S = ROUGH_MAP_SIZE;
  const x = Math.min(Math.max(Math.floor(u * S), 0), S - 1);
  const y = Math.min(Math.max(Math.floor(v * S), 0), S - 1);
  return (tex.image.data as unknown as Uint8Array)[(y * S + x) * 4 + 1] as number;
}

export type DiscUpload = {
  length: number;
  width: number;
  height: number;
  irisGL: number;
  irisGR: number;
  trapL: number;
  trapR: number;
};

/**
 * Live-upload readback for the gate report: G at the true iris centres
 * (expect ROUGH_DISC_INNER*255 = 31) and at the OLD v-mirrored numerals
 * (expect 255 — pure sclera; a v-mirrored map would swap these pairs, so
 * this pin fails if the mapping is ever mirrored again).
 */
export function readDiscUpload(tex: DataTexture): DiscUpload {
  return {
    length: (tex.image.data as unknown as Uint8Array).length,
    width: tex.image.width as number,
    height: tex.image.height as number,
    irisGL: discTexelG(tex, IRIS_CENTER_L_UV[0], IRIS_CENTER_L_UV[1]),
    irisGR: discTexelG(tex, IRIS_CENTER_R_UV[0], IRIS_CENTER_R_UV[1]),
    trapL: discTexelG(tex, 299.55 / 1024, 300.0 / 1024),
    trapR: discTexelG(tex, 724.65 / 1024, 721.28 / 1024),
  };
}
