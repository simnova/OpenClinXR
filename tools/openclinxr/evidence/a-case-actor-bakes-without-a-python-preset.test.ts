import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * OBSERVABLE: a case's actor can be baked from the phenotype its case authors, without someone first
 * hand-writing a preset for that actor inside a pipeline script.
 *
 * MEASURED 2026-08-24, do not re-derive.
 *
 *   actors across the 14 shipped case fixtures                        104
 *   of those, actors whose case authors a phenotype                     4   (all in pediatric-asthma.ts)
 *   characters hardcoded in orchestrate_character.py                    4
 *   `"height_cm": <int>` literals in orchestrate_character.py           4   (:72 125, :108 166, :144 176, :184 178)
 *
 * **The factory can bake 4 of 104 actors, and every one of them required a hand-written Python
 * preset.** `PRESETS` is keyed `scenarioId:actorId` at `:208-209`, so a fifteenth case means editing
 * Python, not authoring a case. That is the D9 dark-factory failure exactly: a hand-authored table of
 * people inside a pipeline station.
 *
 * WHAT I GOT WRONG TWICE BEFORE WRITING THIS, both corrected on #647 rather than quietly:
 *   1. "Two of eleven shipped bodies are phenotype-driven, nine are generator defaults." Wrong. Every
 *      Anny manifest carries an authored `height_cm` and every shipped body matches its own; the
 *      cluster at 1.760 is four actors who are all 176 cm, not a default firing.
 *   2. "Zero are phenotype-driven; the solver never runs." Also wrong, in the other direction. The
 *      height reaches the vertices today - via the manifest, not via `body_param_stage.py`.
 * The height->vertex path is NOT the gap. **The gap is where the number comes from**, and it comes
 * from a Python literal that agrees with `pediatric-asthma.ts:116` by hand-maintenance.
 *
 * KNOWN-GOOD COLUMN - clause (2): the four existing presets. Their `height_cm` values are the proof
 * that the pipeline honours a described human, and they must not move. A fix that reaches clause (1)
 * by rewriting the macro path drags them.
 *
 * COUNTERWEIGHT - clause (3): **the preset table must not GROW.** Adding a fifth hardcoded entry
 * satisfies "one more actor can bake" and re-authors the defect with one more row. Coverage rises;
 * hand-written entries do not.
 *
 * FAILED TREATMENT, do not repeat: moving the four presets into a JSON or YAML file. That is the same
 * table in a different syntax and clause (3) counts it the same way. The values must be READ from the
 * scenario fixtures, which already own `phenotype` as a case-definition field.
 *
 * claimScope: counts of authored phenotypes, fixture actors, and hardcoded pipeline presets, read
 *   statically from the sources named above.
 * notEvidenceFor: whether a newly covered actor bakes to a good-looking figure; the non-height
 *   phenotype fields; garments; rigging; whether 104 actors SHOULD all have distinct bodies.
 *
 * ## FIXED (#650)
 *
 * `ed-chest-pain.ts` now authors a `phenotype` block for `patient_robert_hayes_v1`
 * (the ED patient; the v2/v3 fixtures spread the v1 actor record, so the block
 * lands in both exported ED variants). The values reproduce the legacy ED
 * preset's described human (height 178 cm is a pinned known-good) minus the
 * pipeline-only knobs (seed, output_name, anny_topology, sleeveGeometryExpansion).
 * `orchestrate_character.py` flipped its #601 seam (`resolve_case_actor_params`)
 * to resolve from the case-definition export FIRST — the case is the source; the
 * four legacy preset rows remain as the pinned known-good baseline clauses (2)-(4)
 * pin in place, and remain functional only as the fallback for the one preset
 * actor the export does not cover (ed_chest_pain_priority_v2:patient_ed_chest_pain_v1).
 * `PIPELINE_PHENOTYPE_DEFAULTS` gained `patient_robert_hayes_v1` so the proven
 * ED gown geometry path is preserved for the newly authored actor.
 * `actor-phenotype.v1.json` was regenerated from the fixtures (15 cases / 32
 * actors; only robert's entries changed, derived -> authored).
 * Measured after: **2** cases author a phenotype in fixture source
 * (pediatric-asthma, ed-chest-pain); all four pinned heights still resolve to
 * the same params; the three migrated peds actors' params are byte-identical
 * to the legacy preset params they replaced as the primary source.
 */

const ORCHESTRATE = "tools/openclinxr/asset-pipeline/anny/orchestrate_character.py";
const FIXTURE_DIR = "packages/openclinxr/scenario-fixtures/src";
const CASES = [
  "pediatric-asthma", "ed-chest-pain", "ob-preeclampsia", "stroke-alert", "psychiatric-safety",
  "abdominal-pain-interpreter", "postop-fever", "adult-abdominal-pain", "telehealth-diabetes",
  "stepdown-sepsis", "primary-care-dyslipidemia", "peds-fever", "ward-delirium", "oncology-bad-news",
] as const;

/** Hand-written per-actor entries inside the pipeline script. */
const hardcodedPresetCount = (): number =>
  (readFileSync(ORCHESTRATE, "utf8").match(/"actor_id":\s*"/gu) ?? []).length;

/** Cases whose fixture authors at least one `phenotype:` block. */
const casesAuthoringAPhenotype = (): string[] =>
  CASES.filter((c) => /phenotype:\s*\{/u.test(readFileSync(`${FIXTURE_DIR}/${c}.ts`, "utf8")));

describe("a case actor bakes without a python preset", () => {
  it("(1) more than one case authors the humans its own actors are baked from", () => {
    const authoring = casesAuthoringAPhenotype();
    expect(
      authoring,
      `only ${authoring.join(", ") || "none"} authors a phenotype. The other cases' actors cannot be `
      + "baked as themselves — a fifteenth case means editing orchestrate_character.py, not authoring "
      + "a case, which is the D9 hand-authored-table failure",
    ).not.toHaveLength(1);
  });

  it("(2) KNOWN-GOOD COLUMN: the described humans the pipeline already honours keep their stature", () => {
    // These four heights reach the shipped meshes today (125 -> 1.241 m, 166 -> 1.660, 176 -> 1.760).
    // A fix that rewires the macro path instead of the SOURCE of the number would move them.
    const py = readFileSync(ORCHESTRATE, "utf8");
    const heights = [...py.matchAll(/"height_cm":\s*(\d+)/gu)].map((m) => Number(m[1]));
    for (const expected of [125, 166, 176, 178]) {
      expect(heights, `height_cm ${expected} is a described human the pipeline honours today`)
        .toContain(expected);
    }
  });

  it("(3) COUNTERWEIGHT: the hand-written preset table does not grow", () => {
    // The cheap fix is a fifth hardcoded entry — one more actor bakes, the defect gains a row.
    // Coverage must rise without the table rising. Moving the table to JSON is the same table in a
    // different syntax; this counts `actor_id` keys wherever they live in the script.
    expect(
      hardcodedPresetCount(),
      "orchestrate_character.py had 4 hand-written actor presets when this was planted; covering more "
      + "actors must not mean writing more of them",
    ).toBeLessThanOrEqual(4);
  });

  it("(4) VACUITY GUARD: both counters are reading real sources", () => {
    // Without this, clause (1) passes on a fixture glob that matches nothing and clause (3) on a
    // regex that never matches. Pins that the numbers are non-zero and the file list is complete.
    expect(CASES.length, "the shipped bank is 14 cases").toBe(14);
    expect(hardcodedPresetCount(), "the preset table must be found, not silently empty").toBeGreaterThan(0);
    expect(casesAuthoringAPhenotype().length, "pediatric-asthma authors one today").toBeGreaterThan(0);
  });
});
