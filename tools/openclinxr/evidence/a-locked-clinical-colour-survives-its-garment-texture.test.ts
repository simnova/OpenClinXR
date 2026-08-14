import { existsSync, readFileSync } from "node:fs";
import { inflateSync } from "node:zlib";
import { dirname, join, resolve as pathResolve } from "node:path";
import { fileURLToPath } from "node:url";
import { NodeIO } from "@gltf-transform/core";
import { describe, expect, it } from "vitest";

/**
 * **A garment can carry a locked clinical colour, or it can carry its own authored texture. It cannot
 * carry both, because glTF multiplies them.**
 *
 * Measured 2026-08-14 on `mpfb-peds-nurse-kevin.glb`, read with NodeIO. The control is already inside
 * the file — two garments with a byte-identical colour factor, one textured and one not:
 *
 *   garment            | baseColorFactor        | baseColorTexture      | effective brightness
 *   -------------------|------------------------|-----------------------|---------------------
 *   cargo_pants        | [0.05, 0.48, 0.52]     | none                  | **100%**
 *   fisherman_sweater  | [0.05, 0.48, 0.52]     | shirt-knit, mean 0.205| **21%**
 *
 * `0.48 x 0.205 = 0.098`. The scrub hue survives as a HUE and loses 90% of its BRIGHTNESS, so the
 * nurse's newly-fitted long sleeve (#199) renders near-black where the data says scrub teal.
 *
 * ## BOTH MECHANISMS ARE INDIVIDUALLY CORRECT — THIS IS A COMPOSITION DEFECT
 *
 *   - the locked clinical colour IS applied; `materialize_mpfb_humanoid_candidate.py` sets the scrub
 *     factor and #199's ledger entry says so truthfully
 *   - the #360 path consumes the garment's own declared `.mhmat` -> `shirt-knit.png` as
 *     `baseColorTexture`, which is why the knit reads as knit rather than as flat vinyl
 *
 * Neither is a bug. Their product is. A fix that deletes either one loses something real, which is why
 * clauses (2) and (3) exist.
 *
 * ## WHY THIS IS NOT ONE GARMENT'S PROBLEM
 *
 * Any cached garment that declares its own `.mhmat` does this the moment a clinical colour is locked
 * onto it. `garments-keep-their-authored-texture.test.ts` requires authored textures to survive and
 * `a-station-cast-is-visually-separable.test.ts` requires role colours to stay distinguishable — today
 * those two are jointly satisfiable **only by garments with no texture**, which is why the defect
 * appeared on the first textured clinical garment the pipeline ever produced.
 *
 * ## THE THRESHOLD IS A MIDPOINT, NOT A FIT (SS9s)
 *
 * 50% is not calibrated from the observation. It is the point at which a rendered garment stops being
 * nearer its intended colour than it is to black. It does not reference the treatment: a texture
 * normalised to its own mean lands near 100% whether or not anyone tuned it, and today's 21% misses by
 * 2.4x. Compare a fitted threshold — "half the observed 21%" — which any nonzero value would clear.
 *
 * ## THE CHEAP FIXES THIS REFUSES
 *
 *   treatment                                        | (1) colour | (2) weave kept | (3) known-good | result
 *   -------------------------------------------------|------------|----------------|----------------|--------
 *   a) today                                         | **FAIL**   |      pass      |      pass      | REFUSED
 *   b) drop the texture, keep the factor             |    pass    |    **FAIL**    |      pass      | REFUSED
 *   c) darken the PANTS too, so both "match"         |    pass    |      pass      |    **FAIL**    | REFUSED
 *   d) normalise the texture by its own mean, or     |    pass    |      pass      |      pass      | ALL PASS
 *      bake the factor into the texture              |            |                |                |
 *
 * **(b) is the one to watch and it is why clause (2) exists.** Deleting `shirt-knit` makes the sweater
 * render at the full locked colour and instantly satisfies (1) — while throwing away the weave that
 * #360 was built to deliver. It is the cheapest possible green.
 *
 * **(c) is why clause (3) exists.** Consistency is achievable by degrading the garment that works.
 * Clause (3) pins the untextured pants at their authored factor AND at full brightness, so "make them
 * match" cannot be reached downward.
 *
 * **This contract does NOT prescribe the method.** Normalising the texture by its mean and baking the
 * factor into the texture both pass, and so would anything else that lands the same numbers. Which one
 * is the implementer's call — record it.
 *
 * WHICH ARE REDS AND WHICH ARE NETS (#227): (1) is the sole RED and fails today at 21%. (2) and (3)
 * pass today and are counterweights. They are independent of what (1) measures — fixing a colour
 * composition cannot delete a texture or rewrite the pants' authored factor unless done by (b) or (c).
 *
 * NOT TESTED:
 *   - **The runtime's own material path.** This reads the glTF, not three.js (SS6v says those can
 *     disagree). The lit capture agrees with the arithmetic, which is evidence, not proof of the code path.
 *   - **Whether normalising crushes the weave.** Never run. It may flatten contrast or shift hue.
 *   - **The other cached garments.** Only this asset's four materials were read; the pack's six
 *     unextracted garments were not checked for declared `.mhmat`s.
 *   - **Any clinical claim about what colour a nurse should wear.** This says the shipped colour does
 *     not match the locked one, never that the locked one is right.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = pathResolve(HERE, "../../..");
/** Overridable so a destructive probe can point the same logic at a doctored asset. */
const ASSET =
  process.env.OPENCLINXR_COLOUR_PROBE_GLB ??
  join(REPO_ROOT, "apps/ui-xr/public/generated-humanoids/mpfb-peds-nurse-kevin.glb");

