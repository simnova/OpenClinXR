import { edChestPainScenario } from "@openclinxr/scenario-fixtures";
import { describe, expect, it } from "vitest";
import { assembleExamForm, createDefaultClinicalSkillsBlueprint } from "./index.js";

describe("exam assembly", () => {
  it("assembles approved scenarios into an ordered exam form with complete coverage", () => {
    const blueprint = createDefaultClinicalSkillsBlueprint();
    const form = assembleExamForm({
      examFormId: "form_openclinxr_pilot_001",
      blueprint,
      scenarios: [edChestPainScenario],
    });

    expect(form.status).toBe("ready_for_review");
    expect(form.stationRefs).toEqual([
      {
        order: 1,
        scenarioId: "ed_chest_pain_priority_v1",
        scenarioVersion: 1,
        title: "ED Chest Pain With Nurse Interruption And Family Pressure",
      },
    ]);
    expect(form.coverage.missingTraceTags).toEqual([]);
    expect(form.coverage.coveredTraceTags).toEqual(edChestPainScenario.requiredTraceTags);
  });

  it("marks forms with missing required coverage as incomplete", () => {
    const blueprint = {
      ...createDefaultClinicalSkillsBlueprint(),
      requiredTraceTags: [...edChestPainScenario.requiredTraceTags, "shared_decision_making"],
    };
    const form = assembleExamForm({
      examFormId: "form_openclinxr_pilot_coverage_gap",
      blueprint,
      scenarios: [edChestPainScenario],
    });

    expect(form.status).toBe("coverage_incomplete");
    expect(form.coverage.missingTraceTags).toEqual(["shared_decision_making"]);
  });

  it("rejects unapproved scenarios before exam form lock", () => {
    expect(() =>
      assembleExamForm({
        examFormId: "form_unapproved",
        blueprint: createDefaultClinicalSkillsBlueprint(),
        scenarios: [{ ...edChestPainScenario, status: "draft" }],
      }),
    ).toThrow("Cannot assemble unapproved scenario");
  });
});
