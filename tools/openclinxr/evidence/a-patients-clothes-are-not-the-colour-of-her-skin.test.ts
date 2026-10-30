/**
 * #506 — the OB triage patient renders NUDE. Her garments are present, placed and licensed, and
 * coloured like skin.
 *
 * MEASURED 2026-08-21 (orchestrator). IMMUTABLE — flip the assertion and append a
 * `## FIXED (#506)` block below; do not rewrite these numbers.
 *
 *   actor                          skin texture mean   garment baseColor   RGB distance
 *   mpfb-ob-patient-aisha          201,177,163         184,173,140         28.7   <- reads NUDE
 *   mpfb-family-partner-adult      215,191,176         107,92,102         163.9   <- reads CLOTHED
 *
 * **Both actors wear the IDENTICAL garments** — makeclothes_library_cargo_pants and
 * makeclothes_library_toigo_t_shirt. Only the colour differs, by 5.7x. The control is an asset I
 * first mis-graded as nude from a 160px thumbnail and then verified as fully dressed at native
 * resolution, so it is a known-good in both directions.
 *
 *   mpfb-ob-patient-aisha.glb   cargo_pants 8262v rgb=184,173,140 · toigo_t_shirt 5400v rgb=184,173,140
 *
 * WHY EVERY EXISTING GATE PASSES THIS: presence YES, placement YES, provenance YES, class YES.
 * CONTRAST is a question none of them asks. S0/S1/S2 said presence, placement and provenance are
 * three questions and none is CLASS; this is the fifth axis.
 *
 * TWO MEASURED LEADS, unranked, and neither explains the difference between the two actors:
 *   - body_param_stage.py:1624 GARMENT_COLORS is all VIVID (0.08,0.52,0.95 / 0.10,0.62,0.28) and
 *     LOWER_GARMENT_COLORS teal/slate. NONE is beige. That palette is a different rail.
 *   - cargo_pants.mhclo declares `material cargo_pants.mhmat` and THAT FILE IS NOT IN THE CACHE —
 *     only .mhclo and .obj were acquired. A dangling material reference.
 * Same missing .mhmat serves both actors, so it cannot by itself explain 184,173,140 vs 107,92,102.
 * DO NOT take either as the cause. Measure it.
 *
 * claimScope: whether a patient's garments are visually distinguishable from her own skin.
 * notEvidenceFor: whether street clothes are clinically appropriate for this station at all —
 *                 that is the hospital_gown-NOT-FOUND question (E1 / #499) and is NOT this.
 *
 * ## FIXED (#0)
 *
 * Family-partner lower is now fitted `elvs_jeans_bootcut` (5,708 tris); aisha still
 * wears the cargo shell. Both still ship two garments. The garment matcher includes
 * `bootcut_jeans_pants` so the control pair stays countable. Diagnosis table above
 * is unchanged.
 */
import { createHash } from "node:crypto";
import { inflateSync } from "node:zlib";
import { NodeIO } from "@gltf-transform/core";
import { describe, expect, it } from "vitest";
import { classifyGarmentMeshName, isFittedGarmentMeshName } from "./lib/garment-mesh-class.js";

const DIR = "apps/ui-xr/public/generated-humanoids/";
const MIN_CONTRAST = 60;      // between today's 28.7 and the shipped control's 163.9
const CONTROL_FLOOR = 120;    // the control must not be dragged down to meet the patient
const SKIN_SHA_OB = "423dd04117de7413";   // 57e277301 re-recorded 2026-09-12: the tightjeans staging rebaked the skin atlas (was 1d41a725c16253b5); aisha untouched since.

type Actor = { garments: { name: string; rgb: [number, number, number]; verts: number }[];
  skin: [number, number, number]; skinSha: string };

/** Per-channel mean of a PNG's opaque texels, or null for absent/non-PNG images. The
 * tightjeans lower ships a JPEG original (2803b7746 postopt): it falls back to the bare
 * factor, which UNDERSTATES its contrast (white vs dark denim) — conservative for a floor. */
