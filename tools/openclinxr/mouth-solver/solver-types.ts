/**
 * Thin re-export: verifier types live in @openclinxr/station-mouth-verifier
 * (MADR 0061 verifier). Kept so existing tool imports keep resolving.
 */
export type {
  CueTrackCue,
  EvaluateParams,
  EvaluatorOutput,
  EvaluatorSummary,
  FrameRecord,
  NowGapPoint,
  PositionSpace,
  PremiseProbeRow,
  ToothSample,
} from "@openclinxr/station-mouth-verifier";
