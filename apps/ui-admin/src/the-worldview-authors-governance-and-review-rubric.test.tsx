import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * OBSERVABLE: ScenarioSchema.review, reviewRubric, and governance are
 * merge-preserved. Faculty worldview cannot see or tweak Q4 review gates,
 * rubric items, or scoreUseLabel on the case they are compiling.
 *
 * MEASURED 2026-08-29. mergeFormValuesIntoScenario comment
 * case-authoring-model.ts:339-340 "preserving every field the form does not
 * expose (review gates, governance, rubric)". ScenarioFormValues has none of
 * those keys (case-authoring-model.ts:174-191).
 *
 * Diagnosis header IMMUTABLE. Flip it.fails → it and append ## FIXED.
 */

const SRC = dirname(fileURLToPath(import.meta.url));
const MODEL = readFileSync(join(SRC, "case-authoring-model.ts"), "utf8");
const SLICE = MODEL.slice(
  MODEL.indexOf("export type ScenarioFormValues"),
  MODEL.indexOf("export type ScenarioActorFormValue"),
);

describe("the worldview authors governance and review rubric", () => {
  it("(1) ScenarioFormValues includes governance", () => {
    expect(SLICE).toMatch(/governance/);
  });

  it("(2) ScenarioFormValues includes reviewRubric", () => {
    expect(SLICE).toMatch(/reviewRubric/);
  });

  it("(3) COUNTERWEIGHT: createEmptyScenarioDraft still ships formative governance", () => {
    expect(MODEL).toContain('scoreUseLabel: "formative_local_only"');
  });
});

// NOT TESTED: #167 never; validated_summative; clinical review quality.

// ## FIXED (tsk_3007002d210229a8)
// ScenarioFormValues now carries governance (Scenario["governance"]) and
// reviewRubric (Scenario["reviewRubric"]); scenarioToFormValues projects them
// and mergeFormValuesIntoScenario round-trips them (form-authored governance wins,
// hidden members fall back to the base). CaseAuthoringWorkbench surfaces bounded
// faculty controls: scoreUseLabel/validationStage Selects exclude validated_summative
// and stage_3_validated, stage_0 is never auto-approved, and rubric items are
// editable rows. createEmptyScenarioDraft still ships
// scoreUseLabel: "formative_local_only" / stage_0_synthetic_draft (clause 3).
