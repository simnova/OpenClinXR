import { readdirSync } from "node:fs";
import { createHash } from "node:crypto";
import { dirname, join, resolve as pathResolve } from "node:path";
import { fileURLToPath } from "node:url";
import { inflateSync } from "node:zlib";
import { NodeIO, type Primitive } from "@gltf-transform/core";
import { describe, expect, it } from "vitest";

/**
 * #370 — the MPFB skin must carry SURFACE RELIEF (a normal map), not only albedo.
 *
 * `b1870652` landed the base-colour half of the operator's "bake normals / details before
 * export" prescription and I graded it: real subsurface variation in the atlas, and no
 * perceptible change in the rendered figure. Colour at 1024^2 spread over a body is subtle;
 * relief (pores catching light) is what reads at clinical working distance. The shipped skin
 * material is the GameEngine-safe export of `enhanced_skin`'s base colour with none of its
 * bump detail:
 *
 *   mpfb_skin_peds_nurse_kevin  baseColor 848,247 B  normal NONE  metallicRoughness NONE
 *
 * THE FIX: `materialize_mpfb_humanoid_candidate.py` now bakes the shipped `enhanced_skin`
 * shader's perturbed surface normal (its Noise Texture -> ColorRamp -> Bump feeding the
 * Principled Normal) to a tangent-space normal map with a Cycles NORMAL bake — geometry +
 * bump, not light transport — and wires it as the glTF normalTexture.
 *
 * ## THE CHEAP FIXES THIS REFUSES
 *   - a flat neutral normal map (128,128,255): satisfies "has a normal texture", changes
 *     nothing, costs memory. Caught by (2) — a flat map is byte-identical for every actor.
 *   - breaking the albedo while adding relief: the ad35790e occlusion bake (black torso,
 *     black thighs). Caught by (3) below, carried forward verbatim from b8e119ee.
 *   - baking lighting into the normal map (direct/indirect passes): the NORMAL bake reads
 *     geometry + bump, never light transport — there are no direct/indirect passes enabled.
 *
 * ## RED / COUNTERWEIGHT / VACUITY (#227)
 *   (1) RED — every MPFB skin material carries a normalTexture above a byte floor (fails 3/3
 *       today: normal NONE).
 *   (2) COUNTERWEIGHT (a) — no two actors share a byte-identical normal map. A genuine
 *       per-actor bake differs because the bodies differ.
 *   (3) COUNTERWEIGHT (b) — base colour survives: texture still present, per-actor distinct,
 *       and no skin texel below 0.35x the atlas median (b8e119ee's clause; a real regression
 *       net on the measured bytes).
 *   (4) VACUITY — plain `it`: all three actors are enumerated and their base-colour atlas
 *       decodes over a real skin area. An `it.fails` cannot guard its own vacuity (§7t).
 *
 * NOT TESTED:
 *   - Whether the normal map LOOKS like realistic skin relief. This asserts presence,
 *     per-actor distinctness and albedo survival; appearance is the orchestrator's pixel
 *     grade of the `.skin-normal.png` artifact, not a file-side claim.
 *   - Quest memory cost of a second full-body texture per actor (no headset here).
 *   - Whether roughness should become a map rather than the 0.78 scalar (out of scope).
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = pathResolve(HERE, "../../..");
const GENERATED = "apps/ui-xr/public/generated-humanoids";

/** A stub or 1x1 normal map is nowhere near this; a real 1024^2 bake is hundreds of KB. */
const MIN_NORMAL_TEXTURE_BYTES = 2048;
const MIN_BASE_COLOR_TEXTURE_BYTES = 2048;
/** b8e119ee's clause, verbatim: a skin texel darker than this fraction of the atlas median is baked occlusion. */
const DARK_TEXEL_FRACTION = 0.35;
/** Vacuity floor — a stub atlas covers nowhere near this many texels. */
const MIN_SKIN_TEXELS = 100_000;

