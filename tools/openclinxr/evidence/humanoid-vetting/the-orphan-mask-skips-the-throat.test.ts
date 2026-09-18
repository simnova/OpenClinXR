import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve as pathResolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * Orphan-throat skip: `_extend_mask_to_orphaned_quads` must not hide a
 * skin component whose centroid sits above the neck band, because the
 * throat (~1.46 m / 1.76 m stature ~= 0.83 H) falls inside the hem band
 * (0.60-0.85 H) named in the function's diagnosis comment and became MASK
 * in front of skin at the collar V (x=0 y=1.45-1.46, orchestrator raycast
 * on /tmp/openclinxr-f1-scrub1/mpfb-clinical-nurse-adult.glb).
 *
 * Source-assertion only: no Blender, no GLB, no F1/DERMAL staging.
 *
 * NOT TESTED: the rebake pixels themselves (nurse rebake card owns that).
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = pathResolve(HERE, "../../../..");
const MAT = join(REPO_ROOT, "tools/openclinxr/evidence/blender/materialize_mpfb_humanoid_candidate.py");

function mat(): string {
  expect(existsSync(MAT), `${MAT} — the factory materializer`).toBe(true);
  return readFileSync(MAT, "utf8");
}

describe("the orphan mask skips the throat", () => {
  it("prints ORPHAN_EXTEND_SKIP_THROAT for neck-band islands", () => {
    const src = mat();
    expect(src, "skip print string").toMatch(/ORPHAN_EXTEND_SKIP_THROAT/);
  });

  it("gates the skip on 0.78 * stature and excludes throat roots from the hide set", () => {
    const src = mat();
    expect(src, "neck band from the body's own stature").toMatch(/0\.78\s*\*\s*stature_z/);
    expect(src, "throat roots excluded from orphan_polys").toMatch(/not in throat_roots/);
    expect(src, "hem/waist/boot orphans still hidden").toMatch(/slot="orphan"/);
  });
});