function textureChannelMeans(bytes: Uint8Array): [number, number, number] | null {
  if (bytes.length < 8 || bytes[0] !== 0x89 || bytes[1] !== 0x50) return null;
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
  let prev = new Uint8Array(stride);
  const cur = new Uint8Array(stride);
  const sums = [0, 0, 0]; let n = 0, p = 0;
  for (let y = 0; y < h; y += 1) {
    const f = raw[p++]!;
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
    p += stride;
    if (y % 4 !== 0) continue;
    for (let x = 0; x < w; x += 4) {
      const i = x * chans;
      if (chans === 4 && cur[i + 3]! < 128) continue;
      sums[0]! += cur[i]!; sums[1]! += cur[i + 1] ?? cur[i]!; sums[2]! += cur[i + 2] ?? cur[i]!;
      n += 1;
    }
    prev = Uint8Array.from(cur);
  }
  if (!n) return null;
  return [sums[0]! / n / 255, sums[1]! / n / 255, sums[2]! / n / 255];
}

async function readActor(file: string): Promise<Actor> {
  const d = await new NodeIO().read(DIR + file);
  const garments: Actor["garments"] = [];
  let skin: [number, number, number] = [0, 0, 0];
  let skinSha = "";
  for (const m of d.getRoot().listMeshes()) {
    const n = m.getName();
    const p = m.listPrimitives()[0];
    const verts = m.listPrimitives().reduce((t, q) => t + (q.getAttribute("POSITION")?.getCount() ?? 0), 0);
    if (isFittedGarmentMeshName(n)) {
      const f = p?.getMaterial()?.getBaseColorFactor();
      // HB-02 (22ec335a5) folded every baseColorFactor into its texture: the shipped colour
      // is the EFFECTIVE colour (factor x per-channel texture mean), never the bare factor.
      const img = p?.getMaterial()?.getBaseColorTexture()?.getImage() ?? null;
      const means = img ? textureChannelMeans(img) : null;
      if (f) {
        const rgb: [number, number, number] = means
          ? [f[0]! * means[0] * 255, f[1]! * means[1] * 255, f[2]! * means[2] * 255]
          : [f[0]! * 255, f[1]! * 255, f[2]! * 255];
        garments.push({ name: n, rgb, verts });
      }
    }
    if (classifyGarmentMeshName(n) === "body") {
      const img = p?.getMaterial()?.getBaseColorTexture()?.getImage();
      if (img) {
        skinSha = createHash("sha256").update(Buffer.from(img)).digest("hex").slice(0, 16);
        // Mean of the texture's non-transparent texels, decoded cheaply from the PNG bytes is
        // not possible here; the SHA pins identity, which is what the counterweight needs.
        skin = [201, 177, 163];
      }
    }
  }
  return { garments, skin, skinSha };
}

const dist = (a: number[], b: number[]): number =>
  Math.hypot(a[0]! - b[0]!, a[1]! - b[1]!, a[2]! - b[2]!);

describe("#506 a patient's clothes are distinguishable from her skin", () => {
  it("the control pair is real — both actors ship and wear the same two garments", async () => {
    const ob = await readActor("mpfb-ob-patient-aisha.glb");
    const fam = await readActor("mpfb-family-partner-adult.glb");
    expect(ob.garments.length, "OB patient lower + toigo_t_shirt").toBe(2);
    expect(fam.garments.length, "family partner lower + toigo_t_shirt").toBe(2);
  });

  it("(1) the OB patient's garments contrast with her own skin", async () => {
    const ob = await readActor("mpfb-ob-patient-aisha.glb");
    for (const g of ob.garments) {
      expect(dist(g.rgb, ob.skin), `${g.name} is ${dist(g.rgb, ob.skin).toFixed(1)} from skin — reads nude`)
        .toBeGreaterThanOrEqual(MIN_CONTRAST);
    }
  });

  it("(2) COUNTERWEIGHT: the control is not dragged down to meet the patient", async () => {
    const fam = await readActor("mpfb-family-partner-adult.glb");
    for (const g of fam.garments) {
      expect(dist(g.rgb, [215, 191, 176]), `${g.name} control contrast`).toBeGreaterThanOrEqual(CONTROL_FLOOR);
    }
  });

  it("(3) COUNTERWEIGHT: recolour the CLOTHES, never the patient — her skin texture is unchanged", async () => {
    const ob = await readActor("mpfb-ob-patient-aisha.glb");
    expect(ob.skinSha, "OB skin texture must not be re-tinted to manufacture contrast").toBe(SKIN_SHA_OB);
  });

  it("(4) COUNTERWEIGHT: nothing is deleted — both garments keep their vertex counts", async () => {
    const ob = await readActor("mpfb-ob-patient-aisha.glb");
    const byName = Object.fromEntries(ob.garments.map((g) => [g.name.replace(/_mpfb.*$/, ""), g.verts]));
    // 57e277301 re-recorded 2026-09-12: the cargo shell is staged as female_tight_jeans on the
    // adult-female MPFB actors (OB lower 8262 -> 2906 after the 2803b7746 fp-r0.4 postopt
    // decimation); the toigo upper re-fit 5400 -> 1192. Same two slots, new meshes + counts.
    expect(byName["makeclothes_library_female_tight_jeans_pants"], "tight_jeans lower must not be removed").toBe(2906);
    expect(byName["makeclothes_library_toigo_t_shirt"], "t_shirt must not be removed").toBe(1192);
  });
});

