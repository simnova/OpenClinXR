import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * OBSERVABLE: the factory publishes the body cells it can build, the way it already publishes irises.
 *
 * SPECIFIED 2026-08-25 by a grok-4.6 consult the operator asked to drive this design. Its axes and its
 * cell count are DERIVED from translators that already exist, not chosen:
 *
 *   AGE_BANDS  infant (0,1] | child (1,12] | young (12,18] | adult (18,65] | older (65,90]
 *              — the five predicates in body_param_stage._years_to_age_macro, verified on this tree:
 *              y<=1.0 / y<=12.0 / y<=18.0 / y<=65.0 / else, and the 90 ceiling is that function's
 *              own `(y - 65.0) / 25.0`.
 *   SEX        female 0.0 | male 1.0 | unspecified 0.5
 *              — the three outcomes of body_param_stage._gender_presentation_to_macro.
 *   CELLS      AGE_BANDS x SEX = 15.   id = f"{ageBand}_{sex}".
 *
 * STATURE IS DELIBERATELY NOT AN AXIS. The consult amended its own earlier "age-band x sex x stature"
 * wording: height stays the #328 bake-measure-interpolate solver against authored `height_cm`, and
 * snapping stature to ticks would fight that solver.
 *
 * `body_profile` IS NOT A CELL. It is a role tag — `adult_clinical_physician`, `adult_clinical_team`.
 * Clause (4) refuses a manifest that catalogues role tags instead of buildable cells.
 *
 * CLOSED BY THE TRANSLATORS, NOT BY THE BANK. Measured: the bank occupies 4 of the 15 cells and 26
 * export rows carry no `gender_presentation` at all. Empty cells stay — the factory can bake them.
 * A manifest whose ids equal the bank's occupied set has catalogued authoring, not capability.
 *
 * THE MODEL BEING CLONED: iris-capability-manifest.json, generated from `iris_palette._EYE_IRIS_PACK`
 * and guarded by the-factory-publishes-what-it-can-build.test.ts. Clause (1) below obtains ids by
 * CALLING the pack, never by reading a list — the same §9h discipline that guard uses.
 *
 * FAILED TREATMENT, refused by clause (4): widening the iris guard instead of adding this one. Two
 * fields with different packs and different licence rows do not belong in one contract.
 *
 * FAILED TREATMENT, refused by clause (2): writing the ids into the generator as a literal. That is a
 * second source of truth and it is the defect the iris manifest was built to avoid.
 *
 * KNOWN-GOOD COLUMN: the iris manifest, which satisfies this shape today and is untouched here.
 *
 * NO SCALAR THRESHOLD APPEARS IN THIS CONTRACT. Every assertion is set membership or field presence.
 *
 * claimScope: whether a body-cell capability manifest exists and is derived from BODY_CELL_PACK.
 * notEvidenceFor: whether any cell has ever been baked; the stature envelope reachable per cell; the
 *   adapter that would pick a cell when a case omits `gender_presentation`, which the consult listed
 *   as NOT TESTED and which this slice does not build.
 */

const MAKECLOTHES = "packages/openclinxr/factory-stations/src/body_param";
const MANIFEST = "packages/openclinxr/asset-registry/src/body-cell-capability-manifest.json";
const IRIS_MANIFEST = "packages/openclinxr/asset-registry/src/iris-capability-manifest.json";

type Option = { id: string; ageBand?: string; sex?: string; ageMacro?: number; genderMacro?: number; licence?: string };

/** §9h — the cells the STAGE can build, obtained by calling its pack, never by reading a list. */
function packFromStage(): string[] {
  const py = [
    "import sys, json",
    `sys.path.insert(0, ${JSON.stringify(MAKECLOTHES)})`,
    "from body_param_stage import BODY_CELL_PACK",
    "print(json.dumps(sorted(c['id'] for c in BODY_CELL_PACK)))",
  ].join("\n");
  return JSON.parse(execFileSync("python3", ["-c", py], { encoding: "utf8" }).trim()) as string[];
}

const manifest = (): { options?: Option[]; derivedFrom?: string; generatedBy?: string; field?: string } =>
  JSON.parse(readFileSync(MANIFEST, "utf8"));