const io = new NodeIO();
const isSkinMaterial = (n: string): boolean =>
  /skin|body|human/i.test(n) && !/iris|eye|cornea|sclera|scalp|hair/i.test(n);

type DecodedPng = { w: number; h: number; lum: Float32Array };

function decodePng(bytes: Uint8Array): DecodedPng | null {
  if (bytes.length < 8 || bytes[0] !== 0x89 || bytes[1] !== 0x50) return null;
  let w = 0;
  let h = 0;
  let depth = 0;
  let colour = -1;
  const idat: Uint8Array[] = [];
  let off = 8;
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  while (off + 8 <= bytes.length) {
    const len = dv.getUint32(off);
    const type = String.fromCharCode(bytes[off + 4]!, bytes[off + 5]!, bytes[off + 6]!, bytes[off + 7]!);
    const body = bytes.subarray(off + 8, off + 8 + len);
    if (type === "IHDR") {
      w = dv.getUint32(off + 8);
      h = dv.getUint32(off + 12);
      depth = bytes[off + 16]!;
      colour = bytes[off + 17]!;
    } else if (type === "IDAT") idat.push(body);
    else if (type === "IEND") break;
    off += 12 + len;
  }
  if (depth !== 8 || w === 0 || h === 0) return null;
  const chans = colour === 0 ? 1 : colour === 2 ? 3 : colour === 4 ? 2 : colour === 6 ? 4 : 0;
  if (chans === 0) return null;

  let raw: Buffer;
  try {
    raw = inflateSync(Buffer.concat(idat.map((c) => Buffer.from(c))));
  } catch {
    return null;
  }
  const stride = w * chans;
  if (raw.length < (stride + 1) * h) return null;

  const lum = new Float32Array(w * h);
  const prev = new Uint8Array(stride);
  const cur = new Uint8Array(stride);
  let p = 0;
  for (let y = 0; y < h; y += 1) {
    const filter = raw[p++]!;
    for (let x = 0; x < stride; x += 1) {
      const rb = raw[p + x]!;
      const a = x >= chans ? cur[x - chans]! : 0;
      const b = prev[x]!;
      const c = x >= chans ? prev[x - chans]! : 0;
      let v: number;
      if (filter === 0) v = rb;
      else if (filter === 1) v = rb + a;
      else if (filter === 2) v = rb + b;
      else if (filter === 3) v = rb + ((a + b) >> 1);
      else {
        const pa = Math.abs(b - c);
        const pb = Math.abs(a - c);
        const pc = Math.abs(a + b - 2 * c);
        v = rb + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c);
      }
      cur[x] = v & 0xff;
    }
    p += stride;
    for (let x = 0; x < w; x += 1) {
      const i = x * chans;
      lum[y * w + x] = chans >= 3 ? 0.299 * cur[i]! + 0.587 * cur[i + 1]! + 0.114 * cur[i + 2]! : cur[i]!;
    }
    prev.set(cur);
  }
  return { w, h, lum };
}

function pointInTri(
  px: number, py: number,
  ax: number, ay: number, bx: number, by: number, cx: number, cy: number,
): boolean {
  const d1 = (px - bx) * (ay - by) - (ax - bx) * (py - by);
  const d2 = (px - cx) * (by - cy) - (bx - cx) * (py - cy);
  const d3 = (px - ax) * (cy - ay) - (cx - ax) * (py - ay);
  const neg = d1 < 0 || d2 < 0 || d3 < 0;
  const pos = d1 > 0 || d2 > 0 || d3 > 0;
  return !(neg && pos);
}

