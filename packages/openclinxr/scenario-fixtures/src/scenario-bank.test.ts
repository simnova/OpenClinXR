import { validateScenario } from "@openclinxr/shared-schemas";
import { describe, expect, it } from "vitest";
import { edChestPainScenario, evaluateScenarioBankMaturity, scenarioBank } from "./index.js";

describe("scenario bank maturity", () => {
  it("contains schema-valid draft breadth without treating drafts as active-form ready", () => {
    expect(scenarioBank.map((scenario) => scenario.scenarioId)).toEqual([
      "ed_chest_pain_priority_v1",
      "peds_asthma_parent_anxiety_v1",
      "psych_suicidal_ideation_safety_v1",
      "telehealth_diabetes_health_literacy_v1",
    ]);
    expect(scenarioBank.every((scenario) => validateScenario(scenario).ok)).toBe(true);
    expect(scenarioBank.filter((scenario) => scenario.status === "draft")).toHaveLength(3);
  });

  it("reports maturity, review blockers, and clinical setting diversity", () => {
    const report = evaluateScenarioBankMaturity(scenarioBank);

    expect(report.scenarioCount).toBe(4);
    expect(report.statusCounts).toEqual({ approved: 1, draft: 3, retired: 0 });
    expect(report.validationStageCounts.stage_0_synthetic_draft).toBe(3);
    expect(report.activationEligibleScenarioIds).toEqual([edChestPainScenario.scenarioId]);
    expect(report.blockedScenarioIds).toEqual([
      { scenarioId: "peds_asthma_parent_anxiety_v1", reason: "not_approved" },
      { scenarioId: "psych_suicidal_ideation_safety_v1", reason: "not_approved" },
      { scenarioId: "telehealth_diabetes_health_literacy_v1", reason: "not_approved" },
    ]);
    expect(report.clinicalSettings).toEqual([
      "behavioral_health_private_room_v1",
      "ed_exam_bay_v1",
      "pediatric_urgent_care_bay_v1",
      "telehealth_home_visit_v1",
    ]);
    expect(report.hiddenFactPolicy.redactsAll).toBe(true);
    expect(report.hiddenFactPolicy.requiresTriggerForAll).toBe(true);
    expect(report.safetyCriticalTraceTags).toEqual(
      expect.arrayContaining(["ecg_request", "oxygen_request", "suicide_safety_plan", "teach_back"]),
    );
  });
});
