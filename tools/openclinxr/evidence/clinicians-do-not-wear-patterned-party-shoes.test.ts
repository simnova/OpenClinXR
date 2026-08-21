/**
 * #502 — ten nurses and a physician wear loud red-and-leopard flats in clinical stations.
 *
 * MEASURED 2026-08-21 (orchestrator), enumerated live from resolveScenarioActorCast.
 * IMMUTABLE — flip the assertion and append a `## FIXED (#502)` block below.
 *
 * CORRECTED 2026-08-21 after my own clause (4) failed against the tree: the SAME toigo_flats mesh
 * ships TWO WAYS, and my first count of "19 roles in leopard flats" was wrong.
 *
 *   asset                          footwear         texture              factor      reading
 *   mpfb-clinical-nurse-adult      toigo_flats      "Shoe" 7,769,810 B   255,255,255  LEOPARD  x10 roles
 *   mpfb-clinical-physician-adult  toigo_flats      "Shoe" 7,769,810 B   255,255,255  LEOPARD  x1
 *   mpfb-ob-patient-aisha          toigo_flats      "Shoe" 7,769,810 B   255,255,255  LEOPARD  x1
 *   mpfb-gown-adult-patient        toigo_flats      NONE                  26,23,20    PLAIN BLACK x7
 *   mpfb-family-partner-adult      mj_cloth_shoes   textured             -            plain    x10
 *   mpfb-peds-nurse-kevin          male_boots       textured             -            plain    x3
 *
 * So the offenders are ELEVEN CLINICIAN ROLES (nurse x10, physician x1), not nineteen.
 *
 * AND THE FIX ALREADY EXISTS IN THE TREE (D1): mpfb-gown-adult-patient wears the same mesh with the
 * texture stripped and a dark base-colour factor. That is the in-tree precedent to follow — no new
 * asset, no new tool, and it drops a 7.77 MB texture per actor as a side effect.
 *
 *   texture luminance sd:  Shoe (leopard) 56.2 · mj_cloth_shoes 25.1 · male_boots 22.3
 *
 * THIS IS NOT A TRIANGLE-COUNT GATE. Standing directive: no output gated on triangle count, and
 * MADR 0050 — optimisation is a post-process. `toigo_flats` is also 115,206 vertices against
 * `toigo_mj_cloth_shoes`'s 2,008, but that is a SIDE EFFECT of any swap and must not become the
 * justification or the assertion. The claim here is clinical plausibility, measured as texture
 * saturation, with a shipped control.
 *
 * THRESHOLD 40 IS A GAP MIDPOINT, NOT A FITTED NUMBER: the two acceptable shipped shoes sit at
 * sd 22.3 and 25.1; the offender at 56.2. 40 falls in a 31-point empty gap, and both anchors are
 * shipped assets independent of any fix (§9s).
 *
 * WHAT THIS METRIC CANNOT SEE (§6e): sd measures CONTRAST WITHIN the texture, i.e. patterning. A
 * plain, uniformly bright-red shoe would pass it. That is deliberate — the graded defect is a
 * leopard PRINT on clinicians, not colour — but do not read a green here as "the shoe looks
 * clinical". That verdict stays with the orchestrator's pixel grade.
 *
 * SCOPE: clinicians only. A patient in patterned street shoes is defensible; a nurse and a
 * physician in them are not. Patients are deliberately out of scope and clause (3) pins them.
 *
 * claimScope: whether clinician actors wear high-saturation patterned footwear.
 * notEvidenceFor: frame budget, vertex counts, or any patient's wardrobe.
 */
import { NodeIO } from "@gltf-transform/core";
import { describe, expect, it } from "vitest";
import { regionLuminance } from "./lib/png-region-luminance.js";

const DIR = "apps/ui-xr/public/generated-humanoids/";
const MAX_CLINICIAN_PATTERN_SD = 40;
const CLINICIAN = /nurse|physician|respiratory_therapist|consultant|resident/;

async function footwearPattern(glb: string): Promise<{ mesh: string; sd: number } | null> {
  const d = await new NodeIO().read(DIR + glb);
  for (const m of d.getRoot().listMeshes()) {
    if (!/footwear/.test(m.getName())) continue;
    const img = m.listPrimitives()[0]?.getMaterial()?.getBaseColorTexture()?.getImage();
    if (!img) continue;
    const r = regionLuminance(new Uint8Array(img), {}, { step: 2 });
    if (!r) continue;
    return { mesh: m.getName().replace(/_mpfb.*$/, ""), sd: r.sd };
  }
  return null;
}

async function cast(): Promise<{ role: string; glb: string }[]> {
  const c = await import("../../../packages/openclinxr/asset-registry/src/actor-casting.ts");
  const out: { role: string; glb: string }[] = [];
  for (const s of c.listShippedCastScenarioIds() as string[])
    for (const a of c.resolveScenarioActorCast(s) as Record<string, string>[])
      out.push({ role: String(a.role), glb: String(a.assetPath).split("/").pop()! });
  return out;
}

describe("#502 clinicians do not wear patterned party shoes", () => {
  it("the control is real — a near-neutral shipped shoe already exists on the cast", async () => {
    const s = await footwearPattern("mpfb-family-partner-adult.glb");
    expect(s?.mesh).toContain("mj_cloth_shoes");
    expect(s!.sd, "the shipped plain control sits at sd 25.1").toBeLessThan(30);
  });

  it.fails("(1) every clinician's footwear is not a loud patterned shoe", async () => {
    const seen = new Set<string>();
    for (const { role, glb } of await cast()) {
      if (!CLINICIAN.test(role) || seen.has(glb)) continue;
      seen.add(glb);
      const s = await footwearPattern(glb);
      if (!s) continue;
      expect(s.sd, `${role} wears ${s.mesh} at saturation ${s.sd.toFixed(0)}`)
        .toBeLessThanOrEqual(MAX_CLINICIAN_PATTERN_SD);
    }
  });

  it("(2) COUNTERWEIGHT: kevin's brown boots stay acceptable — this is not a de-colour-everything rule", async () => {
    const s = await footwearPattern("mpfb-peds-nurse-kevin.glb");
    expect(s!.sd, "plain brown boots at sd 22.3 must remain allowed").toBeLessThanOrEqual(MAX_CLINICIAN_PATTERN_SD);
    expect(s!.sd, "and must not have been flattened to a featureless texture to pass").toBeGreaterThan(12);
  });

  it("(3) COUNTERWEIGHT: patients are out of scope and untouched", async () => {
    const s = await footwearPattern("mpfb-family-partner-adult.glb");
    expect(s?.mesh, "the family partner's shoe must not be swapped by this slice").toContain("mj_cloth_shoes");
  });

  it(
    "(4) COUNTERWEIGHT: the in-tree precedent is preserved — the gown patient stays untextured",
    async () => {
      // The cheap fix is to desaturate/flatten the shared library texture, which greens clause (1)
      // for clinicians AND silently degrades it for the eight patient roles that legitimately wear
      // it. The fix must be a per-role SWAP, not an edit to a shared asset.
      // The gown patient already wears this mesh with NO texture and a dark factor — the in-tree
      // precedent. footwearPattern() returns null when there is no texture, which is the pass
      // condition here: she must stay plain, and the shared "Shoe" texture must not be edited to
      // green clinicians (that would degrade the ob patient, who legitimately wears the print).
      const plain = await footwearPattern("mpfb-gown-adult-patient.glb");
      expect(plain, "the gown patient must stay untextured — she is the precedent, not a target").toBeNull();
    },
  );
});
