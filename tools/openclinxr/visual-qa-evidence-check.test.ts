import { execFile } from "node:child_process";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";
import {
  buildVisualQaEvidenceReport,
  buildVisualQaLoopReadinessSummary,
  buildVisualQaRemediationWorkOrderRefs,
  normalizeVisualQaEvidenceInput,
  type VisualQaEvidence,
  type VisualQaEvidenceReport,
} from "./visual-qa-evidence-check.js";
import { buildVisualQaRemediationWorkOrderPlans } from "../../packages/openclinxr/capability-gateway/src/index.js";

const execFileAsync = promisify(execFile);

describe("visual QA evidence checker", () => {
  it("accepts the captured IWER screenshot as adversarial visual QA evidence only", async () => {
    const evidence = JSON.parse(
      await readFile("docs/openclinxr/visual-qa-evidence-2026-05-04.json", "utf8"),
    ) as VisualQaEvidence;
    const report = buildVisualQaEvidenceReport({
      generatedAt: "2026-05-05T00:00:00.000Z",
      inputFile: "docs/openclinxr/visual-qa-evidence-2026-05-04.json",
      evidence,
    });

    expect(report.result).toEqual({
      readyForAdversarialVisualQa: true,
      readyForProductionRuntime: false,
      readyForPhysicalQuestClaim: false,
      blockers: [],
    });
    expect(report.remediationWorkOrderRefs).toBeUndefined();
    expect(report.evidence.claimBoundaries?.notEvidenceFor).toEqual(expect.arrayContaining([
      "physical_quest_foreground_frame_pacing",
      "in_headset_text_readability",
      "production_runtime_readiness",
    ]));
  });

  it("rejects missing artifact metadata, missing review dimensions, and unsafe claims", () => {
    const evidence = readyEvidence();
    evidence.capture!.artifact = "/tmp/untracked-screenshot.jpg";
    evidence.capture!.mimeType = "image/jpeg";
    evidence.capture!.dimensions = { width: 100, height: 100 };
    evidence.adversarialReview!.checks!.ui_readability = { status: "not_assessed", notes: [] };
    evidence.adversarialReview!.checks!.evidence_limits = undefined;
    evidence.claimBoundaries!.allowedClaims = ["production_runtime_readiness"];
    evidence.claimBoundaries!.notEvidenceFor = ["psychometric_validity"];

    const report = buildVisualQaEvidenceReport({
      generatedAt: "2026-05-05T00:00:00.000Z",
      evidence,
    });

    expect(report.result.readyForAdversarialVisualQa).toBe(false);
    expect(report.result.blockers).toEqual(expect.arrayContaining([
      "artifact_not_under_docs_openclinxr_visual_evidence",
      "artifact_mime_type_not_supported",
      "artifact_file_missing",
      "artifact_dimensions_do_not_match_png_header",
      "review_check_missing_notes:ui_readability",
      "review_check_missing:evidence_limits",
      "missing_not_evidence_for_physical_quest_foreground_frame_pacing",
      "unsafe_allowed_claim:production_runtime_readiness",
    ]));
  });

  it("rejects known visual regression cue IDs from prior realism review failures", () => {
    const evidence = readyEvidence();
    evidence.visualRegressionCueIds = ["broad_face_material_contrast_patch"];

    const report = buildVisualQaEvidenceReport({
      generatedAt: "2026-05-24T00:00:00.000Z",
      evidence,
    });

    expect(report.result.readyForAdversarialVisualQa).toBe(false);
    expect(report.result.blockers).toContain(
      "rejected_visual_regression_cue_present:broad_face_material_contrast_patch",
    );
  });

  it("requires explicit runtime realism signals for humanoid-focused visual QA", () => {
    const evidence = readyEvidence();
    evidence.visualQaFocus = "humanoid_realism";
    evidence.humanoidRealismSignalIds = [
      "animated_humanoid_runtime_playback",
      "visible_mouth_eye_expression_cues",
      "dialogue_eye_micro_saccade_blink_cue",
      "generated_eyelid_blink_control_cue",
      "emotion_aligned_expression_transition_cue",
    ];
    evidence.humanoidVisualAnalysis = readyHumanoidVisualAnalysis();

    const report = buildVisualQaEvidenceReport({
      generatedAt: "2026-05-24T00:00:00.000Z",
      evidence,
    });

    expect(report.result.readyForAdversarialVisualQa).toBe(false);
    expect(report.result.blockers).toEqual(expect.arrayContaining([
      "humanoid_realism_signal_missing:authored_clinical_idle_pose_runtime_cue",
      "humanoid_realism_signal_missing:dialogue_viseme_and_gaze_mapping",
    ]));
  });

  it("accepts humanoid-focused visual QA with explicit runtime realism signals when temporal checks are not claimed from a still", () => {
    const evidence = readyEvidence();
    evidence.visualQaFocus = "humanoid_realism";
    evidence.humanoidRealismSignalIds = [
      "animated_humanoid_runtime_playback",
      "authored_clinical_idle_pose_runtime_cue",
      "visible_mouth_eye_expression_cues",
      "dialogue_viseme_and_gaze_mapping",
      "dialogue_eye_micro_saccade_blink_cue",
      "generated_eyelid_blink_control_cue",
      "emotion_aligned_expression_transition_cue",
    ];
    evidence.humanoidVisualAnalysis = readyHumanoidVisualAnalysis();
    evidence.capture = {
      ...evidence.capture,
      artifactType: "video",
      artifact: "docs/openclinxr/videos/visual-qa-temporal-eye-fixture.webm",
      mimeType: "video/webm",
      dimensions: { width: 1280, height: 720 },
      durationMs: 2400,
      frameCount: 72,
    };

    const report = buildVisualQaEvidenceReport({
      generatedAt: "2026-05-24T00:00:00.000Z",
      evidence,
    });

    expect(report.result.readyForAdversarialVisualQa).toBe(true);
  });

  it("requires strict AAA-pass for concern-level humanoid realism dimensions when the review is human focused", () => {
    const evidence = readyEvidence();
    evidence.visualQaFocus = "humanoid_realism";
    evidence.humanoidRealismSignalIds = [
      "animated_humanoid_runtime_playback",
      "authored_clinical_idle_pose_runtime_cue",
      "visible_mouth_eye_expression_cues",
      "dialogue_viseme_and_gaze_mapping",
      "dialogue_eye_micro_saccade_blink_cue",
      "generated_eyelid_blink_control_cue",
      "emotion_aligned_expression_transition_cue",
      "examinee_locomotion_observed",
    ];
    evidence.humanoidVisualAnalysis = {
      ...readyHumanoidVisualAnalysis(),
      mouth_movement_readability: { status: "concern", notes: ["Mouth movement is static in this frame and requires a stronger pass review."] },
    };

    const report = buildVisualQaEvidenceReport({
      generatedAt: "2026-05-24T00:00:00.000Z",
      evidence,
    });

    expect(report.result.readyForAdversarialVisualQa).toBe(false);
    expect(report.result.blockers).toContain("humanoid_visual_analysis_strict_pass_required:mouth_movement_readability");
  });

  it("rejects missing deterministic realism-metadata review checks for equipment necessity and clutter removal", () => {
    const evidence = readyEvidence();
    evidence.adversarialReview!.checks!.equipment_necessity = undefined;
    evidence.adversarialReview!.checks!.scene_clutter_removal = undefined;

    const report = buildVisualQaEvidenceReport({
      generatedAt: "2026-05-24T00:00:00.000Z",
      evidence,
    });

    expect(report.result.readyForAdversarialVisualQa).toBe(false);
    expect(report.result.blockers).toEqual(expect.arrayContaining([
      "review_check_missing:equipment_necessity",
      "review_check_missing:scene_clutter_removal",
    ]));
  });

  it("rejects current dynamic-only generated scene overview when deterministic clutter and equipment checks are absent", () => {
    const evidence = readyEvidence();
    evidence.capture = {
      ...evidence.capture,
      scenarioId: "oncology_bad_news_family_v1",
      runtimeUrl: "http://127.0.0.1:5183/?scene=generated-oncology-bad-news-family",
      route: "/?scene=generated-oncology-bad-news-family",
    };
    evidence.visualRegressionCueIds = [
      "case_defined_generated_scene_overview",
      "dynamic_encounter_factory_scene_bundle_loaded",
      "generated_humanoid_role_slots_visible",
    ];
    delete evidence.adversarialReview!.checks!.equipment_necessity;
    delete evidence.adversarialReview!.checks!.scene_clutter_removal;

    const report = buildVisualQaEvidenceReport({
      generatedAt: "2026-05-26T00:00:00.000Z",
      evidence,
    });

    expect(report.result.readyForAdversarialVisualQa).toBe(false);
    expect(report.result.blockers).toEqual(expect.arrayContaining([
      "review_check_missing:equipment_necessity",
      "review_check_missing:scene_clutter_removal",
    ]));
    expect(report.result.blockers).not.toContain("rejected_visual_regression_cue_present:case_defined_generated_scene_overview");
  });

  it("blocks humanoid-focused visual QA when screenshot analysis flags pose or mouth realism failures", () => {
    const evidence = readyEvidence();
    evidence.visualQaFocus = "humanoid_realism";
    evidence.humanoidRealismSignalIds = [
      "animated_humanoid_runtime_playback",
      "authored_clinical_idle_pose_runtime_cue",
      "visible_mouth_eye_expression_cues",
      "dialogue_viseme_and_gaze_mapping",
      "dialogue_eye_micro_saccade_blink_cue",
      "generated_eyelid_blink_control_cue",
      "emotion_aligned_expression_transition_cue",
    ];
    evidence.humanoidVisualAnalysis = {
      ...readyHumanoidVisualAnalysis(),
      mouth_movement_readability: { status: "blocked", notes: ["Screenshot shows a closed or static mouth during spoken dialogue."] },
      pose_naturalness: { status: "blocked", notes: ["Screenshot shows a mannequin/T-pose-like stance instead of a clinical idle pose."] },
    };

    const report = buildVisualQaEvidenceReport({
      generatedAt: "2026-05-24T00:00:00.000Z",
      evidence,
    });

    expect(report.result.readyForAdversarialVisualQa).toBe(false);
    expect(report.result.blockers).toEqual(expect.arrayContaining([
      "humanoid_visual_analysis_blocked:mouth_movement_readability",
      "humanoid_visual_analysis_blocked:pose_naturalness",
    ]));
  });

  it("converts blocked humanoid visual QA into reusable asset-generation remediation work-order refs", () => {
    const evidence = readyEvidence();
    evidence.visualQaFocus = "humanoid_realism";
    evidence.humanoidRealismSignalIds = [
      "animated_humanoid_runtime_playback",
      "authored_clinical_idle_pose_runtime_cue",
      "visible_mouth_eye_expression_cues",
      "dialogue_viseme_and_gaze_mapping",
      "dialogue_eye_micro_saccade_blink_cue",
      "generated_eyelid_blink_control_cue",
      "emotion_aligned_expression_transition_cue",
    ];
    evidence.humanoidVisualAnalysis = {
      ...readyHumanoidVisualAnalysis(),
      mouth_movement_readability: { status: "blocked", notes: ["Mouth is static during dialogue."] },
      pose_naturalness: { status: "blocked", notes: ["Patient pose reads as a mannequin stance."] },
      face_visibility: { status: "blocked", notes: ["Face is not readable enough for affect review."] },
    };

    const report = buildVisualQaEvidenceReport({
      generatedAt: "2026-05-25T00:00:00.000Z",
      inputFile: "docs/openclinxr/visual-qa-evidence-humanoid-blocked.json",
      evidence,
    });
    const remediationRefs = buildVisualQaRemediationWorkOrderRefs(report);

    expect(remediationRefs).toEqual(expect.arrayContaining([
      expect.objectContaining({
        schemaVersion: "openclinxr.visual-qa-remediation-work-order-ref.v1",
        scenarioId: "ed_chest_pain_priority_v1",
        sourceEvidenceRef: "docs/openclinxr/visual-qa-evidence-humanoid-blocked.json",
        blockerId: "humanoid_visual_analysis_blocked:mouth_movement_readability",
        targetKind: "facial_lipsync_gaze_animation",
        capabilityId: "animation-generation",
        status: "planned_metadata_only",
        notEvidenceFor: ["production_asset_readiness", "quest_readiness", "clinical_validity", "scoring_validity"],
      }),
      expect.objectContaining({
        blockerId: "humanoid_visual_analysis_blocked:pose_naturalness",
        targetKind: "role_idle_animation_glb",
        capabilityId: "animation-generation",
      }),
      expect.objectContaining({
        blockerId: "humanoid_visual_analysis_blocked:face_visibility",
        targetKind: "role_specific_humanoid_glb",
        capabilityId: "character-generation",
      }),
    ]));
    expect(remediationRefs.every((ref) => ref.workOrderRef.startsWith("encounter-generation-work-order://ed_chest_pain_priority_v1/"))).toBe(true);
  });

  it("summarizes blocked visual QA findings into deterministic remediation loop inputs", () => {
    const evidence = readyEvidence();
    evidence.visualQaFocus = "humanoid_realism";
    evidence.humanoidRealismSignalIds = [
      "animated_humanoid_runtime_playback",
      "authored_clinical_idle_pose_runtime_cue",
      "visible_mouth_eye_expression_cues",
      "dialogue_viseme_and_gaze_mapping",
      "dialogue_eye_micro_saccade_blink_cue",
      "generated_eyelid_blink_control_cue",
      "emotion_aligned_expression_transition_cue",
    ];
    evidence.humanoidVisualAnalysis = {
      ...readyHumanoidVisualAnalysis(),
      mouth_movement_readability: { status: "blocked", notes: ["Mouth is static during dialogue."] },
      gaze_target_alignment: { status: "blocked", notes: ["Eyes do not look at the learner while speaking."] },
      emotion_expression_transition_readability: { status: "blocked", notes: ["Expression snaps instead of easing between emotions."] },
      locomotion_path_realism: { status: "blocked", notes: ["Walk path clips through the stretcher."] },
    };
    evidence.adversarialReview!.checks!.equipment_necessity = {
      status: "blocked",
      notes: ["Unneeded visual clutter is competing with required ED equipment."],
    };

    const report = buildVisualQaEvidenceReport({
      generatedAt: "2026-05-25T00:00:00.000Z",
      inputFile: "docs/openclinxr/visual-qa-evidence-humanoid-blocked.json",
      evidence,
    });
    const summary = buildVisualQaLoopReadinessSummary(report);

    expect(summary).toMatchObject({
      schemaVersion: "openclinxr.visual-qa-loop-readiness.v1",
      scenarioId: "ed_chest_pain_priority_v1",
      sourceEvidenceRef: "docs/openclinxr/visual-qa-evidence-humanoid-blocked.json",
      sourceReadyForAdversarialVisualQa: false,
      readyForAutomatedRemediationLoop: true,
      evidenceCanDriveRemediationWithoutLiveHeadsetCapture: true,
      notEvidenceFor: ["production_asset_readiness", "quest_readiness", "clinical_validity", "scoring_validity"],
    });
    expect(summary.remediationInputs).toEqual(expect.arrayContaining([
      expect.objectContaining({
        category: "mouth_viseme",
        targetKinds: ["facial_lipsync_gaze_animation"],
        capabilityIds: ["animation-generation"],
      }),
      expect.objectContaining({
        category: "gaze",
        targetKinds: ["facial_lipsync_gaze_animation"],
        capabilityIds: ["animation-generation"],
      }),
      expect.objectContaining({
        category: "expression_transition",
        targetKinds: ["facial_lipsync_gaze_animation"],
        capabilityIds: ["animation-generation"],
      }),
      expect.objectContaining({
        category: "locomotion_pose",
        targetKinds: ["role_idle_animation_glb"],
        capabilityIds: ["animation-generation"],
      }),
      expect.objectContaining({
        category: "clutter_equipment",
        targetKinds: ["medical_equipment_glb"],
        capabilityIds: ["medical-equipment-generation"],
      }),
    ]));
    expect(summary.remediationInputCount).toBe(summary.remediationInputs.length);
    expect(summary.unresolvedBlockers).toEqual(expect.arrayContaining([
      "humanoid_visual_analysis_blocked:mouth_movement_readability",
      "humanoid_visual_analysis_blocked:gaze_target_alignment",
      "humanoid_visual_analysis_blocked:emotion_expression_transition_readability",
      "humanoid_visual_analysis_blocked:locomotion_path_realism",
      "review_check_blocked:equipment_necessity",
    ]));
  });

  it("normalizes desktop remediation artifacts into visual QA remediation inputs without Quest readiness claims", async () => {
    const artifact = JSON.parse(
      await readFile("docs/openclinxr/evidence/realism-review-mouth-gaze-pose-posture-remediation-placeholder-2026-05-25.json", "utf8"),
    ) as unknown;
    const evidence = normalizeVisualQaEvidenceInput(artifact);
    const report = buildVisualQaEvidenceReport({
      generatedAt: "2026-05-25T00:00:00.000Z",
      inputFile: "docs/openclinxr/evidence/realism-review-mouth-gaze-pose-posture-remediation-placeholder-2026-05-25.json",
      evidence,
    });
    const summary = buildVisualQaLoopReadinessSummary(report);

    expect(evidence).toMatchObject({
      schemaVersion: "openclinxr.visual-qa-evidence.v1",
      visualQaFocus: "humanoid_realism",
      capture: {
        source: "desktop_browser",
        artifactType: "video",
        artifact: "docs/openclinxr/videos/visual-qa-mouth-gaze-pose-posture-remediation-placeholder-2026-05-25.webm",
        xrMode: "desktop_remediation_artifact_not_physical_quest",
      },
      claimBoundaries: {
        allowedClaims: ["adversarial_visual_iteration_artifact"],
        notEvidenceFor: expect.arrayContaining([
          "physical_quest_foreground_frame_pacing",
          "in_headset_text_readability",
          "production_runtime_readiness",
        ]),
      },
    });
    expect(report.result.readyForAdversarialVisualQa).toBe(false);
    expect(report.result.readyForPhysicalQuestClaim).toBe(false);
    expect(report.remediationWorkOrderRefs).toEqual(expect.arrayContaining([
      expect.objectContaining({
        schemaVersion: "openclinxr.visual-qa-remediation-work-order-ref.v1",
        scenarioId: "oncology_bad_news_family_v1",
        sourceEvidenceRef: "docs/openclinxr/evidence/realism-review-mouth-gaze-pose-posture-remediation-placeholder-2026-05-25.json",
        status: "planned_metadata_only",
      }),
    ]));
    expect(report.remediationWorkOrderRefs?.every((ref) => ref.notEvidenceFor.join(",") === "production_asset_readiness,quest_readiness,clinical_validity,scoring_validity")).toBe(true);
    expect(summary.readyForAutomatedRemediationLoop).toBe(true);
    expect(summary.notEvidenceFor).toEqual(["production_asset_readiness", "quest_readiness", "clinical_validity", "scoring_validity"]);
    expect(summary.remediationInputs).toEqual(expect.arrayContaining([
      expect.objectContaining({ category: "mouth_viseme" }),
      expect.objectContaining({ category: "gaze" }),
      expect.objectContaining({ category: "locomotion_pose" }),
    ]));
  });

  it("feeds normalized visual remediation inputs into concrete asset work-order planning inputs without Quest or production claims", async () => {
    const artifact = JSON.parse(
      await readFile("docs/openclinxr/evidence/realism-review-mouth-gaze-pose-posture-remediation-placeholder-2026-05-25.json", "utf8"),
    ) as unknown;
    const evidence = normalizeVisualQaEvidenceInput(artifact);
    const report = buildVisualQaEvidenceReport({
      generatedAt: "2026-05-25T00:00:00.000Z",
      inputFile: "docs/openclinxr/evidence/realism-review-mouth-gaze-pose-posture-remediation-placeholder-2026-05-25.json",
      evidence,
    });
    const summary = buildVisualQaLoopReadinessSummary(report);
    const plans = buildVisualQaRemediationWorkOrderPlans({
      requestId: "visual_remediation_ed_chest_pain_001",
      encounterId: "encounter_1",
      scenarioId: summary.scenarioId,
      sourceEvidenceRef: summary.sourceEvidenceRef,
      encounterDefinitionRef: {
        storeKind: "mongoose",
        documentId: "scenario_ed_chest_pain_v1",
      },
      targetAssetStore: {
        storeKind: "azurite_blob",
        containerName: "openclinxr-assets",
        blobPrefix: "scenario-assets/ed_chest_pain_priority_v1/encounter_1/",
      },
      persistenceTarget: {
        storeKind: "mongoose",
        collectionName: "encounter_asset_generation_jobs",
      },
      remediationInputs: summary.remediationInputs,
      notEvidenceFor: summary.notEvidenceFor,
    });

    const mouthPlan = plans.find((plan) => plan.category === "mouth_viseme");
    const gazePlan = plans.find((plan) => plan.category === "gaze");
    const locomotionPlan = plans.find((plan) => plan.category === "locomotion_pose");

    expect(plans.every((plan) => plan.temporalEvidenceBoundary === "metadata_only_not_quest_or_production_claims")).toBe(true);
    expect(plans.every((plan) => (
      plan.workOrder.notEvidenceFor.join(",") === "production_asset_readiness,quest_readiness,clinical_validity,scoring_validity"
    ))).toBe(true);
    expect(mouthPlan).toMatchObject({
      schemaVersion: "openclinxr.visual-qa-remediation-work-order-plan.v1",
      scenarioId: summary.scenarioId,
      sourceEvidenceRef: summary.sourceEvidenceRef,
      category: "mouth_viseme",
      recommendedWorkerActions: expect.arrayContaining([
        expect.stringContaining("facial, viseme, gaze, blink, and emotion-transition animation tracks"),
      ]),
      workOrder: expect.objectContaining({
        targetKind: "facial_lipsync_gaze_animation",
        capabilityId: "animation-generation",
        providerRoute: "local-runtime-planned",
        evidenceGateRefs: ["visual_qa_evidence"],
        inputRefs: expect.arrayContaining([
          summary.sourceEvidenceRef,
        ]),
        visualQaBlockerRefs: expect.arrayContaining([
          "humanoid_visual_analysis_blocked:mouth_movement_readability",
        ]),
        acceptanceCriteria: expect.arrayContaining([
          "normalized_visual_remediation_inputs_are_preserved_as_asset_planning_inputs",
          "temporal_evidence_boundaries_remain_metadata_only_until_new_evidence_closes_the_blockers",
        ]),
      }),
    });
    expect(gazePlan).toBeDefined();
    expect(locomotionPlan).toBeDefined();
  });

  it("blocks still screenshots from claiming passing blink or micro-saccade temporal readability", () => {
    const evidence = readyEvidence();
    evidence.visualQaFocus = "humanoid_realism";
    evidence.humanoidRealismSignalIds = [
      "animated_humanoid_runtime_playback",
      "authored_clinical_idle_pose_runtime_cue",
      "visible_mouth_eye_expression_cues",
      "dialogue_viseme_and_gaze_mapping",
      "dialogue_eye_micro_saccade_blink_cue",
      "generated_eyelid_blink_control_cue",
      "emotion_aligned_expression_transition_cue",
    ];
    evidence.humanoidVisualAnalysis = {
      ...readyHumanoidVisualAnalysis(),
      eye_blink_micro_saccade_readability: {
        status: "pass",
        notes: ["Still screenshot appears to show an eye animation cue."],
      },
    };

    const report = buildVisualQaEvidenceReport({
      generatedAt: "2026-05-24T00:00:00.000Z",
      evidence,
    });

    expect(report.result.readyForAdversarialVisualQa).toBe(false);
    expect(report.result.blockers).toContain(
      "humanoid_visual_analysis_temporal_pass_requires_video:eye_blink_micro_saccade_readability",
    );
  });

  it("allows video artifacts to carry passing blink or micro-saccade temporal readability evidence", () => {
    const evidence = readyEvidence();
    evidence.visualQaFocus = "humanoid_realism";
    evidence.humanoidRealismSignalIds = [
      "animated_humanoid_runtime_playback",
      "authored_clinical_idle_pose_runtime_cue",
      "visible_mouth_eye_expression_cues",
      "dialogue_viseme_and_gaze_mapping",
      "dialogue_eye_micro_saccade_blink_cue",
      "generated_eyelid_blink_control_cue",
      "emotion_aligned_expression_transition_cue",
    ];
    evidence.capture = {
      ...evidence.capture,
      artifactType: "video",
      artifact: "docs/openclinxr/videos/visual-qa-temporal-eye-fixture.webm",
      mimeType: "video/webm",
      dimensions: { width: 1280, height: 720 },
      durationMs: 2400,
      frameCount: 72,
    };
    evidence.humanoidVisualAnalysis = {
      ...readyHumanoidVisualAnalysis(),
      eye_blink_micro_saccade_readability: {
        status: "pass",
        notes: ["Short video shows blink and micro-saccade timing cues during speech."],
      },
    };

    const report = buildVisualQaEvidenceReport({
      generatedAt: "2026-05-24T00:00:00.000Z",
      evidence,
    });

    expect(report.result.blockers).not.toContain(
      "humanoid_visual_analysis_temporal_pass_requires_video:eye_blink_micro_saccade_readability",
    );
    expect(report.result.readyForAdversarialVisualQa).toBe(true);
  });

  it("blocks tiny video placeholders from carrying temporal humanoid evidence", () => {
    const evidence = readyEvidence();
    evidence.visualQaFocus = "humanoid_realism";
    evidence.humanoidRealismSignalIds = [
      "animated_humanoid_runtime_playback",
      "authored_clinical_idle_pose_runtime_cue",
      "visible_mouth_eye_expression_cues",
      "dialogue_viseme_and_gaze_mapping",
      "dialogue_eye_micro_saccade_blink_cue",
      "generated_eyelid_blink_control_cue",
      "emotion_aligned_expression_transition_cue",
    ];
    evidence.capture = {
      ...evidence.capture,
      artifactType: "video",
      artifact: "docs/openclinxr/videos/visual-qa-temporal-eye-placeholder.webm",
      mimeType: "video/webm",
      dimensions: { width: 1280, height: 720 },
      durationMs: 2400,
      frameCount: 72,
    };
    evidence.humanoidVisualAnalysis = {
      ...readyHumanoidVisualAnalysis(),
      eye_blink_micro_saccade_readability: {
        status: "pass",
        notes: ["Short video shows blink and micro-saccade timing cues during speech."],
      },
    };

    const report = buildVisualQaEvidenceReport({
      generatedAt: "2026-05-24T00:00:00.000Z",
      evidence,
    });

    expect(report.result.readyForAdversarialVisualQa).toBe(false);
    expect(report.result.blockers).toContain("video_artifact_too_small_for_temporal_review");
  });

  it("blocks video artifacts without enough duration for temporal humanoid review", () => {
    const evidence = readyEvidence();
    evidence.visualQaFocus = "humanoid_realism";
    evidence.humanoidRealismSignalIds = [
      "animated_humanoid_runtime_playback",
      "authored_clinical_idle_pose_runtime_cue",
      "visible_mouth_eye_expression_cues",
      "dialogue_viseme_and_gaze_mapping",
      "dialogue_eye_micro_saccade_blink_cue",
      "generated_eyelid_blink_control_cue",
      "emotion_aligned_expression_transition_cue",
    ];
    evidence.capture = {
      ...evidence.capture,
      artifactType: "video",
      artifact: "docs/openclinxr/videos/visual-qa-temporal-eye-fixture.webm",
      mimeType: "video/webm",
      dimensions: { width: 1280, height: 720 },
      durationMs: 600,
      frameCount: 18,
    };
    evidence.humanoidVisualAnalysis = {
      ...readyHumanoidVisualAnalysis(),
      eye_blink_micro_saccade_readability: {
        status: "pass",
        notes: ["Short video shows blink and micro-saccade timing cues during speech."],
      },
    };

    const report = buildVisualQaEvidenceReport({
      generatedAt: "2026-05-24T00:00:00.000Z",
      evidence,
    });

    expect(report.result.readyForAdversarialVisualQa).toBe(false);
    expect(report.result.blockers).toContain("video_duration_too_short_for_temporal_review");
  });

  it("blocks video artifacts without enough frames for temporal humanoid review", () => {
    const evidence = readyEvidence();
    evidence.visualQaFocus = "humanoid_realism";
    evidence.humanoidRealismSignalIds = [
      "animated_humanoid_runtime_playback",
      "authored_clinical_idle_pose_runtime_cue",
      "visible_mouth_eye_expression_cues",
      "dialogue_viseme_and_gaze_mapping",
      "dialogue_eye_micro_saccade_blink_cue",
      "generated_eyelid_blink_control_cue",
      "emotion_aligned_expression_transition_cue",
    ];
    evidence.capture = {
      ...evidence.capture,
      artifactType: "video",
      artifact: "docs/openclinxr/videos/visual-qa-temporal-eye-fixture.webm",
      mimeType: "video/webm",
      dimensions: { width: 1280, height: 720 },
      durationMs: 2400,
      frameCount: 4,
    };
    evidence.humanoidVisualAnalysis = {
      ...readyHumanoidVisualAnalysis(),
      eye_blink_micro_saccade_readability: {
        status: "pass",
        notes: ["Short video shows blink and micro-saccade timing cues during speech."],
      },
    };

    const report = buildVisualQaEvidenceReport({
      generatedAt: "2026-05-24T00:00:00.000Z",
      evidence,
    });

    expect(report.result.readyForAdversarialVisualQa).toBe(false);
    expect(report.result.blockers).toContain("video_frame_count_too_low_for_temporal_review");
  });

  it("blocks video artifacts whose duration and frame count imply an implausible review frame rate", () => {
    const evidence = readyEvidence();
    evidence.visualQaFocus = "humanoid_realism";
    evidence.humanoidRealismSignalIds = [
      "animated_humanoid_runtime_playback",
      "authored_clinical_idle_pose_runtime_cue",
      "visible_mouth_eye_expression_cues",
      "dialogue_viseme_and_gaze_mapping",
      "dialogue_eye_micro_saccade_blink_cue",
      "generated_eyelid_blink_control_cue",
      "emotion_aligned_expression_transition_cue",
    ];
    evidence.capture = {
      ...evidence.capture,
      artifactType: "video",
      artifact: "docs/openclinxr/videos/visual-qa-temporal-eye-fixture.webm",
      mimeType: "video/webm",
      dimensions: { width: 1280, height: 720 },
      durationMs: 12000,
      frameCount: 12,
    };
    evidence.humanoidVisualAnalysis = {
      ...readyHumanoidVisualAnalysis(),
      eye_blink_micro_saccade_readability: {
        status: "pass",
        notes: ["Sparse frames are not enough to judge blink and micro-saccade timing."],
      },
    };

    const report = buildVisualQaEvidenceReport({
      generatedAt: "2026-05-24T00:00:00.000Z",
      evidence,
    });

    expect(report.result.readyForAdversarialVisualQa).toBe(false);
    expect(report.result.blockers).toContain("video_frame_rate_not_plausible_for_temporal_review");
  });

  it("blocks temporal video artifacts whose extension and MIME type disagree", () => {
    const evidence = readyEvidence();
    evidence.visualQaFocus = "humanoid_realism";
    evidence.humanoidRealismSignalIds = [
      "animated_humanoid_runtime_playback",
      "authored_clinical_idle_pose_runtime_cue",
      "visible_mouth_eye_expression_cues",
      "dialogue_viseme_and_gaze_mapping",
      "dialogue_eye_micro_saccade_blink_cue",
      "generated_eyelid_blink_control_cue",
      "emotion_aligned_expression_transition_cue",
    ];
    evidence.capture = {
      ...evidence.capture,
      artifactType: "video",
      artifact: "docs/openclinxr/videos/visual-qa-temporal-eye-fixture.webm",
      mimeType: "video/mp4",
      dimensions: { width: 1280, height: 720 },
      durationMs: 2400,
      frameCount: 72,
    };
    evidence.humanoidVisualAnalysis = {
      ...readyHumanoidVisualAnalysis(),
      eye_blink_micro_saccade_readability: {
        status: "pass",
        notes: ["Video metadata must agree with the artifact path before temporal claims are accepted."],
      },
    };

    const report = buildVisualQaEvidenceReport({
      generatedAt: "2026-05-24T00:00:00.000Z",
      evidence,
    });

    expect(report.result.readyForAdversarialVisualQa).toBe(false);
    expect(report.result.blockers).toContain("artifact_extension_mime_type_mismatch");
  });

  it("exposes a CLI for scoring visual QA evidence JSON", async () => {
    const rootPackage = JSON.parse(await readFile("package.json", "utf8")) as {
      scripts: Record<string, string>;
    };
    expect(rootPackage.scripts["visual:qa:evidence"]).toBe(
      "tsx tools/openclinxr/visual-qa-evidence-check.ts",
    );
    expect(rootPackage.scripts["visual:qa:evidence:validate"]).toBe(
      "tsx tools/openclinxr/visual-qa-evidence-check.ts --validate-latest",
    );

    const tempDir = await mkdtemp(path.join(os.tmpdir(), "openclinxr-visual-qa-"));
    const inputPath = path.join(tempDir, "visual-qa.json");
    const outputPath = path.join(tempDir, "visual-qa-report.json");
    await writeFile(inputPath, `${JSON.stringify(readyEvidence(), null, 2)}\n`, "utf8");

    const { stdout } = await execFileAsync(
      path.resolve("node_modules/.bin/tsx"),
      ["tools/openclinxr/visual-qa-evidence-check.ts", "--input", inputPath, "--output", outputPath],
      { encoding: "utf8", timeout: 15000 },
    );
    const report = JSON.parse(await readFile(outputPath, "utf8")) as VisualQaEvidenceReport;

    expect(stdout).toContain(`Wrote ${outputPath}`);
    expect(report.inputFile).toBe(inputPath);
    expect(report.result.readyForAdversarialVisualQa).toBe(true);
  });

  it("validates the latest passing committed visual QA evidence", async () => {
    const { stdout } = await execFileAsync(
      path.resolve("node_modules/.bin/tsx"),
      ["tools/openclinxr/visual-qa-evidence-check.ts", "--validate-latest"],
      { encoding: "utf8", timeout: 15000 },
    );

    expect(stdout.trim()).toMatch(/^Validated docs\/openclinxr\/visual-qa-evidence-.+\.json$/);
  });

  it("accepts pnpm-style argument separators before input flags", async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "openclinxr-visual-qa-pnpm-args-"));
    const inputPath = path.join(tempDir, "visual-qa.json");
    await writeFile(inputPath, `${JSON.stringify(readyEvidence(), null, 2)}\n`, "utf8");

    const { stdout } = await execFileAsync(
      path.resolve("node_modules/.bin/tsx"),
      ["tools/openclinxr/visual-qa-evidence-check.ts", "--", "--input", inputPath],
      { encoding: "utf8", timeout: 15000 },
    );
    const report = JSON.parse(stdout) as VisualQaEvidenceReport;

    expect(report.inputFile).toBe(inputPath);
    expect(report.result.readyForAdversarialVisualQa).toBe(true);
  });
});