/** Rasterize the skin primitive's UV coverage so luminance checks only see skin texels (§11s). */
function coverageMask(prim: Primitive, w: number, h: number): Uint8Array {
  const mask = new Uint8Array(w * h);
  const uv = prim.getAttribute("TEXCOORD_0")?.getArray();
  if (!uv) return mask;
  const idx = prim.getIndices()?.getArray();
  const triCount = idx ? idx.length / 3 : uv.length / 6;
  for (let t = 0; t < triCount; t += 1) {
    const a = idx ? idx[t * 3]! : t * 3;
    const b = idx ? idx[t * 3 + 1]! : t * 3 + 1;
    const c = idx ? idx[t * 3 + 2]! : t * 3 + 2;
    const ax = uv[a * 2]!;
    const ay = uv[a * 2 + 1]!;
    const bx = uv[b * 2]!;
    const by = uv[b * 2 + 1]!;
    const cx = uv[c * 2]!;
    const cy = uv[c * 2 + 1]!;
    const minX = Math.max(0, Math.floor(Math.min(ax, bx, cx) * w));
    const maxX = Math.min(w - 1, Math.ceil(Math.max(ax, bx, cx) * w));
    const minY = Math.max(0, Math.floor(Math.min(ay, by, cy) * h));
    const maxY = Math.min(h - 1, Math.ceil(Math.max(ay, by, cy) * h));
    for (let y = minY; y <= maxY; y += 1) {
      for (let x = minX; x <= maxX; x += 1) {
        const px = (x + 0.5) / w;
        const py = (y + 0.5) / h;
        if (pointInTri(px, py, ax, ay, bx, by, cx, cy)) mask[y * w + x] = 1;
      }
    }
  }
  return mask;
}

type Row = {
  file: string;
  skinMaterials: string[];
  normalTextureSha: string | null;
  normalTextureBytes: number;
  baseColorSha: string | null;
  baseColorBytes: number;
  coveredTexels: number;
  medianLuminance: number;
  darkTexelFraction: number;
};

async function measure(rel: string): Promise<Row | null> {
  const doc = await io.read(join(REPO_ROOT, rel));
  const skinMats = doc.getRoot().listMaterials().filter((m) => isSkinMaterial(m.getName()));
  if (skinMats.length === 0) return null;

  let normalSha: string | null = null;
  let normalBytes = 0;
  let baseSha: string | null = null;
  let baseBytes = 0;
  let prim: Primitive | null = null;

  for (const mesh of doc.getRoot().listMeshes()) {
    for (const p of mesh.listPrimitives()) {
      const mat = p.getMaterial();
      if (!mat || !isSkinMaterial(mat.getName())) continue;
      const ntex = mat.getNormalTexture()?.getImage();
      if (ntex && ntex.byteLength > normalBytes) {
        normalBytes = ntex.byteLength;
        normalSha = createHash("sha256").update(ntex).digest("hex").slice(0, 16);
      }
      const btex = mat.getBaseColorTexture()?.getImage();
      if (btex && btex.byteLength > baseBytes) {
        baseBytes = btex.byteLength;
        baseSha = createHash("sha256").update(btex).digest("hex").slice(0, 16);
        prim = p;
      }
    }
  }

  let coveredTexels = 0;
  let medianLuminance = 0;
  let darkTexelFraction = 0;
  if (prim) {
    const btex = prim.getMaterial()?.getBaseColorTexture()?.getImage();
    const decoded = btex ? decodePng(btex) : null;
    if (decoded) {
      const mask = coverageMask(prim, decoded.w, decoded.h);
      const values: number[] = [];
      for (let y = 0; y < decoded.h; y += 1) {
        for (let x = 0; x < decoded.w; x += 1) {
          if (mask[y * decoded.w + x]) values.push(decoded.lum[y * decoded.w + x]!);
        }
      }
      coveredTexels = values.length;
      if (values.length > 0) {
        values.sort((a, b) => a - b);
        medianLuminance = values[Math.floor(values.length / 2)]!;
        let dark = 0;
        for (const v of values) if (v < DARK_TEXEL_FRACTION * medianLuminance) dark += 1;
        darkTexelFraction = dark / values.length;
      }
    }
  }

  return {
    file: rel.split("/").pop()!,
    skinMaterials: skinMats.map((m) => m.getName()),
    normalTextureSha: normalSha,
    normalTextureBytes: normalBytes,
    baseColorSha: baseSha,
    baseColorBytes: baseBytes,
    coveredTexels,
    medianLuminance,
    darkTexelFraction,
  };
}

