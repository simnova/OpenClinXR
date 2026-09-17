import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve as pathResolve } from "node:path";
import { fileURLToPath } from "node:url";
import { NodeIO } from "@gltf-transform/core";
import { describe, expect, it } from "vitest";
import { type DecodedPng, decodePng8 } from "../../asset-pipeline/trellis/bake-humanoid-albedo.js";

/**
 * The rebaked nurse carries its authored hair and scrub textures.
 *
 * What is measured: the rebake output GLB (given by OPENCLINXR_REBAKED_NURSE_GLB) is read
 * with NodeIO, and (1) the fitted-hair material's baseColorTexture/normalTexture presence is
 * checked against what the hair style's own `.mhmat` declares, while (2) each scrub garment's
 * atlas texture is decoded and its per-channel coefficient of variation (std/mean) is checked
 * against the SOURCE texture's CV — the known-good column.
 *
 * The D2 defect: the pre-rebake mpfb-clinical-nurse-adult ships its scrub pair with tex=NONE
 * and a flat teal factor while the fleet's authored weave reference for the same shirt exists
 * (scrub-shirt texture sha256 c18e7daba260ee9c, a re-encode of the same upstream image). A
 * rebake that ships a flat teal atlas byte-identical to the old one is refused by clause (2).
 *
 * NOT TESTED: runtime three.js appearance; other actors; whether the hue is the locked clinical
 * colour (a-locked-clinical-colour-survives-its-garment-texture.test.ts owns that); test is
 * skipped when the env var is unset.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = pathResolve(HERE, "../../../..");
const CACHE = join(REPO_ROOT, ".openclinxr-local/provider-cache");
const GLB = process.env.OPENCLINXR_REBAKED_NURSE_GLB ?? "";

const glbExists = GLB !== "" && existsSync(GLB);
const doc = glbExists ? await new NodeIO().readBinary(readFileSync(GLB)) : null;

function findMaterial(pattern: RegExp) {
  return doc?.getRoot().listMaterials().find((m) => pattern.test(m.getName())) ?? null;
}

/** `material <file>` line of a `.mhclo`; the value is the whole rest of the line, trimmed. */
function mhcloMaterialFile(mhcloPath: string): string | null {
  for (const raw of readFileSync(mhcloPath, "utf8").split("\n")) {
    const m = /^material\s+(.+?)\s*$/i.exec(raw.trim());
    if (m) return m[1]!.trim();
  }
  return null;
}

/** Declared texture filenames of a `.mhmat`; keys case-insensitive, values whole rest of line. */
function mhmatTextureDecls(mhmatPath: string): { diffuse: string | null; normal: string | null } {
  let diffuse: string | null = null;
  let normal: string | null = null;
  for (const raw of readFileSync(mhmatPath, "utf8").split("\n")) {
    const stripped = raw.trim();
    const d = /^diffusetexture\s+(.+?)\s*$/i.exec(stripped);
    if (d && d[1]!.trim() !== "") diffuse = d[1]!.trim();
    const n = /^normalmaptexture\s+(.+?)\s*$/i.exec(stripped);
    if (n && n[1]!.trim() !== "") normal = n[1]!.trim();
  }
  return { diffuse, normal };
}

function mustDecode(label: string, bytes: Uint8Array | null): DecodedPng {
  let decoded: DecodedPng | null = null;
  try {
    if (bytes) decoded = decodePng8(bytes);
  } catch {
    decoded = null;
  }
  expect(decoded, `${label} decodes as an 8-bit PNG`).not.toBeNull();
  return decoded!;
}

function channelStats(decoded: DecodedPng): { mean: number[]; std: number[]; cv: number[] } {
  const n = decoded.w * decoded.h;
  const mean = [0, 0, 0];
  for (let i = 0; i < n; i += 1) {
    const o = i * decoded.chans;
    mean[0]! += decoded.px[o]!;
    mean[1]! += decoded.px[o + 1]!;
    mean[2]! += decoded.px[o + 2]!;
  }
  for (let c = 0; c < 3; c += 1) mean[c]! /= n;
  const variance = [0, 0, 0];
  for (let i = 0; i < n; i += 1) {
    const o = i * decoded.chans;
    for (let c = 0; c < 3; c += 1) {
      const d = decoded.px[o + c]! - mean[c]!;
      variance[c]! += d * d;
    }
  }
  const std = variance.map((v) => Math.sqrt(v / n));
  const cv = std.map((s, c) => (mean[c]! === 0 ? 0 : s / mean[c]!));
  return { mean, std, cv };
}

const fmt = (xs: number[]): string => `[${xs.map((v) => v.toFixed(3)).join(", ")}]`;

