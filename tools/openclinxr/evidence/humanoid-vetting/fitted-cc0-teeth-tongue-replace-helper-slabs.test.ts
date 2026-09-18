import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve as pathResolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * Teeth + tongue ship as helper-held slabs. The CC0 system-asset pack carries fitted
 * replacements and the materializer already proves the fit rail on eyes.
 *
 * MEASURED 2026-09-18 from the extracted `makehuman_system_assets_cc0.zip` tree:
 *
 *   teeth_base/teeth_base.mhclo   barycentric triples 15006-15111, ALL >= 13380
 *   tongue01/tongue01.mhclo       plain refs 13380-13605, ALL >= 13380
 *
 * Same helper-vert class as the eyes (helper-l-eye / helper-r-eye 14598-14741), so both
 * fits MUST run BEFORE the #318 helper strip. `HumanService._check_add_bodyparts` already
 * names "teeth" and "tongue" as add_mhclo_asset slots — the factory just never calls them.
 *
 * Licence: every staged .mhclo/.obj/.mhmat opens with "This asset was explicitly released
 * as CC0 in september 2020" (Data Collection AB, Joel Palmius, Jonas Hauquier) — the same
 * stamp as the shipped eyes. FACSHuman teeth/tongue are AGPL3 and stay refused.
 *
 * ## THE CHEAP FIXES THIS REFUSES
 *
 *   treatment                                                   | (1) | (2) | (3) | result
 *   -------------------------------------------------------------|-----|-----|-----|--------
 *   a) today — helper slabs, no fitted meshes                    |FAIL |FAIL |FAIL | REFUSED
 *   b) fitted meshes but helper slabs ALSO retained ("do both")  | pass|**FAIL**| pass| REFUSED
 *   c) fitted meshes with hand-authored geometry/material        | pass| pass|**FAIL**| REFUSED
 *   d) fitted CC0 teeth_base + tongue01, helpers retired         | pass| pass| pass| ALL PASS
 *
 * WHICH ARE REDS AND WHICH ARE NETS: (1) is the RED. (2) and (3) pass today (one set of
 * teeth exists; nothing is hand-authored) and are regression nets — (2) guards the #683
 * "do not do both" rule, (3) guards D1.
 *
 * claimScope: the materializer wires HumanService.add_mhclo_asset for CC0 teeth_base +
 *   tongue01 before the helper strip, with a header-stamp licence gate and declared-material
 *   consumption; helper-held teeth/tongue extraction is retired.
 * notEvidenceFor: whether the fitted teeth LOOK right (orchestrator grades pixels); headset
 *   budget; other actors; viseme displacement on the new teeth.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = pathResolve(HERE, "../../../..");
const MAT = join(REPO_ROOT, "tools/openclinxr/evidence/blender/materialize_mpfb_humanoid_candidate.py");
const LEDGER = join(REPO_ROOT, "docs/openclinxr/third-party-asset-licence-ledger.md");

function mat(): string {
  expect(existsSync(MAT), `${MAT} — the factory materializer`).toBe(true);
  return readFileSync(MAT, "utf8");
}

