import { dirname, join, resolve as pathResolve } from "node:path";
import { fileURLToPath } from "node:url";
import { inflateSync } from "node:zlib";
import { NodeIO } from "@gltf-transform/core";
import { describe, expect, it } from "vitest";
import { classifyGarmentMeshName } from "../lib/garment-mesh-class.js";

/**
 * MPFB skin normal-map regression checks. Clauses (1)–(4) cover actors with an
 * intentional skin normal map. Clause (5) covers all actors, and (6) checks
 * actors whose maps were intentionally stripped.
 *
 * Historical measurements (2026-08-14, every fourth texel outside the atlas gutter).
 * Each map was bound at 1024² and scale 1. The columns are sd(R), flat texels,
 * and mean absolute difference between adjacent samples (adjacent-MAD).
 *
 * Actor    Original               Dermal rebake (#369)
 * Aisha    2.13 / 77.1% / 1.44    9.24 / 36.7% / 4.46
 * Kevin    2.08 / 77.7% / 1.38    8.90 / 36.8% / 4.29
 * Child    2.42 / 72.6% / 1.67   12.02 / 36.5% / 6.04
 *
 * No in-tree map qualified as a reference before the rebake (SS9h). The bake
 * replaced a missing MPFB_GEN_scale_factor input, restored the dermal Voronoi
 * detail, and baked hidden atlas polygons with the skin material. The resulting
 * maps supplied the known-good reference. Keep detail in the deterministic
 * MPFB2/Blender bake (D1/D9).
 *
 * Clauses (1)–(3) measure detail. The binding and albedo counterweights
 * catch texture deletion and painted-in shading (#227).
 *
 * NOT TESTED: visual appearance, anatomical accuracy, roughness (0.78 in both
 * measurements), or the generator's ability to reproduce the bake on this install.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = pathResolve(HERE, "../../../..");
const GENERATED = join(REPO_ROOT, "apps/ui-xr/public/generated-humanoids");

const ACTORS_WITH_NORMAL_MAP = ["mpfb-peds-nurse-kevin"] as const;
const ACTORS_WITHOUT_NORMAL_MAP = ["mpfb-ob-patient-aisha", "mpfb-peds-patient-child"] as const;
const ACTORS = [...ACTORS_WITH_NORMAL_MAP, ...ACTORS_WITHOUT_NORMAL_MAP];

/** Quantization tolerance around the flat normal (128,128,255). */
const FLAT_TOL = 2;
/** Flat-texel ceiling for a map carrying surface detail (#369). */
const MAX_FLAT_FRACTION = 0.40;
/** At 5° of tilt, random azimuth gives sd(R) ≈ 127·sin(5°)/√2 ≈ 7.8 (SS9s). */
const MIN_SD = 8;
/** Coherence ceiling below the original maps' 0.66–0.71 ratio (#369). */
const MAX_INCOHERENCE = 0.6;
/** Albedo luminance sd measured 2026-08-14, with 25% headroom (#369). */
const ALBEDO_SD_BASELINE: Record<string, number> = {
  "mpfb-ob-patient-aisha": 12.62,
  "mpfb-peds-nurse-kevin": 12.36,
  "mpfb-peds-patient-child": 15.30,
};
const ALBEDO_SD_TOLERANCE = 1.25;

type SkinRow = {
  actor: string;
  bound: boolean;
  normalScale: number;
  sd: number;
  flatFraction: number;
  /** adjacent-MAD / sd. Low = coherent surface, ~1.13 = white noise. */
  incoherence: number;
  albedoSd: number;
};

const io = new NodeIO();

/**
 * Minimal PNG decode — same chunk walk and filter reconstruction as
 * `a-room-has-contact-shadows.test.ts`, which is the proven in-tree reader (D1: no new dependency).
 * Returns interleaved 8-bit samples; null when the file is not 8-bit colour we can read.
 */
type Decoded = { w: number; h: number; chans: number; data: Uint8Array };

