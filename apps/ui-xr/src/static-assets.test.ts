import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const genericHandAssetHashes = {
  "left.glb": "bc67783144944ea1cda54d9247885825ea5fb9d4651469fe7d00be517a5c2b87",
  "right.glb": "291790c14f7f88a7f9bd35330c47392ed8e8d395ae6728f4bb7089f1bc1f2b96",
  "profile.json": "749bb0624eb032d1e726e87dad398e6729020f35d62d2e9b431d4202e4c656fc",
  "LICENSE.md": "0ef0c87e8ffdd0681f332dc3b39f284dee2166d1f853fabc3853884fe81a6f30",
} as const;

const generatedSceneAssetHashes = {
  "humanoids/neutral-generated-human.glb": "6f7bd1f5fe0be492f1054aa838188df9efafb1de42430db59da809b50576bc0f",
  "humanoids/variants/ob-patient-aisha-generated-human.glb": "ad2ad124d56b1f5ccaa2f61a75d08cac865c57ae22b999744f5ce3459037f4f2",
  "humanoids/variants/ob-nurse-williams-generated-human.glb": "6f2261b1b0c83d5417d219b070ee0f704e008eec208b073a3e7586faac7b3c67",
  "humanoids/variants/ob-partner-omar-generated-human.glb": "06ee1ba01fc2d195babdff3d26d366c2028042f815a2bbc27e8ad3a5e6c34abc",
  "humanoids/candidates/mpfb-ob-patient-aisha-rigged-candidate.glb": "0bf0988dd8e18bb89dcec25a70072504575cae378ba3f9444c548f20daef8d3d",
  "humanoids/candidates/charmorph-antonia-ob-patient-candidate.glb": "9bdb335c7e06b96ac4e0f64d59a36857e8a7449a6cc779e2c0f382ad83392b31",
  "humanoids/candidates/charmorph-reom-ob-patient-candidate.glb": "47640a2d45a9b5c0b3c5a93885c59870ca19bcb52eeb881017668166c612428b",
  "medical-equipment/ecg-cart-12-lead.glb": "c3b6f1934eb232a3c32b7d6afd830d09b0632b29bf83d3e5d776746b3cafb378",
  "medical-equipment/iv-pole-with-pump.glb": "1a9a57932e2e0b8bd86c927527e8ea4fcb19fd3e74bf9ba33ec4490234ccfb04",
  "medical-equipment/inhaler_spacer_equipment.glb": "16f593508e3b4aac78efd3ab8ccb19fc28da471c0c5c281c416dc56ff5197e29",
  "medical-equipment/nebulizer_mask_equipment.glb": "91a485a9f3ec27bb75d4e5295ba1ba62a16302f63af0b0d3190ea624ccc28c3d",
  "medical-equipment/oxygen_wall_port_equipment.glb": "d543ad97f96c95858209d267a8d1fa438a75e234d46be8ec8d860f347fd7e041",
  "medical-equipment/parent_chair_equipment.glb": "68adbb73d39f75bfc128e317c9bddb9265a5206dd8a8a9a7c79f0e65dd36db9d",
  "medical-equipment/pediatric_stretcher_equipment.glb": "010f3a7533d403c80e6d13d54018144d94f19d1816dd887fc1bea8b2a9ffdc23",
  "medical-equipment/pulse_oximeter_equipment.glb": "0ddc1fa03f397d001bdf350a8e8c5ef4224274cba876c4a8879d3d56f8672c83",
  "environment/ed-exam-bay-shell.glb": "af010787db369953d9b00a3f050cbba88a51e25262a213308fc84fc36f43779b",
  "environment/pediatric_urgent_care_bay_environment.glb": "9c431d8e158cbb7486de557ffaed02e79a0bac9681704b80449ace7dc4af8c62",
} as const;

