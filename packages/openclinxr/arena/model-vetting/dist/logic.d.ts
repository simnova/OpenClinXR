import type { ModelVettingReport, AnnyLikePreflightReport } from "./types.js";
export declare function buildModelVettingReportFromAnnyPreflight(input: {
    generatedAt?: string;
    sourceReport: AnnyLikePreflightReport;
}): ModelVettingReport;
export declare function validateModelVettingReport(value: unknown): {
    ok: true;
} | {
    ok: false;
    errors: string[];
};
export type { CagematchDecisionBranch, CagematchFeasibilityCriterion, CagematchProcessExplanation, CagematchReportMedia, CagematchReportPage, CagematchReportRegistry, CagematchTechnologyId, } from "./cagematch-report.js";
export { validateCagematchReportPage, validateCagematchReportRegistry } from "./cagematch-report.js";
export { PEDS_ASTHMA_PATIENT_VISeme_DIALOGUE_UTTERANCE, applyMorphTargetVisemeCue, buildVisemeTimelineFromDialogue, humanoidDialogueDurationMs, phonemeSequenceForDialogue, visemeAtTimelineProgress, visemeForPhoneme, visemeOpenness, } from "./viseme-timeline.js";
export type { MorphTargetVisemeCueEvidence, VisemeTimeline, VisemeTimelineMappingMode } from "./viseme-timeline.js";
export { applyMorphTargetEmotionCue, buildPedsAsthmaPatientEmotionTransitionTimeline, emotionWeightsAtTimelineProgress, expressionWeightsForEmotion, } from "./emotion-transition.js";
export type { EmotionTransitionMappingMode, EmotionTransitionTimeline, HumanoidExpressionEmotion, HumanoidExpressionWeights, MorphTargetEmotionCueEvidence, } from "./emotion-transition.js";
export { batchScorePipelineIndex, buildCandidateId, buildPipelineCandidateIndex, buildPromotionRecord, cagematchDeployTargetForManifest, deployTargetForManifest, deployTargetsForManifest, deriveCandidateRole, deriveManifestId, diffPipelineCandidates, joinPromotionStatus, joinVisionScore, numericDelta, PIPELINE_CANDIDATE_INDEX_CLAIM_SCOPE, PIPELINE_CANDIDATE_INDEX_SCHEMA_VERSION, PIPELINE_CANDIDATE_NOT_EVIDENCE_FOR, PIPELINE_CANDIDATE_PROMOTION_CLAIM_SCOPE, PIPELINE_CANDIDATE_PROMOTION_SCHEMA_VERSION, summarizeRigging, validatePipelineCandidateIndex, } from "./pipeline-candidate.js";
//# sourceMappingURL=logic.d.ts.map