import { dirname, join, resolve as pathResolve } from "node:path";
import { fileURLToPath } from "node:url";
import { inflateSync } from "node:zlib";
import { NodeIO } from "@gltf-transform/core";
import { describe, expect, it } from "vitest";

/**
 * **Every MPFB actor ships a 1024² skin normal map, correctly bound, containing essentially nothing.**
 * This is not a missing-asset defect and not a wiring defect. The plumbing is right and there is no
 * signal travelling down it, which is why the skin grades as matte plastic.
 *
 * Measured 2026-08-14 on the shipped bytes, sampling every 4th texel and excluding empty atlas gutter:
 *
 *   actor    normalTexture   normalScale   sd(R)   flat texels   adjacent-MAD   roughness
 *   -------  --------------  -----------  ------  ------------  -------------  ---------
 *   aisha    BOUND 1024²          1        2.13      77.1%           1.44       0.78 flat
 *   kevin    BOUND 1024²          1        2.08      77.7%           1.38       0.78 flat
 *   child    BOUND 1024²          1        2.42      72.6%           1.67       0.78 flat
 *
 * "flat texels" = within ±2 of a perfectly flat tangent-space normal (128,128,255). Over seventy per
 * cent of every map is literally the no-op value; the rest deviates by about two levels out of 255.
 *
 * ## THE BAND IS DERIVED FROM GEOMETRY, NOT FROM THE OBSERVATION (SS9s)
 *
 * A tangent-space normal map stores a unit vector, so a surface tilted by θ from the texel normal
 * deviates R and G from 128 by `127·sin(θ)`, and across a random azimuth the standard deviation is
 * about `127·sin(θ)/√2`:
 *
 *   slope  1.3°  ->  sd ≈  2.0     <- WHAT SHIPS TODAY. That is flat to within rounding.
 *   slope  5.0°  ->  sd ≈  7.8
 *   slope 10.0°  ->  sd ≈ 15.6
 *   slope 15.0°  ->  sd ≈ 23.2
 *
 * So `sd > 8` is not a number chosen to be just out of reach — it is the encoding's own answer to
 * "does this surface tilt by at least five degrees anywhere". Pores, wrinkles and blemishes are all
 * well above that. Today's maps fail it by 4×, and they fail it because they describe a mirror.
 *
 * ## THERE IS NO KNOWN-GOOD COLUMN IN THIS TREE, AND THAT IS ITSELF THE FINDING (SS9h)
 *
 * SS9h asks for a known-good beside the broken one. I looked: **the only three bound normal maps in the
 * shipped assets are these three, and all three are blank.** No garment, footwear or library asset
 * binds one at all. So there is no in-tree reference and the band above had to be derived externally,
 * which is exactly the case SS9h says to declare rather than paper over. If a later slice produces one
 * good map, it becomes the reference and this comment should be replaced with it.
 *
 * ## THE CHEAP FIXES THIS REFUSES
 *
 *   treatment                                        | (1) flat | (2) slope | (3) coherent | (4) bound | (5) albedo | result
 *   -------------------------------------------------|----------|-----------|--------------|-----------|------------|--------
 *   a) today                                         | **FAIL** | **FAIL**  |   **FAIL**   |   pass    |    pass    | REFUSED
 *   b) delete the blank map, it does nothing anyway  |   pass   |   pass    |     pass     | **FAIL**  |    pass    | REFUSED
 *   c) fill it with random noise to move the numbers |   pass   |   pass    |   **FAIL**   |   pass    |    pass    | REFUSED
 *   d) paint shading into the albedo instead         | **FAIL** | **FAIL**  |   **FAIL**   |   pass    |  **FAIL**  | REFUSED
 *   e) bake real surface detail into the normal map  |   pass   |   pass    |     pass     |   pass    |    pass    | ALL PASS
 *
 * **(c) is the one to watch and it is why clause (3) exists.** Clauses (1) and (2) are both satisfied
 * instantly by `rand()` — noise is not flat and has a large sd. But a baked surface is *spatially
 * coherent*: neighbouring texels describe neighbouring bits of skin, so the mean absolute difference
 * between adjacent samples is small compared with the global spread. White noise has
 * `adjacent-MAD ≈ 1.13·sd`; a coherent map is far below that. Today's ratio is **0.66–0.71**, which is
 * itself the signature of dither rather than detail — so (3) is a RED, not a counterweight.
 *
 * **(d) is why clause (5) exists.** Painting creases and shadows into the base colour looks better in
 * one lighting setup and wrong in every other, and it is the traditional way to fake this. Albedo
 * luminance sd is pinned per actor.
 *
 * ## WHY THIS IS A DARK-FACTORY SLICE (D1/D9)
 *
 * Do NOT hand-author a normal map. MPFB2 and Blender can bake one; the binding, the `normalScale`, the
 * texture slot and the export path all already work. The step moving from absent to deterministic is a
 * bake, and once it exists every future actor gets it with no per-actor work.
 *
 * WHICH ARE REDS AND WHICH ARE NETS (#227): (1), (2) and (3) are REDS and fail on 3 of 3 actors today.
 * (4) and (5) are counterweights and pass today. They are independent of what the REDs measure: baking
 * detail into a normal map cannot unbind the texture and cannot change the albedo.
 *
 * NOT TESTED:
 *   - **That the skin then looks like skin.** This bounds the map's information content, not
 *     appearance. Only a graded capture settles that, and that grade is not the worker's.
 *   - **Roughness.** Every actor ships a uniform 0.78 with no roughness map. A perfect normal map under
 *     uniform roughness will still read partly synthetic. Deliberately out of scope — measured and
 *     recorded on #369, not asserted here.
 *   - **Whether MPFB2 can bake this on this install.** The generator's capability is unverified; a
 *     `reject_measured` close naming what was tried is an acceptable outcome.
 *   - **Anatomical correctness of the detail.** A coherent map of the wrong person's pores passes.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = pathResolve(HERE, "../../..");
const GENERATED = join(REPO_ROOT, "apps/ui-xr/public/generated-humanoids");

const ACTORS = ["mpfb-ob-patient-aisha", "mpfb-peds-nurse-kevin", "mpfb-peds-patient-child"] as const;

/** Within this of (128,128,255) a texel is the no-op value. */
const FLAT_TOL = 2;
/** Today 72.6-77.7%. A map that describes a surface cannot be mostly no-op. */
const MAX_FLAT_FRACTION = 0.40;
/** 127·sin(5°)/√2 ≈ 7.8 — the encoding's own answer to "does this tilt at least five degrees". */
const MIN_SD = 8;
/** White noise sits at ≈1.13; a spatially coherent bake is well below. Today 0.66-0.71. */
const MAX_INCOHERENCE = 0.6;
/** Albedo luminance sd measured 2026-08-14; +25% headroom before it reads as baked-in shading. */
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
    if (!/^mpfb_skin_/.test(material.getName() ?? "")) continue;
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
  it.fails("(1) RED: the map is not mostly the flat no-op value", () => {
    requireMeasured();
    const blank = rows
      .filter((r) => r.flatFraction > MAX_FLAT_FRACTION)
      .map(
        (r) =>
          `${r.actor}: ${(r.flatFraction * 100).toFixed(1)}% of texels are within ±${FLAT_TOL} of a perfectly flat normal (limit ${(MAX_FLAT_FRACTION * 100).toFixed(0)}%)`,
      );
    expect(blank, "skin normal maps that are mostly no-op").toEqual([]);
  });

  it.fails("(2) RED: the map encodes at least five degrees of surface slope", () => {
    requireMeasured();
    const flat = rows
      .filter((r) => r.sd < MIN_SD)
      .map(
        (r) =>
          `${r.actor}: sd(R)=${r.sd.toFixed(2)} ≈ ${((Math.asin((r.sd * Math.SQRT2) / 127) * 180) / Math.PI).toFixed(1)}° of slope (need sd >= ${MIN_SD}, i.e. >= 5°)`,
      );
    expect(flat, "skin normal maps describing a mirror").toEqual([]);
  });

  it.fails("(3) RED: the map is spatially coherent, not dither", () => {
    // Refuses (c): rand() satisfies (1) and (2) instantly. A baked surface has neighbouring texels
    // describing neighbouring skin, so adjacent-MAD is small against the global spread; white noise
    // sits at ≈1.13. Today's 0.66-0.71 is the signature of dither, which is why this is a RED.
    requireMeasured();
    const noisy = rows
      .filter((r) => r.incoherence > MAX_INCOHERENCE)
      .map(
        (r) =>
          `${r.actor}: adjacent-MAD/sd = ${r.incoherence.toFixed(2)} (limit ${MAX_INCOHERENCE}; white noise ≈ 1.13) — neighbouring texels are uncorrelated`,
      );
    expect(noisy, "skin normal maps that are noise rather than surface").toEqual([]);
  });

  it("(4) COUNTERWEIGHT: the normal texture stays bound and scaled", () => {
    // Refuses (b): deleting a map that "does nothing anyway" makes every RED pass and removes the
    // slot a real bake would fill. The binding already works — that is the point.
    requireMeasured();
    const unbound = rows
      .filter((r) => !r.bound || r.normalScale < 1)
      .map((r) => `${r.actor}: bound=${r.bound} normalScale=${r.normalScale} (need bound with scale >= 1)`);
    expect(unbound, "actors whose normal texture was unbound or scaled down").toEqual([]);
  });

  it("(5) COUNTERWEIGHT: shading was not baked into the albedo instead", () => {
    // Refuses (d): painting creases into base colour looks right in one light and wrong in all others.
    requireMeasured();
    const painted = rows
      .filter((r) => r.albedoSd > (ALBEDO_SD_BASELINE[r.actor] ?? 0) * ALBEDO_SD_TOLERANCE)
      .map(
        (r) =>
          `${r.actor}: albedo luminance sd ${r.albedoSd.toFixed(2)} vs baseline ${ALBEDO_SD_BASELINE[r.actor]} (limit ×${ALBEDO_SD_TOLERANCE}) — detail was painted into base colour`,
      );
    expect(painted, "actors whose albedo gained baked-in shading").toEqual([]);
  });
});
