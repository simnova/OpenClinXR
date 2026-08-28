/**
 * Eyelashes ship at 368 triangles from hm08 helper geometry. Eyebrows ship at 35,334 from a fitted
 * library asset. Two adjacent features of one face, 96x apart, and the low-fidelity one was never a
 * decision.
 *
 * MEASURED 2026-08-26 on main, all 11 shipped MPFB humanoids:
 *
 *   lash meshes named hm08 (helper geometry)      11
 *   lash meshes fitted from eyelashes01            0
 *
 *   mpfb-ob-patient-aisha, per mesh:
 *     26,756  mpfb_ob_patient_aisha_body                             <- #542 invariant
 *     35,334  openclinxr_fitted_eyebrow_mindfront_eyebrows_05_...    <- FITTED from eyebrows01
 *        368  openclinxr_hm08_eyelash_...                            <- helper geometry
 *        192  openclinxr_hm08_teeth_...
 *        448  openclinxr_hm08_tongue_...
 *
 * The eyelashes01 pack is staged, CC0, and deliberately unfitted. Five variants, quads:
 *   mindfront_eyelashes_01   8,316 quads = 16,632 tris   <- smallest, still 45x the shipped lash
 *   ..._03  9,396 = 18,792   ..._04  12,186 = 24,372   ..._02  12,744 = 25,488   ..._05  14,850 = 29,700
 *
 * THE MECHANISM IS ALREADY PROVEN, BY THE BROWS, ON THE SAME PATH.
 * materialize_mpfb_humanoid_candidate.py:3522 — "Pack is CC0 on every .mhclo header; ClothesService
 * fits against hm08 basemesh refs. The fitted mesh is a SEPARATE object, so the strip does not touch
 * it. Eyelashes are NOT fitted from eyelashes01 here — they are retained from hm08 helper groups
 * just below (do not do both)."
 *
 * So this is not a failed fit and not a licence block. Brows go through EYEBROW_STYLE_BY_REFERENCE
 * (:105), a per-actor style map. `grep EYELASH_STYLE` returns 0. The lashes came along as a
 * by-product of #542's helper extraction, whose goal was keeping the body at 26,756 tris.
 *
 * WHY THE ASSERTION IS ON SHIPPED BYTES, not on the pipeline: the bake is the layer that decides,
 * and reading the fixture or the manifest answers a different question (the wrong-layer error #568
 * recorded twice in one night). A glTF mesh name is layer-independent.
 *
 * claimScope: which source each shipped actor's lash mesh comes from, and the three counts a lash
 *   refit must not disturb.
 * notEvidenceFor: whether a fitted lash LOOKS better. Every number here is geometry. A fitted lash
 *   that reads no different at conversational distance is a real outcome and closes this card.
 */
import { describe, it, expect } from "vitest";
import { NodeIO } from "@gltf-transform/core";
import { ALL_EXTENSIONS } from "@gltf-transform/extensions";
import { readdirSync } from "node:fs";

const DIR = "apps/ui-xr/public/generated-humanoids";
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
const assets = (): string[] =>
  readdirSync(DIR).filter((f) => f.startsWith("mpfb") && f.endsWith(".glb")).sort();

type Mesh = { name: string; tris: number };
async function meshes(glb: string): Promise<Mesh[]> {
  const d = await io.read(`${DIR}/${glb}`);
  return d.getRoot().listMeshes().map((m) => ({
    name: m.getName(),
    tris: m.listPrimitives().reduce((t, p) => {
      const i = p.getIndices();
      return t + (i ? i.getCount() / 3 : (p.getAttribute("POSITION")?.getCount() ?? 0) / 3);
    }, 0),
  }));
}

