import { describe, expect, it } from "vitest";
import { inspectGarmentHemBoundary } from "./garment-hem-boundary.js";

/**
 * **OBSERVABLE: the lower-coverage predicate reports what a rail actually does, or says it cannot.**
 *
 * ## MEASURED BY THE ORCHESTRATOR ON HEAD db323030, 2026-08-23 — do not re-derive
 *
 * NodeIO mesh/material dump of the two rails:
 *
 *     mpfb-gown-adult-patient.glb   (MPFB)
 *       body  mat=openclinxr_hidden_lower_*      402 tris   <- MPFB HIDES body regions
 *       body  mat=openclinxr_hidden_upper_*     2716 tris
 *       openclinxr_real_garment_peds_upper_v1   5829 tris   (UPPER only)
 *       -> no lower garment mesh of any kind
 *
 *     peds_nurse_kevin.glb          (Anny, the control that passes today)
 *       body  mat=openclinxr_role_mesh_clothing_nurse_*  2144 + 2840 tris  <- Anny PAINTS
 *
 * `garment-hem-boundary.ts:17` matches `/openclinxr_role_mesh_clothing_.*_lower/i` and nothing else,
 * so `hasPaintedLowerRegion` is FALSE for every MPFB asset **by construction**. Its verdict on that
 * rail is meaningless, not negative — the same structural-zero shape as #586's `quiet=0`.
 *
 * ## THE PRODUCT QUESTION IS ALREADY ANSWERED — do not re-open it
 *
 * I graded `mpfb-gown-adult-patient.glb` at native resolution: a plain cyan knee-length hospital
 * gown, three-quarter sleeves, bare lower legs below the hem, shoes. **She is not undressed.** The
 * bare calves are correct for the garment. Do NOT change any asset, bake, garment or material under
 * this card. This is an instrument slice.
 *
 * ## WHY IT MATTERS BEYOND ONE ASSET
 *
 * D11 names MPFB first-class for standard rig, face shape keys and MakeHuman wardrobe. A predicate
 * that can only ever return one answer for that whole rail is not a measurement, and every MPFB
 * humanoid currently passes or fails #124's hem-overlap counterweight for reasons unrelated to its
 * coverage.
 *
 * ## THE CRASH MUST BE FIXED FIRST — AND THE FIX ALREADY EXISTS ON MAIN
 *
 * Planting this contract surfaced a third instance of the spread-overflow class:
 *
 *     RangeError: Maximum call stack size exceeded
 *       at collectBodyMesh  tools/openclinxr/evidence/garment-hem-boundary.ts:509
 *       509|  const minY = Math.min(...positions.map((v) => v.y));
 *
 * Six consecutive spread calls, identical to the ones #589 removed from `open-front-underlayer.ts`
 * hours earlier — and #589 landed the shared single-pass helper `min-max-bounds.ts` on main for
 * exactly this. **D1: wire the proven tool, do not hand-roll a second one.** Until that lands here,
 * `peds_nurse_kevin.glb` cannot be measured at all, which is why clause (3) — the known-good column —
 * is planted RED rather than green. A known-good column that cannot run is not a known-good column,
 * and pretending otherwise would be the vacuity this repo keeps catching.
 *
 * Fix order is therefore: wire `min-max-bounds.ts` here (clause 3 goes green on the Anny rail),
 * then teach the predicate the MPFB vocabulary (clauses 1, 2, 4).
 *
 * claimScope: whether the lower-coverage predicate can express what each rail does.
 * notEvidenceFor: whether any humanoid is adequately dressed; garment fit; the gown's silhouette.
 */

const MPFB = "apps/ui-xr/public/generated-humanoids/mpfb-gown-adult-patient.glb";
const ANNY = "apps/ui-xr/public/generated-humanoids/peds_nurse_kevin.glb";

type Row = {
  hasPaintedLowerRegion: boolean;
  /** #594: which vocabulary the verdict came from — absent today, which is the defect. */
  lowerCoverageRail?: string;
};

async function row(glb: string): Promise<Row> {
  const r = (await inspectGarmentHemBoundary({ glbPaths: [glb] })) as unknown as { assets: Row[] };
  expect(r.assets.length, `${glb} must produce a row`).toBeGreaterThan(0);
  return r.assets[0]!;
}

describe("the lower-coverage predicate reads both rails", () => {
  it.fails("(1) RED: an MPFB asset's verdict names the vocabulary it was measured in", async () => {
    // Today there is no such field: the predicate reports a bare false and the caller cannot tell a
    // real zero from an unsupported rail.
    const r = await row(MPFB);
    expect(typeof r.lowerCoverageRail, "the verdict must say which rail vocabulary it read").toBe("string");
  });

  it.fails("(2) RED: MPFB hide-regions are recognised as lower coverage", async () => {
    // mpfb-gown-adult-patient carries openclinxr_hidden_lower_* at 402 tris. The MPFB rail expresses
    // coverage by hiding body faces rather than painting them; the predicate must read that.
    const r = await row(MPFB);
    expect(r.hasPaintedLowerRegion, "MPFB lower coverage is invisible to the Anny-only matcher").toBe(true);
  });

  it.fails("(3) KNOWN-GOOD COLUMN — BLOCKED BY A CRASH, see header: the Anny rail still measures as today", async () => {
    // peds_nurse_kevin carries 2144 + 2840 painted lower tris. This must not change, and it pins the
    // premise: without a rail that genuinely reports true, clause (2) could be satisfied by making
    // the predicate return true for everything.
    const r = await row(ANNY);
    expect(r.hasPaintedLowerRegion, "the Anny control must keep reporting real painted coverage").toBe(true);
  });

  it.fails("(4) COUNTERWEIGHT: an unrecognised vocabulary is NOT treated as coverage", async () => {
    // Refuses the cheap green on (2) — "if we cannot tell, say covered" would green the whole rail
    // vacuously and destroy the only signal this predicate carries. A rail the code does not
    // understand must report a NAMED unknown, never a silent true.
    const r = await row(MPFB);
    expect(["anny_paint", "mpfb_hide", "unknown"], `unexpected rail label ${r.lowerCoverageRail}`)
      .toContain(r.lowerCoverageRail ?? "missing");
  });
});
