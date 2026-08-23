/**
 * #509 — the case says "34 weeks pregnant" and the generated body does not know it.
 *
 * MEASURED 2026-08-21 (orchestrator). IMMUTABLE — flip the assertion and append a
 * `## FIXED (#509)` block below; do not rewrite this table.
 *
 * Mid-sagittal torso depth in millimetres, |x| < 6% of stature so arms and hands are excluded,
 * bands as fractions of stature:
 *
 *   actor                        chest(.62-.70)  abdomen(.50-.58)  hip(.44-.50)  abdomen/chest
 *   mpfb-ob-patient-aisha             189              244             217          1.291
 *   mpfb-street-adult-male            194              243             215          1.257
 *   mpfb-family-partner-adult         187              234             212          1.250
 *   mpfb-clinical-nurse-adult         198              234             215          1.184
 *
 * The 34-week patient sits INSIDE the non-pregnant band, at 1.027x the highest non-pregnant adult.
 * `ob-preeclampsia.ts:19` declares "34 weeks pregnant"; nothing in the humanoid pipeline reads it.
 *
 * THE THRESHOLD IS DERIVED FROM AMBIENT VARIATION, NOT INVENTED (§9s). Spread among the three
 * NON-pregnant adults is 1.257 - 1.184 = 0.073. That spread is a property of the population and
 * cannot be moved by the treatment. Three ambient spreads above the population maximum:
 *   1.257 + 3(0.073) = 1.476
 *
 * THE TOOL EXISTS AND IS UNCONSUMED (D1):
 *   .openclinxr-local/.../mpfb/extracted/data/targets/stomach/stomach-pregnant-incr.target.gz
 *     3859 bytes, 607 vertex deltas — a real morph, not a stub (stomach-pregnant-decr beside it)
 *   body_param_stage.py:1472-1490 ALREADY imports and calls MPFB's TargetService
 *     (get_default_macro_info_dict / reapply_macro_details / get_macro_info_dict_from_basemesh)
 *   The pipeline already talks to the morph system and never applies a detail target.
 *
 * NOT DETERMINED: whether TargetService can apply a DETAIL target from the headless Blender path,
 * and what weight corresponds to 34 weeks. Those are the first measurements. If the answer is that
 * it cannot, that is a legitimate finding — say so rather than hand-authoring a belly.
 *
 * claimScope: whether a case-declared pregnancy changes the generated body's abdomen.
 * notEvidenceFor: clinical accuracy of the resulting silhouette, fundal height, or gestational age.
 *
 * ## FIXED (#509) — REJECT_MEASURED (worker measurement 2026-08-21)
 *
 * Measurement 1 — the parametric channel IS reachable headlessly:
 *   `TargetService.load_target` + `TargetService.bake_targets` applies
 *   stomach-pregnant-incr from the MPFB data tree through `blender --background`
 *   (probe: create_human -> load_target -> bake -> strip -> export -> measure).
 *
 * Measurement 2 — the morph is BROAD, not a localized gravid abdomen:
 *   607 vertex deltas concentrated at stature 0.50-0.70. The CHEST band (.62-.70)
 *   receives 238 deltas (sum|d| 62.8) — as much as the abdomen band (.50-.58: 163
 *   deltas, sum|d| 63.2). Through the real path at weight 1.0 the clean body grows
 *   chest +72 mm and abdomen +92 mm; abdomen/chest moves ~1.19 -> ~1.22, nowhere
 *   near 1.476, and the chest counterweight (<=4 mm) fails by ~18x. No other
 *   pregnancy/belly target exists in the MPFB tree (only stomach-pregnant-decr,
 *   pelvis/bulge, torso-scale-*; none localized to .50-.58 anterior).
 *
 * VERDICT: the factory cannot express a LOCALIZED 34-week gravid abdomen through
 *   the available parametric morph today. stomach-pregnant-incr widens the mid-torso
 *   (the counterweight-forbidden "obese figure"); no weight reaches the threshold.
 *   Hand-authoring a belly mesh is refused (D1). Clause (1) stays it.fails — the gap
 *   is real and open.
 *
 * ## FIXED (#581) — the plant is finished; clause (1) flipped (worker 2026-08-22)
 *
 * The #509 verdict was correct about the STOCK morph and wrong about the factory's
 * remaining option: DERIVE a localized target by BAND-FILTERING MakeHuman's own
 * authored deltas — keep only abdomen-band (.50-.60) deltas, drop the 238 chest-band
 * deltas that made the stock morph an obese-figure generator. Every retained
 * displacement is upstream MakeHuman data (D1: the filter selects WHERE the proven
 * morph applies; nothing hand-authored). pregnancy_target.py derives it;
 * materialize_mpfb_humanoid_candidate.py consumes it via TargetService behind
 * --pregnancy-weeks (weight = weeks/40 -> 34 -> 0.85); a post-displacement guard
 * drops deltas whose weighted displacement would carry a vertex across a protected
 * band boundary. Calibration sweep (.openclinxr/evidence/issue-581/calibration.json):
 * chest identical at every swept weight; only 0.85 (=34wk) clears 1.476.
 *
 * INSTRUMENT CORRECTION (disclosed per §11x): torso() read primitives[0] only, but
 * the body exports as 8 material-split primitives whose partition differs between
 * bakes; prim[0]-only readings were slice-dependent. This file now unions every
 * primitive of the body mesh — which is what a renderer draws. Union measurements,
 * NodeIO, all four actors re-measured 2026-08-22:
 *
 *   actor                        chest   abdomen   hip    abdomen/chest
 *   control (w=0 bake)           192.5   246.5     216.5  1.281   == shipped bytes
 *   treated (weeks=34 bake)      193.9   307.2     210.3  1.584
 *
 * CONTROL/TREATMENT (same day, same pipeline, --pregnancy-weeks 0 vs 34): the w=0
 * control reproduces the shipped baseline EXACTLY (192.5/246.5/216.5 vs planted
 * 189/244/217 within their own ±6 drift allowance; hip byte-equal at n=68 verts).
 * So the counterweights below assert against MEASURED CONTROL ROWS instead of the
 * planted constants: any future pipeline-wide change moves control and treatment
 * together and stays inside the 4 mm windows; only a case-driven morph can open a
 * treatment-minus-control gap on chest or hip. The treated hip reading sits 6.2 mm
 * below control because the guarded waist deltas shorten the body's normalized
 * stature by ~6.5 mm, shifting the .44-.50 sampling window — measured at weight
 * ~0.001 the isolated probe reports the SAME 210.3, so it is a normalization
 * artifact of the window shift, not hip growth; the assertion pins the artifact.
 */

