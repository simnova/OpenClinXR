import { describe, expect, it } from "vitest";
import { measureGarmentWeightCorrespondence } from "./garment-weight-correspondence.js";

/**
 * OBSERVABLE: the garment shell is skinned like the body it was derived from, so cloth follows the
 * limb it sits on instead of lagging or tearing when the skeleton moves.
 *
 * MEASURED 2026-08-24, do not re-derive. #121 replaced the ring-and-tube cage with a body-surface
 * shell and did NOT transfer skin weights. `tools/openclinxr/asset-pipeline/anny/automate_blender.py`
 * :484-495 still assigns garment weights from normalised X/Y POSITION thresholds - the ring-and-tube
 * era's heuristic - rather than copying from the body vertices the shell was derived from.
 *
 * The measurement is a normalised L1 distance between a garment vertex's dense per-bone weight vector
 * and that of the nearest body vertex. 0 = skinned identically, 1 = no shared bone.
 *
 *   rail                                   all verts   within 8 mm of skin
 *   ANNY  peds_upper_v1 on anny_base        0.1795          0.1795
 *   MPFB  toigo_t_shirt on its own body     0.0254          0.0139
 *
 * THE BAND CONTROL IS THE LOAD-BEARING HALF. A nearest-vertex proxy could inflate the Anny number
 * simply because its shell stands further off the skin (21.1 mm mean vs 9.4 mm). Restricting to
 * garment vertices within 8 mm - where "nearest" is not arguable - leaves the Anny median COMPLETELY
 * UNCHANGED at 0.1795 while MPFB's improves to 0.0139. The disagreement is not a geometry artifact.
 *
 * KNOWN-GOOD COLUMN: the MPFB rail, whose weights come from a real transfer. It is the reference the
 * threshold is derived from - 0.05 sits 3.6x above MPFB's measured 0.0139 and 3.6x below Anny's
 * 0.1795. Not fitted to clear an observation in either direction.
 *
 * FAILED TREATMENT, do not repeat: re-running a position paint over the garment AABB with more bones.
 * That is the defect with more entries. The offset step already knows which body vertex each shell
 * vertex came from - record the index and copy the groups. Blender's Data Transfer (nearest-face
 * interpolated) is the sanctioned fallback if that correspondence was not stored.
 *
 * WHY THIS IS NOT GRADEABLE: the figures ship at or near bind pose, so bad weights are invisible in a
 * still. `body-rig-appendage-motion-cagematch` analyses clip channels on BONES and says nothing about
 * whether the garment follows. This contract is the evidence, which is why clauses (3) and (4) exist.
 *
 * claimScope: whether a garment vertex's bone weights match the body vertex beneath it, on these two
 *   shipped assets, at bind pose, read from the exported glTF.
 * notEvidenceFor: how the cloth looks under motion; poke-through; whether the correspondence index is
 *   the right transfer mechanism; any asset not named here; the MakeClothes-fitted lower garments.
 */

const HUMANOIDS = "apps/ui-xr/public/generated-humanoids";
const ANNY_GLB = `${HUMANOIDS}/adult_male_street_casual.glb`;
const MPFB_GLB = `${HUMANOIDS}/mpfb-ob-patient-aisha.glb`;

/** 3.6x above the MPFB known-good, 3.6x below the measured Anny value. */
const MAX_DISAGREEMENT = 0.05;
/** Vertices this close to the skin cannot have an arguable nearest neighbour. */
const BAND_M = 0.008;

const annyGarment = () => measureGarmentWeightCorrespondence(
  ANNY_GLB, (n) => /anny_base/u.test(n), (n) => /real_garment_peds_upper_v1_mesh$/u.test(n), BAND_M);
const mpfbGarment = () => measureGarmentWeightCorrespondence(
  MPFB_GLB, (n) => /_body$/u.test(n), (n) => /toigo_t_shirt/u.test(n), BAND_M);

describe("a garment deforms like the body under it", () => {
  it.fails("(1) the Anny garment shell inherits the skin weights of the body it was derived from", async () => {
    const r = await annyGarment();
    expect(
      r.medianDisagreement,
      `median bone-weight disagreement between the garment and the skin beneath it. Position-painted `
      + `weights put the cloth on a different bone mix from the limb it covers, so it lags or tears the `
      + `moment the skeleton moves - and nothing in a bind-pose still can show it`,
    ).toBeLessThanOrEqual(MAX_DISAGREEMENT);
  }, 60_000);

  it("(2) KNOWN-GOOD COLUMN: the MPFB rail's transferred weights stay in band", async () => {
    // The reference the threshold is derived from. A fix that reaches clause (1) by loosening the
    // instrument, changing the metric, or rewriting the shared armature fails here too.
    const r = await mpfbGarment();
    expect(r.medianDisagreement, "MPFB's transfer is the reference for what correspondence looks like")
      .toBeLessThanOrEqual(MAX_DISAGREEMENT);
    expect(r.comparedVertices, "and it must still have vertices in the band to compare").toBeGreaterThan(500);
  }, 60_000);

  it("(3) COUNTERWEIGHT: the garment is still an offset shell on several bones, not shrink-wrap", async () => {
    // Two cheap ways to satisfy clause (1) without transferring anything: collapse the shell onto the
    // skin so every vertex is coincident, or drive the whole garment from one bone so the vectors are
    // trivially similar. Both destroy the garment. Bounds are on the ANNY asset, which is the one
    // under treatment - MPFB is untouched by the fix and cannot vouch for it.
    const r = await measureGarmentWeightCorrespondence(
      ANNY_GLB, (n) => /anny_base/u.test(n), (n) => /real_garment_peds_upper_v1_mesh$/u.test(n));
    expect(r.meanNearestMeters, "the shell must stand off the skin - a shrink-wrapped garment is not a garment")
      .toBeGreaterThan(0.005);
    expect(r.meanInfluencesPerVertex, "and must stay multi-bone - one bone per vertex is a rigid parent")
      .toBeGreaterThan(2);
  }, 60_000);

  it("(4) VACUITY GUARD: the instrument can tell a painted rail from a transferred one", async () => {
    // Without this, (1) and (2) could both pass on an instrument that returns a constant. Pins that
    // the metric is a function of the asset. Deliberately NOT an assertion about which is better -
    // only that they are distinguishable, so the contract cannot go green on a broken reader.
    const [anny, mpfb] = await Promise.all([annyGarment(), mpfbGarment()]);
    expect(anny.comparedVertices, "the Anny band must not be empty or clause (1) is green about nothing")
      .toBeGreaterThan(100);
    expect(
      Math.abs(anny.medianDisagreement - mpfb.medianDisagreement),
      "the two rails must measure differently today; if they do not, the reader is broken",
    ).toBeGreaterThan(0.02);
  }, 60_000);
});
