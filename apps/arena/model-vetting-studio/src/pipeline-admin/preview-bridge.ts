import type { PipelineCandidate } from "@openclinxr/model-vetting";
import type { ModelVettingStudioCandidateView, ModelVettingStudioEvidence } from "../studio-state.js";

/**
 * Build a minimal ModelVettingStudioEvidence carrying just the fields the
 * three.js candidate-capture renderer reads (candidateId, actorId,
 * actorDisplayRole, sourceGlbPath, notEvidenceFor). Aesthetic preview only.
 */
export function pipelineCandidatesToStudioEvidence(
  candidates: PipelineCandidate[],
): ModelVettingStudioEvidence {
  const views: ModelVettingStudioCandidateView[] = candidates.map((candidate) => ({
    candidateId: candidate.candidateId,
    actorId: candidate.manifestId,
    actorDisplayRole: `${candidate.role} · ${candidate.manifestId}`,
    sourceGlbPath: candidate.glbPath,
    sourceKind: "generated_pipeline_candidate",
    usesRealAnnyForwardPass: false,
    roleMaterialHandoff: null,
    roleAnimationHandoff: null,
    proceduralFaceDetailHandoff: null,
    gateResult: "blocked_before_scene",
    labModeSummary: [],
    captureSlots: [],
    blockers: [],
  })) as unknown as ModelVettingStudioCandidateView[];

  return {
    source: "window.__openClinXrModelVettingStudioEvidence",
    reportUrl: "pipeline-candidate-index",
    reportSchemaVersion: "openclinxr.pipeline-candidate-index.v1",
    claimScope: "isolated_model_vetting_metadata_structural_and_lab_contract_only",
    providerExecutionEnabled: false,
    scenePlacementEvidenceAllowed: false,
    runtimePromotionAllowed: false,
    productionManifestPromotionAllowed: false,
    candidateCount: views.length,
    candidates: views,
    fixedCameraPresets: ["front", "side", "three_quarter"],
    videoCapturePresets: ["turntable", "viseme_timeline", "emotion_transition"],
    actorPlayerPreview: null,
    notEvidenceFor: [
      "clinical_validity",
      "exam_equivalence",
      "scoring",
      "learner_readiness",
    ],
  } as unknown as ModelVettingStudioEvidence;
}