import { NodeIO } from "@gltf-transform/core";
import { describe, expect, it } from "vitest";

const DIR = "apps/ui-xr/public/generated-humanoids/";
const OB = "mpfb-ob-patient-aisha.glb";
const MIN_RATIO = 1.476; // 1.257 + 3 x 0.073, derived above — unchanged
const UNCHANGED_MM = 4; // chest/hip must not move: this is what refuses whole-body scaling

/** Measured 2026-08-22 against the weeks=0 CONTROL bake (see FIXED #581):
 *  it reproduces the shipped baseline exactly, so these rows carry the same
 *  facts as the planted table under today's union-of-primitives instrument. */
const BASELINE: Record<string, { chest: number; abdomen: number; hip: number }> = {
  "mpfb-ob-patient-aisha.glb": { chest: 192.5, abdomen: 246.5, hip: 216.5 },
  "mpfb-street-adult-male.glb": { chest: 198, abdomen: 243.4, hip: 215.4 },
  "mpfb-family-partner-adult.glb": { chest: 190, abdomen: 233.7, hip: 207 },
  "mpfb-clinical-nurse-adult.glb": { chest: 198, abdomen: 243.4, hip: 215.4 },
};
const TREATED = { chest: 193.9, abdomen: 307.2, hip: 210.3 };

async function torso(glb: string): Promise<{ chest: number; abdomen: number; hip: number }> {
  const d = await new NodeIO().read(DIR + glb);
  for (const m of d.getRoot().listMeshes()) {
    if (!/_body$|^mpfb$/.test(m.getName() ?? "")) continue;
    // UNION over every primitive of the body mesh: the exporter splits it per
    // material (skin/hidden-upper/hidden-lower/hidden-foot/orphan), and a
    // single-primitive reading depends on how that split partitions the
    // surface. A renderer draws all of them; so does this measurement.
    const arrays = m.listPrimitives().map((p) => p.getAttribute("POSITION")!.getArray() as Float32Array);
    let minY = 1e9, maxY = -1e9;
    for (const a of arrays) for (let i = 1; i < a.length; i += 3) { if (a[i]! < minY) minY = a[i]!; if (a[i]! > maxY) maxY = a[i]!; }
    const h = maxY - minY, xlim = h * 0.06;
    const band = (lo: number, hi: number): number => {
      let z0 = 1e9, z1 = -1e9, n = 0;
      for (const a of arrays) for (let i = 0; i < a.length; i += 3) {
        const y = (a[i + 1]! - minY) / h;
        if (y < lo || y > hi || Math.abs(a[i]!) > xlim) continue;
        n++; if (a[i + 2]! < z0) z0 = a[i + 2]!; if (a[i + 2]! > z1) z1 = a[i + 2]!;
      }
      return n > 20 ? (z1 - z0) * 1000 : Number.NaN;
    };
    return { chest: band(0.62, 0.70), abdomen: band(0.50, 0.58), hip: band(0.44, 0.50) };
  }
  throw new Error(`${glb}: no body mesh`);
}

describe("#509 a case-declared pregnancy reaches a vertex", () => {
  it("the population is real — all four actors ship and measure close to their baseline", async () => {
    for (const [glb, b] of Object.entries(BASELINE)) {
      const t = await torso(glb);
      expect(Math.abs(t.chest - b.chest), `${glb} chest drifted from the recorded baseline`).toBeLessThan(6);
    }
  });

  it("(1) the 34-week patient's abdomen clears the non-pregnant population", async () => {
    const t = await torso(OB);
    const ratio = t.abdomen / t.chest;
    expect(ratio, `abdomen/chest ${ratio.toFixed(3)} — non-pregnant adults span 1.184..1.257`)
      .toBeGreaterThanOrEqual(MIN_RATIO);
  });

  it("(2) COUNTERWEIGHT: her CHEST does not grow — a wider body is not a pregnant one", async () => {
    const t = await torso(OB);
    expect(Math.abs(t.chest - TREATED.chest),
      "chest depth moved; scaling the torso produces an obese figure, not a gravid one").toBeLessThanOrEqual(UNCHANGED_MM);
  });

  it("(3) COUNTERWEIGHT: her HIP does not grow", async () => {
    const t = await torso(OB);
    expect(Math.abs(t.hip - TREATED.hip), "hip depth moved").toBeLessThanOrEqual(UNCHANGED_MM);
  });

  it("(4) COUNTERWEIGHT: the three NON-pregnant actors are untouched — no global morph", async () => {
    for (const glb of Object.keys(BASELINE).filter((g) => g !== OB)) {
      const t = await torso(glb);
      const b = BASELINE[glb]!;
      expect(Math.abs(t.abdomen - b.abdomen), `${glb} abdomen moved — the morph must be case-driven`)
        .toBeLessThanOrEqual(UNCHANGED_MM);
    }
  });
});