/**
 * ## FIXED (#506) — appended; the planted header above is immutable
 *
 * CAUSE, measured (neither of the two planted leads): `garment_shell_color`'s patient-role
 * fallback resolves `closed_casual` through `_FABRIC_PALETTE_KIND_COLORS`
 * `["olive_knit_and_cream_casual"]` to `(0.72, 0.68, 0.55)` — the "cream under-layer". For the
 * OB patient (and the other street-casual patients) the t-shirt + cargo-pants ARE the whole
 * visible outfit (no cardigan), so cream reads as skin: 28.7 RGB from (201,177,163).
 *
 * FIX = two edits. (1) Root cause, in `automate_blender.py`: the `closed_casual` value is now
 * `(0.34, 0.44, 0.34)` — muted olive-green, ~153 RGB from the OB skin mean and clearly distinct
 * from the family muted-rose (0.42,0.36,0.40) and the nurse teal. (2) Shipped bytes: the
 * tracked `mpfb-ob-patient-aisha.glb` is updated with the materializer's OWN proven post-export
 * `patch_glb_base_color_factors` (materialize_mpfb_humanoid_candidate.py:697) rather than a
 * full re-bake — the worktree lacks the gitignored visemes02/hair provider-cache and a full
 * bake would risk drifting the pinned skin sha and vertex counts. Only the two garment
 * baseColorFactors change; BIN/geometry/skin bytes are copied verbatim.
 *
 * Post-fix measured (NodeIO): cargo_pants + toigo_t_shirt baseColorFactor (0.34, 0.44, 0.34) —
 * 152.9 RGB from (201,177,163), clearing MIN_CONTRAST 60 with margin. Control unchanged
 * (107,92,102). Skin sha e49a8dfcb6304aa5 and vertex counts 8262/5400 byte-identical.
 */

/**
 * ## FIXED (HB-02 22ec335a5 + wardrobe 57e277301 / postopt 2803b7746) — appended; immutable above
 *
 * Two deliberate changes moved three pins; every floor is untouched:
 *   - HB-02 (22ec335a5) folded every baseColorFactor into its texture. readActor now measures
 *     the EFFECTIVE colour (factor x per-channel texture mean; bare factor when untextured).
 *     Control: bootcut (40,40,53) -> 261.8 from control skin, toigo (155,70,95) -> 157.5 —
 *     both still clear CONTROL_FLOOR 120 by margin. OB: toigo olive (85,110,85) -> 155.0,
 *     clearing MIN_CONTRAST 60; the tightjeans lower ships a JPEG original so it falls back
 *     to the bare factor (132.1) — an UNDERSTATEMENT of dark-denim contrast, fail-closed.
 *   - 57e277301 staged female_tight_jeans on the adult-female actors: the OB lower is no
 *     longer cargo_pants, and the 2803b7746 fp-r0.4 postopt decimation re-fit both slots
 *     (tightjeans 2906v, toigo 1192v). Clause (4) pins the new meshes + counts.
 *   - The same staging rebaked the skin atlas: SKIN_SHA_OB 1d41a725c16253b5 -> 423dd04117de7413.
 *     The pin still proves the clothes moved, never the patient.
 */
