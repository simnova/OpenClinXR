import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { buildModelVettingStudioEvidence } from "./studio-state.js";

describe("model vetting studio state", () => {
  it("builds deterministic capture evidence from the current peds report without weakening gates", async () => {
    const reportPath = "docs/openclinxr/model-vetting-report-peds-asthma-parent-anxiety-2026-06-06.json";
    const reportFsPath = process.cwd().endsWith(path.join("apps", "arena", "model-vetting-studio"))
      ? path.join("..", "..", "..", reportPath)
      : reportPath;
    const report = JSON.parse(await readFile(reportFsPath, "utf8")) as unknown;
    const actorPlayerPath = "docs/openclinxr/model-vetting-actor-player-runtime-evidence-peds-asthma-parent-anxiety-2026-06-05.json";
    const actorPlayerFsPath = process.cwd().endsWith(path.join("apps", "arena", "model-vetting-studio"))
      ? path.join("..", "..", "..", actorPlayerPath)
      : actorPlayerPath;
    const actorPlayerEvidence = JSON.parse(await readFile(actorPlayerFsPath, "utf8")) as unknown;
    const captureManifestPath = "docs/openclinxr/model-vetting-capture-manifest-peds-asthma-parent-anxiety-2026-06-05.json";
    const captureManifestFsPath = process.cwd().endsWith(path.join("apps", "arena", "model-vetting-studio"))
      ? path.join("..", "..", "..", captureManifestPath)
      : captureManifestPath;
    const captureManifest = JSON.parse(await readFile(captureManifestFsPath, "utf8")) as unknown;
    const evidence = buildModelVettingStudioEvidence(report, reportPath, actorPlayerEvidence, actorPlayerPath, captureManifest);

    expect(evidence).toMatchObject({
      source: "window.__openClinXrModelVettingStudioEvidence",
      providerExecutionEnabled: false,
      scenePlacementEvidenceAllowed: false,
      runtimePromotionAllowed: false,
      productionManifestPromotionAllowed: false,
      candidateCount: 3,
      fixedCameraPresets: ["front", "side", "three_quarter"],
      videoCapturePresets: ["turntable", "viseme_timeline", "emotion_transition"],
      actorPlayerPreview: {
        source: "model_vetting_actor_player_runtime_evidence",
        evidenceUrl: actorPlayerPath,
        executionMode: "local_deterministic_non_scene",
        actorCount: 3,
        turnCount: 9,
        sampleCount: 27,
        providerExecutionPerformed: false,
        runtimeExecutionAllowed: false,
        learnerLaunchAllowed: false,
        scenePlacementEvidenceAllowed: false,
        claimBoundary: "non_scene_actor_player_preview_not_runtime_or_readiness",
      },
    });
    expect(evidence.actorPlayerPreview?.actors.map((actor) => [actor.actorId, actor.turnCount, actor.sampleCount])).toEqual([
      ["patient_maya_johnson_v1", 4, 12],
      ["parent_tara_johnson_v1", 2, 6],
      ["nurse_kevin_lee_v1", 3, 9],
    ]);
    const nurse = evidence.actorPlayerPreview?.actors.find((actor) => actor.actorId === "nurse_kevin_lee_v1");
    expect(nurse?.mediaHandoff).toMatchObject({
      speechVisemeTimelineVideoPath: "docs/openclinxr/model-vetting-captures/peds_nurse_kevin_viseme_timeline_2026-06-05.webm",
      emotionTransitionVideoPath: "docs/openclinxr/model-vetting-captures/peds_nurse_kevin_emotion_transition_2026-06-05.webm",
      gazeBlinkTurntableVideoPath: "docs/openclinxr/model-vetting-captures/peds_nurse_kevin_turntable_2026-06-05.webm",
      postureAndMaterialArtifactCount: 6,
    });
    expect(nurse?.mediaHandoff.postureAndMaterialArtifactPaths).toEqual(expect.arrayContaining([
      "docs/openclinxr/model-vetting-captures/peds_nurse_kevin_front_2026-06-05.png",
      "docs/openclinxr/model-vetting-captures/peds_nurse_kevin_emotion_transition_2026-06-05.webm",
    ]));
    expect(nurse?.roleAnimationHandoff).toMatchObject({
      roleSpecificClipNames: ["openclinxr_role_nurse_clinical_check_reassure"],
      claimScope: "deterministic_role_specific_procedural_gesture_not_mocap_or_speech2motion",
      notEvidenceFor: expect.arrayContaining(["production_asset_readiness"]),
    });
    expect(nurse?.turns[0]).toMatchObject({
      roleAnimationClipName: "openclinxr_role_nurse_clinical_check_reassure",
    });
    const patientCandidate = evidence.candidates.find((candidate) => candidate.actorId === "patient_maya_johnson_v1");
    expect(patientCandidate).toMatchObject({
      sourceKind: "real_anny_candidate_unverified",
      usesRealAnnyForwardPass: true,
    });
    const nurseCandidate = evidence.candidates.find((candidate) => candidate.actorId === "nurse_kevin_lee_v1");
    expect(nurseCandidate).toMatchObject({
      sourceKind: "real_anny_candidate_unverified",
      usesRealAnnyForwardPass: true,
    });
    expect(nurseCandidate?.roleMaterialHandoff).toMatchObject({
      wardrobeRole: "pediatric_nurse_scrubs",
      roleVisualCue: "clinical_nurse",
      clothingStyle: "teal_clinical_scrubs_with_name_badge",
      objectNames: expect.arrayContaining(["openclinxr_role_clothing_nurse_name_badge"]),
      meshRegionMaterialMode: "bounds_based_role_clothing_material_assignment",
      topFaceCount: expect.any(Number),
      lowerFaceCount: expect.any(Number),
      claimScope: "small_procedural_role_marker_not_production_costume",
      notEvidenceFor: expect.arrayContaining(["production_asset_readiness"]),
    });
    expect(nurseCandidate?.roleAnimationHandoff).toMatchObject({
      roleSpecificClipNames: ["openclinxr_role_nurse_clinical_check_reassure"],
      claimScope: "deterministic_role_specific_procedural_gesture_not_mocap_or_speech2motion",
      notEvidenceFor: expect.arrayContaining(["production_asset_readiness"]),
    });
    expect(nurseCandidate?.proceduralFaceDetailHandoff).toBeNull();
    const firstTurn = evidence.actorPlayerPreview?.actors[0]?.turns[0];
    expect(firstTurn).toMatchObject({
      turnId: "turn_1_inhaler_history",
      sceneExecutionStatus: "not_scene_executed",
      remainingBlockers: expect.arrayContaining([
        "multi_turn_sequence_not_executed_in_scene_runtime",
        "learner_runtime_not_enabled",
        "quest_runtime_not_verified",
      ]),
    });
    expect(evidence.actorPlayerPreview?.notEvidenceFor).toEqual(expect.arrayContaining([
      "real_anny_model_output",
      "b_plus_visual_realism_gate",
      "scene_placement_readiness",
      "quest_readiness",
      "production_asset_readiness",
      "learner_readiness",
      "clinical_validity",
      "scoring_validity",
    ]));
    expect(evidence.notEvidenceFor).toEqual(expect.arrayContaining([
      "b_plus_visual_realism_gate",
      "scene_placement_readiness",
      "quest_readiness",
      "production_asset_readiness",
      "learner_readiness",
      "clinical_validity",
      "scoring_validity",
    ]));
    for (const candidate of evidence.candidates) {
      expect(candidate.gateResult).toBe("blocked_before_scene");
      expect(candidate.captureSlots).toHaveLength(6);
      expect(candidate.captureSlots.every((slot) => slot.status === "captured")).toBe(true);
      expect(candidate.captureSlots.every((slot) => slot.artifactPath?.startsWith("docs/openclinxr/model-vetting-captures/"))).toBe(true);
      expect(candidate.captureSlots.every((slot) => slot.notEvidenceFor.includes("quest_readiness"))).toBe(true);
      expect(candidate.blockers).toEqual(expect.arrayContaining([
        "fixed_camera_screenshots_missing",
        "turntable_animation_video_missing",
        "morph_viseme_timeline_capture_missing",
        "emotion_transition_capture_missing",
      ]));
    }
  });
});
