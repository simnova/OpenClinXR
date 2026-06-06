import { describe, expect, it } from "vitest";
import {
  buildModelVettingReportFromAnnyPreflight,
  validateModelVettingReport,
  type AnnyLikePreflightReport,
  type ModelVettingCaptureArtifacts,
} from "./index.js";

const completeCaptureArtifacts: ModelVettingCaptureArtifacts = {
  fixedCameraScreenshots: [
    "docs/openclinxr/model-vetting/evidence/peds-child-front.png",
    "docs/openclinxr/model-vetting/evidence/peds-child-side.png",
    "docs/openclinxr/model-vetting/evidence/peds-child-three-quarter.png",
  ],
  turntableVideo: "docs/openclinxr/model-vetting/evidence/peds-child-turntable.webm",
  morphVisemeTimelineCapture: "docs/openclinxr/model-vetting/evidence/peds-child-viseme.webm",
  emotionTransitionCapture: "docs/openclinxr/model-vetting/evidence/peds-child-emotion.webm",
};

const baseCandidate = {
  candidateId: "peds_patient_child_anny_compatible_candidate",
  scenarioId: "peds_asthma_parent_anxiety_v1",
  actorMapping: {
    actorId: "patient_maya_johnson_v1",
    actorRole: "patient",
    actorDisplayRole: "school-age pediatric asthma patient",
    reuseKey: "peds_asthma_parent_anxiety_v1:patient_maya_johnson_v1:patient:anny_candidate",
  },
  paths: {
    sourceGlbPath: "apps/ui-xr/public/generated-humanoids/peds_patient_child.glb",
    provenancePath: "apps/ui-xr/public/generated-humanoids/peds_patient_child.provenance.json",
  },
  provenance: {
    documentSha256: "a".repeat(64),
    sourceOriginChainPresent: true,
    licenseChainPresent: true,
    derivativeLineagePresent: true,
    toolVersionPresent: true,
    promptOrCaseParameterHashPresent: true,
    notEvidenceFor: [
      "real_anny_model_output",
      "b_plus_visual_realism_gate",
      "production_asset_readiness",
      "quest_readiness",
      "learner_readiness",
      "clinical_validity",
      "scoring_validity",
    ],
  },
  glb: {
    byteLength: 1200000,
    sha256: "b".repeat(64),
    sceneCount: 1,
    nodeCount: 30,
    meshCount: 1,
    materialCount: 3,
    skinCount: 1,
    animationCount: 4,
    morphTargetPrimitiveCount: 1,
    vertexCount: 7200,
    clinicalIdlePoseClipCount: 3,
  },
  rigControlEvidence: {
    canonicalSkeletonNodesPresent: true,
    faceRigNodesPresent: true,
    gazeEyeNodesPresent: true,
    blinkControlPresent: true,
    requiredMorphTargetsPresent: true,
    requiredMorphTargets: [
      "openclinxr_mouth_open",
      "openclinxr_brow_concern",
      "openclinxr_cheek_tension",
    ],
    missingMorphTargets: [],
    observedMorphTargets: [
      "openclinxr_mouth_open",
      "openclinxr_brow_concern",
      "openclinxr_cheek_tension",
    ],
    locomotionPostureClipPresent: true,
  },
  status: "ready_for_webxr_visual_evidence",
  blockers: [],
  nextEvidenceRequired: [
    "license_provenance_chain_review_with_source_origin_derivative_lineage_and_document_hash",
    "canonical_rig_expression_gaze_blink_and_locomotion_clip_evidence",
  ],
} satisfies AnnyLikePreflightReport["candidates"][number];

function sourceReport(candidate: AnnyLikePreflightReport["candidates"][number] = baseCandidate): AnnyLikePreflightReport {
  return {
    schemaVersion: "openclinxr.anny-candidate-preflight.v1",
    generatedAt: "2026-06-05T12:00:00.000Z",
    candidates: [candidate],
  };
}

