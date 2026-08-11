import { dirname, resolve as pathResolve } from "node:path";
import { fileURLToPath } from "node:url";
import { NodeIO } from "@gltf-transform/core";
import { describe, expect, it } from "vitest";

/**
 * #321 put a real fitted garment on the MPFB2 patient. I graded it: the t-shirt is correctly placed on
 * her torso with short sleeves and a waist hem — and **the body pokes through it** in large
 * skin-coloured patches across the chest, abdomen, shoulders and collar. The two surfaces compete for
 * the same pixels.
 *
 * THE MECHANISM IS AN ABSENCE, NOT A BUG, and it is located:
 *
 *   rail                  | body verts | hidden verts | garment verts
 *   ----------------------|------------|--------------|---------------
 *   mpfb-ob-patient-aisha |     14,762 |      **0**   |     5,400
 *   lean_female (hm08)    |     48,438 |      5,440   |    13,533
 *
 * **The MPFB2 rail has no body-part hiding.** The library rail solves exactly this with
 * `apply_body_hide_material_region` (`body_param_stage.py:650`) — #285's answer to body-vs-garment
 * z-fighting, after the §6s research found that the industry hides the body under cloth rather than
 * pushing the cloth out. It paints an `alphaMode=MASK` material at `baseColorFactor [0,0,0,0]` with
 * `alphaCutoff=0.5`, so alpha 0 falls below the cutoff and those faces are DISCARDED, not rendered
 * black. Geometry, rig and shape keys are untouched — only polygon material indices change.
 *
 * Nothing applies it to Aisha, so a fitted garment and the body it is fitted to both render.
 *
 * **D1: the tool exists and is proven on the sibling rail.** Do not write a second hider, and do not
 * push the garment further out — #322 measured that the raw MakeClothes fit sits coincident with the
 * skin (median ~0.7 mm, half the surface behind it) and already offsets to a 1.5 cm standoff before the
 * coverage gate. Standoff alone did not stop the poke-through; hiding is the other half.
 *
 * WHERE THE THRESHOLDS COME FROM:
 *
 *   > 0 hidden verts.        Zero is the definition of "no hiding". Not tuned.
 *   >= 1,000 hidden verts.   The library rail hides 5,440 under 13,533 verts of garment — a ratio of
 *                            0.40. Aisha's garment is 5,400 verts, so the same ratio predicts ~2,170.
 *                            One thousand is well under that and exists to refuse a token mask, not to
 *                            grade coverage.
 *   0 hidden HAND verts.     #295's counterweight, restated. The library rail achieves exactly 0 today,
 *                            so this is a real known-good and not an aspiration.
 *   <= 60% of the body.      Refuses hiding her entirely to stop the poke-through. The library rail
 *                            hides 5,440 of 48,438 = 11%; a mask over most of the body is not hiding
 *                            under cloth, it is deleting the patient.
 *
 * THE CHEAP FIXES THIS REFUSES, probed before planting:
 *
 *   treatment                                      | (1) | (2) | (3) | (4) | result
 *   -----------------------------------------------|-----|-----|-----|-----|--------
 *   a) today                                       |FAIL |pass |pass |pass | REFUSED
 *   b) hide the whole body                         |pass |pass |**FAIL**|pass| REFUSED
 *   c) hide a token handful of faces               |**FAIL**|pass|pass|pass| REFUSED
 *   d) delete the garment so nothing pokes through |FAIL |pass |pass |**FAIL**| REFUSED
 *   e) hide the hands along with the torso         |pass |**FAIL**|pass|pass| REFUSED
 *   f) apply_body_hide_material_region under cloth | pass| pass| pass| pass| ALL PASS
 *
 * (e) is the one to watch: the mask is applied per-polygon from a coverage mask, and #295 measured
 * 11,528 hand-dominant vertices discarded by exactly this mechanism on the library rail before it was
 * scoped away from the hands. Re-introducing that here would produce the stump half of the mitten
 * defect on a second rail.
 *
 * WHICH ARE REDS AND WHICH ARE NETS (#227): (1) is the RED and fails today (0 hidden). (2), (3) and (4)
 * PASS today — (2) and (3) vacuously, since there is no mask to over-reach, and I am saying so rather
 * than letting them read as strong greens (§7t). They become load-bearing the moment a mask exists.
 *
 * NOT TESTED: nothing is rendered. This asserts a hide mask EXISTS, is non-trivial, spares the hands and
 * does not consume the body. It does **not** prove the poke-through is gone — a mask can hide the wrong
 * faces, and no clause here relates the hidden faces to the garment's footprint. That is rule 11s'
 * warning applied to my own contract: I am bounding a quantity, and the defect could still live in
 * WHICH faces are hidden. The pixel grade remains the only check on that and it is mine to make.
 *
 * ## FIXED (#323)
 *
 * `materialize_mpfb_humanoid_candidate.py` now wires the PROVEN tool from the sibling rail
 * (D1 — no second hider): `body_param_stage.apply_body_hide_material_region`
 * (body_param_stage.py:651) with the per-triangle mask from
 * `garment_coverage.body_hide_mask` (signed clearance < HIDE_EPSILON_M=5 mm against the
 * body's outward normal), scoped away from the hands from the start with
 * `body_param_stage.scope_hide_mask_away_from_hands` (the #295 stump refused on this rail
 * too). It runs AFTER the #321 fit + weight transfer so the mask covers the FINAL garment
 * footprint, and does NOT push the garment further out (#322's 1.5 cm standoff is already
 * in the shipped bytes). The glTF exporter maps the constant alpha-0 Principled input to
 * `alphaMode=MASK / alphaCutoff=0.5`, so the hidden faces are DISCARDED at render, not
 * rendered black — the library rail's shipped bytes use exactly this material shape.
 *
 * Measured from the re-baked GLB (NodeIO, the same attribution this file drives):
 *
 *   mpfb-ob-patient-aisha.glb   sha256 2494318b…  (was 3db12730…)
 *   hidden:   1,605 verts / 2,636 tris in `openclinxr_hidden_upper_mpfb_ob_patient_aisha_body_mesh`
 *             (Blender census: 1,318 quads / 2,477 fan-triangulated mask tris, band
 *             Y [0.97, 1.42] from the garment's world bounds, height_axis=2)
 *   hiddenHand: 0              (scope_hide_mask_away_from_hands; handFacesUnhidden 0)
 *   hidden fraction: 10.5%     (library rail known-good: 10.1% — same shape)
 *   garment:  5,400 verts      (unchanged — clause 4)
 *
 * The hidden primitive's AABB (X ±0.32, Y 0.95–1.43, Z −0.07..0.16) sits inside the
 * garment's footprint (X ±0.31, Y 0.97–1.42) — the mask covers the torso under the
 * t-shirt, not the hands, head or legs. `it.fails` flipped to `it`; all four clauses pass
 * on the masked asset. The mouth targets (13), the 137-joint rig, the 26,756-triangle
 * helper-stripped body and the garment placement are unchanged (regression nets green).
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = pathResolve(HERE, "../../..");
const PUBLIC = `${REPO_ROOT}/apps/ui-xr/public`;

const AISHA = "generated-humanoids/mpfb-ob-patient-aisha.glb";
const LIBRARY = "xr-assets/humanoids/candidates/body-param-adult_lean_female-library.glb";

const HIDDEN_MATERIAL = /hidden/i;
const GARMENT_MATERIAL = /makeclothes|garment|toigo|shirt|pants/i;
const HAND_JOINT = /hand|wrist|finger|thumb/i;

const MIN_HIDDEN_VERTS = 1000;
const MAX_HIDDEN_FRACTION = 0.6;

type Shape = { id: string; body: number; hidden: number; hiddenHand: number; garment: number };

const io = new NodeIO();

async function shapeOf(id: string, rel: string): Promise<Shape> {
  const doc = await io.read(`${PUBLIC}/${rel}`);
  const skin = doc.getRoot().listSkins()[0];
  const handJoints = new Set(
    (skin?.listJoints() ?? [])
      .map((j, i) => ({ i, n: j.getName() }))
      .filter((j) => HAND_JOINT.test(j.n))
      .map((j) => j.i),
  );
  const out: Shape = { id, body: 0, hidden: 0, hiddenHand: 0, garment: 0 };

  for (const mesh of doc.getRoot().listMeshes()) {
    for (const prim of mesh.listPrimitives()) {
      const pos = prim.getAttribute("POSITION");
      if (!pos) continue;
      const name = prim.getMaterial()?.getName() ?? "";
      const n = pos.getCount();

      if (HIDDEN_MATERIAL.test(name)) {
        out.hidden += n;
        const joints = prim.getAttribute("JOINTS_0");
        const weights = prim.getAttribute("WEIGHTS_0");
        if (joints && weights) {
          const je: [number, number, number, number] = [0, 0, 0, 0];
          const we: [number, number, number, number] = [0, 0, 0, 0];
          for (let i = 0; i < joints.getCount(); i += 1) {
            joints.getElement(i, je);
            weights.getElement(i, we);
            let dominant = -1;
            let best = 0;
            for (let k = 0; k < 4; k += 1) if (we[k]! > best) { best = we[k]!; dominant = je[k]!; }
            if (dominant >= 0 && handJoints.has(dominant)) out.hiddenHand += 1;
          }
        }
      } else if (GARMENT_MATERIAL.test(name)) {
        out.garment += n;
      } else {
        out.body += n;
      }
    }
  }
  return out;
}

const aisha = await shapeOf("mpfb2_aisha", AISHA);
const library = await shapeOf("library_lean_female", LIBRARY);

/** An unmeasured asset must FAIL every clause, never pass vacuously (§7t). */
function requireMeasured(): void {
  expect(aisha.body, "aisha body verts").toBeGreaterThan(1000);
  expect(aisha.garment, "aisha garment verts — #321 must still hold").toBeGreaterThan(1000);
  expect(library.hidden, "library hide mask present as the known-good").toBeGreaterThan(1000);
}