const files = readdirSync(join(REPO_ROOT, GENERATED))
  .filter((n: string) => n.startsWith("mpfb-") && n.endsWith(".glb") && !/candidate/i.test(n))
  .map((n: string) => `${GENERATED}/${n}`);

const rows = (await Promise.all(files.map((f) => measure(f).catch(() => null)))).filter(
  (r): r is Row => r !== null,
);

/** An empty enumeration must FAIL, never pass vacuously (§7t). */
function requireRows(): void {
  expect(rows.length, `MPFB bodies measured (scanned ${files.length})`).toBeGreaterThanOrEqual(3);
}

describe("MPFB skin carries a tangent-space normal map without breaking the albedo (#370)", () => {
  it("(4) VACUITY: all three actors enumerate with a decodable base-colour atlas", () => {
    requireRows();
    for (const r of rows) {
      expect(r.coveredTexels, `${r.file}: skin coverage below ${MIN_SKIN_TEXELS} texels`).toBeGreaterThanOrEqual(MIN_SKIN_TEXELS);
      expect(r.baseColorBytes, `${r.file}: base-colour texture too small`).toBeGreaterThan(MIN_BASE_COLOR_TEXTURE_BYTES);
    }
  });

  it("(1) RED: every MPFB skin material carries a normalTexture above a byte floor", () => {
    requireRows();
    const missing = rows
      .filter((r) => r.normalTextureSha === null || r.normalTextureBytes < MIN_NORMAL_TEXTURE_BYTES)
      .map((r) => `${r.file}: skin=[${r.skinMaterials.join(",")}] normal=${r.normalTextureSha ?? "NONE"} bytes=${r.normalTextureBytes}`);
    expect(missing, "actors whose skin has no baked normal map (flat colour relief, not geometry+bump)").toEqual([]);
  });

  it("(2) COUNTERWEIGHT (a): no two actors share one normal map", () => {
    // Refuses a flat neutral map (identical for everyone) and a single shared bake.
    requireRows();
    const withNormal = rows.filter((r) => r.normalTextureSha !== null);
    const shas = withNormal.map((r) => r.normalTextureSha!);
    const dupes = shas.filter((s, i) => shas.indexOf(s) !== i);
    expect(
      dupes,
      `normal maps reused across actors (${new Set(shas).size} distinct across ${withNormal.length})`,
    ).toEqual([]);
  });

  it("(3) COUNTERWEIGHT (b): base colour survives — present, distinct, and no occlusion-dark texels", () => {
    requireRows();
    const noBase = rows
      .filter((r) => r.baseColorSha === null || r.baseColorBytes < MIN_BASE_COLOR_TEXTURE_BYTES)
      .map((r) => `${r.file}: base=${r.baseColorSha ?? "NONE"} bytes=${r.baseColorBytes}`);
    expect(noBase, "base-colour texture lost by the normal-map bake").toEqual([]);

    const baseShas = rows.map((r) => r.baseColorSha!);
    const dupes = baseShas.filter((s, i) => baseShas.indexOf(s) !== i);
    expect(dupes, `base-colour atlases reused across actors (${new Set(baseShas).size} distinct)`).toEqual([]);

    const dark = rows
      .filter((r) => r.darkTexelFraction > 0)
      .map((r) => `${r.file}: darkTexelFraction ${r.darkTexelFraction.toFixed(4)} at median ${r.medianLuminance.toFixed(1)}`);
    expect(dark, "atlases with baked-in dark regions — occlusion painted into base colour by the normal bake").toEqual([]);
  });
});