function decodePng(bytes: Uint8Array): Decoded | null {
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
  const out = new Uint8Array(stride * h);
  let prev = new Uint8Array(stride);
  let p = 0;
  for (let y = 0; y < h; y++) {
    const filter = raw[p++]!;
    const cur = out.subarray(y * stride, (y + 1) * stride);
    for (let x = 0; x < stride; x++) {
      const rawByte = raw[p + x]!;
      const a = x >= chans ? cur[x - chans]! : 0;
      const b = prev[x]!;
      const c = x >= chans ? prev[x - chans]! : 0;
      let v: number;
      if (filter === 0) v = rawByte;
      else if (filter === 1) v = rawByte + a;
      else if (filter === 2) v = rawByte + b;
      else if (filter === 3) v = rawByte + ((a + b) >> 1);
      else {
        const pa = Math.abs(b - c);
        const pb = Math.abs(a - c);
        const pc = Math.abs(a + b - 2 * c);
        v = rawByte + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c);
      }
      cur[x] = v & 0xff;
    }
    p += stride;
    prev = cur;
  }
  return { w, h, chans, data: out };
}

/** Sample every 4th texel, skipping fully-black atlas gutter (never a valid normal). */
function stats(png: Decoded): { sd: number; flatFraction: number; incoherence: number } {
  const rs: number[] = [];
  const adj: number[] = [];
  let flat = 0;
  for (let y = 0; y < png.h; y += 4) {
    let prev: number | null = null;
    for (let x = 0; x < png.w; x += 4) {
      const i = (y * png.w + x) * png.chans;
      const r = png.data[i]!;
      const g = png.data[i + 1] ?? r;
      const b = png.data[i + 2] ?? r;
      if (r === 0 && g === 0 && b === 0) {
        prev = null;
        continue;
      }
      rs.push(r);
      if (Math.abs(r - 128) <= FLAT_TOL && Math.abs(g - 128) <= FLAT_TOL && b >= 253 - FLAT_TOL) {
        flat += 1;
      }
      if (prev !== null) adj.push(Math.abs(r - prev));
      prev = r;
    }
  }
  if (rs.length === 0) return { sd: 0, flatFraction: 1, incoherence: 1 };
  const mean = rs.reduce((s, v) => s + v, 0) / rs.length;
  const sd = Math.sqrt(rs.reduce((s, v) => s + (v - mean) ** 2, 0) / rs.length);
  const mad = adj.length ? adj.reduce((s, v) => s + v, 0) / adj.length : 0;
  return { sd, flatFraction: flat / rs.length, incoherence: sd > 0 ? mad / sd : 1 };
}

function albedoLuminanceSd(png: Decoded): number {
  const L: number[] = [];
  for (let y = 0; y < png.h; y += 4) {
    for (let x = 0; x < png.w; x += 4) {
      const i = (y * png.w + x) * png.chans;
      const r = png.data[i]!;
      const g = png.data[i + 1] ?? r;
      const b = png.data[i + 2] ?? r;
      if (r === 0 && g === 0 && b === 0) continue;
      L.push(0.2126 * r + 0.7152 * g + 0.0722 * b);
    }
  }
  if (!L.length) return 0;
  const m = L.reduce((s, v) => s + v, 0) / L.length;
  return Math.sqrt(L.reduce((s, v) => s + (v - m) ** 2, 0) / L.length);
}

async function measure(actor: string): Promise<SkinRow | null> {
  const doc = await io.read(join(GENERATED, `${actor}.glb`));
  for (const material of doc.getRoot().listMaterials()) {
    // Skin materials via the shared body class, not a /^mpfb_skin_/ literal.
    if (classifyGarmentMeshName(material.getName() ?? "") !== "body") continue;
    const normal = material.getNormalTexture();
    const base = material.getBaseColorTexture();
    const normalImage = normal?.getImage();
    const baseImage = base?.getImage();
    const normalPng = normalImage ? decodePng(normalImage) : null;
    const basePng = baseImage ? decodePng(baseImage) : null;
    const s = normalPng ? stats(normalPng) : { sd: 0, flatFraction: 1, incoherence: 1 };
    return {
      actor,
      bound: Boolean(normal),
      normalScale: material.getNormalScale?.() ?? 0,
      sd: s.sd,
      flatFraction: s.flatFraction,
      incoherence: s.incoherence,
      albedoSd: basePng ? albedoLuminanceSd(basePng) : 0,
    };
  }
  return null;
}

const rows = (await Promise.all(ACTORS.map(measure))).filter((r): r is SkinRow => r !== null);
const normalRows = rows.filter((r) => ACTORS_WITH_NORMAL_MAP.some((actor) => actor === r.actor));

