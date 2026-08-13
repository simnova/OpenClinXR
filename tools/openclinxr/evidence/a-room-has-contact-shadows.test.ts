import { readdirSync } from "node:fs";
import { dirname, join, resolve as pathResolve } from "node:path";
import { fileURLToPath } from "node:url";
import { inflateSync } from "node:zlib";
import { NodeIO } from "@gltf-transform/core";
import { describe, expect, it } from "vitest";

/**
 * MADR 0055 decided that room realism is a MATERIAL problem, not a geometry problem, and ranked
 * **baked lighting and ambient occlusion as the single largest lever** — zero triangles, zero runtime
 * cost. #345–#348 landed the texture and material half of that decision. The light half never shipped.
 *
 * MEASURED 2026-08-12 on the shipped rooms, with NodeIO:
 *
 *   asset                          tris   materials   baseColorTex   **OCCLUSION**   roughness values
 *   ----------------------------   ----   ---------   ------------   -------------   ----------------
 *   ed-exam-bay-shell.glb           792      29            29            **0**              15
 *   infinigen-ed-exam-bay.glb       440       3             3            **0**               3
 *
 * **Not one of 32 materials across both rooms carries an occlusion texture.** Every surface is
 * uniformly lit: no darkening where wall meets floor, none under the bed, none in the corners. That
 * is the remaining half of the Fisher-Price look after #345–#348 fixed the flat-colour half — a room
 * with albedo but no contact shadow reads as a diagram of a room.
 *
 * WHAT THIS IS NOT. It is not a claim that the rooms are untextured — they are not, as of #345–#348,
 * and `a-room-is-lit-and-textured.test.ts` gates that. It is not a claim about punctual lights;
 * MADR 0055 deliberately separated baked occlusion (needs no light node) from whether the runtime
 * should carry `KHR_lights_punctual`, and bundling them would make one proof stand for two mechanisms.
 *
 * THE CHEAP FIXES THIS REFUSES, probed 2026-08-12 before planting:
 *
 *   treatment                                   | (1) AO present | (2) AO not a flat fill | (3) albedo kept | (4) tris pinned | result
 *   --------------------------------------------|----------------|------------------------|-----------------|-----------------|--------
 *   a) today                                    |   **FAIL**     |          n/a           |      pass       |      pass       | REFUSED
 *   b) attach a uniform white occlusion image   |     pass       |       **FAIL**         |      pass       |      pass       | REFUSED
 *   c) darken the base colour instead           |   **FAIL**     |          n/a           |      pass       |      pass       | REFUSED
 *   d) bake AO from the room's own geometry     |     pass       |         pass           |      pass       |      pass       | ALL PASS
 *
 * (b) is the one to worry about: an occlusion texture is trivially satisfiable by a 1×1 white PNG,
 * which is why clause (2) requires measured LUMINANCE VARIATION in the decoded pixels rather than the
 * texture's existence or its byte size. A byte floor would be the §8n error — it proves an encoder
 * ran, not that anything is shadowed.
 *
 * (c) is refused on purpose even though MADR 0055's own wording ("bake lighting and AO into the
 * albedo") permits it. Multiplying occlusion into base colour is unrecoverable: the albedo can never
 * be re-lit, re-tinted, or atlased afterwards, and MADR 0055 item 6 (atlas the generator's materials)
 * depends on that being possible. A separate `KHR` occlusion channel is the same bake, kept separable.
 * **If you believe that is the wrong call, say so in your report and implement it this way anyway.**
 *
 * THE CLAUSE-(2) DECODER IS VALIDATED AGAINST REAL DATA, because a variation gate that cannot read a
 * legitimate image would reject the correct fix. Pointed at the 32 base-colour textures that DO ship:
 * **32 of 32 decoded, 0 undecodable**, and 26 carry real variation. So a failure of clause (2) means
 * a flat map, not a blind instrument.
 *
 * That probe also corrected a claim of mine. I reported #345–#348 as "0 → 32 textured materials",
 * which is true and incomplete: **6 of the parametric shell's 29 base-colour textures decode at
 * sd = 0.00** — they are uniform-colour PNGs carrying no detail. Those materials are textured in the
 * glTF sense and flat in the visual sense. Not this contract's business, recorded so the next reader
 * does not inherit the rounder number.
 *
 * WHICH ARE REDS AND WHICH ARE NETS (#227): (1) is the RED and fails on both rooms. (2) is REACHABLE
 * ONLY once (1) passes and is a counterweight, not a current defect. (3) and (4) pass today and are
 * regression nets — the albedo work from #345–#348 must survive, and the triangle count is pinned so
 * "add contact shadows" cannot be satisfied by modelling shadow geometry.
 *
 * NOT TESTED: this asserts that occlusion VARIES across each room's materials. It does not assert the
 * darkening is in the anatomically right PLACE — an AO map with variation in the wrong region passes
 * clause (2) and would still grade wrong. Only a pixel grade settles that, which is the §11s trap
 * this rail has hit four times: a bounded quantity is not a correct shape. It also says nothing about
 * the room's DIMENSIONS (#342) or its prop set (#339).
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = pathResolve(HERE, "../../..");
const ENV_DIR = "apps/ui-xr/public/xr-assets/environment";

/** A real AO bake spans open surface to deep contact. A flat fill has sd 0. */
const MIN_LUMINANCE_SD = 6; // 0-255 scale