describe("the factory publishes body cells", () => {
  it("(1) a body-cell manifest exists and lists exactly what the stage can build", () => {
    expect(existsSync(MANIFEST), `${MANIFEST} must exist`).toBe(true);
    const ids = (manifest().options ?? []).map((o) => o.id).sort();
    expect(
      ids,
      "the published cells must equal the pack obtained by CALLING body_param_stage, not a hand list",
    ).toEqual(packFromStage());
  });

  it("(2) the manifest is DERIVED from the stage's pack, not a second literal", () => {
    const m = manifest();
    expect(m.field, "the manifest names its field").toBe("body_cell");
    expect(m.derivedFrom ?? "", "derivedFrom names BODY_CELL_PACK in body_param_stage")
      .toMatch(/body_param_stage\.py::BODY_CELL_PACK/u);
    expect(m.generatedBy ?? "", "generatedBy names the generator that produces this file")
      .toMatch(/generate_body_cell_capability_manifest\.py/u);
  });

  it("(3) every published cell carries the fields a caller needs to choose one", () => {
    const options = manifest().options ?? [];
    const incomplete = options
      .filter((o) => ["ageBand", "sex", "ageMacro", "genderMacro", "licence"].some((k) => (o as Record<string, unknown>)[k] === undefined))
      .map((o) => o.id);
    expect(options.length, "the manifest must not be empty").toBeGreaterThan(0);
    expect(incomplete, "a cell without its macros is not choosable").toEqual([]);
  });

  it("(4) NET: role tags are not cells, and the iris manifest is untouched", () => {
    // Refuses cataloguing `body_profile` role tags as capability, and refuses widening the iris guard
    // into a second field. Both are green today; a fix that breaks either has gone the wrong way.
    expect(existsSync(IRIS_MANIFEST), "the iris manifest is the model, not the target").toBe(true);
    const iris = JSON.parse(readFileSync(IRIS_MANIFEST, "utf8")) as { field?: string; options?: Option[] };
    expect(iris.field, "the iris manifest still publishes eye_color").toBe("eye_color");
    expect((iris.options ?? []).length, "the iris options are unchanged").toBeGreaterThan(0);
    if (existsSync(MANIFEST)) {
      const roleTagged = (manifest().options ?? [])
        .map((o) => o.id)
        .filter((id) => /^adult_clinical_|_parent$|_team$/u.test(id));
      expect(roleTagged, "a body_profile role tag is not a bakeable cell").toEqual([]);
    }
  });

  /*
   * ## FIXED (#670)
   * Clauses (1)-(3) flipped from it.fails to it. The fix:
   *   - `BODY_CELL_PACK` added to body_param_stage.py — ONE literal for capability:
   *     5 age bands (the predicates _years_to_age_macro implements: <=1 / <=12 / <=18 /
   *     <=65 / else, 90 ceiling = its own `(y-65)/25`) x 3 sex outcomes of
   *     _gender_presentation_to_macro. ageMacro computed BY CALLING
   *     _years_to_age_macro at the band midpoint, never typed.
   *   - generate_body_cell_capability_manifest.py derives
   *     body-cell-capability-manifest.json by importing that pack; the generator also
   *     re-reads licence ledger lines 100-101 and aborts if they stop saying what the
   *     licence string claims ("build-time tool" / "CC0 1.0" / "#343").
   *   - `import bpy` at body_param_stage module level is now guarded (try/except
   *     ImportError -> bpy = None) so the pack is importable under plain python3 by
   *     this contract's probe. No module-level statement uses bpy/Vector; the Blender
   *     path is unchanged (same pattern as orchestrate_character.py's guarded FastAPI).
   * Part 2 (--reference sex): materialize_mpfb_humanoid_candidate.main() now sets
   *   macro["gender"] via _case_gender_macro_for_reference() — reads
   *   input_params.phenotype.gender_presentation through phenotype_numeric_block,
   *   translates with body_param_stage._gender_presentation_to_macro (no second map),
   *   refuses when the key is absent or when phenotype_summary maps to a DIFFERENT
   *   macro than the phenotype block (measured live: ed_chest_pain_nurse_adult authors
   *   adult_female_nurse vs adult_male_nurse -> refuses). Same-macro string variants
   *   bake; a no-signal summary does not veto. measure_reference untouched; age stays
   *   head-height-fraction; height stays solve_height_macro. Stature is NOT an axis.
   */
});