describe("an actor wears fitted eyelashes, not helper stubs (#683)", () => {
  it(
    "(1) every shipped actor's lash mesh is fitted from eyelashes01, not hm08 helper geometry",
    async () => {
      const stubs: string[] = [];
      for (const glb of assets()) {
        for (const m of await meshes(glb)) {
          if (!/lash/i.test(m.name)) continue;
          if (/hm08/.test(m.name)) stubs.push(`${glb}: ${m.name} (${Math.round(m.tris)} tris)`);
        }
      }
      expect(
        stubs,
        "lash meshes still come from hm08 helper geometry. The eyelashes01 pack is staged and CC0; "
          + "the brows prove the ClothesService fit path on the same basemesh refs:\n"
          + stubs.join("\n"),
      ).toHaveLength(0);
    },
    1_800_000,
  );

  // (2) COUNTERWEIGHT — the source warns "do not do both". Fitting eyelashes01 while retaining the
  //     hm08 helper lashes gives an actor two sets. EXACTLY one, never "at least one".
  it("(2) COUNTERWEIGHT: exactly one lash mesh per actor", async () => {
    for (const glb of assets()) {
      const lashes = (await meshes(glb)).filter((m) => /lash/i.test(m.name));
      expect(lashes.length, `${glb} has ${lashes.length} lash meshes: ${lashes.map((l) => l.name).join(", ")}`)
        .toBe(1);
    }
  }, 1_800_000);

  // (3) COUNTERWEIGHT: #542's invariant. Helper extraction exists so the basemesh stays 26,756 tris.
  //     A refit that re-targets the basemesh has broken the thing it was built around.
  //
  //     CORRECTED 2026-08-27 (#683 worker, reported at discovery): this clause was written as
  //     "every mpfb body == 26,756" and is IMPOSSIBLE on the current tree — #695 decimated the four
  //     ED cast actors on 2026-08-26 (after this card was planted): their bodies ship at 12,884,
  //     12,890, 12,892 and 14,942 triangles, never 26,756. The counterweight's intent is
  //     unchanged — THIS slice's lash refit must not re-target the basemesh — so the clause now
  //     pins the helper-stripped actors to exactly 26,756 and the #695-decimated actors to their
  //     recorded pre-slice counts (within 1%; the re-bake's gown body measured 14,928 vs the
  //     recorded 14,942, a 0.09% re-serialisation delta). Measured pre-change 2026-08-27:
  //
  //       mpfb-gown-adult-patient.glb        14,942   (decimated 0.5,   error 0.001, #695)
  //       mpfb-clinical-nurse-adult.glb      12,892   (decimated 0.4,   error 0.001, #695)
  //       mpfb-family-partner-adult.glb      12,884   (decimated 0.4,   error 0.001, #695)
  //       mpfb-clinical-physician-adult.glb  12,890   (decimated 0.4,   error 0.001, #695)
  it("(3) COUNTERWEIGHT: the body stays 26,756 tris (helper-stripped actors) or at its recorded decimated count (ED cast)", async () => {
    const bodies: string[] = [];
    const DECIMATED: Record<string, number> = {
      "mpfb-gown-adult-patient.glb": 14_942,
      "mpfb-clinical-nurse-adult.glb": 12_892,
      "mpfb-family-partner-adult.glb": 12_884,
      "mpfb-clinical-physician-adult.glb": 12_890,
    };
    for (const glb of assets()) {
      for (const m of await meshes(glb)) {
        if (!/_body$/.test(m.name)) continue;
        const recorded = DECIMATED[glb];
        if (recorded !== undefined) {
          if (Math.abs(Math.round(m.tris) - recorded) / recorded > 0.01) {
            bodies.push(`${glb}: ${m.name} = ${Math.round(m.tris)} (decimated ${recorded})`);
          }
        } else if (Math.round(m.tris) !== 26756) {
          bodies.push(`${glb}: ${m.name} = ${Math.round(m.tris)}`);
        }
      }
    }
    expect(bodies, `body triangle count moved from its recorded pre-slice state:\n${bodies.join("\n")}`).toHaveLength(0);
  }, 1_800_000);

  // (4) COUNTERWEIGHT: this slice touches lashes. A brow count that moves means the fit order or the
  //     helper strip was disturbed. Teeth and tongue are in the same extraction and stay helper-held.
  it("(4) COUNTERWEIGHT: brows stay fitted, teeth and tongue stay helper-retained", async () => {
    for (const glb of assets()) {
      const ms = await meshes(glb);
      const brow = ms.find((m) => /brow/i.test(m.name));
      expect(brow?.name ?? "", `${glb} lost its fitted eyebrow`).toMatch(/fitted_eyebrow_mindfront_eyebrows_/);
      for (const feature of ["teeth", "tongue"]) {
        const f = ms.find((m) => new RegExp(feature, "i").test(m.name));
        expect(f?.name ?? "", `${glb} ${feature} left hm08 helper retention`).toMatch(/hm08/);
      }
    }
  }, 1_800_000);

  /**
   * (5) COUNTERWEIGHT ADDED 2026-08-26, after #692 measured the station budget.
   *
   * The four clauses above bound lash MESH COUNT, body triangles, and brow/teeth/tongue retention.
   * Not one of them bounds what the upgrade COSTS. That is the #686 shape exactly: a clause bounding
   * the right property while every other property the cheapest satisfying mechanism would move runs
   * free. #686 bounded normal-dot correctly and added 51,281 triangles nobody noticed until a census.
   *
   * MEASURED from the CC0 pack at
   * `.openclinxr-local/provider-cache/facial/sources/makehuman-eyelashes01/extracted/eyelashes/`,
   * counting OBJ quads as two triangles each:
   *
   *   shipped helper lash                368 tris
   *   mindfront_eyelashes_01          16,632         +16,264 per actor
   *   mindfront_eyelashes_02          25,488         +25,120
   *   mindfront_eyelashes_05          29,700         +29,332
   *
   * Across the eleven shipped actors the SMALLEST variant is +178,904 triangles, which is one whole
   * station budget (180,000, asset-generation-pipeline.md:87). The ED four-actor station goes from
   * 360,524 to 425,580, from 2.00x over budget to 2.36x.
   *
   * THE BOUND IS DERIVED, NOT CHOSEN: the smallest variant the CC0 pack actually offers. It forbids
   * silently reaching for eyelashes_05 at nearly double the cost, and it does not pretend to say
   * what the cast can afford — that is #692's question and this clause does not answer it.
   */
  it("(5) COUNTERWEIGHT: a fitted lash costs no more than the smallest variant the pack offers", async () => {
    const SMALLEST_VARIANT_TRIS = 16_632;
    const over: string[] = [];
    for (const glb of assets()) {
      for (const m of await meshes(glb)) {
        if (!/lash/i.test(m.name)) continue;
        if (Math.round(m.tris) > SMALLEST_VARIANT_TRIS) {
          over.push(`${glb}: ${m.name} = ${Math.round(m.tris)} > ${SMALLEST_VARIANT_TRIS}`);
        }
      }
    }
    expect(
      over,
      "eyelashes_01 is 16,632 tris and eyelashes_05 is 29,700; taking the larger costs +29,332 per "
        + `actor against a station already 2.00x over budget:\n${over.join("\n")}`,
    ).toHaveLength(0);
  }, 1_800_000);
});

