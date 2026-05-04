import { validateScenario } from "@openclinxr/shared-schemas";
import { describe, expect, it } from "vitest";
import { edChestPainScenario, evaluateScenarioBankMaturity, scenarioBank } from "./index.js";

describe("scenario bank maturity", () => {
  it("contains schema-valid draft breadth without treating drafts as active-form ready", () => {
    expect(scenarioBank.map((scenario) => scenario.scenarioId)).toEqual([
      "ed_chest_pain_priority_v1",
      "peds_asthma_parent_anxiety_v1",
      "ward_delirium_med_rec_v1",
      "telehealth_diabetes_health_literacy_v1",
      "ob_headache_preeclampsia_triage_v1",
      "psych_suicidal_ideation_safety_v1",
      "ed_stroke_alert_handoff_v1",
      "stepdown_sepsis_nurse_escalation_v1",
      "clinic_abdominal_pain_interpreter_v1",
      "oncology_bad_news_family_v1",
      "postop_fever_consult_pressure_v1",
      "primary_care_dyslipidemia_joint_pain_v1",
    ]);
    expect(scenarioBank.every((scenario) => validateScenario(scenario).ok)).toBe(true);
    expect(scenarioBank.filter((scenario) => scenario.status === "draft")).toHaveLength(11);
  });

  it("reports maturity, review blockers, and clinical setting diversity", () => {
    const report = evaluateScenarioBankMaturity(scenarioBank);

    expect(report.scenarioCount).toBe(12);
    expect(report.targetScenarioCount).toBe(12);
    expect(report.missingScenarioCount).toBe(0);
    expect(report.statusCounts).toEqual({ approved: 1, draft: 11, retired: 0 });
    expect(report.validationStageCounts.stage_0_synthetic_draft).toBe(11);
    expect(report.activationEligibleScenarioIds).toEqual([edChestPainScenario.scenarioId]);
    expect(report.blockedScenarioIds).toEqual([
      { scenarioId: "peds_asthma_parent_anxiety_v1", reason: "not_approved" },
      { scenarioId: "ward_delirium_med_rec_v1", reason: "not_approved" },
      { scenarioId: "telehealth_diabetes_health_literacy_v1", reason: "not_approved" },
      { scenarioId: "ob_headache_preeclampsia_triage_v1", reason: "not_approved" },
      { scenarioId: "psych_suicidal_ideation_safety_v1", reason: "not_approved" },
      { scenarioId: "ed_stroke_alert_handoff_v1", reason: "not_approved" },
      { scenarioId: "stepdown_sepsis_nurse_escalation_v1", reason: "not_approved" },
      { scenarioId: "clinic_abdominal_pain_interpreter_v1", reason: "not_approved" },
      { scenarioId: "oncology_bad_news_family_v1", reason: "not_approved" },
      { scenarioId: "postop_fever_consult_pressure_v1", reason: "not_approved" },
      { scenarioId: "primary_care_dyslipidemia_joint_pain_v1", reason: "not_approved" },
    ]);
    expect(report.clinicalSettings).toEqual([
      "behavioral_health_private_room_v1",
      "ed_exam_bay_v1",
      "ed_stroke_bay_v1",
      "inpatient_ward_room_v1",
      "ob_triage_room_v1",
      "oncology_consult_room_v1",
      "pediatric_urgent_care_bay_v1",
      "primary_care_clinic_room_v1",
      "stepdown_room_v1",
      "surgical_ward_room_v1",
      "telehealth_home_visit_v1",
      "urgent_care_clinic_room_v1",
    ]);
    expect(report.hiddenFactPolicy.redactsAll).toBe(true);
    expect(report.hiddenFactPolicy.requiresTriggerForAll).toBe(true);
    expect(report.safetyCriticalTraceTags).toEqual(
      expect.arrayContaining(["ecg_request", "oxygen_request", "suicide_safety_plan", "teach_back"]),
    );
    expect(report.fixtureCompleteness).toEqual({
      completeScenarioIds: scenarioBank.map((scenario) => scenario.scenarioId),
      incompleteScenarioIds: [],
      requiredActorRoles: [
        "consultant",
        "family",
        "interpreter",
        "medical_assistant",
        "nurse",
        "patient",
        "physician",
        "respiratory_therapist",
        "system",
      ],
      missingRequiredActorRoles: [],
    });
    expect(report.traceabilityCoverage).toEqual({
      completeScenarioIds: scenarioBank.map((scenario) => scenario.scenarioId),
      incompleteScenarioIds: [],
      requiredTraceTagsCoveredByRubric: true,
      eventTagsWithinRequiredTraceTags: true,
      safetyCriticalTagsWithinRequiredTraceTags: true,
    });
  });
});