describe.skipIf(!GLB)(
  "a rebaked nurse carries its authored hair and scrub textures [skipped: contract NOT evaluated without a real bake — set OPENCLINXR_REBAKED_NURSE_GLB]",
  () => {
    it("(0) precondition: the rebake subject exists", () => {
      expect(existsSync(GLB), `rebake subject missing: ${GLB}`).toBe(true);
    });

    it("(1) RED: the fitted hair material carries the textures its .mhmat declares", () => {
      expect(glbExists, `rebake subject missing: ${GLB}`).toBe(true);
      const hair = findMaterial(/^openclinxr_fitted_hair_(.+)_mpfb_/);
      expect(hair, `no material matching /^openclinxr_fitted_hair_(.+)_mpfb_/ in ${GLB}`).not.toBeNull();
      const style = /^openclinxr_fitted_hair_(.+)_mpfb_/.exec(hair!.getName())![1]!;
      const mhclo = join(CACHE, "hair/sources/makehuman-hair01/extracted/hair", style, `${style}.mhclo`);
      expect(existsSync(mhclo), `hair mhclo missing from provider cache: ${mhclo}`).toBe(true);
      const matFile = mhcloMaterialFile(mhclo);
      expect(matFile, `${mhclo} declares no material line`).not.toBeNull();
      const mhmat = join(dirname(mhclo), matFile!);
      expect(existsSync(mhmat), `hair mhmat missing from provider cache: ${mhmat}`).toBe(true);
      const decls = mhmatTextureDecls(mhmat);
      if (decls.diffuse !== null) {
        const base = hair!.getBaseColorTexture();
        expect(base, `${hair!.getName()} declares diffuseTexture ${decls.diffuse} but ships no baseColorTexture`).not.toBeNull();
        mustDecode(`${hair!.getName()} baseColorTexture`, base!.getImage());
      }
      if (decls.normal !== null) {
        expect(
          hair!.getNormalTexture(),
          `${hair!.getName()} declares normalmapTexture ${decls.normal} but ships no normalTexture`,
        ).not.toBeNull();
      }
    });

    it.each([
      {
        material: "mat_makeclothes_library_scrub_shirt",
        mhmat: join(CACHE, "garments/sources/makehuman-community-scrub-shirt/Scrub_Shirt.mhmat"),
      },
      {
        material: "mat_makeclothes_library_scrub_pants",
        mhmat: join(CACHE, "garments/sources/makehuman-community-scrub-pants/Scrub_Pants.mhmat"),
      },
    ])("(2) RED: $material atlas keeps the source weave contrast", ({ material, mhmat }) => {
      expect(glbExists, `rebake subject missing: ${GLB}`).toBe(true);
      const mat = findMaterial(new RegExp(`^${material}$`));
      expect(mat, `${material} missing from ${GLB}`).not.toBeNull();
      const base = mat!.getBaseColorTexture();
      expect(base, `${material} ships no baseColorTexture: a flat colour carries no weave`).not.toBeNull();
      const atlas = channelStats(mustDecode(`${material} baseColorTexture`, base!.getImage()));
      expect(existsSync(mhmat), `source mhmat missing from provider cache: ${mhmat}`).toBe(true);
      const decls = mhmatTextureDecls(mhmat);
      expect(decls.diffuse, `${mhmat} declares no diffuseTexture`).not.toBeNull();
      const sourcePng = join(dirname(mhmat), decls.diffuse!);
      expect(existsSync(sourcePng), `source texture missing from provider cache: ${sourcePng}`).toBe(true);
      const source = channelStats(mustDecode(`source ${decls.diffuse}`, readFileSync(sourcePng)));
      // Floor derived from the SOURCE texture, not the bake. glTF multiplies the texture by a constant
      // baseColorFactor and bake-humanoid-albedo folds that factor per texel; multiplying by a constant
      // leaves std/mean unchanged, so the source CV is the known-good column. Measured 2026-09-17 on the
      // cache PNGs (2048x2048 RGB): shirt mean [96.9,151.6,179.5] std [3.9,4.7,5.2] -> CV [0.040,0.031,0.029];
      // pants mean [96.1,148.6,175.3] std [3.2,3.0,3.1] -> CV [0.033,0.020,0.018]. 50% allows 8-bit
      // requantisation; it does not reference the treatment. The shipped-before rebake measured shirt atlas
      // std <= 0.9 on means [8.8,121.9,133.0] (CV G,B ~0.007), which this refuses.
      const MIN_CV_FRACTION = 0.5;
      for (let c = 0; c < 3; c += 1) {
        expect(
          atlas.cv[c],
          `${material} channel ${"RGB"[c]}: atlas CV ${atlas.cv[c]!.toFixed(4)} (mean ${atlas.mean[c]!.toFixed(1)}, std ${atlas.std[c]!.toFixed(2)}) vs source CV ${source.cv[c]!.toFixed(4)} (mean ${source.mean[c]!.toFixed(1)}, std ${source.std[c]!.toFixed(2)}) — atlas CV ${fmt(atlas.cv)} vs source CV ${fmt(source.cv)}`,
        ).toBeGreaterThanOrEqual(MIN_CV_FRACTION * source.cv[c]!);
      }
    });
  },
);