/*
 * ## FIXED (#683)
 *
 * Clause (1) flipped from `it.fails` to `it` on 2026-08-27. The fix is a fitted
 * eyelash from the CC0 eyelashes01 pack, mirroring the eyebrow rail (D1), in
 * `tools/openclinxr/evidence/blender/materialize_mpfb_humanoid_candidate.py`:
 *
 *   - `EYELASH_STYLE_BY_REFERENCE` maps every actor to `mindfront_eyelashes_01`
 *     (the smallest variant the pack offers — 8,316 quads = 16,632 tris), with
 *     `EYELASH_STYLE_SEARCH_ROOTS` + `resolve_eyelash_style_dir` mirroring the
 *     eyebrow pattern (named dirs only, never a glob).
 *   - The fit runs BEFORE the #318 helper strip (same load-bearing order as
 *     hair/eyes/brows): `fit_hair` -> `ClothesService.fit_clothes_to_human`
 *     against the full basemesh, licence-gated by `read_hair_mhclo_licence`
 *     (every eyelashes01 .mhclo header is CC0), weighted 1.0 to the head bone.
 *   - `HM08_FEATURE_HELPER_GROUPS` no longer retains the hm08 helper lashes
 *     ("do not do both"): teeth/tongue stay helper-held at 192 / 448 tris.
 *
 * All 11 shipped mpfb-*.glb were re-baked through the materializer (the two gown
 * assets through `bake_mpfb_gown_inspect.py` stage-2 on the re-baked bases) and
 * the four ED cast actors re-decimated at their #695-pinned rungs (gown 0.5,
 * nurse/family/physician 0.4, error 0.001). Measured post-bake on every actor:
 * exactly one lash mesh, fitted (no hm08), at the smallest variant's cost; body
 * stays 26,756 tris; brows stay fitted (mindfront_eyebrows_*); teeth/tongue stay
 * hm08 helper-retained.
 *
 * KNOWN PREDICTED CONSEQUENCE, owned elsewhere: the four ED actors gain
 * decimated lashes (~8,316 tris on the gown at ratio 0.5, ~6,653 each on the
 * other three at 0.4), taking the ED station total from 178,969 to ~207,244 —
 * over the 180,000 authored budget. The issue's own cost analysis computes this
 * (+16,264 per actor full-fidelity) and #692/#699 own whether a real budget
 * exists to answer against. The contract test's clause (5) bounds the lash cost;
 * it deliberately does not answer the station-budget question.
 *
 * DATA CORRECTION, RECORDED (see the manifest's notes): the ob_patient_aisha
 * manifest's descriptor-derived numeric block (age 34 / height_cm 166 / bmi 24)
 * was removed because the first bake to exercise it refused — MPFB's height
 * macro has a dead band (macrotargets height parts 0.49..0.51 + the 0.01
 * target-weight cutoff) making 1.66 m unbuildable for that macro dict (reachable
 * statures jump 1.6542 -> 1.6763; solver residual 5.8 mm > its 5 mm internal
 * tolerance). The shipped body was baked pre-#688 with DEFAULT macros + the #581
 * pregnancy morph; the manifest now reproduces that path. skin_tone/eye_color
 * (the #688 channels) are unchanged. A `robert_reference` manifest was added
 * (staged + shipped) so the gown-adult-patient's #651 height rebake (178 cm
 * adult-male numeric identity) reproduces and its baked-from reference resolves.
 */
