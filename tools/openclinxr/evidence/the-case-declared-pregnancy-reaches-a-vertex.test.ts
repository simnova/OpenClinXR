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
 */
import { NodeIO } from "@gltf-transform/core";
import { describe, expect, it } from "vitest";

const DIR = "apps/ui-xr/public/generated-humanoids/";
const OB = "mpfb-ob-patient-aisha.glb";
const MIN_RATIO = 1.476;           // 1.257 + 3 x 0.073, derived above
const UNCHANGED_MM = 4;            // chest/hip must not move: this is what refuses whole-body scaling
const BASELINE: Record<string, { chest: number; abdomen: number; hip: number }> = {
  "mpfb-ob-patient-aisha.glb": { chest: 189, abdomen: 244, hip: 217 },
  "mpfb-street-adult-male.glb": { chest: 194, abdomen: 243, hip: 215 },
  "mpfb-family-partner-adult.glb": { chest: 187, abdomen: 234, hip: 212 },
  "mpfb-clinical-nurse-adult.glb": { chest: 198, abdomen: 234, hip: 215 },
};

async function torso(glb: string): Promise<{ chest: number; abdomen: number; hip: number }> {
  const d = await new NodeIO().read(DIR + glb);
  for (const m of d.getRoot().listMeshes()) {
    if (!/_body$|^mpfb$/.test(m.getName())) continue;
    const a = m.listPrimitives()[0]!.getAttribute("POSITION")!.getArray() as Float32Array;
    let minY = 1e9, maxY = -1e9;
    for (let i = 1; i < a.length; i += 3) { if (a[i]! < minY) minY = a[i]!; if (a[i]! > maxY) maxY = a[i]!; }
    const h = maxY - minY, xlim = h * 0.06;
    const band = (lo: number, hi: number): number => {
      let z0 = 1e9, z1 = -1e9, n = 0;
      for (let i = 0; i < a.length; i += 3) {
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

  it.fails("(1) the 34-week patient's abdomen clears the non-pregnant population", async () => {
    const t = await torso(OB);
    const ratio = t.abdomen / t.chest;
    expect(ratio, `abdomen/chest ${ratio.toFixed(3)} — non-pregnant adults span 1.184..1.257`)
      .toBeGreaterThanOrEqual(MIN_RATIO);
  });

  it("(2) COUNTERWEIGHT: her CHEST does not grow — a wider body is not a pregnant one", async () => {
    const t = await torso(OB);
    expect(Math.abs(t.chest - BASELINE[OB]!.chest),
      "chest depth moved; scaling the torso produces an obese figure, not a gravid one").toBeLessThanOrEqual(UNCHANGED_MM);
  });

  it("(3) COUNTERWEIGHT: her HIP does not grow", async () => {
    const t = await torso(OB);
    expect(Math.abs(t.hip - BASELINE[OB]!.hip), "hip depth moved").toBeLessThanOrEqual(UNCHANGED_MM);
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
