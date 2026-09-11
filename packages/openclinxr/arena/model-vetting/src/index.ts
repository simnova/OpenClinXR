/**
 * Public interface of @openclinxr/model-vetting.
 *
 * Named lists, not `export *`. A star republishes a module wholesale, so a symbol added inside
 * becomes public with nobody deciding it should be.
 */

export type {
  CagematchFeasibilityCriterion,
  CagematchReportPage,
  CagematchReportRegistry,
  VisemeTimeline,
} from "./logic.js";
export {
  applyMorphTargetEmotionCue,
  applyMorphTargetVisemeCue,
  batchScorePipelineIndex,
  buildModelVettingReportFromAnnyPreflight,
  buildPedsAsthmaPatientEmotionTransitionTimeline,
  buildPromotionRecord,
  buildVisemeTimelineFromDialogue,
  diffPipelineCandidates,
  emotionWeightsAtTimelineProgress,
  PEDS_ASTHMA_PATIENT_VISeme_DIALOGUE_UTTERANCE,
  validateCagematchReportPage,
  validateCagematchReportRegistry,
  validateModelVettingReport,
  validatePipelineCandidateIndex,
  visemeAtTimelineProgress,
} from "./logic.js";
export type {
  PipelineCandidate,
  PipelineCandidateDiff,
  PipelineCandidateIndex,
  PromotionRecord,
} from "./pipeline-candidate.js";
export type {
  AnnyLikePreflightReport,
  ModelVettingCandidate,
  ModelVettingCaptureArtifacts,
  ModelVettingReport,
} from "./types.js";

