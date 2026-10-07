/**
 * Thin re-export: the mouth verifier implementation lives in
 * @openclinxr/station-mouth-verifier (MADR 0061 verifier). This module stays so
 * existing tool imports keep working; the S0 counterweight
 * the-evaluator-output-is-unchanged pins the output bytes through it.
 */
export {
  DY_GATE_RULE,
  assertGroundTruthDyGate,
  evaluate,
  headFocusCamera,
  loadHeadlessScene,
  probePremise,
  readEvaluatorTrack,
} from "@openclinxr/station-mouth-verifier";
export type {
  CueTrackCue,
  EvaluateParams,
  EvaluatorOutput,
  EvaluatorSummary,
  EvaluatorTrack,
  FrameRecord,
  HeadFocusCamera,
  HeadlessMesh,
  HeadlessScene,
  NowGapPoint,
  PositionSpace,
  PremiseProbeRow,
  ToothSample,
} from "@openclinxr/station-mouth-verifier";
