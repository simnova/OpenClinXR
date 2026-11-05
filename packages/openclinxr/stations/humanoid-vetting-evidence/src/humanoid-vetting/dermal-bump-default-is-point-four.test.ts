import { repoRoot } from "@openclinxr/factory-station-core/runner";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Diagnosis: factory default was 1.0, then 0.4; native bump-1.0 collar
 * cobblestone; bump-0.4 collar smooth but shipped hp detail too low
 * (hp 1.22 vs 1.68 floor). Strength 0.8 ships the F1 recipe (hp 2.10-2.26).
 *
 * r5 sweep (E=st-vitfacet-fix/neck-r5.json): neck cobblestone is present on
 * origin/main AND at dermal strength 0, and strength only modulates it ~5%
 * (nurse studio band1-4: main 4.378, s0 4.025, 0.8 4.236; runtime rig smooth
 * at all strengths, bands 0.9-1.7). The lever is not the dermal default:
 * STILL WRONG is studio-rig neck cobblestone from a non-dermal bake channel
 * (cheek hp2 nurse studio 0.468 main -> 0.405 shipped). Facets gone on six
 * faces at 0.8 (r3 re-bake).
 *
 * Source-assertion only: the DEFAULT bump string must be "0.8" (env
 * override stays). No Blender, no GLB, no rebake pixels.
 *
 * NOT TESTED: the rebake pixels themselves (r3 owns that; G4 tilt bar).
 */

const REPO_ROOT = repoRoot();
const MAT = join(REPO_ROOT, "tools/openclinxr/evidence/blender/materialize_mpfb_humanoid_candidate.py");

function mat(): string {
  expect(existsSync(MAT), `${MAT} — the factory materializer`).toBe(true);
  return readFileSync(MAT, "utf8");
}

describe("dermal bump default is 0.8", () => {
  it("reads DERMAL_BUMP_STRENGTH env with default \"0.8\"", () => {
    const src = mat();
    expect(src, "default string").toMatch(/DERMAL_BUMP_STRENGTH",\s*"0\.8"/);
    expect(src, "old 1.0 default gone").not.toMatch(/DERMAL_BUMP_STRENGTH",\s*"1\.0"/);
    expect(src, "0.4 default gone").not.toMatch(/DERMAL_BUMP_STRENGTH",\s*"0\.4"/);
  });
});
