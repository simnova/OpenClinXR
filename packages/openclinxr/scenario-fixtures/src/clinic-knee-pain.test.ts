import { type Scenario, validateEnvironmentManifest, validateScenario } from "@openclinxr/shared-schemas";
import { describe, expect, it } from "vitest";
import {
  clinicKneePainDialogueSeeds,
  clinicKneePainScenario,
  CLINIC_KNEE_PAIN_SCENARIO_ID,
} from "./clinic-knee-pain.js";
import { edChestPainScenario } from "./ed-chest-pain.js";
import {
  buildDynamicEncounterFactoryPlanningProjection,
  buildScenarioBankExamSequenceProjection,
  createLearnerScenarioView,
  evaluateScenarioBankMaturity,
  findScenarioFixtureById,
  scenarioBank,
  scenarioDialogueSeedBank,
} from "./index.js";

const ED_LEAKAGE = /ed_exam_bay|ed_chest_pain|ecg_request|history_opqrst|patient_robert_hayes|nurse_maria_alvarez|12-lead/i;

describe("clinic knee pain review-gated factory path", () => {
  it("is a draft multi-actor fixture with distinct clinic needs and an authored learner-event seed", () => {
    expect(clinicKneePainScenario.status).toBe("draft");
    expect(clinicKneePainScenario.review).toEqual({
      clinical: "draft",
      psychometric: "draft",
      legal: "draft",
      simulationQa: "draft",
    });
    expect(clinicKneePainScenario.governance.validationStage).toBe("stage_0_synthetic_draft");
    expect(validateScenario(clinicKneePainScenario).ok).toBe(true);
    expect(
      validateEnvironmentManifest({
        environment: clinicKneePainScenario.environment,
        equipment: clinicKneePainScenario.equipment,
        assetNeeds: clinicKneePainScenario.assetNeeds,
      }).ok,
    ).toBe(true);
    expect(clinicKneePainScenario.actors.map((actor) => actor.role)).toEqual([
      "patient",
      "family",
      "medical_assistant",
    ]);
    expect(clinicKneePainScenario.environment?.environmentId).toBe("sports_medicine_clinic_room_v1");
    expect(clinicKneePainScenario.equipment).toEqual([
      "clinic chairs",
      "goniometer",
      "ice pack",
      "crutches",
      "elastic knee sleeve",
      "clipboard rooming notes",
    ]);
    expect(clinicKneePainScenario.actors.every((actor) => actor.placement?.supportSurface !== "stretcher")).toBe(true);
    expect(clinicKneePainScenario.actors.every((actor) => actor.bodyMechanics === undefined)).toBe(true);
    expect(clinicKneePainDialogueSeeds.some((seed) => seed.seedId === "clinic_knee_rom_exam_on_learner_request")).toBe(
      true,
    );
    expect(clinicKneePainDialogueSeeds.find((seed) => seed.seedId === "clinic_knee_rom_exam_on_learner_request")).toMatchObject({
      actorId: "patient_jordan_cole_v1",
      expectedTraceTags: ["knee_rom_exam_requested"],
      affect: "anxious",
      spokenText: "It stops about halfway and feels tight on the inside.",
    });
  });

  it("travels the scenario-bank, exam-sequence, and dynamic factory-planning contracts as a draft candidate", () => {
    expect(findScenarioFixtureById(CLINIC_KNEE_PAIN_SCENARIO_ID)?.scenarioId).toBe(CLINIC_KNEE_PAIN_SCENARIO_ID);
    expect(scenarioBank.map((scenario) => scenario.scenarioId)).toContain(CLINIC_KNEE_PAIN_SCENARIO_ID);
    expect(scenarioDialogueSeedBank.some((entry) => entry.scenarioId === CLINIC_KNEE_PAIN_SCENARIO_ID)).toBe(true);

    const maturity = evaluateScenarioBankMaturity(scenarioBank);
    expect(maturity.activationEligibleScenarioIds).toEqual([edChestPainScenario.scenarioId]);
    expect(maturity.activationEligibleScenarioIds).not.toContain(CLINIC_KNEE_PAIN_SCENARIO_ID);
    expect(maturity.blockedScenarioIds).toContainEqual({
      scenarioId: CLINIC_KNEE_PAIN_SCENARIO_ID,
      reason: "not_approved",
    });

    const sequence = buildScenarioBankExamSequenceProjection(scenarioBank);
    const station = sequence.stations.find((entry) => entry.scenarioId === CLINIC_KNEE_PAIN_SCENARIO_ID);
    expect(station).toMatchObject({
      status: "draft",
      environmentId: "sports_medicine_clinic_room_v1",
      activationEligible: false,
      learnerUseBoundary: "draft_review_required",
      actorRoles: ["family", "medical_assistant", "patient"],
      reviewBlockers: ["scenario_status:draft", "faculty_review_required"],
    });

    const projection = buildDynamicEncounterFactoryPlanningProjection(scenarioBank);
    expect(projection.nextFactoryPlanningScenarioId).toBe("peds_asthma_parent_anxiety_v1");
    const planning = projection.scenarios.find((entry) => entry.scenarioId === CLINIC_KNEE_PAIN_SCENARIO_ID);
    expect(planning).toMatchObject({
      factoryPlanningOrder: 15,
      status: "draft",
      validationStage: "stage_0_synthetic_draft",
      environmentId: "sports_medicine_clinic_room_v1",
      multiActorReady: true,
      dialogueSeedReady: true,
      factoryPlanningMetadataComplete: true,
      activationEligible: false,
      learnerUseBoundary: "draft_review_required",
      recommendedNextAction: "complete_required_review_gates",
      encounterFactoryInputSummary: {
        factorySelectionRole: "candidate",
        sharedAssetLookupKeys: expect.arrayContaining([
          "semantic::environment::sports_medicine_clinic_room_v1",
          "semantic::equipment::goniometer",
          "semantic::actor::patient::patient_jordan_cole_v1",
        ]),
        dynamicBehaviorTraceTags: expect.arrayContaining(["knee_rom_exam_requested", "return_to_play_counseling"]),
      },
    });
    expect(JSON.stringify(planning)).not.toMatch(ED_LEAKAGE);
    expect(createLearnerScenarioView(clinicKneePainScenario).actors.every((actor) => !("hiddenFacts" in actor))).toBe(
      true,
    );
  });

  it("fails closed if status is flipped to approved without matching review and governance", () => {
    const statusOnly = { ...clinicKneePainScenario, status: "approved" as const };
    expect(validateScenario(statusOnly)).toEqual({
      ok: false,
      errors: ["approved scenarios require clinical, psychometric, legal, and simulation QA approval"],
    });

    const gatesWithoutStage = {
      ...clinicKneePainScenario,
      status: "approved" as const,
      review: {
        clinical: "approved" as const,
        psychometric: "approved" as const,
        legal: "approved" as const,
        simulationQa: "approved" as const,
      },
    };
    expect(validateScenario(gatesWithoutStage)).toMatchObject({
      ok: false,
      errors: ["approved scenarios require at least stage_1_expert_reviewed governance"],
    });

    const promoted = evaluateScenarioBankMaturity([statusOnly]);
    expect(promoted.activationEligibleScenarioIds).toEqual([]);
    expect(promoted.blockedScenarioIds[0]?.reason).not.toBeUndefined();
  });

  it("fails closed if the knee-pain factory row leaks ED chest-pain constants", () => {
    const edEnvironment = edChestPainScenario.environment;
    expect(edEnvironment).toBeDefined();
    const leaked: Scenario = {
      ...clinicKneePainScenario,
      environment: edEnvironment!,
      equipment: edChestPainScenario.equipment ?? [],
    };
    const projection = buildDynamicEncounterFactoryPlanningProjection([edChestPainScenario, leaked]);
    const planning = projection.scenarios.find((entry) => entry.scenarioId === CLINIC_KNEE_PAIN_SCENARIO_ID);
    expect(JSON.stringify(planning)).toMatch(ED_LEAKAGE);
    expect(planning?.environmentId).toBe("ed_exam_bay_v1");

    const honest = buildDynamicEncounterFactoryPlanningProjection(scenarioBank).scenarios.find(
      (entry) => entry.scenarioId === CLINIC_KNEE_PAIN_SCENARIO_ID,
    );
    expect(honest?.environmentId).toBe("sports_medicine_clinic_room_v1");
    expect(JSON.stringify(honest)).not.toMatch(ED_LEAKAGE);
    expect(honest?.encounterFactoryInputSummary.sharedAssetLookupKeys.some((key) => ED_LEAKAGE.test(key))).toBe(false);
  });
});