/**
 * An empty enumeration must FAIL, never pass vacuously (SS7t). Plain `it` on purpose: an `it.fails`
 * cannot guard its own vacuity — it is satisfied by ANY failure, including this guard throwing.
 */
function requireMeasured(): void {
  expect(rows.length, `MPFB actors with an mpfb_skin_* material (of ${ACTORS.length})`).toBe(
    ACTORS.length,
  );
}

describe("the skin normal map carries surface detail", () => {
  it("(1) RED: the map is not mostly the flat no-op value", () => {
    requireMeasured();
    const blank = normalRows
      .filter((r) => r.flatFraction > MAX_FLAT_FRACTION)
      .map(
        (r) =>
          `${r.actor}: ${(r.flatFraction * 100).toFixed(1)}% of texels are within ±${FLAT_TOL} of a perfectly flat normal (limit ${(MAX_FLAT_FRACTION * 100).toFixed(0)}%)`,
      );
    expect(blank, "skin normal maps that are mostly no-op").toEqual([]);
  });

  it("(2) RED: the map encodes at least five degrees of surface slope", () => {
    requireMeasured();
    const flat = normalRows
      .filter((r) => r.sd < MIN_SD)
      .map(
        (r) =>
          `${r.actor}: sd(R)=${r.sd.toFixed(2)} ≈ ${((Math.asin((r.sd * Math.SQRT2) / 127) * 180) / Math.PI).toFixed(1)}° of slope (need sd >= ${MIN_SD}, i.e. >= 5°)`,
      );
    expect(flat, "skin normal maps describing a mirror").toEqual([]);
  });

  it("(3) RED: the map is spatially coherent, not dither", () => {
    // Spatial coherence rejects random noise that could pass (1) and (2).
    requireMeasured();
    const noisy = normalRows
      .filter((r) => r.incoherence > MAX_INCOHERENCE)
      .map(
        (r) =>
          `${r.actor}: adjacent-MAD/sd = ${r.incoherence.toFixed(2)} (limit ${MAX_INCOHERENCE}; white noise ≈ 1.13) — neighbouring texels are uncorrelated`,
      );
    expect(noisy, "skin normal maps that are noise rather than surface").toEqual([]);
  });

  it("(4) COUNTERWEIGHT: the normal texture stays bound and scaled", () => {
    // Preserve the original binding and scale (#369).
    requireMeasured();
    const unbound = normalRows
      .filter((r) => !r.bound || r.normalScale < 1)
      .map((r) => `${r.actor}: bound=${r.bound} normalScale=${r.normalScale} (need bound with scale >= 1)`);
    expect(unbound, "actors whose normal texture was unbound or scaled down").toEqual([]);
  });

  it("(5) COUNTERWEIGHT: shading was not baked into the albedo instead", () => {
    // Check albedo across both texture policies.
    requireMeasured();
    const painted = rows
      .filter((r) => r.albedoSd > (ALBEDO_SD_BASELINE[r.actor] ?? 0) * ALBEDO_SD_TOLERANCE)
      .map(
        (r) =>
          `${r.actor}: albedo luminance sd ${r.albedoSd.toFixed(2)} vs baseline ${ALBEDO_SD_BASELINE[r.actor]} (limit ×${ALBEDO_SD_TOLERANCE}) — detail was painted into base colour`,
      );
    expect(painted, "actors whose albedo gained baked-in shading").toEqual([]);
  });

  // Intentional JSON-only strips on 2026-10-10: 10768617f (aisha-normal-off-proof.mjs)
  // and 281364d88 (child-normal-off-proof.mjs), both under ../factory-skin-publication/.
  it.each(ACTORS_WITHOUT_NORMAL_MAP)("(6) GUARD: %s has no normalTexture", async (actor) => {
    const doc = await io.read(join(GENERATED, `${actor}.glb`));
    // Skin = material or mesh in the body class; hair normal maps are intentional (c613e86e8).
    const isBody = (n: string | null) => classifyGarmentMeshName(n ?? "") === "body";
    const boundMaterials = doc.getRoot().listMeshes().flatMap((mesh) =>
      mesh.listPrimitives().map((p) => p.getMaterial())
        .filter((m) => m?.getNormalTexture() && (isBody(mesh.getName()) || isBody(m.getName()))),
    );
    expect(
      boundMaterials.map((material) => material?.getName()),
      `normal map restored: move ${actor} back into the positive set; do not widen or delete this guard`,
    ).toEqual([]);
  });
});
