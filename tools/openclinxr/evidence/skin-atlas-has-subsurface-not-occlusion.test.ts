import { readdirSync } from "node:fs";
import { createHash } from "node:crypto";
import { dirname, join, resolve as pathResolve } from "node:path";
import { fileURLToPath } from "node:url";
import { inflateSync } from "node:zlib";
import { NodeIO, type Document, type Primitive } from "@gltf-transform/core";
import { describe, expect, it } from "vitest";

/**
 * #343 RETRY — the skin atlas must carry SUBSURFACE tint, not baked occlusion.
 *
 * `ad35790e` was refused at the pixel grade: it baked DIFFUSE with direct+indirect, which painted
 * occlusion into base colour — a near-black torso and thighs, invisible in-render only because
 * clothing happened to cover it. Its lesson is the counterweight below: a metric that counts HOW
 * MUCH an atlas varies cannot tell subsurface tint from baked ambient occlusion, so this contract
 * gates on WHAT KIND of variation appeared.
 *
 * THE FIX, and what it is NOT: `materialize_mpfb_humanoid_candidate.py`
 * `apply_subsurface_tint` loads MPFB2's SHIPPED subsurface weight map
 * (`data/textures/sss.png`, CC0, already recorded in third-party-asset-licence-ledger.md) and
 * combines it with the DIFFUSE COLOR bake as a RELATIVE warm brightening — the #343 RETRY approach
 * 2 (bake the subsurface input, combine with the albedo), no light transport, no hand-authored
 * node graph (the D1 refusal). It is NOT a flat-colour tweak (#337/#338's third-time trap), NOT a
 * hand-picked per-actor literal, and NOT a re-run of `use_pass_direct + use_pass_indirect` (the
 * occlusion that got the previous attempt refused).
 *
 * WHY THIS INSTRUMENT: the shipped sss.png is grayscale 0.27..0.48 (thin skin brighter = more
 * subsurface transmission). Its spatial structure lives at the TILE scale (anatomical tone), while
 * the pre-fix atlas's only variation is pore-scale noise — per-pixel sd is the WRONG instrument
 * and today's flat atlas already clears it. Block-mean (16x16) sd averages the noise away and
 * measures the tone structure the fix adds.
 *
 * ## RED / COUNTERWEIGHT / VACUITY (#227)
 *
 *   (1) RED — spatial structure: block-mean luminance sd over 16x16 tiles of the skin-covered
 *       atlas exceeds the pre-fix value (measured 2026-08-13 on the HEAD GLBs, below) by a factor.
 *   (2) COUNTERWEIGHT (a) — NO DARK REGIONS: no skin texel below 0.35 x the atlas median luminance.
 *       This is the clause that would have caught ad35790e's occlusion; the pre-fix flat atlas
 *       passes it (darkFrac 0.000 on all three), so it is a regression net on the measured bytes,
 *       not an invented bound.
 *   (3) COUNTERWEIGHT (b) — the three per-actor atlases stay byte-distinct (also pinned by
 *       mpfb-skin-is-baked-not-painted.test.ts; re-asserted here so this contract does not weaken it).
 *   (4) VACUITY — plain `it`: all three atlases decode, are non-empty, and cover a real skin area.
 *       An `it.fails` cannot guard its own vacuity (§7t).
 *
 * PRE-FIX BASELINE, measured with THIS instrument (UV-coverage block sd) on the HEAD GLBs
 * (sha 625d0857), 2026-08-13:
 *
 *   mpfb-ob-patient-aisha.glb      blockSd 1.58   median 183.47
 *   mpfb-peds-nurse-kevin.glb      blockSd 1.39   median 168.58
 *   mpfb-peds-patient-child.glb    blockSd 2.48   median 208.97
 *
 * NOT TESTED:
 *   - Whether the tinted skin LOOKS like realistic subsurface scattering. This asserts the atlas
 *     has tile-scale tone structure with no dark regions; the appearance is the orchestrator's
 *     pixel grade, not a file-side claim.
 *   - Clinical skin-tone appropriateness (§8d/§8y — not an implementer decision).
 *   - That the tint is visually strong enough at encounter distance — a pixel grade, not a
 *     luminance statistic.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = pathResolve(HERE, "../../..");
const GENERATED = "apps/ui-xr/public/generated-humanoids";

/** Pre-fix block-mean (16x16) luminance sd, measured with the UV-coverage instrument below. */
const PRE_FIX_BLOCK_SD: Record<string, number> = {
  "mpfb-ob-patient-aisha.glb": 1.58,
  "mpfb-peds-nurse-kevin.glb": 1.39,
  "mpfb-peds-patient-child.glb": 2.48,
};
/** Post/pre block-sd ratio the fix must clear. Measured ~1.5-2.0x; 1.3 leaves re-bake margin. */
const MIN_BLOCK_SD_FACTOR = 1.3;
/** A skin texel darker than this fraction of the atlas median is baked occlusion (#343 counterweight a). */
const DARK_TEXEL_FRACTION = 0.35;
/** Vacuity floor — a stub atlas covers nowhere near this many texels. */
const MIN_SKIN_TEXELS = 100_000;
/** 16x16 tile side (atlas is 1024x1024 = 64x64 tiles). */
const TILE = 16;

const io = new NodeIO();
const isSkinMaterial = (n: string): boolean => /skin|body|human/i.test(n) && !/iris|eye|cornea|sclera|scalp|hair/i.test(n);

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

/**
 * The bake clears un-baked texels to black, so luminance alone cannot separate skin from
 * background (a luminance floor would also exclude occlusion-dark skin and vacate counterweight
 * (a) — the exact §11s trap). Coverage is instead rasterized from the skin primitive's own UV:
 * a texel is "skin" iff a skin-material triangle maps onto it, whatever its baked luminance.
 */
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
  textureSha: string;
  textureBytes: number;
  coveredTexels: number;
  medianLuminance: number;
  darkTexelFraction: number;
  blockMeanSd: number;
};