describe("static browser assets", () => {
  it("declares a local favicon to keep headset browser smoke logs clean", () => {
    const indexHtml = readFileSync(new URL("../index.html", import.meta.url), "utf8");

    expect(indexHtml).toContain('rel="icon"');
    expect(indexHtml).toContain('href="/favicon.svg"');
    expect(existsSync(new URL("../public/favicon.svg", import.meta.url))).toBe(true);
  });

  it("keeps Three.js imports explicit so the headset bundle remains tree-shakeable", () => {
    const mainSource = readFileSync(new URL("./main.ts", import.meta.url), "utf8");

    expect(mainSource).not.toContain('import * as THREE from "three"');
    expect(mainSource).toContain('} from "three"');
  });

  it("exposes an explicit immersive VR entry path for Quest Browser", () => {
    const mainSource = readFileSync(new URL("./main.ts", import.meta.url), "utf8");
    const runtimeStateSource = readFileSync(new URL("./runtime-state.ts", import.meta.url), "utf8");

    expect(runtimeStateSource).toContain("Phase 1 Full VR");
    expect(mainSource).toContain("__openClinXrExperienceModeEvidence");
    expect(mainSource).toContain("Enter Full VR");
    expect(mainSource).toContain("scene-boot-message");
    expect(mainSource).toContain("3D scene blocked");
    expect(mainSource).toContain('requestSession("immersive-vr"');
    expect(mainSource).not.toContain('requestSession("immersive-ar"');
    expect(mainSource).toContain('"hand-tracking"');
    expect(mainSource).toContain("renderer.xr.enabled = true");
    expect(mainSource).toContain("renderer.setAnimationLoop");
    expect(mainSource).toContain("isImmersiveFrameEvidenceActive");
    expect(mainSource).toContain("requestAnimationFrame(() => updateManualEvidencePanel())");
    expect(mainSource).toContain("__openClinXrXrEntryEvidence");
    expect(mainSource).toContain("recordXrEntryEvidence");
    expect(mainSource).toContain("lastError");
  });

  it("blocks generated learner bundle use until runtime, visual QA, and Quest evidence gates attach", () => {
    const mainSource = readFileSync(new URL("./main.ts", import.meta.url), "utf8");
    const runtimeStateSource = readFileSync(new URL("./runtime-state.ts", import.meta.url), "utf8");

    expect(mainSource).toContain("evaluateEncounterRuntimeLearnerUseGate");
    expect(mainSource).toContain("ENCOUNTER_LEARNER_RUNTIME_REQUIRED_GATE_IDS");
    expect(mainSource).toContain("shouldUseLearnerRuntimeAssetBundle");
    expect(mainSource).toContain("bundleUsesOnlyApprovedLocalFixtureAssets");
    expect(mainSource).toContain("learner_runtime_asset_bundle_api_generated_blocked_by_evidence_gates");
    expect(mainSource).toContain("learner_runtime_asset_bundle_static_generated_blocked_by_evidence_gates");
    expect(mainSource).toContain("__openClinXrLearnerRuntimeUseGateEvidence");
    expect(mainSource).toContain("posture-bundle-gate");
    expect(mainSource).toContain(`recordLearnerRuntimeUseGateEvidence(
        bundle,
        "api_bundle"`);
    expect(mainSource).toContain(`recordLearnerRuntimeUseGateEvidence(
        bundle,
        "static_generated_bundle"`);
    expect(mainSource).toContain(`blocking \${evidence.blockingGateIds.join`);
    expect(mainSource).toContain("generated learner use blocked");
    expect(mainSource).toContain("runtime_realism_evidence");
    expect(mainSource).toContain("visual_qa_evidence");
    expect(mainSource).toContain("quest_runtime_evidence");
    expect(runtimeStateSource).toContain("learner_scene_uses_local_fixture_until_runtime_visual_quest_gates_attach");
    expect(runtimeStateSource).toContain("LearnerRuntimeUseGateEvidence");
    expect(runtimeStateSource).toContain("approvedLocalFixtureOnly");
  });

  it("publishes the pediatric humanoid materialization handoff in the public learner bundle without readiness claims", () => {
    const bundle = JSON.parse(readFileSync(new URL("../public/xr-assets/generated/peds_asthma_parent_anxiety_v1/learner-runtime-bundle.v1.json", import.meta.url), "utf8")) as {
      scenarioId: string;
      pedsHumanoidMaterializationHandoff?: {
        schemaVersion: string;
        scenarioId: string;
        assets: Array<{
          actorRole: string;
          runtimeAssetPath: string;
          provenanceManifestPath: string;
          realAnnyWeightsUsed: boolean;
          realismGrade: string;
          promotionStatus?: string;
          notEvidenceFor: string[];
        }>;
        productionReadinessClaimed: boolean;
        questReadinessClaimed: boolean;
        clinicalValidityClaimed: boolean;
        scoringValidityClaimed: boolean;
        claimBoundary: string;
      };
    };

    expect(bundle.scenarioId).toBe("peds_asthma_parent_anxiety_v1");
    expect(bundle.pedsHumanoidMaterializationHandoff).toMatchObject({
      schemaVersion: "openclinxr.peds-humanoid-materialization-handoff.v1",
      scenarioId: "peds_asthma_parent_anxiety_v1",
      productionReadinessClaimed: false,
      questReadinessClaimed: false,
      clinicalValidityClaimed: false,
      scoringValidityClaimed: false,
      claimBoundary: "local_generated_humanoid_candidate_metadata_not_runtime_or_production_readiness",
    });
    expect(bundle.pedsHumanoidMaterializationHandoff?.assets).toEqual([
      expect.objectContaining({
        actorRole: "patient",
        runtimeAssetPath: "/generated-humanoids/peds_patient_child.glb",
        provenanceManifestPath: "apps/ui-xr/public/generated-humanoids/peds_patient_child.provenance.json",
        realAnnyWeightsUsed: false,
        realismGrade: "B",
        promotionStatus: "runtime_candidate_not_realism_gate_pass",
        notEvidenceFor: expect.arrayContaining(["real_anny_model_output", "b_plus_visual_realism_gate", "quest_readiness"]),
      }),
      expect.objectContaining({
        actorRole: "anxious_parent",
        runtimeAssetPath: "/generated-humanoids/peds_anxious_parent.glb",
        provenanceManifestPath: "apps/ui-xr/public/generated-humanoids/peds_anxious_parent.provenance.json",
        realAnnyWeightsUsed: false,
        realismGrade: "B",
        promotionStatus: "runtime_candidate_not_realism_gate_pass",
        notEvidenceFor: expect.arrayContaining(["real_anny_model_output", "b_plus_visual_realism_gate", "quest_readiness"]),
      }),
      expect.objectContaining({
        actorRole: "nurse",
        runtimeAssetPath: "/generated-humanoids/peds_nurse_kevin.glb",
        provenanceManifestPath: "apps/ui-xr/public/generated-humanoids/peds_nurse_kevin.provenance.json",
        realAnnyWeightsUsed: false,
        realismGrade: "B",
        promotionStatus: "runtime_candidate_not_realism_gate_pass",
        notEvidenceFor: expect.arrayContaining(["real_anny_model_output", "b_plus_visual_realism_gate", "quest_readiness"]),
      }),
    ]);
  });

  it("exposes timed encounter progression and patient note evidence for station-to-station runs", () => {
    const mainSource = readFileSync(new URL("./main.ts", import.meta.url), "utf8");
    const styles = readFileSync(new URL("./styles.css", import.meta.url), "utf8");

    expect(mainSource).toContain("__openClinXrExamFlowEvidence");
    expect(mainSource).toContain("__openClinXrExamRunSummaryEvidence");
    expect(mainSource).toContain("configuredExamRunId");
    expect(mainSource).toContain(`openclinxr.patientNote.\${examRunId}.\${examScenarioId}`);
    expect(mainSource).toContain("configuredExamSequence");
    expect(mainSource).toContain("examEncounterSeconds");
    expect(mainSource).toContain("examNoteSeconds");
    expect(mainSource).toContain("patient-note-text");
    expect(mainSource).toContain("End encounter / start note");
    expect(mainSource).toContain("Submit note / next encounter");
    expect(mainSource).toContain("advanceExamFlowForElapsedTime");
    expect(mainSource).toContain("advanceExamNoteForElapsedTime");
    expect(mainSource).toContain("encounter_timer_elapsed_note_phase_started");
    expect(mainSource).toContain("note_timer_elapsed_patient_note_required");
    expect(mainSource).toContain("examAutoAdvanceOnNoteTimeout");
    expect(mainSource).toContain("navigateToExamScenario");
    expect(mainSource).toContain("canAdvanceToNextEncounter");
    expect(mainSource).toContain("examFlowEvidence");
    expect(mainSource).toContain("examRunSummaryEvidence");
    expect(mainSource).toContain("recordExamRunStationOutcome");
    expect(mainSource).toContain(`openclinxr.examRunSummary.\${examRunId}`);
    expect(mainSource).toContain(`Exam: \${examFlowEvidence.scenarioIndex + 1}/\${examFlowEvidence.totalScenarios}`);
    expect(mainSource).toContain(`Note: \${examFlowEvidence.noteTextLength} chars`);
    expect(mainSource).toContain("lastObservedLocomotionSummary");
    expect(mainSource).toContain("formatRuntimeLocomotionLine");
    expect(styles).toContain(".exam-flow-panel");
    expect(styles).toContain(".patient-note-text");
  });

  it("does not resize the renderer while an immersive headset session is presenting", () => {
    const mainSource = readFileSync(new URL("./main.ts", import.meta.url), "utf8");

    expect(mainSource).toContain("renderer.xr.isPresenting");
    expect(mainSource.indexOf("renderer.xr.isPresenting")).toBeLessThan(mainSource.indexOf("renderer.setSize(width, height, false)"));
  });

  it("keeps desktop fallback controls wrapable on narrow viewports", () => {
    const styles = readFileSync(new URL("./styles.css", import.meta.url), "utf8");

    expect(styles).toContain("flex-wrap: wrap;");
    expect(styles).toContain(".runtime-panel");
    expect(styles).toContain("overflow-wrap: anywhere;");
    expect(styles).toContain(".trace-button");
    expect(styles).toContain("word-break: break-word;");
  });

  it("renders clinical text and controller affordances inside the immersive scene", () => {
    const mainSource = readFileSync(new URL("./main.ts", import.meta.url), "utf8");

    expect(mainSource).toContain("CanvasTexture");
    expect(mainSource).toContain("createReadableVrTextPanel");
    expect(mainSource).toContain("iwsdkStationSceneObjects.clinicalPanel");
    expect(mainSource).toContain("clinicalPanelLinesForSelectedStation");
    expect(mainSource).toContain("clinicalPanel.update(clinicalPanelLinesForSelectedStation())");
    expect(mainSource).toContain("runtimeSceneObjectPrefix()}.locomotion-rig");
    expect(mainSource).toContain("iwsdkStationSceneObjects.dialoguePanel");
    expect(mainSource).toContain("iwsdkStationSceneObjects.actorRealismPanel");
    expect(mainSource).toContain("iwsdkStationSceneObjects.inputPanel");
    expect(mainSource).toContain("Actor Realism Requirements");
    expect(mainSource).toContain("formatActiveActorRealismRequirementLines");
    expect(mainSource).toContain("until actor-specific humanoid gate evidence attaches");
    expect(mainSource).toContain("active_dialogue_actor_realism_requirements_visible_for_adversarial_review");
    expect(mainSource).toContain("renderer.xr.getController");
    expect(mainSource).toContain("XRControllerModelFactory");
    expect(mainSource).toContain("renderer.xr.getControllerGrip");
    expect(mainSource).toContain("runtimeSceneObjectPrefix()}.controller-ray");
    expect(mainSource).toContain('"select"');
    expect(mainSource).toContain("xr_controller_select");
    expect(mainSource).toContain("completeNextTraceActionFromXrSelect");
    expect(mainSource).toContain("iwsdkStationSceneObjects.controllerGripLeft");
    expect(mainSource).toContain("iwsdkStationSceneObjects.controllerGripRight");
    expect(mainSource).toContain("openClinXrIwsdkStableObjectName");
    expect(mainSource).toContain("runtimeSceneObjectPrefix()}.controller-grip");
  });

  it("raises and offsets in-scene text panels for clearer desktop visual QA", () => {
    const mainSource = readFileSync(new URL("./main.ts", import.meta.url), "utf8");

    expect(mainSource).toContain("clockMesh.position.set(0.9, 3.35, -1.2)");
    expect(mainSource).toContain("panel.mesh.position.set(-1.55, 2.62, -1.42)");
    expect(mainSource).toContain("dialoguePanel.mesh.position.set(0.85, 2.58, -1.42)");
    expect(mainSource).toContain("inputPanel.mesh.position.set(1.6, 1.32, -1.08)");
    expect(mainSource).toContain("inputPanel.mesh.rotation.y = -0.42");
  });

  it("adds local mesh hand models with primitive fallback and experimental locomotion affordances", () => {
    const mainSource = readFileSync(new URL("./main.ts", import.meta.url), "utf8");
    const runtimeStateSource = readFileSync(new URL("./runtime-state.ts", import.meta.url), "utf8");

    expect(mainSource).toContain("XRHandModelFactory");
    expect(mainSource).toContain("renderer.xr.getHand");
    expect(mainSource).toContain("GLTFLoader");
    expect(mainSource).toContain("LoadingManager");
    expect(mainSource).toContain("localHandMeshPath");
    expect(mainSource).toContain("meshLoadingManager.onError");
    expect(mainSource).toContain("onMeshLoadError");
    expect(mainSource).toContain("handAssetLoadErrors");
    expect(mainSource).toContain('recordBootPhase("hand_mesh_asset_load_failed"');
    expect(mainSource).toContain("handModelFactory.setPath(localHandMeshPath)");
    expect(mainSource).toContain("meshHandModelProfile");
    expect(mainSource).toContain("createHandModel(hand, meshHandModelProfile)");
    expect(mainSource).toContain("primitiveHandModelProfile");
    expect(mainSource).toContain("createHandModel(hand, primitiveHandModelProfile)");
    expect(mainSource).toContain("activeHandRepresentationKind");
    expect(mainSource).toContain("meshHandRepresentationKind");
    expect(mainSource).not.toContain('createHandModel(hand, "boxes")');
    expect(mainSource).not.toContain("cdn.jsdelivr.net");
    expect(mainSource).not.toContain("@webxr-input-profiles/assets");
    expect(mainSource).toContain("runtimeSceneObjectPrefix()}.hand-model");
    expect(mainSource).toContain("installHandModelsOnce");
    expect(mainSource).toContain("handModelStatus");
    expect(mainSource).toContain("__openClinXrBootEvidence");
    expect(mainSource).toContain("applyLocomotion");
    expect(mainSource).toContain("readXrGamepadLocomotion");
    expect(mainSource).toContain("readXrHandGestureLocomotion");
    expect(mainSource).toContain("sampleRoomScalePose");
    expect(mainSource).toContain("previousRoomScalePose");
    expect(mainSource).toContain("roomScalePose");
    expect(mainSource).toContain("Movement: room-scale walking, thumbstick, keyboard, or armed hand gesture");
    expect(mainSource).toContain(`Speech affect: \${formatHumanoidSpeechAffectEvidence`);
    expect(mainSource).toContain("emotion-transition-cue-present");
    expect(mainSource).toContain("scenarioDialogueEmotionContext");
    expect(mainSource).toContain("emotionForScenarioActorProfile");
    expect(mainSource).toContain("scenario_actor_baseline_mood_emotion_mapping");
    expect(mainSource).toContain("case_definition_driven_expression_selection");
    expect(mainSource).toContain("openclinxrCaptureMode");
    expect(mainSource).toContain("suppressed_mismatched_placeholder_environment_for_case_defined_scene_manifest");
    expect(mainSource).toContain("mismatched_placeholder_equipment_glb_suppressed");
    expect(mainSource).toContain("semantic_pediatric_equipment_cues_visible");
    expect(mainSource).toContain("emotionSource: speech.emotionContext.source");
    expect(mainSource).toContain("humanoidSourceComparator");
    expect(mainSource).toContain("peds_anny_mpfb2_eye_rig_patient");
    expect(mainSource).toContain("peds_anny_school_age_mpfb2_eye_patient");
    expect(mainSource).toContain("peds_anny_comfy_masked_skin");
    expect(mainSource).toContain("/cagematch/anny-mpfb2-eye-rig/current/peds_patient_child_mpfb2_eye_rig.glb");
    expect(mainSource).toContain("/cagematch/anny-school-age/current/peds_patient_child_mpfb2_eye.glb");
    expect(mainSource).toContain("pedsAsthmaPatientBundleVisemeUtterance");
    expect(mainSource).toContain("openClinXrVisemeTimelineComparatorEvidence");
    expect(mainSource).toContain("resolvePedsAdaptiveDialogueBranch");
    expect(mainSource).toContain("__openClinXrPedsAdaptiveDialogueEvidence");
    expect(mainSource).toContain("schoolAgePatientAssetPath");
    expect(mainSource).toContain("__openClinXrMouthGazePoseComparatorEvidence");
    expect(mainSource).toContain("recordMouthGazePoseComparatorEvidence");
    expect(mainSource).toContain("glb_morph_target_timeline_from_bundle_dialogue_with_emotion_transition");
    expect(mainSource).toContain("bundle_dialogue_adaptive_branch");
    expect(mainSource).toContain("/cagematch/anny-comfy-masked-skin/current/peds_anxious_parent.glb");
    expect(mainSource).toContain("/cagematch/anny-comfy-masked-skin/current/peds_nurse_kevin.glb");
    expect(mainSource).toContain("source_materials_preserved_for_clean_comparator_capture_no_runtime_tint");
    expect(mainSource).toContain("source_pose_preserved_for_clean_comparator_capture_no_runtime_posture_override");
    expect(mainSource).toContain("source_comparator_fixed_pose_sampled");
    expect(mainSource).toContain("source_comparator_animation_suppressed");
    expect(mainSource).toContain("clean_humanoid_source_comparator_full_body_candidate_capture");
    expect(mainSource).toContain("hidden_for_clean_humanoid_source_comparator_capture");
    expect(mainSource).toContain("frustum_culling_disabled_for_clean_source_comparator_capture_after_skinned_mesh_bounds_hid_body");
    expect(mainSource).toContain("mpfb-ob-patient-aisha-rigged-candidate.glb");
    expect(mainSource).toContain("charmorph-antonia-ob-patient-candidate.glb");
    expect(mainSource).toContain("charmorph-reom-ob-patient-candidate.glb");
    expect(mainSource).toContain("isPediatricAsthmaRuntimeScenario");
    expect(mainSource).toContain("pediatric_patient_smaller_silhouette_cue");
    expect(mainSource).toContain("pediatric_asthma_hunched_work_of_breathing_pose_cue");
    expect(mainSource).toContain("pediatric_patient_case_role_distinct_from_adult_actor_pose_cue");
    expect(mainSource).toContain("applyHumanoidJointRotationsByAlias");
    expect(mainSource).toContain("mixamorigleftarm");
    expect(mainSource).toContain("pediatric-patient-left-arm-hunched-breathing-pose-cue");
    expect(mainSource).toContain("nurse-reaching-to-oxygen-equipment-pose-cue");
    expect(mainSource).toContain("parent-supportive-hand-to-chest-pose-cue");
    expect(mainSource).toContain("configureSemanticRolePoseOverlay");
    expect(mainSource).toContain("semantic_role_pose_overlay_hidden_unless_affordance_or_debug_capture");
    expect(mainSource).toContain("pediatric-small-stature-band-cue");
    expect(mainSource).toContain("nurse-scrub-v-neck-role-cue");
    expect(mainSource).toContain("parent-civilian-shoulder-bag-cue");
    expect(mainSource).toContain("pediatric-nebulizer-mask-face-cue");
    expect(mainSource).toContain("pediatric-oxygen-tubing-work-of-breathing-cue");
    expect(mainSource).toContain("nurse_adult_clinical_silhouette_cue");
    expect(mainSource).toContain("nurse_asymmetric_equipment_attention_pose_cue");
    expect(mainSource).toContain("adult_family_member_silhouette_cue");
    expect(mainSource).toContain("parent_asymmetric_anxiety_pose_cue");
    expect(mainSource).toContain("family-parent-hand-to-chest-anxiety-cue");
    expect(mainSource).toContain("__openClinXrRoleDistinctHumanoidCueEvidence");
    expect(mainSource).toContain("recordRoleDistinctHumanoidCue");
    expect(mainSource).toContain("pediatric_nebulizer_mask_face_cue");
    expect(mainSource).toContain("family_parent_hand_to_chest_anxiety_cue");
    expect(mainSource).toContain("__openClinXrPediatricRespiratoryEquipmentCueEvidence");
    expect(mainSource).toContain("addPediatricRespiratoryEquipmentCues");
    expect(mainSource).toContain("generated-equipment-slot");
    expect(mainSource).toContain("case_definition_equipment_loaded_from_runtime_bundle");
    expect(mainSource).toContain("dynamic_encounter_equipment_context");
    expect(mainSource).toContain("pediatric_nebulizer_mask_readability_cue");
    expect(mainSource).toContain("oxygen_wall_port_round_connector_cue");
    expect(mainSource).toContain("pulse_ox_finger_clip_readability_cue");
    expect(mainSource).toContain("low_translucent_pediatric_bed_rail_cue");
    expect(mainSource).toContain("__openClinXrRuntimeHumanoidActingCueEvidence");
    expect(mainSource).toContain("pediatricAsthmaActingOverlayForSlot");
    expect(mainSource).toContain("pediatric_asthma_visible_work_of_breathing_idle_cue");
    expect(mainSource).toContain("pediatric_patient_idle_gaze_alternates_parent_nurse_learner");
    expect(mainSource).toContain("recordRuntimeHumanoidActingCueEvidence");
    expect(mainSource).toContain("__openClinXrCaseDefinedHumanoidPerformanceContractEvidence");
    expect(mainSource).toContain("buildCaseDefinedHumanoidPerformanceContractEvidence");
    expect(mainSource).toContain("scenarioId = selectedScenarioId()");
    expect(mainSource).toContain("scenarioBank.find((candidate) => candidate.scenarioId === scenarioId)");
    expect(mainSource).toContain("window.__openClinXrCaseDefinedHumanoidPerformanceContractEvidence = buildCaseDefinedHumanoidPerformanceContractEvidence()");
    expect(mainSource).toContain("buildCaseDefinedHumanoidPerformanceContractEvidence(encounterRuntimeAssetBundle.scenarioId)");
    expect(mainSource).toContain("formatCaseDefinedHumanoidPerformanceContractEvidence");
    expect(mainSource).toContain(`case humanoid contract \${evidence.actorCount} actors`);
    expect(mainSource).toContain("case_definition_humanoid_performance_metadata_only");
    expect(mainSource).toContain("caseDefinedHumanoidPerformanceContractEvidence: window.__openClinXrCaseDefinedHumanoidPerformanceContractEvidence");
    expect(runtimeStateSource).toContain("xr_room_scale");
    expect(runtimeStateSource).toContain("room_scale_keyboard_thumbstick_and_hand_gesture_dolly");
    expect(runtimeStateSource).toContain('localHandMeshPath = "/xr-hands/generic-hand/"');
    expect(runtimeStateSource).toContain('meshHandModelProfile = "mesh"');
    expect(runtimeStateSource).toContain('meshHandRepresentationKind = "mesh"');
    expect(mainSource).toContain("handGestureDwellMs");
    expect(mainSource).toContain("handPinchDistanceThresholdMeters");
    expect(mainSource).toContain("handGestureLocomotionOriginMeters");
    expect(mainSource).toContain("handGestureRelativeOffsetMeters");
    expect(mainSource).toContain("isXrHandPinching");
    expect(mainSource).toContain('joints?.["thumb-tip"]');
    expect(mainSource).not.toContain("inputState?.pinching");
    expect(mainSource).toContain("other_locomotion_source_active");
    expect(mainSource).toContain("Gesture: armed");
    expect(mainSource).toContain("Trace hand select");
    expect(mainSource).toContain("xr_hand_select");
    expect(mainSource).toContain("Trace interaction");
    expect(mainSource).toContain("__openClinXrTraceInteractionEvidenceSummary");
    expect(mainSource).toContain("buildXrTraceInteractionEvidenceSummary");
    expect(mainSource).toContain("summary.claimBoundary");
    expect(mainSource).toContain("classifyXrSelectSource");
    expect(mainSource).toContain("event.data");
    expect(mainSource).toContain("formatCaptureReadinessStatus");
    expect(mainSource).toContain("Capture:");
    expect(mainSource).toContain("rep ${inputEvidence.handRepresentationKind");
    expect(mainSource).toContain("createXrHandSelectState");
    expect(mainSource).toContain("maybeCompleteTraceActionFromHandSelect");
    expect(mainSource).toContain("xr_hand_gesture");
    expect(mainSource).toContain("xrHandGestureState");
    expect(mainSource).toContain("locomotionDiagnostics");
    expect(mainSource).toContain("formatLocomotionDiagnosticSummary");
    expect(mainSource).toContain("gamepadSources");
    expect(mainSource).toContain("pinchDistanceMeters");
    expect(mainSource).toContain("movementCrossedDeadzone");
    expect(mainSource).toContain("fallbackAnimationLoop");
    expect(mainSource).toContain("immersiveFramesObserved");
    expect(mainSource).toContain("previewFramesObserved");
    expect(mainSource).toContain("__openClinXrInputEvidence");
    expect(existsSync(new URL("../public/xr-hands/generic-hand/left.glb", import.meta.url))).toBe(true);
    expect(existsSync(new URL("../public/xr-hands/generic-hand/right.glb", import.meta.url))).toBe(true);
    expect(existsSync(new URL("../public/xr-hands/generic-hand/LICENSE.md", import.meta.url))).toBe(true);
    expect(existsSync(new URL("../public/xr-hands/generic-hand/PROVENANCE.md", import.meta.url))).toBe(true);
  });

  it("keeps local hand mesh asset hashes aligned with reviewed provenance", () => {
    const provenance = readFileSync(new URL("../public/xr-hands/generic-hand/PROVENANCE.md", import.meta.url), "utf8");

    for (const [fileName, expectedHash] of Object.entries(genericHandAssetHashes)) {
      const asset = readFileSync(new URL(`../public/xr-hands/generic-hand/${fileName}`, import.meta.url));
      const actualHash = createHash("sha256").update(asset).digest("hex");

      expect(actualHash).toBe(expectedHash);
      expect(provenance).toContain(`generic-hand/${fileName}\` | \`${expectedHash}\``);
    }
  });

  it("keeps generated scene asset hashes aligned with local fixture provenance", () => {
    const humanoidProvenance = readFileSync(new URL("../public/xr-assets/humanoids/PROVENANCE.md", import.meta.url), "utf8");
    const equipmentProvenance = readFileSync(new URL("../public/xr-assets/medical-equipment/PROVENANCE.md", import.meta.url), "utf8");
    const environmentProvenance = readFileSync(new URL("../public/xr-assets/environment/PROVENANCE.md", import.meta.url), "utf8");

    for (const [fileName, expectedHash] of Object.entries(generatedSceneAssetHashes)) {
      const assetUrl = new URL(`../public/xr-assets/${fileName}`, import.meta.url);
      if (existsSync(assetUrl)) {
        const asset = readFileSync(assetUrl);
        const actualHash = createHash("sha256").update(asset).digest("hex");
        expect(actualHash).toBe(expectedHash);
      }
      expect(`${humanoidProvenance}\n${equipmentProvenance}\n${environmentProvenance}`).toContain(expectedHash);
    }
  });

  it("exposes a local manual-performance evidence export panel", () => {
    const mainSource = readFileSync(new URL("./main.ts", import.meta.url), "utf8");
    const runtimeStateSource = readFileSync(new URL("./runtime-state.ts", import.meta.url), "utf8");

    expect(runtimeStateSource).toContain("buildManualPerformanceCaptureSummary");
    expect(mainSource).toContain("__openClinXrManualPerformanceCaptureSummary");
    expect(mainSource).toContain("__openClinXrTraceActionHandoffEvidence");
    expect(mainSource).toContain("formatLocomotionPathQuality");
    expect(runtimeStateSource).toContain("path_shape_probe_only");
    expect(mainSource).toContain("manual-evidence-json");
    expect(mainSource).toContain("copy-evidence-button");
    expect(mainSource).toContain("evidence-trace");
    expect(mainSource).toContain("evidence-scene-assets");
    expect(mainSource).toContain("formatSceneAssetEvidenceStatus");
    expect(mainSource).toContain("evidence-actor-player");
    expect(mainSource).toContain("formatActorPlayerRuntimeMetadataSummary");
    expect(mainSource).toContain("__openClinXrActorPlayerRuntimeMetadataSummary");
    expect(mainSource).toContain("review-only actor-player metadata");
    expect(mainSource).toContain("local_deterministic_non_scene");
    expect(mainSource).toContain("not_scene_executed");
    expect(mainSource).toContain("ui_xr_actor_player_metadata_only_not_runtime_execution");
    expect(mainSource).toContain("__openClinXrPedsActorPlayerRuntimePlaybackEvidence");
    expect(mainSource).toContain("local_desktop_preview_from_bundle_dialogue_or_actor_player_samples");
    expect(mainSource).toContain("local_actor_player_runtime_preview_not_readiness");
    expect(mainSource).toContain("live preview");
    expect(mainSource).toContain("real_anny_model_output");
    expect(mainSource).toContain("b_plus_visual_realism_gate");
    expect(mainSource).toContain("evidence-validation");
    expect(mainSource).toContain("updateManualEvidencePanel");
    expect(mainSource).toContain("hand rep");
    expect(mainSource).toContain("attempt");
    expect(mainSource).toContain("frameStatsFresh");
    expect(mainSource).toContain("formatTechnicalGapStatus");
    expect(mainSource).toContain("technicalGaps");
    expect(mainSource).toContain("window.setInterval(updateManualEvidencePanel, 1000)");
    expect(mainSource).toContain("manualPerformanceDraft");
    expect(mainSource).toContain("__OPENCLINXR_UI_XR_APP_METADATA__");
    expect(mainSource).toContain("buildRuntimeReproducibilityEvidence");
    expect(mainSource).toContain("buildXrRuntimeReadinessDecision");
    expect(mainSource).toContain("buildXrTraceActionHandoffEvidence");
    expect(mainSource).toContain("__openClinXrRuntimeReadinessDecision");
    expect(mainSource).toContain("traceActionHandoffEvidence");
    expect(mainSource).toContain("posture-launch");
    expect(mainSource).toContain("learner launch blocked");
    expect(runtimeStateSource).toContain("buildManualPerformanceReproducibility");
    expect(runtimeStateSource).toContain("browser_reported_metadata_not_device_firmware_proof");
    expect(runtimeStateSource).toContain("manualValidationReady");
    expect(runtimeStateSource).toContain("frame_stats_stale_or_unsampled");
    expect(runtimeStateSource).toContain("formatManualEvidenceCopyStatus");
    expect(runtimeStateSource).toContain("Clipboard unavailable");
    expect(mainSource).toContain("evidenceCopyDisposition");
    expect(mainSource).toContain("navigator.clipboard.writeText");
  });

  it("plays peds actor-player sample turns through live humanoid speech and affect controls without promoting readiness", () => {
    const mainSource = readFileSync(new URL("./main.ts", import.meta.url), "utf8");

    expect(mainSource).toContain("schedulePedsActorPlayerRuntimePlaybackIfReady");
    expect(mainSource).toContain("triggerPedsActorPlayerRuntimeTurnForTrace");
    expect(mainSource).toContain("pedsActorPlayerTurnForTraceTag");
    expect(mainSource).toContain("pedsActorPlayerRuntimeSequenceForTrace");
    expect(mainSource).toContain("playPedsActorPlayerRuntimeSequence");
    expect(mainSource).toContain("bundle_dialogue_sequence");
    expect(mainSource).toContain("latestSequenceActorIds");
    expect(mainSource).toContain("applyPedsActorPlayerSequenceListenerCues");
    expect(mainSource).toContain("sequence_listener_gaze_to_active_speaker");
    expect(mainSource).toContain("sequence_listener_expression_residual");
    expect(mainSource).toContain("latestListenerActorIds");
    expect(mainSource).toContain("latestCoupledSignalIds");
    expect(mainSource).toContain("pedsActorPlayerTurnFromRuntimeBundleTrace");
    expect(mainSource).toContain("pedsActorPlayerBundleDialogueTurns");
    expect(mainSource).toContain("pedsActorPlayerRuntimeTurns");
    expect(mainSource).toContain("bundle_dialogue_turn");
    expect(mainSource).toContain("actor_player_sample_fallback");
    expect(mainSource).toContain("normalizePedsActorPlayerEmotion");
    expect(mainSource).toContain("triggerHumanoidDialogue(turn.actorId");
    expect(mainSource).toContain("latestTriggerSource: \"trace_action\"");
    expect(mainSource).toContain("latestTriggerSource: \"scheduled_preview\"");
    expect(mainSource).toContain("oxygen_request: \"turn_3_oxygen_request\"");
    expect(mainSource).toContain("parent_communication: \"turn_6_parent_communication\"");
    expect(mainSource).toContain("oxygen_request: [\"oxygen_request\", \"work_of_breathing_assessment\"]");
    expect(mainSource).toContain("parent_communication: [\"parent_communication\", \"empathy_statement\"]");
    expect(mainSource).toContain("roleAnimationClipName: \"openclinxr_role_patient_asthma_breathing_effort\"");
    expect(mainSource).toContain("roleAnimationClipName: \"openclinxr_role_parent_anxious_fidget_guard\"");
    expect(mainSource).toContain("roleAnimationClipName: \"openclinxr_role_nurse_clinical_check_reassure\"");
    expect(mainSource).toContain("scenePlacementEvidenceAllowed: false");
    expect(mainSource).toContain("learnerLaunchAllowed: false");
    expect(mainSource).toContain("questEvidenceRefreshAllowed: false");
    expect(mainSource).toContain("productionAssetReadinessClaimed: false");
    expect(mainSource).toContain("clinicalValidityClaimed: false");
    expect(mainSource).toContain("scoringValidityClaimed: false");
  });

  it("surfaces runtime provider and mode evidence without adding remote dependencies", () => {
    const mainSource = readFileSync(new URL("./main.ts", import.meta.url), "utf8");
    const runtimeStateSource = readFileSync(new URL("./runtime-state.ts", import.meta.url), "utf8");

    expect(runtimeStateSource).toContain("buildRuntimeEvidencePosture");
    expect(mainSource).toContain("__openClinXrRuntimeEvidencePosture");
    expect(mainSource).toContain("runtime-posture-grid");
    expect(mainSource).toContain("posture-model");
    expect(mainSource).toContain("posture-voice");
    expect(mainSource).toContain("posture-quest");
    expect(mainSource).toContain("posture-mr");
    expect(mainSource).toContain("readRuntimeActorEquipmentMaterializationGate(bundle)");
    expect(mainSource).toContain("actor/equipment materialization blocked");
    expect(mainSource).toContain("materialization evidence slots");
    expect(runtimeStateSource).toContain("actorEquipmentMaterializationGate: RuntimeActorEquipmentMaterializationGateEvidence | null");
    expect(runtimeStateSource).toContain("materializationEvidenceAttachmentSummary: RuntimeMaterializationEvidenceAttachmentSummary | null");
    expect(mainSource).toContain("Mock model/voice active");
  });

  it("names station scene objects for future IWSDK scene hierarchy checks", () => {
    const mainSource = readFileSync(new URL("./main.ts", import.meta.url), "utf8");
    const runtimeStateSource = readFileSync(new URL("./runtime-state.ts", import.meta.url), "utf8");

    expect(mainSource).toContain("scene.name = iwsdkStationSceneObjects.stationRoot");
    expect(mainSource).toContain("patient.name = iwsdkStationSceneObjects.patientRobertHayes");
    expect(mainSource).toContain("iwsdkStationSceneObjects.ecgCart");
    expect(mainSource).toContain("iwsdkStationSceneObjects.ivPoleWithPump");
    expect(mainSource).toContain("generated-equipment-slot.${ecgCartRuntimeAsset.assetId}");
    expect(mainSource).toContain("generated-equipment-slot.${ivPoleRuntimeAsset.assetId}");
    expect(mainSource).toContain("loadGeneratedEquipmentIntoSceneSlot(ecgCart");
    expect(mainSource).toContain("loadGeneratedEquipmentIntoSceneSlot(ivPole");
    expect(mainSource).toContain("loadGeneratedEnvironmentIntoSceneSlot(environmentShell");
    expect(mainSource).toContain("__openClinXrSceneAssetEvidence");
    expect(mainSource).toContain("sceneAssetEvidence: window.__openClinXrSceneAssetEvidence");
    expect(mainSource).toContain("cameraFramingCue");
    expect(mainSource).toContain("visualFidelityCueIds");
    expect(mainSource).toContain("generated_humanoid_face_hair_eyes_scrubs_shoes_cue");
    expect(mainSource).toContain("generated_humanoid_generator_native_front_orientation_preserved");
    expect(mainSource).toContain("humanoid_interaction_target_decluttered");
    expect(mainSource).toContain("generated_humanoid_facial_features_unobscured");
    expect(mainSource).toContain("visible_runtime_mouth_eye_expression_cues");
    expect(mainSource).toContain("createHumanoidExpressionCue");
    expect(mainSource).toContain("visible_runtime_mouth_shape_cue");
    expect(mainSource).toContain("visible_runtime_eye_focus_cue");
    expect(mainSource).toContain("visible_runtime_eyebrow_jaw_cheek_cue");
    expect(mainSource).toContain("activeExpressionCueIds");
    expect(mainSource).toContain("activeBodyMotionCueIds");
    expect(mainSource).toContain("activeBodyMotionIntensity");
    expect(mainSource).toContain("activeBodyMotionMode");
    expect(mainSource).toContain("openClinXrBodyMotionCue");
    expect(mainSource).toContain("scenario_dialogue_body_lean_cue");
    expect(mainSource).toContain("emotion_microstep_weight_shift_cue");
    expect(mainSource).toContain("__openClinXrExamineeLocomotionEvidence");
    expect(mainSource).toContain("structured_examinee_locomotion_path_evidence");
    expect(mainSource).toContain("examinee_runtime_position_ring_cue");
    expect(mainSource).toContain("hidden_in_scene_only_visual_review_while_locomotion_evidence_remains_window_backed");
    expect(mainSource).toContain("__openClinXrEnvironmentStateEvidence");
    expect(mainSource).toContain("updateEnvironmentStateForTrace");
    expect(mainSource).toContain("runtimeEquipmentIdsForTraceTag");
    expect(mainSource).toContain("oxygen_wall_port_runtime_attention");
    expect(mainSource).toContain("nebulizer_mask_runtime_attention");
    expect(mainSource).toContain("work_of_breathing_runtime_attention");
    expect(mainSource).toContain("inhaler_spacer_history_runtime_attention");
    expect(mainSource).toContain("asthma_trigger_history_runtime_attention");
    expect(mainSource).toContain("pediatric_escalation_runtime_attention");
    expect(mainSource).toContain("urgent_family_support_runtime_attention");
    expect(mainSource).toContain("pediatric_empathy_deescalation_runtime_attention");
    expect(mainSource).toContain("child_parent_reassurance_runtime_attention");
    expect(mainSource).toContain("patient_note_runtime_completion_attention");
    expect(mainSource).toContain("faculty_review_handoff_runtime_attention");
    expect(mainSource).toContain("parent_chair");
    expect(mainSource).toContain("oxygen_started");
    expect(mainSource).toContain("bronchodilator_in_progress");
    expect(mainSource).toContain("applyEnvironmentStateVisuals");
    expect(mainSource).toContain("environmentReactiveProps");
    expect(mainSource).toContain("activePropIds");
    expect(mainSource).toContain("environmentalRealismCueIds");
    expect(mainSource).toContain("roomEnvironmentalRealismCueIds");
    expect(mainSource).toContain("alarmCueMode");
    expect(mainSource).toContain("environmentMotionCueMode");
    expect(mainSource).toContain("updateEnvironmentRealismAnimations");
    expect(mainSource).toContain("deterministic_visual_pulse");
    expect(mainSource).toContain("openClinXrBaseY");
    expect(mainSource).toContain("openClinXrBaseColorHex");
    expect(mainSource).toContain("emissiveIntensity");
    expect(mainSource).toContain("visual_only_no_audio");
    expect(mainSource).toContain("openClinXrVisualAlarmCue");
    expect(mainSource).toContain("Reactive room state");
    expect(mainSource).toContain("room-state-summary");
    expect(mainSource).toContain("local_trace_tied_environment_state");
    expect(mainSource).toContain("recordSceneAssetStatus");
    expect(mainSource).toContain("createEdChestPainLocalLearnerRuntimeAssetBundle");
    expect(mainSource).toContain("defaultStaticGeneratedLearnerRuntimeAssetBundleScenarioId");
    expect(mainSource).toContain("selectedScenarioId");
    expect(mainSource).toContain("openclinxrScenarioId");
    expect(mainSource).toContain("shouldUseStaticGeneratedBundleForVisualReview");
    expect(mainSource).toContain("static_generated_visual_review_only_learner_use_blocked");
    expect(mainSource).toContain("runtimePatientActorId");
    expect(mainSource).toContain("runtimeClinicalTeamActorId");
    expect(mainSource).toContain("runtimeFamilyActorId");
    expect(mainSource).toContain("initializeStaticGeneratedLearnerRuntimeAssetBundle");
    expect(mainSource).toContain("initializeLearnerRuntimeAssetBundle");
    expect(mainSource).toContain("getLearnerRuntimeAssetBundle");
    expect(mainSource).toContain("learnerRuntimeAssetBundleId");
    expect(mainSource).toContain("runtimeAssetBundleId");
    expect(mainSource).toContain("openclinxr.scenarioId");
    expect(mainSource).toContain("__openClinXrSelectedRuntimeAssetBundleId");
    expect(mainSource).toContain("runtimeAssetBundleId: window.__openClinXrSelectedRuntimeAssetBundleId");
    expect(mainSource).toContain("learner_runtime_asset_bundle_loaded");
    expect(mainSource).toContain("learner_runtime_asset_bundle_static_generated_loaded");
    expect(mainSource).toContain("learner_runtime_asset_bundle_fallback");
    expect(mainSource).toContain("resolveRuntimeAssetUrl");
    expect(mainSource).toContain("resolveEmulatorRuntimeAssetUrl");
    expect(mainSource).toContain(`/xr-assets/humanoids/\${resolveLocalHumanoidRuntimeAssetFileName(fileName)}`);
    expect(mainSource).toContain(`/xr-assets/environment/\${resolveLocalEnvironmentRuntimeAssetFileName(fileName)}`);
    expect(mainSource).toContain(`/xr-assets/medical-equipment/\${resolveLocalEquipmentRuntimeAssetFileName(fileName)}`);
    expect(mainSource).toContain("isScenarioSpecificRuntimeFixtureForSelectedScenario");
    expect(mainSource).toContain("pediatric_urgent_care_bay_environment");
    expect(mainSource).toContain("runtimeEquipmentSlotsByAssetId");
    expect(mainSource).toContain("applyRuntimeEquipmentTraceVisuals");
    expect(mainSource).toContain("equipment-trace-active");
    expect(mainSource).toContain("openClinXrRuntimeEquipmentAssetId");
    expect(mainSource).toContain("resolveLocalHumanoidRuntimeAssetFileName");
    expect(mainSource).toContain("resolveLocalEnvironmentRuntimeAssetFileName");
    expect(mainSource).toContain("resolveLocalEquipmentRuntimeAssetFileName");
    expect(mainSource).toContain("findRuntimeActorAsset");
    expect(mainSource).toContain("findRuntimeEquipmentAsset");
    expect(mainSource).toContain("generated_equipment_asset_loaded");
    expect(mainSource).toContain("generated_equipment_asset_load_failed");
    expect(mainSource).toContain("generated_environment_asset_loaded");
    expect(mainSource).toContain("generated_environment_asset_load_failed");
    expect(mainSource).toContain("loadGeneratedHumanoidIntoActorSlot(patient");
    expect(mainSource).toContain("humanoid.rotation.y = 0");
    expect(mainSource).toContain("isHumanoidMouthGazePoseReviewCaptureMode");
    expect(mainSource).toContain("isDynamicGeneratedEncounterSceneMode");
    expect(mainSource).toContain("isGeneratedSceneOverviewCaptureMode");
    expect(mainSource).toContain("generated_scene_overview_multi_actor_dynamic_encounter_capture");
    expect(mainSource).toContain("generated_scene_overview_multi_actor_dynamic_encounter_capture_clinical_focus");
    expect(mainSource).toContain("shouldShowRuntimeAffordanceMarkers");
    expect(mainSource).toContain("shouldShowPrimitiveAssetFallbacks");
    expect(mainSource).toContain("shouldShowInSceneEvidencePanels");
    expect(mainSource).toContain("shouldShowActorRealismRequirementPanel");
    expect(mainSource).toContain('captureMode.includes("actor-realism")');
    expect(mainSource).toContain("active_actor_realism_panel_hidden_until_trace_selected");
    expect(mainSource).toContain("shouldShowInSceneIdentityLabels");
    expect(mainSource).toContain("isSceneOnlyVisualReviewCaptureMode");
    expect(mainSource).toContain("scene-only-visual-review");
    expect(mainSource).toContain("hidden_when_scene_manifest_and_generated_environment_supply_encounter_context");
    expect(mainSource).toContain("hidden_in_generated_encounter_scene_unless_affordance_evidence_capture");
    expect(mainSource).toContain("hidden_in_generated_encounter_scene_unless_fallback_debug_capture");
    expect(mainSource).toContain("hidden_in_generated_encounter_scene_unless_panel_evidence_capture");
    expect(mainSource).toContain("hidden_in_generated_encounter_scene_unless_identity_debug_capture");
    expect(mainSource).toContain("dynamic_encounter_world_floor_anchor_beyond_reusable_portal_threshold");
    expect(mainSource).toContain("isHumanoidFaceDetailCaptureMode");
    expect(mainSource).toContain("humanoid_face_lip_eye_detail_capture");
    expect(mainSource).toContain("humanoidDialogueDurationMs");
    expect(mainSource).toContain("Math.max(baseDurationMs, 45_000)");
    expect(mainSource).toContain("generated_humanoid_asset_loaded");
    expect(mainSource).toContain("generated_humanoid_asset_load_failed");
    expect(runtimeStateSource).toContain("procedural_dialogue_expression_gaze_fallback");
    expect(mainSource).toContain("runtimeGeneratedSceneObjectName(ecgCartRuntimeAsset)");
    expect(mainSource).toContain("runtimeGeneratedSceneObjectName(ivPoleRuntimeAsset)");
    expect(mainSource).toContain("runtimeGeneratedSceneObjectName(encounterRuntimeAssetBundle.environment)");
    expect(mainSource).toContain("runtimeGeneratedSceneObjectName(patientRuntimeHumanoidAsset)");
    expect(mainSource).toContain("runtimeGeneratedSceneObjectName(nurseRuntimeHumanoidAsset)");
    expect(mainSource).toContain("runtimeGeneratedSceneObjectName(spouseRuntimeHumanoidAsset)");
    expect(mainSource).toContain("sceneObjectName: options.objectName");
    expect(mainSource).toContain("runtimeActorPlacement(runtimePatientActorId()");
    expect(mainSource).toContain("runtimeActorPlacement(runtimeClinicalTeamActorId()");
    expect(mainSource).toContain("runtimeActorPlacement(runtimeFamilyActorId()");
    expect(mainSource).toContain("actorNameplateLabel(patientPlacement.labelPrefix, runtimePatientActorId())");
    expect(mainSource).toContain("actorNameplateLabel(nursePlacement.labelPrefix, runtimeClinicalTeamActorId())");
    expect(mainSource).toContain("actorNameplateLabel(spousePlacement.labelPrefix, runtimeFamilyActorId())");
    expect(mainSource).toContain("runtimeSceneObjectPrefix()}.actor-nameplate");
    expect(mainSource).toContain("runtimeAssetDisplayLabel(ecgCartRuntimeAsset");
    expect(mainSource).toContain("runtimeAssetDisplayLabel(ivPoleRuntimeAsset");
    expect(mainSource).toContain("roleTintColor");
    expect(mainSource).toContain("tintGeneratedSceneMaterials");
    expect(mainSource).toContain("registerGeneratedHumanoidAnimation");
    expect(mainSource).toContain("updateGeneratedHumanoidAnimations(deltaSeconds, now, camera, genDriveForHumanoid)");
    expect(mainSource).toContain("procedural_idle_breathing_fallback");
    expect(mainSource).toContain("arms_lowered_from_generator_bind_pose_cue");
    expect(mainSource).toContain("applyGeneratedHumanoidRoleSpecificPosture");
    expect(mainSource).toContain("addRoleSpecificHumanoidVisuals");
    expect(mainSource).toContain("/generated-humanoids/peds_patient_child.glb");
    expect(mainSource).toContain("/generated-humanoids/peds_anxious_parent.glb");
    expect(mainSource).toContain("/generated-humanoids/peds_nurse_kevin.glb");
    expect(mainSource).toContain("runtimeSceneObjectPrefix()}.patient-hospital-gown-torso");
    expect(mainSource).toContain("runtimeSceneObjectPrefix()}.nurse-role-badge-cue");
    expect(mainSource).toContain("runtimeSceneObjectPrefix()}.family-civilian-cardigan-cue");
    expect(mainSource).toContain("patient_chest_pain_guarding_pose_cue");
    expect(mainSource).toContain("patient-hospital-gown-torso");
    expect(mainSource).toContain("nurse-role-badge-cue");
    expect(mainSource).toContain("family-civilian-cardigan-cue");
    expect(mainSource).toContain("gltf_animation_clips_playing");
    expect(mainSource).toContain("gltf_role_animation_clip_playing");
    expect(mainSource).toContain("roleAnimationClipNamesForActor");
    expect(mainSource).toContain("role clips active");
    expect(mainSource).toContain("activeRoleAnimationClipName");
    expect(mainSource).toContain("openClinXrActiveRoleAnimationClipName");
    expect(mainSource).toContain("gazeProbeAnimationClipNamesFromGltf");
    expect(mainSource).toContain("openclinxr_mpfb2_eye_look_probe");
    expect(mainSource).toContain("openClinXrActiveGazeProbeAnimationClipName");
    expect(mainSource).toContain("createDetailedEdRoomProps");
    expect(mainSource).toContain("runtimeRoomPropObjectPrefix");
    expect(mainSource).toContain("runtimeSceneObjectPrefix");
    expect(mainSource).toContain("encounterRuntimeAssetBundle.scenarioId");
    expect(mainSource).toContain("sceneOnlyEssentialRoomPropIds");
    expect(mainSource).toContain("shouldRenderRoomPropInVisualReview");
    expect(mainSource).toContain("encounterRuntimeAssetBundle.sceneManifest.roomProps");
    expect(mainSource).toContain("type EncounterRuntimeRoomProp");
    expect(mainSource).toContain("runtime_scene_manifest_prop");
    expect(mainSource).toContain("openClinXrRuntimeSceneManifestAffordanceCueIds");
    expect(mainSource).toContain("__openClinXrRuntimeSceneManifestEvidence");
    expect(mainSource).toContain("buildRuntimeSceneManifestEvidence");
    expect(mainSource).toContain("__openClinXrDynamicSceneObjectNamingEvidence");
    expect(mainSource).toContain("recordDynamicSceneObjectNamingEvidence(scene)");
    expect(mainSource).toContain("stableIwsdkLegacyObjectNameCount");
    expect(mainSource).toContain("hardcodedEdPrefixLeakCount");
    expect(mainSource).toContain("sampleScenarioPrefixedObjectNames");
    expect(mainSource).toContain("caseDefinedHumanoidRuntimeHandoff");
    expect(mainSource).toContain("caseDefinedHumanoidRuntimeHandoffRequiredSignalIds");
    expect(mainSource).toContain("case_definition_humanoid_runtime_handoff_metadata_only");
    expect(mainSource).toContain("learner_runtime_asset_bundle_scene_manifest");
    expect(mainSource).toContain("floor_scuff_path_between_door_bed_monitor");
    expect(mainSource).toContain("monitor_escalation_status_badge");
    expect(mainSource).toContain("nurse_task_tray_workflow_cue");
    expect(mainSource).toContain("monitor_lead_cable_run");
    expect(mainSource).toContain("bed_wheel_lock_safety_cues");
    expect(mainSource).toContain("openClinXrAffordances");
    expect(mainSource).toContain("createAffordanceMarker");
    expect(mainSource).toContain("runtimeAssetAffordanceCueIds");
    expect(mainSource).toContain("affordanceCueIds");
    expect(mainSource).toContain("animationPlayback");
    expect(runtimeStateSource).toContain("gltf_gaze_probe_clip_playing");
    expect(mainSource).toContain("affordance cues");
    expect(mainSource).toContain("selectable_equipment_reference");
    expect(mainSource).toContain("room_boundary_reference");
    expect(mainSource).toContain("dialogue_target");
    expect(mainSource).toContain("triggerHumanoidDialogueForTrace");
    expect(mainSource).toContain("triggerHumanoidDialogue(actorTurn.actorId, text, localDialogueGazeTargetForTraceTag(tag))");
    expect(mainSource).toContain("triggerHumanoidDialogue(input.actorId, dialogueText");
    expect(mainSource).toContain("__openClinXrHumanoidSpeechEvidence ??=");
    expect(mainSource).not.toContain("window.__openClinXrHumanoidSpeechEvidence = buildHumanoidSpeechEvidence(null, null, null, [], [], null);");
    expect(mainSource).toContain("localDialogueActorIdForTraceTag");
    expect(mainSource).toContain("phonemeSequenceForDialogue");
    expect(mainSource).toContain("visemeForPhoneme");
    expect(mainSource).toContain("createHumanoidSpeechMouthCue");
    expect(mainSource).toContain("createHumanoidEyeGazeCue");
    expect(mainSource).toContain("createHumanoidEyeFocusCue");
    expect(mainSource).toContain("createRuntimeHumanoidDetailCues");
    expect(mainSource).toContain("createHumanoidInteractionCollisionCues");
    expect(mainSource).toContain("face_lip_eye_rig_contract_cue");
    expect(mainSource).toContain("ragdoll_collision_proxy_cue");
    expect(mainSource).toContain("physician_interaction_target_cue");
    expect(mainSource).toContain("interactionCollisionEvidence");
    expect(mainSource).toContain("runtime_proxy_cues_with_offline_rapier_gate");
    expect(mainSource).toContain("humanoid-collision-probe-active-viseme-2026-05-23.json");
    expect(mainSource).toContain("group.visible = false");
    expect(mainSource).toContain("openClinXrRagdollCollisionProxy");
    expect(mainSource).toContain("openClinXrPhysicianInteractionTarget");
    expect(mainSource).toContain("asset_surface_features_only_no_runtime_proxy_overlay");
    expect(mainSource).toContain("generated_humanoid_asset_surface_detail_preferred");
    expect(mainSource).toContain("Local real Anny source + Blender procedural candidate GLB carries");
    expect(mainSource).not.toContain("Anny-derived GLB now carries surface hair, clothing, eye, brow, and lip geometry");
    expect(mainSource).toContain("humanoid_camera_framing_decluttered_three_actor_environment_review");
    expect(mainSource).toContain("applyGeneratedHumanoidClinicalIdlePosture");
    expect(mainSource).toContain("relaxed_arms_scenario_conversation_pose");
    expect(mainSource).toContain("upper_armL");
    expect(mainSource).toContain("forearmR");
    expect(mainSource).toContain("bent_forearm_conversation_pose_cue");
    expect(mainSource).toContain("preserve_anny_authored_skin_face_clothing_contrast");
    expect(mainSource).toContain("actor_close_realism_review_face_torso_posture_capture");
    expect(mainSource).toContain("actor_close_realism_review_panels_scaled_away_from_face_torso");
    expect(mainSource).toContain("runtime_actor_source_variant_clothing_color_without_overlay_mask");
    expect(mainSource).toContain("runtime_actor_source_variant_hair_color_without_overlay_mask");
    expect(mainSource).toContain("__openClinXrDebugScene");
    expect(mainSource).toContain("orientHumanoidTowardGazeTarget");
    expect(mainSource).toContain("speaking_humanoid_turns_toward_gaze_target");
    expect(mainSource).toContain("localDialogueGazeTargetForTraceTag");
    expect(mainSource).toContain("__openClinXrHumanoidSpeechEvidence");
    expect(mainSource).toContain("#evidence-speech-affect");
    expect(mainSource).toContain("formatHumanoidSpeechAffectEvidence");
    expect(mainSource).toContain("emotion transition cue present");
    expect(mainSource).toContain("local_dialogue_phoneme_viseme_mapping");
    expect(mainSource).toContain("scenario_dialogue_viseme_gaze_runtime");
    expect(mainSource).toContain("openClinXrFaceRigRuntimeCue");
    expect(mainSource).toContain("openClinXrMorphTargetRuntimeCue");
    expect(mainSource).toContain("openclinxr_mouth_open");
    expect(mainSource).toContain("emotion_aligned_expression_transition_cue");
    expect(mainSource).toContain("activeEmotionState");
    expect(mainSource).toContain("affectTimeline");
    expect(mainSource).toContain("dialogue_eye_micro_saccade_blink_cue");
    expect(mainSource).toContain("generated_eyelid_blink_control_cue");
    expect(mainSource).toContain("openclinxr_left_upper_eyelid_blink_control");
    expect(mainSource).toContain("openclinxr_right_upper_eyelid_blink_control");
    expect(mainSource).toContain("blinkIntensity");
    expect(mainSource).toContain("microSaccadeYaw");
    expect(mainSource).toContain("activePhoneme");
    expect(mainSource).toContain("activeViseme");
    expect(mainSource).toContain("activeMouthOpenness");
    expect(mainSource).toContain("phoneme-mouth-cue");
    expect(mainSource).toContain("eye-gaze-cue");
    expect(mainSource).toContain("eye-focus-cue");
    expect(mainSource).toContain("dialogue_gaze_target_cue");
    expect(mainSource).toContain("dialogue_eye_focus_target_cue");
    expect(mainSource).toContain("generated_humanoid_hair_clothing_eye_detail_cue");
    expect(mainSource).toContain("gazeTargetKind");
    expect(mainSource).toContain("gazeTargetActorId");
    expect(mainSource).toContain("actorRuntimeRealismRequirement");
    expect(mainSource).toContain("activeActorRuntimeRealismRequirement");
    expect(mainSource).toContain("activeActorRealismLaunchBadge");
    expect(mainSource).toContain("buildRuntimeActorRealismLaunchBadge");
    expect(mainSource).toContain("caseDefinitionRuntimeSignals");
    expect(mainSource).toContain("actor realism requirement pending");
    expect(mainSource).toContain("actorRequirement.requiredCueIds.length");
    expect(mainSource).toContain("production_lip_sync");
    expect(mainSource).toContain("production_eye_tracking");
    expect(mainSource).toContain("urgent_escalation: runtimeFamilyActorId()");
    expect(mainSource).toContain("vitals_review: runtimeClinicalTeamActorId()");
    expect(mainSource).toContain("history_opqrst: runtimePatientActorId()");
    expect(runtimeStateSource).toContain('generatedEcgCart: "openclinxr.ed-chest-pain.ecg-cart-12-lead.generated-glb"');
    expect(runtimeStateSource).toContain('generatedIvPoleWithPump: "openclinxr.ed-chest-pain.iv-pole-with-pump.generated-glb"');
    expect(runtimeStateSource).toContain('generatedEnvironmentShell: "openclinxr.ed-chest-pain.environment-shell.generated-glb"');
    expect(runtimeStateSource).toContain('patientRobertHayesGeneratedHumanoid: "openclinxr.ed-chest-pain.patient-robert-hayes.generated-humanoid-glb"');
    expect(runtimeStateSource).toContain('nurseMariaAlvarezGeneratedHumanoid: "openclinxr.ed-chest-pain.nurse-maria-alvarez.generated-humanoid-glb"');
    expect(runtimeStateSource).toContain('spouseAnnaHayesGeneratedHumanoid: "openclinxr.ed-chest-pain.spouse-anna-hayes.generated-humanoid-glb"');
    expect(mainSource).not.toContain("localGeneratedHumanoidAssetPath");
    expect(mainSource).not.toContain("localGeneratedEcgCartAssetPath");
    expect(mainSource).not.toContain("localGeneratedIvPoleAssetPath");
    expect(mainSource).not.toContain("localGeneratedEnvironmentShellAssetPath");
    expect(runtimeStateSource).toContain('ecgCart: "openclinxr.ed-chest-pain.ecg-cart-12-lead"');
    expect(runtimeStateSource).toContain('ivPoleWithPump: "openclinxr.ed-chest-pain.iv-pole-with-pump"');
    expect(mainSource).toContain("nurse.name = iwsdkStationSceneObjects.nurseMariaAlvarez");
    expect(mainSource).toContain("spouse.name = iwsdkStationSceneObjects.spouseAnnaHayes");
    expect(mainSource).toContain("monitor.name = iwsdkStationSceneObjects.monitor");
    expect(existsSync(new URL("../public/xr-assets/humanoids/neutral-generated-human.glb", import.meta.url))).toBe(true);
    expect(existsSync(new URL("../public/xr-assets/environment/ed-exam-bay-shell.glb", import.meta.url))).toBe(true);
    expect(existsSync(new URL("../public/xr-assets/environment/PROVENANCE.md", import.meta.url))).toBe(true);
    expect(existsSync(new URL("../public/xr-assets/humanoids/PROVENANCE.md", import.meta.url))).toBe(true);
    expect(existsSync(new URL("../public/xr-assets/medical-equipment/ecg-cart-12-lead.glb", import.meta.url))).toBe(true);
    expect(existsSync(new URL("../public/xr-assets/medical-equipment/iv-pole-with-pump.glb", import.meta.url))).toBe(true);
    expect(existsSync(new URL("../public/xr-assets/medical-equipment/PROVENANCE.md", import.meta.url))).toBe(true);
    expect(readFileSync(new URL("../public/xr-assets/medical-equipment/PROVENANCE.md", import.meta.url), "utf8")).toContain("inhaler_spacer_equipment.glb");
    expect(readFileSync(new URL("../public/xr-assets/medical-equipment/PROVENANCE.md", import.meta.url), "utf8")).toContain("pediatric_stretcher_equipment.glb");
  });

  it("keeps generated peds humanoid provenance truthful after local real Anny source generation", () => {
    const mainSource = readFileSync(new URL("./main.ts", import.meta.url), "utf8");
    const parentProvenance = JSON.parse(
      readFileSync(new URL("../public/generated-humanoids/peds_anxious_parent.provenance.json", import.meta.url), "utf8"),
    );
    const childProvenance = JSON.parse(
      readFileSync(new URL("../public/generated-humanoids/peds_patient_child.provenance.json", import.meta.url), "utf8"),
    );
    const nurseProvenance = JSON.parse(
      readFileSync(new URL("../public/generated-humanoids/peds_nurse_kevin.provenance.json", import.meta.url), "utf8"),
    );

    for (const provenance of [parentProvenance, childProvenance, nurseProvenance]) {
      expect(provenance.schemaVersion).toBe("openclinxr.generated-humanoid-provenance.v1");
      expect(provenance.generatorMode).toBe("real_anny_local_forward_pass_plus_blender_procedural");
      expect(provenance.usesRealAnnyForwardPass).toBe(true);
      expect(provenance.realAnnyWeightsUsed).toBe(false);
      expect(provenance.textureMode).toBe("procedural_fallback");
      expect(provenance.realismGrade).toBe("B");
      expect(provenance.sourceOriginChain.sourceTopologyMode).toBe("real_anny_mpfb2_forward_pass_v1");
      expect(provenance.notEvidenceFor).not.toContain("real_anny_model_output");
      expect(provenance.notEvidenceFor).toContain("b_plus_visual_realism_gate");
      expect(provenance.notEvidenceFor).toContain("production_asset_readiness");
      expect(provenance.notEvidenceFor).toContain("quest_readiness");
    }

    expect(mainSource).toContain("real_anny_local_forward_pass_plus_blender_procedural");
    expect(mainSource).toContain("usesRealAnnyForwardPass: true");
    expect(mainSource).toContain("realAnnyWeightsUsed: false");
    expect(mainSource).toContain("procedural_clinical_idle_conversation_posture_fallback");
  });

  it("loads only the active scenario fixture subpath in the headset app", () => {
    const mainSource = readFileSync(new URL("./main.ts", import.meta.url), "utf8");
    const runtimeStateSource = readFileSync(new URL("./runtime-state.ts", import.meta.url), "utf8");
    const headsetSources = `${mainSource}\n${runtimeStateSource}`;

    expect(headsetSources).not.toContain('from "@openclinxr/scenario-fixtures"');
    expect(headsetSources).toContain('from "@openclinxr/scenario-fixtures/ed-chest-pain"');
  });

  it("neutralizes imported humanoid morph weights on load before comparator and runtime controls", () => {
    const mainSource = readFileSync(new URL("./main.ts", import.meta.url), "utf8");

    expect(mainSource).toContain("zero_imported_default_morph_weights_on_load");
    expect(mainSource).toContain("Array.from({ length: morphTargetCount }, () => 0)");
    expect(mainSource).toContain("morphTargetInfluences = Array.from");
    expect(mainSource).toContain("all_imported_morph_targets_zeroed_until_runtime_speech_expression_sets_controlled_weights");
    expect(mainSource).toContain("neutralizeGeneratedHumanoidMorphTargets(humanoid)");
  });

  it("keeps the Portless dev script aligned to the injected app port", () => {
    const packageJson = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as {
      scripts?: Record<string, string>;
    };

    expect(packageJson.scripts?.["dev:portless"]).toBe(`vite --host 127.0.0.1 --port \${PORT:-5173} --strictPort`);
  });

  it("bounds the desktop XR stage to the viewport while letting the runtime panel scroll", () => {
    const styles = readFileSync(new URL("./styles.css", import.meta.url), "utf8");

    expect(styles).toMatch(/\.station-shell\s*{[^}]*height:\s*100vh;[^}]*overflow:\s*hidden;/s);
    expect(styles).toMatch(/\.stage\s*{[^}]*height:\s*100vh;[^}]*min-height:\s*0;/s);
    expect(styles).toMatch(/#station-canvas\s*{[^}]*height:\s*100vh;[^}]*min-height:\s*0;/s);
    expect(styles).toMatch(/\.runtime-panel\s*{[^}]*height:\s*100vh;[^}]*min-height:\s*0;[^}]*overflow-y:\s*auto;/s);
    expect(styles).toMatch(/@media\s*\(max-width:\s*820px\)\s*{[\s\S]*\.station-shell\s*{[^}]*height:\s*auto;[^}]*overflow:\s*visible;/s);
    expect(styles).toMatch(/@media\s*\(max-width:\s*820px\)\s*{[\s\S]*\.stage\s*{[^}]*height:\s*56vh;[^}]*min-height:\s*56vh;/s);
    expect(styles).toMatch(/@media\s*\(max-width:\s*820px\)\s*{[\s\S]*\.runtime-panel\s*{[^}]*height:\s*auto;[^}]*overflow-y:\s*visible;/s);
  });

  it("hides mismatched fallback runtime bundles instead of rendering false encounter realism evidence", () => {
    const mainSource = readFileSync(new URL("./main.ts", import.meta.url), "utf8");

    expect(mainSource).toContain("isSelectedScenarioRuntimeBundleMismatch");
    expect(mainSource).toContain("selectedScenarioId() !== encounterRuntimeAssetBundle.scenarioId");
    expect(mainSource).toContain("selected_scenario_specific_3d_pending_ed_fallback_hidden_to_prevent_false_realism_evidence");
    expect(mainSource).toContain("runtimeBundleMatchesSelectedScenario");
    expect(mainSource).toContain("mismatchedRuntimeBundleFallbackReason");
    expect(mainSource).toContain("learner_runtime_asset_bundle_static_generated_scenario_mismatch_suppressed");
    expect(mainSource).toContain("api learner runtime asset bundle scenario mismatch");
    expect(mainSource).toContain("Scenario-specific 3D bundle is not loaded yet.");
    expect(mainSource).toContain("Fallback bundle hidden");
    expect(mainSource).toContain("Use factory materialization before realism review.");
    expect(mainSource).toContain("hidden_because_selected_scenario_specific_3d_bundle_missing");
    expect(mainSource).toContain("if (!selectedScenarioRuntimeMismatch && !cleanHumanoidSourceComparatorCapture) {\n      scene.add(createVirtualDeviceActorAffordance");
  });

  it("normalizes generated runtime placements before applying them to Three.js transforms", () => {
    const mainSource = readFileSync(new URL("./main.ts", import.meta.url), "utf8");

    expect(mainSource).toContain("function hasVector3");
    expect(mainSource).toContain("typeof vector.x === \"number\"");
    expect(mainSource).toContain("position: hasVector3(placement?.position) ? placement.position : fallback.position");
    expect(mainSource).toContain("scale: hasVector3(placement?.scale) ? placement.scale : fallback.scale");
    expect(mainSource).toContain("interactionCueIds: Array.isArray(placement?.interactionCueIds) ? placement.interactionCueIds : fallback.interactionCueIds");
    expect(mainSource).toContain("fallbackPositions[propIndex % fallbackPositions.length]");
    expect(mainSource).toContain("hasVector3(prop.scale) ? prop.scale : { x: 0.42, y: 0.42, z: 0.42 }");
    expect(mainSource).toContain("prop.label ?? prop.propId.replaceAll");
    expect(mainSource).toContain("Array.isArray(prop.affordanceCueIds) ? prop.affordanceCueIds");
    expect(mainSource).toContain("&& \"scale\" in existing");
  });

  it("renders multimodal scenario expectation cues inside the 3D scene for visual review", () => {
    const mainSource = readFileSync(new URL("./main.ts", import.meta.url), "utf8");

    expect(mainSource).toContain("addScenarioExpectationPanel");
    expect(mainSource).toContain("scenario_expectations_visible_inside_3d_scene_for_adversarial_visual_comparison");
    expect(mainSource).toContain("ob-pregnancy-abdomen-silhouette-cue");
    expect(mainSource).toContain("clinic-rlq-abdominal-pain-cue");
    expect(mainSource).toContain("oncology-family-tissue-emotion-cue");
    expect(mainSource).toContain("postop-abdominal-dressing-cue");
    expect(mainSource).toContain("addActorSpecificIdentityVariantCue");
    expect(mainSource).toContain("actor-specific-hair-cap-variant-cue");
    expect(mainSource).toContain("actor_specific_clothing_accent_variant_cue");
    expect(mainSource).toContain("actor-specific-face-tone-and-cheek-volume-cue");
    expect(mainSource).toContain("left-eye-gaze-anchor-cue");
    expect(mainSource).toContain("right-eye-gaze-anchor-cue");
    expect(mainSource).toContain("emotion-mouth-line-viseme-anchor-cue");
    expect(mainSource).toContain("emotion-brow-tension-cue");
    expect(mainSource).toContain("actor-specific-clothing-layer-silhouette-cue");
  });

  it("surfaces selected runtime bundle manifest evidence in the headset clinical panel", () => {
    const mainSource = readFileSync(new URL("./main.ts", import.meta.url), "utf8");
    const runtimeStateSource = readFileSync(new URL("./runtime-state.ts", import.meta.url), "utf8");

    expect(mainSource).toContain("Bundle scenario:");
    expect(mainSource).toContain("Station context:");
    expect(mainSource).toContain("Actor roster:");
    expect(mainSource).toContain("Equipment IDs:");
    expect(mainSource).toContain("Dialogue turns:");
    expect(mainSource).toContain("Room props:");
    expect(mainSource).toContain("selectedScenarioMatchesBundle");
    expect(runtimeStateSource).toContain("actorRoster");
    expect(runtimeStateSource).toContain("equipmentIds");
    expect(runtimeStateSource).toContain("dialogueTraceTags");
    expect(runtimeStateSource).toContain("stationContextChiefConcern");
  });

  it("derives doorway visual theme from the selected encounter bundle instead of hardcoding one shared room identity", () => {
    const mainSource = readFileSync(new URL("./main.ts", import.meta.url), "utf8");

    expect(mainSource).toContain("scenarioDoorwayVisualTheme");
    expect(mainSource).toContain("addReusableExteriorPreEncounterRoom");
    expect(mainSource).toContain("reused_between_encounters_for_doorway_orientation_and_patient_note_capture_only");
    expect(mainSource).toContain("clinical_world_beyond_doorway_is_generated_from_active_encounter_runtime_bundle");
    expect(mainSource).toContain("encounter-portal-dynamic-opening");
    expect(mainSource).toContain("static_reusable_wall_segment_leaving_dynamic_encounter_window_open");
    expect(mainSource).toContain("depthWrite: false");
    expect(mainSource).toContain("crossing_threshold_enters_dynamic_encounter_world");
    expect(mainSource).toContain("note_capture_affordance_reused_outside_dynamic_clinical_world");
    expect(mainSource).toContain("dynamic_encounter_world_floor_anchor_beyond_reusable_portal_threshold");
    expect(mainSource).toContain("belongs_to_dynamic_world_on_encounter_side_of_doorway");
    expect(mainSource).toContain("__openClinXrPortalTransitionEvidence");
    expect(mainSource).toContain("formatPortalTransitionEvidence");
    expect(mainSource).toContain("entered dynamic encounter");
    expect(mainSource).toContain("portal started encounter");
    expect(mainSource).toContain("selectedPortalPreviewStart");
    expect(mainSource).toContain("applyDeterministicPortalPreviewStart");
    expect(mainSource).toContain("openclinxrPortalStart");
    expect(mainSource).toContain("transitionProbeZ");
    expect(mainSource).toContain("hidden_after_portal_entry_so_reusable_note_shell_and_frame_do_not_occlude_dynamic_encounter_world");
    expect(mainSource).toContain("reusableExteriorHiddenForEncounterView");
    expect(mainSource).toContain("portalInteriorHiddenObjectNames");
    expect(mainSource).toContain("portalTransitionEvidence: window.__openClinXrPortalTransitionEvidence ?? null");
    expect(mainSource).toContain("exterior shell hidden");
    expect(mainSource).toContain("portal_crossed_into_dynamic_encounter_world");
    expect(mainSource).toContain("portal_crossing_started_or_resumed_encounter");
    expect(mainSource).toContain('noteCaptureLocation: "reusable_exterior_anteroom"');
    expect(mainSource).toContain("encounter_specific_theme_applied_to_reused_runtime_assets_no_hardcoded_scene_identity");
    expect(mainSource).toContain("floor_color_derived_from_selected_encounter_runtime_bundle");
    expect(mainSource).toContain("actor_identity_cues_derive_from_encounter_runtime_theme_when_assets_are_reused");
    expect(mainSource).toContain("room_prop_rendered_from_active_encounter_scene_manifest_not_hardcoded_shared_world");
    expect(mainSource).toContain("case_definition_driven_patient_pose_not_chest_pain_default");
    expect(mainSource).toContain("openClinXrScenarioDerivedPosture");
    expect(mainSource).toContain("shouldRenderRoomPropInVisualReview(prop)");
    expect(mainSource).toContain('prop.semanticRole !== "environmental_detail"');
    expect(mainSource).toContain("primitive_actor_restored_when_generated_humanoid_asset_unavailable_to_avoid_empty_encounter_scene");
    expect(mainSource).toContain("case_definition_driven_role_pose_applied_to_fallback_actor");
    expect(mainSource).toContain("ed_chest_pain_priority_v1");
    expect(mainSource).toContain("postop_fever_consult_pressure_v1");
    expect(mainSource).toContain("oncology_bad_news_family_v1");
  });
});