/** The locked scrub colour the materializer applies to clinical roles. */
const CLINICAL_RGB = [0.05, 0.48, 0.52] as const;
const LOCK_TOLERANCE = 0.02;
/** Nearer its own colour than to black. Not derived from the observed 21%. */
const MIN_EFFECTIVE_BRIGHTNESS = 0.5;
/** shirt-knit measures 0.156 today; a deleted or flat texture cannot clear this. */
const MIN_TEXTURE_SD = 0.05;

type Garment = {
  name: string;
  factor: number[];
  locked: boolean;
  hasTexture: boolean;
  texMean: number;
  texSD: number;
  effectiveBrightness: number;
};

/** Mean and sd of a PNG's luminance over opaque texels. Same reader as the AO and face probes. */
function textureStats(bytes: Uint8Array): { mean: number; sd: number } | null {
  let w = 0, h = 0, depth = 0, colour = -1;
  const idat: Uint8Array[] = [];
  let off = 8;
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  while (off + 8 <= bytes.length) {
    const len = dv.getUint32(off);
    const type = String.fromCharCode(bytes[off + 4]!, bytes[off + 5]!, bytes[off + 6]!, bytes[off + 7]!);
    if (type === "IHDR") {
      w = dv.getUint32(off + 8); h = dv.getUint32(off + 12);
      depth = bytes[off + 16]!; colour = bytes[off + 17]!;
    } else if (type === "IDAT") idat.push(bytes.subarray(off + 8, off + 8 + len));
    else if (type === "IEND") break;
    off += 12 + len;
  }
  const chans = colour === 0 ? 1 : colour === 2 ? 3 : colour === 4 ? 2 : colour === 6 ? 4 : 0;
  if (depth !== 8 || !chans || !w) return null;
  let raw: Buffer;
  try { raw = inflateSync(Buffer.concat(idat.map((c) => Buffer.from(c)))); } catch { return null; }
  const stride = w * chans;
  if (raw.length < (stride + 1) * h) return null;
  let prev = new Uint8Array(stride), p = 0;
  const vals: number[] = [];
  for (let y = 0; y < h; y += 1) {
    const f = raw[p++]!;
    const cur = new Uint8Array(stride);
    for (let x = 0; x < stride; x += 1) {
      const rb = raw[p + x]!;
      const a = x >= chans ? cur[x - chans]! : 0, b = prev[x]!, c = x >= chans ? prev[x - chans]! : 0;
      let v: number;
      if (f === 0) v = rb; else if (f === 1) v = rb + a; else if (f === 2) v = rb + b;
      else if (f === 3) v = rb + ((a + b) >> 1);
      else { const pa = Math.abs(b - c), pb = Math.abs(a - c), pc = Math.abs(a + b - 2 * c);
             v = rb + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c); }
      cur[x] = v & 0xff;
    }
    p += stride; prev = cur;
    if (y % 4 !== 0) continue;
    for (let x = 0; x < w; x += 4) {
      const i = x * chans;
      if (chans === 4 && cur[i + 3]! < 128) continue;   // skip transparent texels
      vals.push((cur[i]! + (cur[i + 1] ?? cur[i]!) + (cur[i + 2] ?? cur[i]!)) / 3);
    }
  }
  if (!vals.length) return null;
  const mean = vals.reduce((s, v) => s + v, 0) / vals.length;
  const sd = Math.sqrt(vals.reduce((s, v) => s + (v - mean) ** 2, 0) / vals.length);
  return { mean: mean / 255, sd: sd / 255 };
}

