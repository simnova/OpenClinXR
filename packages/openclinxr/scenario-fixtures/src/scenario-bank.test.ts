import {
  validateCommunicationProfile,
  validateDynamicEncounterFactoryProjectionArtifact,
  validateEnvironmentManifest,
  validateScenario,
} from "@openclinxr/shared-schemas";
import { describe, expect, it } from "vitest";
import {
  abdominalPainInterpreterScenario,
  buildDynamicEncounterFactoryPlanningProjection,
  buildDynamicEncounterFactoryProjectionArtifact,
  buildScenarioBankExamSequenceProjection,
  createLearnerScenarioView,
  edChestPainScenario,
  edChestPainScenarioV2,
  edChestPainScenarioV3,
  evaluateScenarioBankMaturity,
  variantScenarioBank,
  obPreeclampsiaDialogueSeeds,
  obPreeclampsiaScenario,
  oncologyBadNewsScenario,
  pediatricAsthmaDialogueSeeds,
  pediatricAsthmaScenario,
  postopFeverScenario,
  primaryCareDyslipidemiaScenario,
  psychiatricSafetyDialogueSeeds,
  psychiatricSafetyScenario,
  scenarioBank,
  scenarioDialogueSeedBank,
  stepdownSepsisScenario,
  strokeAlertDialogueSeeds,
  strokeAlertScenario,
  telehealthDiabetesDialogueSeeds,
  telehealthDiabetesScenario,
  wardDeliriumDialogueSeeds,
  wardDeliriumScenario,
} from "./index.js";

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
    expect(
      scenarioBank.every((scenario) =>
        validateEnvironmentManifest({
          environment: scenario.environment,
          equipment: scenario.equipment,
          assetNeeds: scenario.assetNeeds,
        }).ok
      ),
    ).toBe(true);
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
    expect(report.scenarioMaturityBreakdown[0]).toMatchObject({
      scenarioId: "ed_chest_pain_priority_v1",
      activationEligible: true,
      blockerIds: [],
      dialogueSeedReady: true,
      traceabilityReady: true,
      assetNeedTypes: ["character", "environment", "equipment"],
      environmentId: "ed_exam_bay_v1",
      recommendedNextAction: "ready_for_local_formative_queue_assembly",
    });
    expect(report.scenarioMaturityBreakdown[1]).toMatchObject({
      scenarioId: "peds_asthma_parent_anxiety_v1",
      activationEligible: false,
      blockerIds: expect.arrayContaining(["scenario_status:draft", "clinical_review:draft", "validation_stage:stage_0_synthetic_draft"]),
      dialogueSeedReady: true,
      traceabilityReady: true,
      recommendedNextAction: "complete_required_review_gates",
    });
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
    expect(report.communicationProfileCoverage).toEqual({
      completeScenarioIds: scenarioBank.map((scenario) => scenario.scenarioId),
      incompleteScenarioIds: [],
      actorCount: {
        total: scenarioBank.reduce((count, scenario) => count + scenario.actors.length, 0),
        withCommunicationProfile: scenarioBank.reduce((count, scenario) => count + scenario.actors.length, 0),
      },
    });
    expect(report.pressureActorCoverage).toEqual({
      completeScenarioIds: scenarioBank.map((scenario) => scenario.scenarioId),
      incompleteScenarioIds: [],
      scenarioCountWithNonPatientActors: 12,
      minimumNonPatientActorCount: 1,
    });
    expect(report.traceabilityCoverage).toEqual({
      completeScenarioIds: scenarioBank.map((scenario) => scenario.scenarioId),
      incompleteScenarioIds: [],
      requiredTraceTagsCoveredByRubric: true,
      eventTagsWithinRequiredTraceTags: true,
      safetyCriticalTagsWithinRequiredTraceTags: true,
    });
    expect(report.dialogueSeedCoverage).toEqual({
      seededScenarioIds: [
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
      ],
      missingSeedScenarioIds: [],
      guardrailProbeScenarioIds: [
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
      ],
    });
    expect(report.sharedAssetReuseMaturity).toMatchObject({
      claimBoundary: "scenario_bank_shared_asset_reuse_metadata_only",
      scenarioCountWithLookupKeys: 12,
      scenarioCountWithReusableKeys: 10,
      notEvidenceFor: [
        "generated_asset_readiness",
        "shared_asset_library_materialization",
        "quest_readiness",
        "runtime_readiness",
        "production_asset_readiness",
      ],
    });
    expect(report.sharedAssetReuseMaturity.lookupKeyCount).toBeGreaterThan(0);
    expect(report.sharedAssetReuseMaturity.reusableLookupKeyCount).toBeGreaterThan(0);
    expect(report.sharedAssetReuseMaturity.duplicateLookupKeyCount).toBeGreaterThan(0);
    expect(report.sharedAssetReuseMaturity.topReusableLookupKeys).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ lookupKey: "semantic::equipment::bedside_monitor", scenarioCount: 2 }),
      ]),
    );
    expect(report.sharedAssetReuseMaturity.lruReuseCandidateScenarioIds).toHaveLength(10);
    expect(report.sharedAssetReuseMaturity.lruReuseCandidateScenarioIds).toEqual(
      expect.arrayContaining([
        "ed_chest_pain_priority_v1",
        "ward_delirium_med_rec_v1",
        "ob_headache_preeclampsia_triage_v1",
      ]),
    );
  });

  it("builds an ordered exam-sequence projection without activating draft stations", () => {
    const projection = buildScenarioBankExamSequenceProjection(scenarioBank);

    expect(projection).toMatchObject({
      source: "scenario_bank_ordered_sequence",
      targetStationCount: 12,
      stationCount: 12,
      missingStationCount: 0,
      activationEligibleCount: 1,
      learnerUseBoundary: "activation_ready_only",
    });
    expect(projection.stations).toHaveLength(12);
    expect(projection.stations[0]).toMatchObject({
      stationOrder: 1,
      scenarioId: "ed_chest_pain_priority_v1",
      status: "approved",
      environmentId: "ed_exam_bay_v1",
      activationEligible: true,
      learnerUseBoundary: "activation_ready",
      dialogueSeedCount: 4,
      guardrailProbeReady: true,
      reviewBlockers: [],
      reviewSummary: "Approved for local formative station queue assembly.",
    });
    expect(projection.stations.slice(1).every((station) => station.activationEligible === false)).toBe(true);
    expect(projection.stations.slice(1).every((station) => station.learnerUseBoundary === "draft_review_required")).toBe(true);
    expect(projection.stations[1]?.reviewBlockers).toEqual(["scenario_status:draft", "faculty_review_required"]);
    expect(projection.stations.find((station) => station.scenarioId === "clinic_abdominal_pain_interpreter_v1")).toMatchObject({
      stationOrder: 9,
      actorRoles: ["family", "interpreter", "patient"],
      assetNeedTypes: ["character", "environment"],
    });
  });

  it("surfaces pediatric asthma as the next review-gated deterministic factory planning scenario after ED chest pain", () => {
    const projection = buildDynamicEncounterFactoryPlanningProjection(scenarioBank);
    const asthmaPlanningScenario = projection.scenarios.find(
      (scenario) => scenario.scenarioId === pediatricAsthmaScenario.scenarioId,
    );

    expect(projection).toMatchObject({
      source: "scenario_bank_dynamic_encounter_factory_planning",
      claimBoundary: "review_gated_factory_metadata_only",
      anchorScenarioId: edChestPainScenario.scenarioId,
      nextFactoryPlanningScenarioId: pediatricAsthmaScenario.scenarioId,
      learnerUseBoundary: "activation_ready_only",
    });
    expect(asthmaPlanningScenario).toMatchObject({
      factoryPlanningOrder: 2,
      status: "draft",
      validationStage: "stage_0_synthetic_draft",
      actorRoles: ["family", "nurse", "patient"],
      actorCount: 3,
      multiActorReady: true,
      dialogueSeedCount: 4,
      dialogueSeedReady: true,
      traceabilityReady: true,
      requiredTraceTagCount: pediatricAsthmaScenario.requiredTraceTags.length,
      safetyCriticalTraceTagCount: 3,
      eventScheduleCount: 1,
      rubricCount: 4,
      requiredReviewerRoleCount: 4,
      environmentId: "pediatric_urgent_care_bay_v1",
      equipmentCount: 6,
      assetNeedTypes: ["character", "environment", "equipment"],
      factoryPlanningMetadataComplete: true,
      factoryPlanningMetadataBlockers: [],
      encounterFactoryInputSummary: {
        source: "scenario_definition_and_dialogue_seed_bank",
        scenarioBankOrder: 2,
        factorySelectionRole: "next_factory_planning_scenario",
        factorySelectionMode: "next_scenario_fallback",
        factorySelectionClaimBoundary: "review_gated_factory_metadata_only",
        actorAssetWorkOrderCount: 3,
        environmentAssetWorkOrderCount: 1,
        equipmentAssetWorkOrderCount: 6,
        sharedAssetLookupKeys: expect.arrayContaining([
          "semantic::actor::patient::patient_maya_johnson_v1",
          "semantic::environment::pediatric_urgent_care_bay_v1",
          "semantic::equipment::nebulizer_mask",
        ]),
        dynamicBehaviorTraceTags: expect.arrayContaining([
          "oxygen_request",
          "parent_communication",
          "urgent_escalation",
        ]),
      },
      humanoidPerformanceContract: {
        claimBoundary: "case_definition_humanoid_performance_metadata_only",
        actorCount: 3,
        locomotionActorRoles: ["family", "nurse", "patient"],
        expressionActorRoles: ["family", "nurse", "patient"],
        gazeActorRoles: ["family", "nurse", "patient"],
        lipSyncActorRoles: ["family", "nurse", "patient"],
        interactiveActorRoles: ["family", "nurse", "patient"],
        actorRuntimeRealismRequirements: expect.arrayContaining([
          expect.objectContaining({
            actorId: "patient_maya_johnson_v1",
            role: "patient",
            baselineMood: ["frightened", "breathless", "seeking reassurance"],
            locomotionRequired: true,
            expressionRequired: true,
            gazeRequired: true,
            lipSyncRequired: true,
            interactionRequired: true,
            requiredCueIds: expect.arrayContaining([
              "case_definition_driven_expression_selection",
              "dialogue_viseme_and_gaze_mapping",
              "actor_target_gaze_from_trace_intent",
              "scenario_timeline_locomotion_or_posture_change",
            ]),
          }),
        ]),
        dialogueDrivenVisemeMappingRequired: true,
        gazeTargetingRequired: true,
        locomotionPlanningRequired: true,
        notEvidenceFor: [
          "generated_humanoid_asset_readiness",
          "animation_quality",
          "quest_readiness",
          "runtime_readiness",
          "clinical_validity",
        ],
      },
      activationEligible: false,
      learnerUseBoundary: "draft_review_required",
      reviewBlockers: expect.arrayContaining([
        "scenario_status:draft",
        "clinical_review:draft",
        "psychometric_review:draft",
        "legal_review:draft",
        "simulation_qa_review:draft",
        "validation_stage:stage_0_synthetic_draft",
      ]),
      recommendedNextAction: "complete_required_review_gates",
    });
    expect(projection.scenarios[0]?.encounterFactoryInputSummary).toMatchObject({
      scenarioBankOrder: 1,
      factorySelectionRole: "anchor",
      factorySelectionMode: "next_scenario_fallback",
      factorySelectionClaimBoundary: "review_gated_factory_metadata_only",
    });
    expect(projection.nextFactoryPlanningScenarioSelectionMode).toBe("next_scenario_fallback");
  });

  it("emits a projection artifact slice with approved-variant selection from additional fixture variants", () => {
    const projectionArtifact = buildDynamicEncounterFactoryProjectionArtifact(variantScenarioBank, edChestPainScenario.scenarioId);

    expect(validateDynamicEncounterFactoryProjectionArtifact(projectionArtifact)).toEqual({ ok: true });
    expect(projectionArtifact).toMatchObject({
      schemaVersion: "openclinxr.dynamic-encounter-factory-projection-artifact.v1",
      source: "scenario_bank_dynamic_encounter_factory_projection_artifact",
      anchorScenarioId: edChestPainScenario.scenarioId,
      learnerUseBoundary: "activation_ready_only",
      nextFactoryPlanningScenarioSelectionMode: "approved_encounter_variant",
      nextFactoryPlanningScenarioId: edChestPainScenarioV2.scenarioId,
    });
    expect(projectionArtifact.scenarioBankSlice.map((scenario) => scenario.scenarioId)).toEqual([
      edChestPainScenario.scenarioId,
      edChestPainScenarioV2.scenarioId,
      edChestPainScenarioV3.scenarioId,
    ]);
  });

  it("prefers the next approved same-encounter scenario variant before falling back to the next fixture", () => {
    const projection = buildDynamicEncounterFactoryPlanningProjection(
      [edChestPainScenario, edChestPainScenarioV2, ...scenarioBank.slice(1)],
      edChestPainScenario.scenarioId,
    );

    expect(projection.nextFactoryPlanningScenarioId).toBe(edChestPainScenarioV2.scenarioId);
    expect(projection.nextFactoryPlanningScenarioSelectionMode).toBe("approved_encounter_variant");
  });

  it("requires replay-ready dialogue seeds before an approved scenario is activation eligible", () => {
    const scenarioWithoutDialogueSeeds = {
      ...edChestPainScenario,
      scenarioId: "approved_missing_dialogue_replay_v1",
    };
    const report = evaluateScenarioBankMaturity([scenarioWithoutDialogueSeeds]);

    expect(report.activationEligibleScenarioIds).toEqual([]);
    expect(report.blockedScenarioIds).toEqual([
      { scenarioId: "approved_missing_dialogue_replay_v1", reason: "dialogue_seed_not_ready" },
    ]);
    expect(report.dialogueSeedCoverage).toEqual({
      seededScenarioIds: [],
      missingSeedScenarioIds: ["approved_missing_dialogue_replay_v1"],
      guardrailProbeScenarioIds: [],
    });
  });

  it("keeps every scenario dialogue seed bank entry aligned with actors, trace tags, and guardrail probes", () => {
    const scenarioById = new Map(scenarioBank.map((scenario) => [scenario.scenarioId, scenario]));

    expect(scenarioDialogueSeedBank.map((entry) => entry.scenarioId)).toEqual(scenarioBank.map((scenario) => scenario.scenarioId));

    for (const entry of scenarioDialogueSeedBank) {
      const scenario = scenarioById.get(entry.scenarioId);
      if (!scenario) {
        throw new Error(`Missing scenario for seed entry ${entry.scenarioId}`);
      }
      const actorIds = new Set(scenario.actors.map((actor) => actor.actorId));
      const allowedTraceTags = new Set([
        ...scenario.requiredTraceTags,
        ...scenario.governance.safetyCriticalTraceTags,
        "guardrail_hidden_truth",
      ]);

      expect(entry.seeds.length, entry.scenarioId).toBeGreaterThanOrEqual(4);
      expect(entry.seeds.some((seed) => seed.safetyExpectation === "blocks_hidden_truth_probe"), entry.scenarioId).toBe(true);
      for (const seed of entry.seeds) {
        expect(actorIds.has(seed.actorId), seed.seedId).toBe(true);
        expect(seed.visibleFacts.length, seed.seedId).toBeGreaterThan(0);
        expect(seed.hiddenFactCanaries.length, seed.seedId).toBeGreaterThan(0);
        expect(seed.expectedTraceTags.every((tag) => allowedTraceTags.has(tag)), seed.seedId).toBe(true);
      }
    }
  });

  it("creates learner scenario views without sharing mutable actor profile state", () => {
    const view = createLearnerScenarioView(edChestPainScenario);
    expect(JSON.stringify(view)).not.toContain("Father died of myocardial infarction");

    view.actors[0]?.communicationProfile?.baselineMood.push("mutated learner mood");

    expect(edChestPainScenario.actors[0]?.communicationProfile?.baselineMood).not.toContain("mutated learner mood");
  });

  it("adds deterministic pediatric asthma dialogue and hidden-fact guardrail seeds", () => {
    expect(pediatricAsthmaScenario.actors.map((actor) => actor.communicationProfile?.style)).toEqual([
      "appeaser",
      "angry_family_member",
      "rationalizer",
    ]);
    expect(pediatricAsthmaScenario.actors.every((actor) => validateCommunicationProfile(actor.communicationProfile).ok)).toBe(true);
    expect(pediatricAsthmaDialogueSeeds.map((seed) => seed.seedId)).toEqual([
      "peds_patient_work_of_breathing",
      "peds_parent_trigger_history",
      "peds_nurse_oxygen_escalation",
      "peds_parent_hidden_truth_probe",
    ]);

    const actorIds = new Set(pediatricAsthmaScenario.actors.map((actor) => actor.actorId));
    const allowedTraceTags = new Set([...pediatricAsthmaScenario.requiredTraceTags, "guardrail_hidden_truth"]);

    expect(pediatricAsthmaDialogueSeeds.every((seed) => seed.visibleFacts.length > 0)).toBe(true);
    expect(pediatricAsthmaDialogueSeeds.every((seed) => seed.hiddenFactCanaries.length > 0)).toBe(true);
    expect(pediatricAsthmaDialogueSeeds.find((seed) => seed.seedId === "peds_parent_hidden_truth_probe")?.safetyExpectation).toBe(
      "blocks_hidden_truth_probe",
    );
    for (const seed of pediatricAsthmaDialogueSeeds) {
      expect(actorIds.has(seed.actorId), seed.seedId).toBe(true);
      expect(seed.expectedTraceTags.every((tag) => allowedTraceTags.has(tag)), seed.seedId).toBe(true);
    }
  });

  it("adds deterministic ward delirium communication profiles for patient, family, nurse, and resident actors", () => {
    expect(wardDeliriumScenario.actors.map((actor) => actor.communicationProfile?.style)).toEqual([
      "appeaser",
      "angry_family_member",
      "rationalizer",
      "rationalizer",
    ]);
    expect(wardDeliriumScenario.actors.every((actor) => validateCommunicationProfile(actor.communicationProfile).ok)).toBe(true);
  });

  it("adds deterministic telehealth diabetes communication profiles for patient, family, and platform actors", () => {
    expect(telehealthDiabetesScenario.actors.map((actor) => actor.communicationProfile?.style)).toEqual([
      "appeaser",
      "rationalizer",
      "rationalizer",
    ]);
    expect(telehealthDiabetesScenario.actors.every((actor) => validateCommunicationProfile(actor.communicationProfile).ok)).toBe(
      true,
    );
  });

  it("adds deterministic OB triage communication profiles for patient, partner, and nurse actors", () => {
    expect(obPreeclampsiaScenario.actors.map((actor) => actor.communicationProfile?.style)).toEqual([
      "appeaser",
      "angry_family_member",
      "rationalizer",
    ]);
    expect(obPreeclampsiaScenario.actors.every((actor) => validateCommunicationProfile(actor.communicationProfile).ok)).toBe(
      true,
    );
  });

  it("adds deterministic communication profiles through the abdominal pain interpreter station", () => {
    expect(
      [
        psychiatricSafetyScenario,
        strokeAlertScenario,
        stepdownSepsisScenario,
        abdominalPainInterpreterScenario,
      ].every((scenario) => scenario.actors.every((actor) => validateCommunicationProfile(actor.communicationProfile).ok)),
    ).toBe(true);
  });

  it("adds deterministic communication profiles for oncology, postop, and primary-care stations", () => {
    expect(
      [oncologyBadNewsScenario, postopFeverScenario, primaryCareDyslipidemiaScenario].every((scenario) =>
        scenario.actors.every((actor) => validateCommunicationProfile(actor.communicationProfile).ok),
      ),
    ).toBe(true);
  });

  it("adds deterministic psychiatric safety dialogue and hidden-fact guardrail seeds", () => {
    expect(psychiatricSafetyDialogueSeeds.map((seed) => seed.seedId)).toEqual([
      "psych_patient_direct_safety_question",
      "psych_partner_confidentiality_boundary",
      "psych_nurse_safety_observation",
      "psych_patient_hidden_truth_probe",
    ]);

    const actorIds = new Set(psychiatricSafetyScenario.actors.map((actor) => actor.actorId));
    const allowedTraceTags = new Set([...psychiatricSafetyScenario.requiredTraceTags, "guardrail_hidden_truth"]);

    expect(psychiatricSafetyDialogueSeeds.every((seed) => seed.visibleFacts.length > 0)).toBe(true);
    expect(psychiatricSafetyDialogueSeeds.every((seed) => seed.hiddenFactCanaries.length > 0)).toBe(true);
    expect(psychiatricSafetyDialogueSeeds.find((seed) => seed.seedId === "psych_patient_hidden_truth_probe")?.safetyExpectation).toBe(
      "blocks_hidden_truth_probe",
    );
    for (const seed of psychiatricSafetyDialogueSeeds) {
      expect(actorIds.has(seed.actorId), seed.seedId).toBe(true);
      expect(seed.expectedTraceTags.every((tag) => allowedTraceTags.has(tag)), seed.seedId).toBe(true);
    }
  });

  it("adds deterministic ward delirium dialogue and hidden-fact guardrail seeds", () => {
    expect(wardDeliriumDialogueSeeds.map((seed) => seed.seedId)).toEqual([
      "ward_patient_orientation_assessment",
      "ward_daughter_medication_collateral",
      "ward_nurse_fall_risk_plan",
      "ward_patient_hidden_truth_probe",
    ]);

    const actorIds = new Set(wardDeliriumScenario.actors.map((actor) => actor.actorId));
    const allowedTraceTags = new Set([...wardDeliriumScenario.requiredTraceTags, "guardrail_hidden_truth"]);

    expect(wardDeliriumDialogueSeeds.every((seed) => seed.visibleFacts.length > 0)).toBe(true);
    expect(wardDeliriumDialogueSeeds.every((seed) => seed.hiddenFactCanaries.length > 0)).toBe(true);
    expect(wardDeliriumDialogueSeeds.find((seed) => seed.seedId === "ward_patient_hidden_truth_probe")?.safetyExpectation).toBe(
      "blocks_hidden_truth_probe",
    );
    for (const seed of wardDeliriumDialogueSeeds) {
      expect(actorIds.has(seed.actorId), seed.seedId).toBe(true);
      expect(seed.expectedTraceTags.every((tag) => allowedTraceTags.has(tag)), seed.seedId).toBe(true);
    }
  });

  it("adds deterministic telehealth diabetes dialogue and hidden-fact guardrail seeds", () => {
    expect(telehealthDiabetesDialogueSeeds.map((seed) => seed.seedId)).toEqual([
      "telehealth_patient_medication_reconciliation",
      "telehealth_patient_teach_back",
      "telehealth_daughter_shared_plan",
      "telehealth_patient_hidden_truth_probe",
    ]);

    const actorIds = new Set(telehealthDiabetesScenario.actors.map((actor) => actor.actorId));
    const allowedTraceTags = new Set([...telehealthDiabetesScenario.requiredTraceTags, "guardrail_hidden_truth"]);

    expect(telehealthDiabetesDialogueSeeds.every((seed) => seed.visibleFacts.length > 0)).toBe(true);
    expect(telehealthDiabetesDialogueSeeds.every((seed) => seed.hiddenFactCanaries.length > 0)).toBe(true);
    expect(telehealthDiabetesDialogueSeeds.find((seed) => seed.seedId === "telehealth_patient_hidden_truth_probe")?.safetyExpectation).toBe(
      "blocks_hidden_truth_probe",
    );
    for (const seed of telehealthDiabetesDialogueSeeds) {
      expect(actorIds.has(seed.actorId), seed.seedId).toBe(true);
      expect(seed.expectedTraceTags.every((tag) => allowedTraceTags.has(tag)), seed.seedId).toBe(true);
    }
  });

  it("adds deterministic OB preeclampsia dialogue and hidden-fact guardrail seeds", () => {
    expect(obPreeclampsiaDialogueSeeds.map((seed) => seed.seedId)).toEqual([
      "ob_patient_red_flags",
      "ob_nurse_bp_escalation",
      "ob_partner_explanation",
      "ob_patient_hidden_truth_probe",
    ]);

    const actorIds = new Set(obPreeclampsiaScenario.actors.map((actor) => actor.actorId));
    const allowedTraceTags = new Set([...obPreeclampsiaScenario.requiredTraceTags, "guardrail_hidden_truth"]);

    expect(obPreeclampsiaDialogueSeeds.every((seed) => seed.visibleFacts.length > 0)).toBe(true);
    expect(obPreeclampsiaDialogueSeeds.every((seed) => seed.hiddenFactCanaries.length > 0)).toBe(true);
    expect(obPreeclampsiaDialogueSeeds.find((seed) => seed.seedId === "ob_patient_hidden_truth_probe")?.safetyExpectation).toBe(
      "blocks_hidden_truth_probe",
    );
    for (const seed of obPreeclampsiaDialogueSeeds) {
      expect(actorIds.has(seed.actorId), seed.seedId).toBe(true);
      expect(seed.expectedTraceTags.every((tag) => allowedTraceTags.has(tag)), seed.seedId).toBe(true);
    }
  });

  it("adds deterministic stroke alert dialogue and hidden-fact guardrail seeds", () => {
    expect(strokeAlertDialogueSeeds.map((seed) => seed.seedId)).toEqual([
      "stroke_son_last_known_well",
      "stroke_patient_neuro_assessment",
      "stroke_consultant_oral_handoff",
      "stroke_patient_hidden_truth_probe",
    ]);

    const actorIds = new Set(strokeAlertScenario.actors.map((actor) => actor.actorId));
    const allowedTraceTags = new Set([...strokeAlertScenario.requiredTraceTags, "guardrail_hidden_truth"]);

    expect(strokeAlertDialogueSeeds.every((seed) => seed.visibleFacts.length > 0)).toBe(true);
    expect(strokeAlertDialogueSeeds.every((seed) => seed.hiddenFactCanaries.length > 0)).toBe(true);
    expect(strokeAlertDialogueSeeds.find((seed) => seed.seedId === "stroke_patient_hidden_truth_probe")?.safetyExpectation).toBe(
      "blocks_hidden_truth_probe",
    );
    for (const seed of strokeAlertDialogueSeeds) {
      expect(actorIds.has(seed.actorId), seed.seedId).toBe(true);
      expect(seed.expectedTraceTags.every((tag) => allowedTraceTags.has(tag)), seed.seedId).toBe(true);
    }
  });
});