function readyEvidence(): VisualQaEvidence {
  return {
    schemaVersion: "openclinxr.visual-qa-evidence.v1",
    capture: {
      source: "iwer_emulation",
      artifactType: "screenshot",
      artifact: "docs/openclinxr/screenshots/iwer-sidecar-agent-browser-2026-05-04.png",
      mimeType: "image/png",
      dimensions: { width: 500, height: 500 },
      runtimeUrl: "http://127.0.0.1:5183/",
      route: "/",
      scenarioId: "ed_chest_pain_priority_v1",
      xrMode: "desktop_managed_browser_not_immersive_session",
      captureCommand: "pnpm iwsdk:iwer:evidence",
    },
    adversarialReview: {
      reviewers: [
        "test-automation-lead",
        "ux-friction-critic",
        "clinical-safety-critic",
        "xr-systems-architect",
        "asset-pipeline-lead",
      ],
      checks: {
        clinical_scene_fidelity: { status: "concern", notes: ["ED-bay intent is visible, but clinical fidelity remains placeholder-level."] },
        actor_equipment_realism: { status: "concern", notes: ["Actors and equipment should not be treated as production-realistic from this screenshot."] },
        equipment_necessity: { status: "pass", notes: ["Only clinically relevant equipment is visible; every item has a scenario workflow role."] },
        scene_clutter_removal: { status: "pass", notes: ["Scene content remains concise with no unrelated props competing with workflow cues."] },
        ui_readability: { status: "pass", notes: ["The fixed-size artifact is adequate for adversarial iteration notes."] },
        interaction_affordances: { status: "concern", notes: ["The artifact alone does not prove controller or hand input affordances."] },
        occlusion_scale: { status: "concern", notes: ["Scale and occlusion need XR scene inspection and physical Quest confirmation."] },
        evidence_limits: { status: "pass", notes: ["This is IWER managed-browser evidence, not physical Quest or production readiness proof."] },
      },
    },
    claimBoundaries: {
      notEvidenceFor: [
        "physical_quest_foreground_frame_pacing",
        "quest_controller_latency",
        "quest_hand_tracking_quality",
        "in_headset_text_readability",
        "thermal_or_battery_behavior",
        "production_runtime_readiness",
      ],
      allowedClaims: ["adversarial_visual_iteration_artifact"],
    },
  };
}

function readyHumanoidVisualAnalysis(): NonNullable<VisualQaEvidence["humanoidVisualAnalysis"]> {
  return {
    face_visibility: { status: "pass", notes: ["Face is visible enough for screenshot-level review."] },
    mouth_movement_readability: { status: "pass", notes: ["Mouth shape and viseme timing match dialogue intent."] },
    eye_blink_micro_saccade_readability: { status: "pass", notes: ["Blink and micro-saccade cues are present and plausible." ] },
    gaze_target_alignment: { status: "pass", notes: ["Gaze stays on learner and dialogue targets with believable cadence."] },
    emotion_expression_transition_readability: { status: "pass", notes: ["Expression transitions follow dialogue and scene emotional intent."] },
    locomotion_path_realism: { status: "pass", notes: ["Locomotion path appears natural with paced movement and clean stop positions."] },
    pose_naturalness: { status: "pass", notes: ["Clinical idle pose is stable and clinically plausible."] },
    hand_arm_naturalness: { status: "pass", notes: ["Hands and arms show plausible spacing and anatomy under speech."] },
  };
}