async function readGarments(): Promise<Garment[]> {
  if (!existsSync(ASSET)) return [];
  const doc = await new NodeIO().readBinary(readFileSync(ASSET));
  const out: Garment[] = [];
  for (const m of doc.getRoot().listMaterials()) {
    const name = m.getName();
    if (!/makeclothes_library/u.test(name)) continue;
    const factor = Array.from(m.getBaseColorFactor()).slice(0, 3);
    const locked = CLINICAL_RGB.every((c, i) => Math.abs((factor[i] ?? -9) - c) < LOCK_TOLERANCE);
    const img = m.getBaseColorTexture()?.getImage();
    const stats = img ? textureStats(img) : null;
    out.push({
      name: name.replace(/^mat_makeclothes_library_/u, ""),
      factor, locked,
      hasTexture: Boolean(img),
      texMean: stats?.mean ?? 1,
      texSD: stats?.sd ?? 0,
      effectiveBrightness: stats?.mean ?? 1,
    });
  }
  return out;
}

const garments = await readGarments();
const locked = garments.filter((g) => g.locked);
const sweater = garments.find((g) => /sweater/u.test(g.name));
const pants = garments.find((g) => /cargo_pants/u.test(g.name));

/**
 * An empty enumeration must FAIL, never pass vacuously (SS7t). Plain `it` on purpose: an `it.fails`
 * cannot guard its own vacuity — it is satisfied by ANY failure, including this guard throwing.
 */
function requireMeasured(): void {
  expect(existsSync(ASSET), `${ASSET} exists`).toBe(true);
  expect(garments.length, `MakeClothes garment materials found in ${ASSET}`).toBeGreaterThanOrEqual(2);
  // Presence BY NAME, not by lock state. A destructive probe that darkened the pants first tripped a
  // `locked.length >= 2` guard here, so the contract went red for the right reason with the WRONG
  // diagnostic — "only 1 locked garment found" reads as a broken enumeration, not as "you rewrote the
  // control". Each clause now owns the lock assertion for its own subject.
  expect(sweater, `the fisherman sweater material is present in ${ASSET}`).toBeDefined();
  expect(pants, `the cargo pants material is present in ${ASSET}`).toBeDefined();
}

describe("a locked clinical colour survives its garment texture", () => {
  it.fails("(1) RED: every clinical-coloured garment renders at its locked brightness", () => {
    requireMeasured();
    // Unlocking the sweater would empty `locked` and make this clause vacuous. Pin it.
    expect(
      sweater!.locked,
      `${sweater!.name} must still carry the locked clinical colour [${CLINICAL_RGB.join(", ")}] — unlocking it would empty this clause rather than satisfy it`,
    ).toBe(true);
    const dim = locked
      .filter((g) => g.effectiveBrightness < MIN_EFFECTIVE_BRIGHTNESS)
      .map(
        (g) =>
          `${g.name}: factor [${g.factor.map((v) => v.toFixed(2)).join(", ")}] x texture mean ${g.texMean.toFixed(3)} = ${(g.effectiveBrightness * 100).toFixed(0)}% brightness — renders nearer black than its locked colour`,
      );
    expect(dim, "clinical garments whose texture swallows the locked colour").toEqual([]);
  });

  it("(2) COUNTERWEIGHT: the authored weave is not deleted to reach the colour", () => {
    // Refuses (b): dropping shirt-knit makes the sweater render at the full locked colour and greens
    // (1) instantly, while throwing away the texture #360 exists to deliver. Cheapest possible green.
    requireMeasured();
    expect(
      sweater!.hasTexture,
      `${sweater!.name} must keep a baseColorTexture — removing it is the cheap green this clause refuses`,
    ).toBe(true);
    expect(
      sweater!.texSD,
      `${sweater!.name} texture luminance sd (0.156 measured 2026-08-14) — a flattened or solid-colour replacement cannot carry the weave`,
    ).toBeGreaterThanOrEqual(MIN_TEXTURE_SD);
  });

  it("(3) COUNTERWEIGHT known-good: the untextured garment keeps its authored colour and full brightness", () => {
    // Refuses (c): "make them match" is reachable downward by darkening the pants. The pants are the
    // control this whole contract is calibrated against (SS9h) and must not be moved to fit.
    requireMeasured();
    const drift = CLINICAL_RGB.map((c, i) =>
      Math.abs((pants!.factor[i] ?? -9) - c) < LOCK_TOLERANCE
        ? null
        : `channel ${i}: ${pants!.factor[i]} vs authored ${c}`,
    ).filter(Boolean);
    expect(drift, `${pants!.name} authored clinical factor rewritten`).toEqual([]);
    expect(
      pants!.effectiveBrightness,
      `${pants!.name} must stay at full brightness — darkening the working garment to match the broken one is not consistency`,
    ).toBeGreaterThanOrEqual(MIN_EFFECTIVE_BRIGHTNESS);
  });
});