describe("the MPFB2 body is hidden under the cloth it wears", () => {
  it(
    `(1) RED: aisha carries a body-hide mask of at least ${MIN_HIDDEN_VERTS} vertices`,
    () => {
      requireMeasured();
      expect(
        aisha.hidden,
        `aisha hidden verts (library rail hides 5,440 under 13,533 garment verts)`,
      ).toBeGreaterThanOrEqual(MIN_HIDDEN_VERTS);
    },
  );

  it("(2) COUNTERWEIGHT: the mask spares the hands — the #295 stump is refused", () => {
    requireMeasured();
    expect(aisha.hiddenHand, "aisha hand-dominant vertices discarded by the mask").toBe(0);
    expect(library.hiddenHand, "library hand-dominant vertices discarded (known-good, 0 today)").toBe(0);
  });

  it(`(3) COUNTERWEIGHT: the mask covers under ${MAX_HIDDEN_FRACTION * 100}% of the body — hiding the patient is refused`, () => {
    requireMeasured();
    const total = aisha.body + aisha.hidden;
    expect(aisha.hidden / total, `aisha hidden fraction of body (library rail is 0.11)`).toBeLessThan(
      MAX_HIDDEN_FRACTION,
    );
  });

  it("(4) COUNTERWEIGHT: #321's garment survives — deleting the cloth to stop poke-through is refused", () => {
    requireMeasured();
    expect(aisha.garment, "aisha garment verts").toBeGreaterThanOrEqual(4000);
  });
});
