import { edChestPainScenario } from "@openclinxr/scenario-fixtures";
import { describe, expect, it } from "vitest";
import { assembleExamForm, createDefaultClinicalSkillsBlueprint, evaluateScenarioVersionDrift } from "./index.js";

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

  it("reports station count, environment, and safety-critical coverage gaps", () => {
    const defaultBlueprint = createDefaultClinicalSkillsBlueprint();
    const blueprint = {
      ...defaultBlueprint,
      stationSlots: [
        ...defaultBlueprint.stationSlots,
        {
          slotId: "station_002_behavioral_health_safety",
          order: 2,
          label: "Behavioral health safety planning",
          requiredEnvironmentIds: ["behavioral_health_private_room_v1"],
          requiredTraceTags: ["direct_suicide_question"],
        },
      ],
      requiredTraceTags: [...defaultBlueprint.requiredTraceTags, "direct_suicide_question"],
      requiredSafetyCriticalTraceTags: [...defaultBlueprint.requiredSafetyCriticalTraceTags, "direct_suicide_question"],
    };

    const form = assembleExamForm({
      examFormId: "form_openclinxr_pilot_missing_station",
      blueprint,
      scenarios: [edChestPainScenario],
    });

    expect(form.status).toBe("blueprint_incomplete");
    expect(form.coverage.stationCount).toEqual({ required: 2, actual: 1, ok: false });
    expect(form.coverage.missingEnvironmentIds).toEqual(["behavioral_health_private_room_v1"]);
    expect(form.coverage.missingSafetyCriticalTraceTags).toEqual(["direct_suicide_question"]);
    expect(form.assemblyIssues).toEqual(
      expect.arrayContaining([
        "missing_station_slots:1",
        "missing_environment_coverage:behavioral_health_private_room_v1",
        "missing_safety_critical_trace_coverage:direct_suicide_question",
      ]),
    );
  });

  it("detects scenario version drift after an exam form is assembled", () => {
    const form = assembleExamForm({
      examFormId: "form_openclinxr_pilot_001",
      blueprint: createDefaultClinicalSkillsBlueprint(),
      scenarios: [edChestPainScenario],
    });

    expect(evaluateScenarioVersionDrift(form, [{ ...edChestPainScenario, version: 2 }])).toEqual([
      {
        scenarioId: "ed_chest_pain_priority_v1",
        lockedVersion: 1,
        currentVersion: 2,
      },
    ]);
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
