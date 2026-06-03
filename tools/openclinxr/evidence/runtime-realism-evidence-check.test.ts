import { describe, expect, it } from "vitest";
import {
  buildRuntimeRealismEvidenceCheckReport,
  validateRuntimeRealismEvidenceCheckReport,
} from "./runtime-realism-evidence-check.js";

describe("runtime realism evidence check", () => {
  it("passes when runtime evidence includes animation, expression, context, dialogue, and locomotion signals", () => {
    const report = buildRuntimeRealismEvidenceCheckReport({
      inputFile: "sample.json",
      generatedAt: "2026-05-23T00:00:00.000Z",
      evidence: {
        sceneAssets: {
          visualFidelityCueIds: ["visible_runtime_mouth_eye_expression_cues"],
          assets: [
            {
              assetId: "openclinxr.patient.generated-humanoid-glb",
              animationPlayback: "gltf_animation_clips_playing",
              affordanceCueIds: ["authored_clinical_idle_pose_clip_cue"],
            },
          ],
        },
        textPanelEvidence: {
          panels: [
            { name: "openclinxr.in-vr-clinical-panel", previewLines: ["Scenario: Oncology Bad News Family"] },
            { name: "openclinxr.in-vr-input-panel", previewLines: ["Movement: last keyboard 580ms ago; d 0.047m"] },
          ],
        },
        humanoidSpeech: {
          visemeSequence: ["wide"],
          gazeTargetKind: "actor",
          activePhoneme: "a",
          activeViseme: "wide",
          activeMouthOpenness: 0.42,
          activeEyeBlinkIntensity: 0.12,
          activeEyeMicroSaccadeYaw: 0.018,
          activeEyeMicroSaccadePitch: -0.006,
          activeExpressionCueIds: ["visible_runtime_mouth_shape_cue", "dialogue_eye_micro_saccade_blink_cue", "generated_eyelid_blink_control_cue", "emotion_aligned_expression_transition_cue"],
          activeEmotionState: "concerned",
          activeExpressionTransitionMs: 450,
          activeExpressionWeights: { mouthOpen: 0.42, browConcern: 0.35, cheekTension: 0.2 },
        },
        examineeLocomotion: {
          source: "keyboard",
          distanceMeters: 0.047,
          turnRadians: 0,
          sampleCount: 3,
          pathCueIds: ["structured_examinee_locomotion_path_evidence"],
        },
      },
    });

    expect(report.result).toEqual({
      status: "realism_evidence_present",
      blockers: [],
      passedSignals: [
        "animated_humanoid_runtime_playback",
        "authored_clinical_idle_pose_runtime_cue",
        "visible_mouth_eye_expression_cues",
        "scenario_specific_vr_clinical_panel",
        "dialogue_viseme_and_gaze_mapping",
        "dialogue_eye_micro_saccade_blink_cue",
        "generated_eyelid_blink_control_cue",
        "emotion_aligned_expression_transition_cue",
        "deterministic_expression_transition_signal",
        "examinee_locomotion_observed",
      ],
    });
    expect(validateRuntimeRealismEvidenceCheckReport(report)).toEqual({ ok: true });
  });

  it("adds deterministic realism metadata signals for eyes, lipsync, expression timing, path, equipment, and clutter", () => {
    const report = buildRuntimeRealismEvidenceCheckReport({
      inputFile: "sample.json",
      generatedAt: "2026-05-25T00:00:00.000Z",
      evidence: {
        sceneAssets: {
          cameraFramingCue: "humanoid_camera_framing_decluttered_three_actor_environment_review",
          visualFidelityCueIds: [
            "visible_runtime_mouth_eye_expression_cues",
            "humanoid_interaction_target_decluttered",
            "room_prop_label_occlusion_reduced",
          ],
          expectedAssetCount: 2,
          loadedCount: 2,
          pendingCount: 0,
          failedCount: 0,
          fallbackActiveCount: 0,
          assets: [
            {
              assetId: "openclinxr.patient.generated-humanoid-glb",
              animationPlayback: "gltf_animation_clips_playing",
              assetPath: "/xr-assets/humanoids/neutral-generated-human.glb",
              affordanceCueIds: ["openclinxr.patient.generated-humanoid-glb:authored_clinical_idle_pose_clip_cue"],
            },
            {
              assetId: "openclinxr.scene.ecg_cart_equipment.generated-glb",
              animationPlayback: "not_applicable",
              assetPath: "/xr-assets/medical-equipment/ecg-cart-12-lead.glb",
              affordanceCueIds: ["openclinxr.scene.ecg_cart_equipment.generated-glb:selectable_equipment_reference"],
            },
          ],
        },
        textPanelEvidence: {
          panels: [{ name: "openclinxr.in-vr-clinical-panel", previewLines: ["Scenario: Oncology Bad News Family"] }],
        },
        captureSummary: {
          locomotionPathQuality: {
            claimScope: "path_shape_probe_only",
            sampleCount: 4,
            distanceMeters: 0.31,
            turnRadians: 0.22,
            straightLineOnly: false,
            pathCueIds: ["runtime_locomotion_delta"],
            blockers: [],
          },
        },
        humanoidSpeech: {
          visemeSequence: ["open", "wide", "mid", "close"],
          gazeTargetKind: "learner_camera",
          activePhoneme: "a",
          activeViseme: "wide",
          activeMouthOpenness: 0.42,
          activeEyeBlinkIntensity: 0.12,
          activeEyeMicroSaccadeYaw: 0.018,
          activeEyeMicroSaccadePitch: -0.006,
          activeExpressionCueIds: [
            "visible_runtime_mouth_shape_cue",
            "visible_runtime_eye_focus_cue",
            "dialogue_eye_micro_saccade_blink_cue",
            "generated_eyelid_blink_control_cue",
            "emotion_aligned_expression_transition_cue",
          ],
          activeEmotionState: "concerned",
          activeExpressionTransitionMs: 420,
          activeExpressionWeights: { mouthOpen: 0.42, browConcern: 0.35, cheekTension: 0.2 },
        },
        runtimeSceneManifestEvidence: {
          equipmentPlacementCount: 2,
        },
        examineeLocomotion: {
          source: "keyboard",
          distanceMeters: 0.31,
          turnRadians: 0.22,
          sampleCount: 4,
          pathCueIds: ["structured_examinee_locomotion_path_evidence"],
        },
      },
    });

    expect(report.result.status).toBe("realism_evidence_present");
    expect(report.result.passedSignals).toEqual(expect.arrayContaining([
      "deterministic_lipsync_and_opening_signal",
      "deterministic_eye_gaze_readability_signal",
      "deterministic_expression_transition_signal",
      "deterministic_locomotion_path_realism_signal",
      "deterministic_equipment_necessity_signal",
      "deterministic_scene_clutter_removal_signal",
    ]));
  });

  it("blocks generated-scene runtime evidence when deterministic equipment and clutter signals are absent", () => {
    const report = buildRuntimeRealismEvidenceCheckReport({
      inputFile: "sample.json",
      generatedAt: "2026-05-26T00:00:00.000Z",
      evidence: {
        sceneAssets: {
          cameraFramingCue: "case_defined_generated_scene_overview",
          visualFidelityCueIds: [
            "visible_runtime_mouth_eye_expression_cues",
            "dynamic_encounter_factory_scene_bundle_loaded",
            "generated_humanoid_role_slots_visible",
          ],
          expectedAssetCount: 1,
          loadedCount: 1,
          pendingCount: 0,
          failedCount: 0,
          fallbackActiveCount: 0,
          assets: [
            {
              assetId: "openclinxr.patient.generated-humanoid-glb",
              animationPlayback: "gltf_animation_clips_playing",
              assetPath: "/xr-assets/humanoids/neutral-generated-human.glb",
              affordanceCueIds: ["openclinxr.patient.generated-humanoid-glb:authored_clinical_idle_pose_clip_cue"],
            },
          ],
        },
        textPanelEvidence: {
          panels: [
            { name: "openclinxr.in-vr-clinical-panel", previewLines: ["Scenario: Oncology Bad News Family"] },
            { name: "openclinxr.in-vr-input-panel", previewLines: ["Movement: path keyboard d 0.31m"] },
          ],
        },
        captureSummary: {
          locomotionPathQuality: {
            claimScope: "path_shape_probe_only",
            sampleCount: 4,
            distanceMeters: 0.31,
            turnRadians: 0.22,
            pathCueIds: ["runtime_locomotion_delta"],
            blockers: [],
          },
        },
        humanoidSpeech: {
          visemeSequence: ["open", "wide", "mid", "close"],
          gazeTargetKind: "learner_camera",
          activePhoneme: "a",
          activeViseme: "wide",
          activeMouthOpenness: 0.42,
          activeEyeBlinkIntensity: 0.12,
          activeEyeMicroSaccadeYaw: 0.018,
          activeEyeMicroSaccadePitch: -0.006,
          activeExpressionCueIds: [
            "visible_runtime_mouth_shape_cue",
            "visible_runtime_eye_focus_cue",
            "dialogue_eye_micro_saccade_blink_cue",
            "generated_eyelid_blink_control_cue",
            "emotion_aligned_expression_transition_cue",
          ],
          activeEmotionState: "concerned",
          activeExpressionTransitionMs: 420,
          activeExpressionWeights: { mouthOpen: 0.42, browConcern: 0.35, cheekTension: 0.2 },
        },
        examineeLocomotion: {
          source: "keyboard",
          distanceMeters: 0.31,
          turnRadians: 0.22,
          sampleCount: 4,
          pathCueIds: ["structured_examinee_locomotion_path_evidence"],
        },
      },
    });

    expect(report.result.status).toBe("realism_evidence_present");
    expect(report.result.passedSignals).not.toEqual(expect.arrayContaining([
      "deterministic_equipment_necessity_signal",
      "deterministic_scene_clutter_removal_signal",
    ]));
  });

  it("accepts current browser capture shape with humanoidSpeechEvidence", () => {
    const report = buildRuntimeRealismEvidenceCheckReport({
      inputFile: "sample.json",
      generatedAt: "2026-05-23T00:00:00.000Z",
      evidence: {
        sceneAssetEvidence: {
          visualFidelityCueIds: ["visible_runtime_mouth_eye_expression_cues"],
          assets: [
            {
              assetId: "openclinxr.patient.generated-humanoid-glb",
              animationPlayback: "gltf_animation_clips_playing",
              affordanceCueIds: ["openclinxr.patient.generated-humanoid-glb:authored_clinical_idle_pose_clip_cue"],
            },
          ],
        },
        textPanelEvidence: {
          panels: [
            { name: "openclinxr.in-vr-clinical-panel", previewLines: ["Scenario: Oncology Bad News Family"] },
            { name: "openclinxr.in-vr-input-panel", previewLines: ["Movement: last keyboard 580ms ago; d 0.047m"] },
          ],
        },
        humanoidSpeechEvidence: {
          visemeSequence: ["wide"],
          gazeTargetKind: "actor",
          activePhoneme: "a",
          activeViseme: "wide",
          activeMouthOpenness: 0.42,
          activeEyeBlinkIntensity: 0.12,
          activeEyeMicroSaccadeYaw: 0.018,
          activeEyeMicroSaccadePitch: -0.006,
          activeExpressionCueIds: ["visible_runtime_mouth_shape_cue", "dialogue_eye_micro_saccade_blink_cue", "generated_eyelid_blink_control_cue", "emotion_aligned_expression_transition_cue"],
          activeEmotionState: "concerned",
          activeExpressionTransitionMs: 450,
          activeExpressionWeights: { mouthOpen: 0.42, browConcern: 0.35, cheekTension: 0.2 },
        },
        examineeLocomotionEvidence: {
          source: "keyboard",
          distanceMeters: 0.047,
          turnRadians: 0,
          sampleCount: 3,
          pathCueIds: ["structured_examinee_locomotion_path_evidence"],
        },
      },
    });

    expect(report.result.status).toBe("realism_evidence_present");
    expect(report.result.passedSignals).toContain("examinee_locomotion_observed");
    expect(report.result.blockers).toEqual([]);
    expect(report.notEvidenceFor).toContain("quest_readiness");
  });

  it("records authored clinical idle pose as a positive runtime signal when humanoid evidence exposes the cue", () => {
    const report = buildRuntimeRealismEvidenceCheckReport({
      inputFile: "sample.json",
      generatedAt: "2026-05-23T00:00:00.000Z",
      evidence: {
        sceneAssets: {
          visualFidelityCueIds: ["visible_runtime_mouth_eye_expression_cues"],
          assets: [
            {
              assetId: "openclinxr.patient.generated-humanoid-glb",
              animationPlayback: "gltf_animation_clips_playing",
              affordanceCueIds: ["authored_clinical_idle_pose_clip_cue"],
            },
          ],
        },
        textPanelEvidence: {
          panels: [
            { name: "openclinxr.in-vr-clinical-panel", previewLines: ["Scenario: Oncology Bad News Family"] },
          ],
        },
        speech: {
          visemeSequence: ["wide"],
          gazeTargetKind: "actor",
          activePhoneme: "a",
          activeViseme: "wide",
          activeMouthOpenness: 0.42,
          activeEyeBlinkIntensity: 0.12,
          activeEyeMicroSaccadeYaw: 0.018,
          activeEyeMicroSaccadePitch: -0.006,
          activeExpressionCueIds: ["visible_runtime_mouth_shape_cue", "dialogue_eye_micro_saccade_blink_cue", "generated_eyelid_blink_control_cue", "emotion_aligned_expression_transition_cue"],
          activeEmotionState: "concerned",
          activeExpressionTransitionMs: 450,
          activeExpressionWeights: { mouthOpen: 0.42, browConcern: 0.35, cheekTension: 0.2 },
        },
        locomotion: {
          source: "keyboard",
          distanceMeters: 0.047,
          turnRadians: 0,
          sampleCount: 3,
          pathCueIds: ["structured_examinee_locomotion_path_evidence"],
        },
      },
    });

    expect(report.result.status).toBe("realism_evidence_present");
    expect(report.result.passedSignals).toContain("authored_clinical_idle_pose_runtime_cue");
  });

  it("accepts direct browser extraction shape with speech alias", () => {
    const report = buildRuntimeRealismEvidenceCheckReport({
      inputFile: "sample.json",
      generatedAt: "2026-05-23T00:00:00.000Z",
      evidence: {
        sceneAssets: {
          visualFidelityCueIds: ["visible_runtime_mouth_eye_expression_cues"],
          assets: [
            {
              assetId: "openclinxr.patient.generated-humanoid-glb",
              animationPlayback: "gltf_animation_clips_playing",
              affordanceCueIds: ["openclinxr.patient.generated-humanoid-glb:authored_clinical_idle_pose_clip_cue"],
            },
          ],
        },
        textPanelEvidence: {
          panels: [
            { name: "openclinxr.in-vr-clinical-panel", previewLines: ["Scenario: Oncology Bad News Family"] },
          ],
        },
        speech: {
          visemeSequence: ["wide"],
          gazeTargetKind: "actor",
          activePhoneme: "a",
          activeViseme: "wide",
          activeMouthOpenness: 0.42,
          activeEyeBlinkIntensity: 0.12,
          activeEyeMicroSaccadeYaw: 0.018,
          activeEyeMicroSaccadePitch: -0.006,
          activeExpressionCueIds: ["visible_runtime_mouth_shape_cue", "dialogue_eye_micro_saccade_blink_cue", "generated_eyelid_blink_control_cue", "emotion_aligned_expression_transition_cue"],
          activeEmotionState: "concerned",
          activeExpressionTransitionMs: 450,
          activeExpressionWeights: { mouthOpen: 0.42, browConcern: 0.35, cheekTension: 0.2 },
        },
        locomotion: {
          source: "keyboard",
          distanceMeters: 0.047,
          turnRadians: 0,
          sampleCount: 3,
          pathCueIds: ["structured_examinee_locomotion_path_evidence"],
        },
      },
    });

    expect(report.result.status).toBe("realism_evidence_present");
  });

  it("blocks evidence that lacks required realism signals", () => {
    const report = buildRuntimeRealismEvidenceCheckReport({
      inputFile: "sample.json",
      generatedAt: "2026-05-23T00:00:00.000Z",
      evidence: {},
    });

    expect(report.result.status).toBe("realism_evidence_blocked");
    expect(report.result.blockers).toContain("animated_humanoid_runtime_playback_missing");
    expect(report.result.blockers).toContain("examinee_locomotion_observed_missing");
  });

  it("blocks profile metadata that omits required runtime realism evidence IDs", () => {
    const report = buildRuntimeRealismEvidenceCheckReport({
      inputFile: "sample.json",
      generatedAt: "2026-05-24T00:00:00.000Z",
      evidence: {
        humanoidRealismProfiles: [
          {
            actorRole: "patient",
            claimScope: "metadata_only_not_visual_quality_evidence",
            requiredRealismEvidenceIds: ["animated_humanoid_runtime_playback"],
          },
        ],
      },
    });

    expect(report.result.blockers).toEqual(expect.arrayContaining([
      "humanoid_realism_profile_evidence_ids_missing",
    ]));
  });

  it("blocks blink and micro-saccade evidence when numeric eye-motion metrics are missing", () => {
    const report = buildRuntimeRealismEvidenceCheckReport({
      inputFile: "sample.json",
      generatedAt: "2026-05-24T00:00:00.000Z",
      evidence: {
        sceneAssets: {
          visualFidelityCueIds: ["visible_runtime_mouth_eye_expression_cues"],
          assets: [
            {
              assetId: "openclinxr.patient.generated-humanoid-glb",
              animationPlayback: "gltf_animation_clips_playing",
              affordanceCueIds: ["authored_clinical_idle_pose_clip_cue"],
            },
          ],
        },
        textPanelEvidence: {
          panels: [
            { name: "openclinxr.in-vr-clinical-panel", previewLines: ["Scenario: Oncology Bad News Family"] },
            { name: "openclinxr.in-vr-input-panel", previewLines: ["Movement: last keyboard 580ms ago; d 0.047m"] },
          ],
        },
        humanoidSpeech: {
          visemeSequence: ["wide"],
          gazeTargetKind: "actor",
          activePhoneme: "a",
          activeViseme: "wide",
          activeMouthOpenness: 0.42,
          activeExpressionCueIds: ["visible_runtime_mouth_shape_cue", "dialogue_eye_micro_saccade_blink_cue", "generated_eyelid_blink_control_cue", "emotion_aligned_expression_transition_cue"],
          activeEmotionState: "concerned",
          activeExpressionTransitionMs: 450,
          activeExpressionWeights: { mouthOpen: 0.42, browConcern: 0.35, cheekTension: 0.2 },
        },
        examineeLocomotion: {
          source: "keyboard",
          distanceMeters: 0.047,
          turnRadians: 0,
          sampleCount: 3,
          pathCueIds: ["structured_examinee_locomotion_path_evidence"],
        },
      },
    });

    expect(report.result.status).toBe("realism_evidence_blocked");
    expect(report.result.blockers).toContain("dialogue_eye_micro_saccade_blink_cue_missing");
  });

  it("blocks blink and micro-saccade evidence when numeric eye-motion metrics are implausible", () => {
    const report = buildRuntimeRealismEvidenceCheckReport({
      inputFile: "sample.json",
      generatedAt: "2026-05-24T00:00:00.000Z",
      evidence: {
        sceneAssets: {
          visualFidelityCueIds: ["visible_runtime_mouth_eye_expression_cues"],
          assets: [
            {
              assetId: "openclinxr.patient.generated-humanoid-glb",
              animationPlayback: "gltf_animation_clips_playing",
              affordanceCueIds: ["authored_clinical_idle_pose_clip_cue"],
            },
          ],
        },
        textPanelEvidence: {
          panels: [
            { name: "openclinxr.in-vr-clinical-panel", previewLines: ["Scenario: Oncology Bad News Family"] },
            { name: "openclinxr.in-vr-input-panel", previewLines: ["Movement: last keyboard 580ms ago; d 0.047m"] },
          ],
        },
        humanoidSpeech: {
          visemeSequence: ["wide"],
          gazeTargetKind: "actor",
          activePhoneme: "a",
          activeViseme: "wide",
          activeMouthOpenness: 0.42,
          activeEyeBlinkIntensity: 1.4,
          activeEyeMicroSaccadeYaw: 0.5,
          activeEyeMicroSaccadePitch: -0.5,
          activeExpressionCueIds: ["visible_runtime_mouth_shape_cue", "dialogue_eye_micro_saccade_blink_cue", "generated_eyelid_blink_control_cue", "emotion_aligned_expression_transition_cue"],
          activeEmotionState: "concerned",
          activeExpressionTransitionMs: 450,
          activeExpressionWeights: { mouthOpen: 0.42, browConcern: 0.35, cheekTension: 0.2 },
        },
        examineeLocomotion: {
          source: "keyboard",
          distanceMeters: 0.047,
          turnRadians: 0,
          sampleCount: 3,
          pathCueIds: ["structured_examinee_locomotion_path_evidence"],
        },
      },
    });

    expect(report.result.status).toBe("realism_evidence_blocked");
    expect(report.result.blockers).toContain("dialogue_eye_micro_saccade_blink_cue_missing");
  });

  it("blocks known rejected visual regression cue IDs even when core runtime signals are present", () => {
    const report = buildRuntimeRealismEvidenceCheckReport({
      inputFile: "sample.json",
      generatedAt: "2026-05-23T00:00:00.000Z",
      evidence: {
        sceneAssets: {
          visualFidelityCueIds: ["visible_runtime_mouth_eye_expression_cues", "persistent_gaze_readability_cue"],
          assets: [
            {
              assetId: "openclinxr.patient.generated-humanoid-glb",
              animationPlayback: "gltf_animation_clips_playing",
              affordanceCueIds: ["openclinxr.patient.generated-humanoid-glb:authored_clinical_idle_pose_clip_cue"],
            },
          ],
        },
        textPanelEvidence: {
          panels: [
            { name: "openclinxr.in-vr-clinical-panel", previewLines: ["Scenario: Oncology Bad News Family"] },
          ],
        },
        speech: {
          visemeSequence: ["wide"],
          gazeTargetKind: "actor",
          activePhoneme: "a",
          activeViseme: "wide",
          activeMouthOpenness: 0.42,
          activeExpressionCueIds: ["visible_runtime_mouth_shape_cue"],
        },
        locomotion: {
          source: "keyboard",
          distanceMeters: 0.047,
          turnRadians: 0,
          sampleCount: 3,
          pathCueIds: ["structured_examinee_locomotion_path_evidence"],
        },
      },
    });

    expect(report.result.status).toBe("realism_evidence_blocked");
    expect(report.result.blockers).toContain("rejected_visual_regression_cue_present:persistent_gaze_readability_cue");
  });

  it("rejects stale reports that do not account for every required runtime realism signal", () => {
    expect(validateRuntimeRealismEvidenceCheckReport({
      schemaVersion: "openclinxr.runtime-realism-evidence-check.v1",
      generatedAt: "2026-05-24T02:31:46.546Z",
      inputFile: "docs/openclinxr/evidence/stale.json",
      result: {
        status: "realism_evidence_blocked",
        blockers: ["examinee_locomotion_observed_missing"],
        passedSignals: [
          "animated_humanoid_runtime_playback",
          "authored_clinical_idle_pose_runtime_cue",
          "visible_mouth_eye_expression_cues",
          "scenario_specific_vr_clinical_panel",
          "dialogue_viseme_and_gaze_mapping",
        ],
      },
      productionReadinessClaimed: false,
      notEvidenceFor: ["production_asset_readiness", "quest_readiness", "clinical_validity", "scoring_validity"],
    })).toEqual({
      ok: false,
      errors: expect.arrayContaining([
        "/result must account for required signal emotion_aligned_expression_transition_cue",
      ]),
    });
  });

  it("rejects reports that omit evidence-boundary caveats", () => {
    const report = buildRuntimeRealismEvidenceCheckReport({
      inputFile: "sample.json",
      generatedAt: "2026-05-25T09:42:02.702Z",
      evidence: {
        sceneAssets: {
          visualFidelityCueIds: ["visible_runtime_mouth_eye_expression_cues"],
          assets: [{
            assetId: "openclinxr.patient.generated-humanoid-glb",
            animationPlayback: "gltf_animation_clips_playing",
            affordanceCueIds: ["authored_clinical_idle_pose_clip_cue"],
          }],
        },
        textPanelEvidence: {
          panels: [
            { name: "openclinxr.in-vr-clinical-panel", previewLines: ["Scenario: ED Chest Pain"] },
            { name: "openclinxr.in-vr-input-panel", previewLines: ["Movement: active keyboard; d 0.047m"] },
          ],
        },
        humanoidSpeechEvidence: {
          visemeSequence: ["open"],
          gazeTargetKind: "learner_camera",
          activePhoneme: "a",
          activeViseme: "open",
          activeMouthOpenness: 0.42,
          activeEyeBlinkIntensity: 0.12,
          activeEyeMicroSaccadeYaw: 0.018,
          activeEyeMicroSaccadePitch: -0.006,
          activeEmotionState: "concerned",
          activeExpressionTransitionMs: 450,
          activeExpressionWeights: { mouthOpen: 0.42, browConcern: 0.35, cheekTension: 0.2 },
          activeExpressionCueIds: [
            "dialogue_eye_micro_saccade_blink_cue",
            "generated_eyelid_blink_control_cue",
            "emotion_aligned_expression_transition_cue",
          ],
        },
        examineeLocomotionEvidence: {
          distanceMeters: 0.047,
          sampleCount: 3,
          pathCueIds: ["structured_examinee_locomotion_path_evidence"],
        },
      },
    });
    const invalid = { ...report, notEvidenceFor: ["production_asset_readiness"] };

    expect(validateRuntimeRealismEvidenceCheckReport(invalid)).toEqual({
      ok: false,
      errors: expect.arrayContaining([
        "/notEvidenceFor must include quest_readiness",
        "/notEvidenceFor must include clinical_validity",
        "/notEvidenceFor must include scoring_validity",
      ]),
    });
  });
});