describe("fitted CC0 teeth and tongue replace the helper slabs", () => {
  it("(1) RED: the materializer fits CC0 teeth_base + tongue01 via add_mhclo_asset before the strip", () => {
    const src = mat();
    // Wiring: the proven MPFB-native call, one per feature, with the bodypart asset_type.
    expect(src, "teeth fit via HumanService.add_mhclo_asset").toMatch(/add_mhclo_asset\(\s*\n?\s*str\(_teeth_mhclo\)/);
    expect(src, "tongue fit via HumanService.add_mhclo_asset").toMatch(/add_mhclo_asset\(\s*\n?\s*str\(_tongue_mhclo\)/);
    expect(src, 'asset_type="teeth"').toMatch(/asset_type="teeth"/);
    expect(src, 'asset_type="tongue"').toMatch(/asset_type="tongue"/);
    // Order: the fits land before the #318 STRIP CALL in file order. The strip's own
    // docstring block and the solve_height_macro probe call both mention the call
    // earlier, so anchor on the LAST call site — the load-bearing strip in main().
    const teethAt = src.indexOf("str(_teeth_mhclo)");
    const tongueAt = src.indexOf("str(_tongue_mhclo)");
    const stripAt = src.lastIndexOf("bake_modifiers_remove_helpers(");
    expect(teethAt, "teeth fit site").toBeGreaterThan(-1);
    expect(tongueAt, "tongue fit site").toBeGreaterThan(-1);
    expect(stripAt, "helper strip call site").toBeGreaterThan(-1);
    expect(teethAt, "teeth fit must precede the helper strip").toBeLessThan(stripAt);
    expect(tongueAt, "tongue fit must precede the helper strip").toBeLessThan(stripAt);
    // Named staged sources, never a glob.
    expect(src, "TEETH_MHCLO names the staged teeth_base source").toMatch(/TEETH_MHCLO = [\s\S]{0,120}?facial\/teeth_base\/teeth_base\.mhclo/);
    expect(src, "TONGUE_MHCLO names the staged tongue01 source").toMatch(/TONGUE_MHCLO = [\s\S]{0,120}?facial\/tongue01\/tongue01\.mhclo/);
    // Licence gate on the header release stamp (no `# license` line on these headers).
    expect(src, "licence stamp gate").toMatch(/teeth_tongue_licence_stamp/);
    // Declared materials consumed through the generic .mhmat path.
    expect(src, "teeth declared material").toMatch(/teeth\.mhmat/);
    expect(src, "tongue declared material").toMatch(/tongue01\.mhmat/);
    expect(src, "generic mhmat path").toMatch(/make_material_from_mhmat\(\s*\n?\s*_teeth_mhclo\.parent/);
  });

  it("(2) COUNTERWEIGHT: exactly one teeth mesh and one tongue mesh — no helper slabs alongside", () => {
    const src = mat();
    // Both helper rails retired: empty group tuples, skipped with HM08_FEATURE_RETIRED.
    expect(src, "helper teeth rail retired").toMatch(/"teeth": \(\),/);
    expect(src, "helper tongue rail retired").toMatch(/"tongue": \(\),/);
    expect(src, "retired rails leave no mesh").toMatch(/HM08_FEATURE_RETIRED/);
  });

  it("(3) COUNTERWEIGHT: D1 — no hand-authored teeth/tongue geometry or material", () => {
    const src = mat();
    // The fitted meshes are named but never constructed: no new mesh/data/verts literals
    // in the teeth/tongue block, and materials come from the declared .mhmat files.
    const block = src.slice(src.indexOf("_teeth_mhclo = REPO_ROOT"), src.indexOf("HM08_FEATURES"));
    expect(block, "no bmesh construction in the teeth/tongue block").not.toMatch(/bmesh|from_mesh|verts\.new|faces\.new/);
    expect(block, "no flat colour authored for teeth/tongue").not.toMatch(/Base Color.*default_value|make_material\(/);
    expect(src, "FACSHuman AGPL assets refused by name").toMatch(/FACSHuman teeth\/tongue are AGPL/);
  });

  it("(4) the ledger records the CC0 teeth+ tongue row with quoted headers", () => {
    expect(existsSync(LEDGER), `${LEDGER}`).toBe(true);
    const ledger = readFileSync(LEDGER, "utf8");
    expect(ledger, "teeth_base row").toMatch(/teeth_base/);
    expect(ledger, "tongue01 row").toMatch(/tongue01/);
    expect(ledger, "quoted CC0 release stamp").toMatch(/This asset was explicitly released as CC0 in september 2020/);
    expect(ledger, "copyright holders quoted").toMatch(/Data Collection AB.*Joel Palmius.*Jonas Hauquier/);
    expect(ledger, "FACSHuman refusal recorded").toMatch(/FACSHuman.*AGPL/);
  });
});