describe("model vetting arena package", () => {
  it("builds an isolated lab report without runtime or production promotion", () => {
    const candidate = {
      ...baseCandidate,
      captureArtifacts: completeCaptureArtifacts,
    } satisfies AnnyLikePreflightReport["candidates"][number];
    const report = buildModelVettingReportFromAnnyPreflight({
      generatedAt: "2026-06-05T13:00:00.000Z",
      sourceReport: sourceReport(candidate),
    });

    expect(report).toMatchObject({
      schemaVersion: "openclinxr.model-vetting-report.v1",
      claimScope: "isolated_model_vetting_metadata_structural_and_lab_contract_only",
      providerBoundary: {
        providerId: "anny_local_or_anny_compatible_import",
        policyMode: "local_metadata_only",
        approvalStatus: "not_required_for_metadata_only",
        localOnly: true,
        providerExecutionEnabled: false,
        externalNetworkUsed: false,
        paidApiUsed: false,
        credentialsRequired: false,
      },
      decision: {
        status: "ready_for_scene_placement_evidence",
        isolatedLabCaptureComplete: true,
        scenePlacementEvidenceAllowed: true,
        runtimePromotionAllowed: false,
        productionManifestPromotionAllowed: false,
      },
    });
    expect(report.candidates[0]?.gateResult).toBe("ready_for_scene_placement_evidence");
    expect(report.candidates[0]?.labModes.map((mode) => mode.modeId)).toEqual([
      "static_model_inspection",
      "rig_inspection",
      "morph_phoneme_inspection",
      "animation_clip_inspection",
      "material_realism_inspection",
      "optimization_inspection",
    ]);
    expect(report.candidates[0]?.labModes.every((mode) => Array.isArray(mode.requiredArtifactKinds))).toBe(true);
    expect(report.candidates[0]?.captureArtifacts.fixedCameraScreenshots).toHaveLength(3);
    expect(report.candidates[0]?.falseGates).toEqual({
      realAnny: false,
      bPlusRealism: false,
      scenePlacementReadiness: false,
      questReadiness: false,
      productionReadiness: false,
      learnerReadiness: false,
      clinicalValidity: false,
      scoringValidity: false,
    });
    expect(report.notEvidenceFor).toContain("quest_readiness");
    expect(report.notEvidenceFor).toContain("clinical_validity");
    expect(validateModelVettingReport(report)).toEqual({ ok: true });
  });

  it("blocks scene placement until isolated lab capture artifacts exist", () => {
    const report = buildModelVettingReportFromAnnyPreflight({
      generatedAt: "2026-06-05T13:00:00.000Z",
      sourceReport: sourceReport(),
    });

    expect(report.decision).toMatchObject({
      status: "blocked_before_scene",
      isolatedLabCaptureComplete: false,
      scenePlacementEvidenceAllowed: false,
      runtimePromotionAllowed: false,
      productionManifestPromotionAllowed: false,
    });
    expect(report.candidates[0]?.gateResult).toBe("blocked_before_scene");
    expect(report.candidates[0]?.blockers).toEqual(expect.arrayContaining([
      "fixed_camera_screenshots_missing",
      "material_fixed_camera_screenshots_missing",
      "morph_viseme_timeline_capture_missing",
      "emotion_transition_capture_missing",
      "turntable_animation_video_missing",
    ]));
    expect(validateModelVettingReport(report)).toEqual({ ok: true });
  });

  it("blocks scene placement when isolated lab modes fail", () => {
    const blocked = {
      ...baseCandidate,
      captureArtifacts: completeCaptureArtifacts,
      glb: {
        ...baseCandidate.glb,
        skinCount: 0,
      },
      rigControlEvidence: {
        ...baseCandidate.rigControlEvidence,
        canonicalSkeletonNodesPresent: false,
      },
      status: "ready_for_webxr_visual_evidence",
    } satisfies AnnyLikePreflightReport["candidates"][number];

    const report = buildModelVettingReportFromAnnyPreflight({ sourceReport: sourceReport(blocked) });

    expect(report.decision).toMatchObject({
      status: "blocked_before_scene",
      scenePlacementEvidenceAllowed: false,
      runtimePromotionAllowed: false,
    });
    expect(report.candidates[0]?.gateResult).toBe("blocked_before_scene");
    expect(report.candidates[0]?.blockers).toEqual(expect.arrayContaining([
      "skin_missing",
      "canonical_skeleton_nodes_missing",
    ]));
    expect(validateModelVettingReport(report)).toEqual({ ok: true });
  });

  it("rejects reports that weaken provider or false-readiness gates", () => {
    const report = buildModelVettingReportFromAnnyPreflight({ sourceReport: sourceReport() });
    report.providerBoundary.providerExecutionEnabled = true as never;
    report.candidates[0]!.falseGates.questReadiness = true as never;
    report.decision.runtimePromotionAllowed = true as never;
    report.notEvidenceFor = report.notEvidenceFor.filter((gate) => gate !== "clinical_validity") as never;

    expect(validateModelVettingReport(report)).toEqual({
      ok: false,
      errors: expect.arrayContaining([
        "/providerBoundary/providerExecutionEnabled must be false",
        "/candidates/0/falseGates/questReadiness must be false",
        "/decision/runtimePromotionAllowed must be false",
        "/notEvidenceFor must include clinical_validity",
      ]),
    });
  });
});
