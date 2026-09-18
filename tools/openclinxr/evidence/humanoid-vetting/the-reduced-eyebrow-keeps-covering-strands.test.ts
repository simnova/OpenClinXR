import { readFileSync } from "node:fs";
import { dirname, join, resolve as pathResolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * The reduced eyebrow keeps covering strands, not a dusting.
 *
 * MEASURED 2026-09-18 (bake4, `ed_chest_pain_nurse_adult`, mindfront_eyebrows_06):
 * EYEBROW_REDUCTION kept 200 of 1,775 strands at the 3,600-tri budget for
 * 247/2304 band cells (10.7%) — the 10% band-ink floor from bstar-sweep, and a
 * dusting at face-crop framing. The in-bake station runs the greedy phase ONLY;
 * the proven bstar-sweep select() has a second phase (densest-ink-per-tri fill,
 * ported in ladder-rebake.ts) that spends leftover budget on the strands
 * carrying the most band ink. The bake never runs it.
 *
 * FAILED treatment refused here: raising tris to 21k (speckle, not arch).
 *
 * WHICH ARE REDS AND WHICH ARE NETS: (1) is the RED. (2) and (3) are
 * regression nets — (2) caps the budget so the fix cannot replay the 21k
 * speckle, (3) guards D1 (no hand-authored brow geometry).
 *
 * claimScope: the factory reducer runs greedy + densest fill inside a capped
 *   budget, and the materializer calls it with that raised budget.
 * notEvidenceFor: whether the filled arch LOOKS right (orchestrator grades
 *   pixels); headset; other actors; meshopt on the new afterTris.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = pathResolve(HERE, "../../../..");
const REDUCER = join(
  REPO_ROOT,
  "tools/openclinxr/asset-pipeline/makeclothes/eyebrow_strand_reduction.py",
);
const MAT = join(
  REPO_ROOT,
  "tools/openclinxr/evidence/blender/materialize_mpfb_humanoid_candidate.py",
);

describe("the reduced eyebrow keeps covering strands", () => {
  it("(1) RED: the reducer fills leftover budget with the densest covering strands", () => {
    const src = readFileSync(REDUCER, "utf8");
    // Phase 2 exists: after the greedy loop breaks, a second pass spends the
    // remaining budget ordered by band ink per triangle.
    expect(src, "phase-2 densest fill after the greedy phase").toMatch(
      /phase.?2|densest/i,
    );
    expect(src, "fill orders remaining strands by ink per tri").toMatch(
      /ink.*per.*tri|per.*tri.*ink/i,
    );
    // The materializer actually spends more than the dusting budget.
    const mat = readFileSync(MAT, "utf8");
    const m = mat.match(/budget_tris=(\d+)/);
    expect(m, "materializer passes an explicit brow budget").not.toBeNull();
    expect(
      Number(m![1]),
      "brow budget raised above the 3600 dusting floor",
    ).toBeGreaterThan(3600);
  });

  it("(2) COUNTERWEIGHT: the raised budget stays far below the 21k speckle", () => {
    const mat = readFileSync(MAT, "utf8");
    const m = mat.match(/budget_tris=(\d+)/);
    expect(m, "materializer passes an explicit brow budget").not.toBeNull();
    expect(
      Number(m![1]),
      "brow budget must not replay the 21k-speckle treatment",
    ).toBeLessThanOrEqual(10000);
  });

  it("(3) COUNTERWEIGHT: D1 — the reducer deletes only, never authors geometry", () => {
    const src = readFileSync(REDUCER, "utf8");
    expect(src, "no vertex construction in the reducer").not.toMatch(
      /verts\.new|faces\.new|from_pydata|bmesh\.ops\.create/,
    );
  });
});