/** #345-#348 landed 32 base-colour textures across the two rooms. None may be lost. */
const MIN_BASE_COLOR_TEXTURES = { "ed-exam-bay-shell.glb": 29, "infinigen-ed-exam-bay.glb": 3 } as const;

/** Contact shadows are a material, not geometry — modelled shadow meshes are refused. */
const MAX_TRIANGLES = 2_000;

/** Minimal PNG reader: returns luminance sd over a subsample, or null if not a decodable PNG. */
function luminanceSd(bytes: Uint8Array): number | null {
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

  const prev = new Uint8Array(stride);
  const cur = new Uint8Array(stride);
  let n = 0;
  let sum = 0;
  let sumSq = 0;
  let p = 0;
  for (let y = 0; y < h; y++) {
    const filter = raw[p++]!;
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
    // Subsample every 4th pixel: AO maps are large and sd converges fast.
    for (let x = 0; x < w; x += 4) {
      const i = x * chans;
      const lum = chans >= 3 ? 0.299 * cur[i]! + 0.587 * cur[i + 1]! + 0.114 * cur[i + 2]! : cur[i]!;
      n++;
      sum += lum;
      sumSq += lum * lum;
    }
    prev.set(cur);
  }
  if (n < 16) return null;
  const mean = sum / n;
  return Math.sqrt(Math.max(0, sumSq / n - mean * mean));
}

type Row = {
  file: string;
  materials: number;
  withOcclusion: number;
  baseColorTextures: number;
  triangles: number;
  occlusionSds: number[];
  undecodable: number;
};

const io = new NodeIO();

async function measure(file: string): Promise<Row> {
  const doc = await io.read(join(REPO_ROOT, ENV_DIR, file));
  const mats = doc.getRoot().listMaterials();
  let withOcclusion = 0;
  let baseColorTextures = 0;
  const occlusionSds: number[] = [];
  let undecodable = 0;
  for (const m of mats) {
    if (m.getBaseColorTexture()) baseColorTextures++;
    const occ = m.getOcclusionTexture();
    if (!occ) continue;
    withOcclusion++;
    const img = occ.getImage();
    const sd = img ? luminanceSd(img) : null;
    if (sd === null) undecodable++;
    else occlusionSds.push(sd);
  }
  let triangles = 0;
  for (const mesh of doc.getRoot().listMeshes())
    for (const prim of mesh.listPrimitives()) triangles += (prim.getIndices()?.getCount() ?? 0) / 3;
  return { file, materials: mats.length, withOcclusion, baseColorTextures, triangles, occlusionSds, undecodable };
}

const files = readdirSync(join(REPO_ROOT, ENV_DIR)).filter((n: string) => n.endsWith(".glb"));
const rows: Row[] = await Promise.all(files.map((f: string) => measure(f)));

/** An empty enumeration must FAIL, never pass vacuously (§7t). */
function requireRows(): void {
  expect(rows.length, `shipped environment GLBs under ${ENV_DIR}`).toBeGreaterThanOrEqual(2);
}

describe("a room has contact shadows", () => {
  it.fails("(1) RED: every shipped room carries baked occlusion", () => {
    requireRows();
    expect(
      rows.filter((r) => r.withOcclusion === 0).map((r) => `${r.file}: ${r.materials} materials, 0 with occlusion`),
      "rooms with no occlusion texture on any material",
    ).toEqual([]);
  });

  it("(2) COUNTERWEIGHT: the occlusion map is not a flat fill", () => {
    // Refuses a 1x1 white PNG, or any uniform image, attached to satisfy (1). Reachable only once
    // (1) passes; until then there are no maps to measure and this asserts the honest nothing.
    requireRows();
    const flat = rows.flatMap((r) => [
      ...r.occlusionSds
        .filter((sd) => sd < MIN_LUMINANCE_SD)
        .map((sd) => `${r.file}: occlusion sd=${sd.toFixed(2)} (< ${MIN_LUMINANCE_SD})`),
      ...(r.undecodable > 0 ? [`${r.file}: ${r.undecodable} occlusion image(s) could not be decoded`] : []),
    ]);
    expect(flat, "occlusion maps with no luminance variation").toEqual([]);
  });

  it("(3) NET known-good: the #345-#348 albedo survives", () => {
    // Refuses buying occlusion by replacing the base-colour work that already landed.
    requireRows();
    const lost = rows
      .filter((r) => r.baseColorTextures < (MIN_BASE_COLOR_TEXTURES[r.file as keyof typeof MIN_BASE_COLOR_TEXTURES] ?? 1))
      .map((r) => `${r.file}: baseColorTextures=${r.baseColorTextures}`);
    expect(lost, "rooms that lost base-colour textures").toEqual([]);
  });

  it("(4) NET known-good: contact shadows are not modelled as geometry", () => {
    // Refuses satisfying "add contact shadows" with dark polygons in the corners.
    requireRows();
    const grew = rows.filter((r) => r.triangles > MAX_TRIANGLES).map((r) => `${r.file}: tris=${r.triangles}`);
    expect(grew, `rooms above ${MAX_TRIANGLES} triangles`).toEqual([]);
  });
});
