import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve as pathResolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * The forward-place station must match any tongue mesh and refuse on zero or many.
 *
 * The factory fits CC0 `tongue01` as `openclinxr_fitted_tongue_mpfb_<subject>_mesh`
 * while the station only matches `/tongue/i`; both the legacy `hm08_tongue` slab and
 * the fitted CC0 mesh must be covered.
 *
 * claimScope: the station regex covers both mesh names and refuses on zero or >1 tongue meshes.
 * notEvidenceFor: whether any forward-placement value is correct (that is a separate measurement);
 *   how anything looks (pixel grade). No GLB is written by this test.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = pathResolve(HERE, "../../../..");
const STATION = join(REPO_ROOT, "tools/openclinxr/asset-pipeline/makeclothes/tongue-forward-place.ts");
const SHIPPED_PATIENT = join(REPO_ROOT, "apps/ui-xr/public/generated-humanoids/mpfb-gown-adult-patient.glb");

function station(): string {
  expect(existsSync(STATION), `${STATION}`).toBe(true);
  return readFileSync(STATION, "utf8");
}

describe("tongue-forward-place refuses zero or many meshes", () => {
  it("(1) the station regex matches the fitted CC0 name and the hm08 slab", () => {
    const src = station();
    const m = /const TONGUE_RE = (\/.*?\/[a-z]*);/.exec(src);
    expect(m, "TONGUE_RE declared as a regex literal in the station").not.toBeNull();
    const re = new RegExp(m![1]!.slice(1, m![1]!.lastIndexOf("/")), m![1]!.slice(m![1]!.lastIndexOf("/") + 1));
    expect(re.test("openclinxr_fitted_tongue_mpfb_nurse1_mesh"), "fitted CC0 name").toBe(true);
    expect(re.test("hm08_tongue"), "legacy hm08 slab").toBe(true);
    expect(re.test("openclinxr_hm08_tongue_mpfb_ob_patient_aisha_mesh"), "shipped prefixed slab").toBe(true);
  });

  it("(2) the station refuses when zero tongue meshes are present (fail-closed)", () => {
    const src = station();
    expect(src, "zero-tongue throw").toMatch(/tongueMeshes\.length === 0/);
    expect(src, "multi-tongue throw").toMatch(/tongueMeshes\.length > 1/);
  });

  it("(3) --dry on the shipped patient GLB still finds a tongue mesh and writes nothing", () => {
    if (!existsSync(SHIPPED_PATIENT)) return;
    const before = readFileSync(SHIPPED_PATIENT);
    const out = execFileSync("pnpm", ["exec", "tsx", STATION, SHIPPED_PATIENT, "--dry"],
      { cwd: REPO_ROOT, encoding: "utf8", timeout: 120000 });
    const report = JSON.parse(out);
    expect(report.meshes.length, "dry run finds the tongue mesh").toBeGreaterThan(0);
    expect(report.action, "dry run writes nothing").toMatch(/no write/);
    expect(readFileSync(SHIPPED_PATIENT).equals(before), "shipped GLB bytes unchanged").toBe(true);
  });
});

// NOT TESTED: whether any --delta value clears the teeth row at "aa" viseme (separate measurement);
// --probe output against a fitted rebake (no fitted GLB exists in-tree yet).