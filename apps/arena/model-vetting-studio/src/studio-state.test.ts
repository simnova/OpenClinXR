import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { buildModelVettingStudioEvidence, optionalJsonFromResponse } from "./studio-state.js";

describe("model vetting studio state", () => {
  it("builds deterministic capture evidence from the current peds report without weakening gates", async () => {
    const reportPath = "docs/openclinxr/anny-skin-track-a-mit-pbr-model-vetting-report-peds-asthma-parent-anxiety-2026-06-06.json";
    const reportFsPath = process.cwd().endsWith(path.join("apps", "arena", "model-vetting-studio"))
      ? path.join("..", "..", "..", reportPath)
      : reportPath;
    const report = JSON.parse(await readFile(reportFsPath, "utf8")) as unknown;
    const captureManifestPath = "docs/openclinxr/anny-skin-track-a-mit-pbr-capture-manifest-peds-asthma-parent-anxiety-2026-06-06.json";
    const captureManifestFsPath = process.cwd().endsWith(path.join("apps", "arena", "model-vetting-studio"))
      ? path.join("..", "..", "..", captureManifestPath)
      : captureManifestPath;
    const captureManifest = JSON.parse(await readFile(captureManifestFsPath, "utf8")) as unknown;
    const evidence = buildModelVettingStudioEvidence(report, reportPath, null, undefined, captureManifest);

    expect(evidence).toMatchObject({
      source: "window.__openClinXrModelVettingStudioEvidence",
      providerExecutionEnabled: false,
      scenePlacementEvidenceAllowed: false,
      runtimePromotionAllowed: false,
      productionManifestPromotionAllowed: false,
      candidateCount: 3,
      fixedCameraPresets: ["front", "side", "three_quarter"],
      videoCapturePresets: ["turntable", "viseme_timeline", "emotion_transition"],
      actorPlayerPreview: null,
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
      expect(candidate.captureSlots.filter((slot) => slot.status === "captured")).toHaveLength(3);
      expect(candidate.captureSlots.filter((slot) => slot.status === "missing")).toHaveLength(3);
      expect(candidate.captureSlots.every((slot) => slot.notEvidenceFor.includes("quest_readiness"))).toBe(true);
      expect(candidate.blockers).toEqual(expect.arrayContaining([
        "turntable_animation_video_missing",
        "morph_viseme_timeline_capture_missing",
        "emotion_transition_capture_missing",
      ]));
    }
  });

  it("treats optional Vite HTML fallback sidecars as absent", async () => {
    const response = new Response("<!doctype html><title>fallback</title>", {
      status: 200,
      headers: { "content-type": "text/html" },
    });

    await expect(optionalJsonFromResponse(response)).resolves.toBeNull();
  });
});
