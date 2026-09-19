import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve as pathResolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * The clearance station must match the fitted CC0 teeth mesh, not only hm08.
 *
 * The factory now fits CC0 `teeth_base` as `openclinxr_fitted_teeth_mpfb_<subject>_mesh`
 * while the station only matched `/hm08_teeth/i`, so a nurse rebake cannot be retreated.
 * #739 already finds teeth with `/teeth/i`; the station must match that.
 *
 * claimScope: the station regex covers both mesh names and refuses on zero teeth meshes.
 * notEvidenceFor: whether any clearance value is correct (that is #738/#739's measurement);
 *   how anything looks (pixel grade). No GLB is written by this test.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = pathResolve(HERE, "../../../..");
const STATION = join(REPO_ROOT, "tools/openclinxr/asset-pipeline/makeclothes/teeth-rest-clearance.ts");
const SHIPPED_NURSE = join(REPO_ROOT, "apps/ui-xr/public/generated-humanoids/mpfb-clinical-nurse-adult.glb");

function station(): string {
  expect(existsSync(STATION), `${STATION}`).toBe(true);
  return readFileSync(STATION, "utf8");
}

describe("teeth-rest-clearance matches fitted and hm08 teeth", () => {
  it("(1) the station regex matches the fitted CC0 name and the hm08 slab", () => {
    const src = station();
    const m = /const TEETH_RE = (\/.*?\/[a-z]*);/.exec(src);
    expect(m, "TEETH_RE declared as a regex literal in the station").not.toBeNull();
    const re = new RegExp(m![1]!.slice(1, m![1]!.lastIndexOf("/")), m![1]!.slice(m![1]!.lastIndexOf("/") + 1));
    expect(re.test("openclinxr_fitted_teeth_mpfb_nurse1_mesh"), "fitted CC0 name").toBe(true);
    expect(re.test("hm08_teeth"), "legacy hm08 slab").toBe(true);
    expect(re.test("openclinxr_hm08_teeth_mpfb_ob_patient_aisha_mesh"), "shipped prefixed slab").toBe(true);
  });

  it("(2) the station refuses when zero teeth meshes are present (fail-closed)", () => {
    const src = station();
    expect(src, "zero-teeth throw").toMatch(/teethMeshes\.length === 0/);
    expect(src, "multi-teeth throw").toMatch(/teethMeshes\.length > 1/);
    expect(src, "no silent skip").not.toMatch(/hm08_teeth mesh found/);
  });

  it("(3) --dry on the shipped nurse GLB still finds a teeth mesh and writes nothing", () => {
    if (!existsSync(SHIPPED_NURSE)) return;
    const before = readFileSync(SHIPPED_NURSE);
    const out = execFileSync("pnpm", ["exec", "tsx", STATION, SHIPPED_NURSE, "--dry"],
      { cwd: REPO_ROOT, encoding: "utf8", timeout: 120000 });
    const report = JSON.parse(out);
    expect(report.meshes.length, "dry run finds the teeth mesh").toBeGreaterThan(0);
    expect(report.action, "dry run writes nothing").toMatch(/no write/);
    expect(readFileSync(SHIPPED_NURSE).equals(before), "shipped GLB bytes unchanged").toBe(true);
  });
});

// NOT TESTED: whether any --delta value clears the face (that is #738/#739's instrument);
// --probe output against a fitted rebake (no fitted GLB exists in-tree yet).
