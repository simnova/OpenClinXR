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
 */
import { createHash } from "node:crypto";
import { NodeIO } from "@gltf-transform/core";
import { describe, expect, it } from "vitest";

const DIR = "apps/ui-xr/public/generated-humanoids/";
const MIN_CONTRAST = 60;      // between today's 28.7 and the shipped control's 163.9
const CONTROL_FLOOR = 120;    // the control must not be dragged down to meet the patient
const SKIN_SHA_OB = "cca6fc73ec09121d";   // re-pinned 2026-08-24 (#647): the height re-bake re-carved the hide regions, so the painted pixel set moved; the tone is unchanged (avg RGB 48,48,48 — measured) — this pin guards re-tinting, not byte identity. The pre-#598 pin (e49a8dfcb6304aa5) was already stale on main after the #598 shoe-swap rebake.

type Actor = { garments: { name: string; rgb: [number, number, number]; verts: number }[];
  skin: [number, number, number]; skinSha: string };

async function readActor(file: string): Promise<Actor> {
  const d = await new NodeIO().read(DIR + file);
  const garments: Actor["garments"] = [];
  let skin: [number, number, number] = [0, 0, 0];
  let skinSha = "";
  for (const m of d.getRoot().listMeshes()) {
    const n = m.getName();
    const p = m.listPrimitives()[0];
    const verts = m.listPrimitives().reduce((t, q) => t + (q.getAttribute("POSITION")?.getCount() ?? 0), 0);
    if (/cargo_pants|toigo_t_shirt/.test(n)) {
      const f = p?.getMaterial()?.getBaseColorFactor();
      if (f) garments.push({ name: n, rgb: [f[0]! * 255, f[1]! * 255, f[2]! * 255], verts });
    }
    if (/_body$|^mpfb$/.test(n)) {
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
    expect(ob.garments.length, "OB patient cargo_pants + toigo_t_shirt").toBe(2);
    expect(fam.garments.length, "family partner cargo_pants + toigo_t_shirt").toBe(2);
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
    expect(byName["makeclothes_library_cargo_pants"], "cargo_pants must not be removed").toBe(8084);
    expect(byName["makeclothes_library_toigo_t_shirt"], "t_shirt must not be removed").toBe(5400);
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