async function measure(rel: string): Promise<Row | null> {
  const doc = await io.read(join(REPO_ROOT, rel));
  const skinMats = doc.getRoot().listMaterials().filter((m) => isSkinMaterial(m.getName()));
  if (skinMats.length === 0) return null;

  // Largest skin texture (the body skin atlas) + its primitive for UV coverage.
  let tex: Uint8Array | null = null;
  let prim: Primitive | null = null;
  for (const mesh of doc.getRoot().listMeshes()) {
    for (const p of mesh.listPrimitives()) {
      const name = p.getMaterial()?.getName() ?? "";
      if (!isSkinMaterial(name)) continue;
      const img = p.getMaterial()?.getBaseColorTexture()?.getImage();
      if (img && (!tex || img.byteLength > tex.byteLength)) {
        tex = img;
        prim = p;
      }
    }
  }
  if (!tex || !prim) return null;
  const decoded = decodePng(tex);
  if (!decoded) return null;
  const mask = coverageMask(prim, decoded.w, decoded.h);

  const values: number[] = [];
  for (let y = 0; y < decoded.h; y += 1) {
    for (let x = 0; x < decoded.w; x += 1) {
      if (mask[y * decoded.w + x]) values.push(decoded.lum[y * decoded.w + x]!);
    }
  }
  if (values.length < MIN_SKIN_TEXELS) return null;
  values.sort((a, b) => a - b);
  const median = values[Math.floor(values.length / 2)]!;
  let dark = 0;
  for (const v of values) if (v < DARK_TEXEL_FRACTION * median) dark += 1;

  const tiles: number[] = [];
  for (let ty = 0; ty < decoded.h; ty += TILE) {
    for (let tx = 0; tx < decoded.w; tx += TILE) {
      let sum = 0;
      let n = 0;
      for (let y = ty; y < Math.min(ty + TILE, decoded.h); y += 1) {
        for (let x = tx; x < Math.min(tx + TILE, decoded.w); x += 1) {
          if (mask[y * decoded.w + x]) {
            sum += decoded.lum[y * decoded.w + x]!;
            n += 1;
          }
        }
      }
      if (n >= (TILE * TILE) / 2) tiles.push(sum / n);
    }
  }
  let mean = 0;
  for (const t of tiles) mean += t;
  mean /= tiles.length;
  let sd = 0;
  for (const t of tiles) sd += (t - mean) * (t - mean);
  sd = Math.sqrt(sd / tiles.length);

  return {
    file: rel.split("/").pop()!,
    textureSha: createHash("sha256").update(tex).digest("hex").slice(0, 16),
    textureBytes: tex.byteLength,
    coveredTexels: values.length,
    medianLuminance: median,
    darkTexelFraction: dark / values.length,
    blockMeanSd: sd,
  };
}

const files = readdirSync(join(REPO_ROOT, GENERATED))
  .filter((n: string) => n.startsWith("mpfb-") && n.endsWith(".glb") && !/candidate/i.test(n))
  .map((n: string) => `${GENERATED}/${n}`);

const rows = (await Promise.all(files.map((f) => measure(f).catch(() => null)))).filter(
  (r): r is Row => r !== null,
);

function requireRows(): void {
  expect(rows.length, `MPFB skin atlases measured (scanned ${files.length})`).toBeGreaterThanOrEqual(3);
}

describe("an MPFB skin atlas carries subsurface tint, not baked occlusion (#343)", () => {
  it("(4) VACUITY: all three atlases decode and cover a real skin area", () => {
    requireRows();
    for (const r of rows) {
      expect(r.coveredTexels, `${r.file}: skin coverage below ${MIN_SKIN_TEXELS} texels`).toBeGreaterThanOrEqual(MIN_SKIN_TEXELS);
      expect(r.textureBytes, `${r.file}: skin texture too small`).toBeGreaterThan(1024);
    }
  });

  it("(1) RED: block-mean (16x16) luminance sd exceeds the pre-fix value", () => {
    requireRows();
    const below = rows
      .filter((r) => {
        const pre = PRE_FIX_BLOCK_SD[r.file];
        return pre === undefined || r.blockMeanSd <= pre * MIN_BLOCK_SD_FACTOR;
      })
      .map((r) => `${r.file}: blockSd ${r.blockMeanSd.toFixed(2)} vs pre-fix ${PRE_FIX_BLOCK_SD[r.file]} (x${(r.blockMeanSd / PRE_FIX_BLOCK_SD[r.file]!).toFixed(2)})`);
    expect(below, "atlases whose spatial tone structure did not clear the subsurface factor").toEqual([]);
  });

  it("(2) COUNTERWEIGHT (a): no skin texel darker than 0.35x the atlas median (occlusion)", () => {
    requireRows();
    const dark = rows
      .filter((r) => r.darkTexelFraction > 0)
      .map((r) => `${r.file}: darkTexelFraction ${r.darkTexelFraction.toFixed(4)} at median ${r.medianLuminance.toFixed(1)}`);
    expect(dark, "atlases with baked-in dark regions — occlusion painted into base colour").toEqual([]);
  });

  it("(3) COUNTERWEIGHT (b): no two actors share one skin atlas", () => {
    requireRows();
    const shas = rows.map((r) => r.textureSha);
    const dupes = shas.filter((s, i) => shas.indexOf(s) !== i);
    expect(dupes, `skin atlases reused across actors (${new Set(shas).size} distinct across ${shas.length})`).toEqual([]);
  });
});
