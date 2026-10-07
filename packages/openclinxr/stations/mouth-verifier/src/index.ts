/**
 * Shared mouth-station verifier: headless scene posing, runtime drive, capture
 * projection, premise probe and the ground-truth dy gate.
 *
 * The verifier measures the seated asset against the step3 fixed capture and
 * gates the projection; it imports measures and thresholds from the objective
 * only, never the executor or a solver [inv:R2][MADR 0061 role rules].
 */

export { evaluate } from "./evaluator.js";
export { headFocusCamera, loadHeadlessScene } from "./headless-scene.js";
export type { HeadFocusCamera, HeadlessMesh, HeadlessScene } from "./headless-scene.js";
export { DY_GATE_RULE, assertGroundTruthDyGate } from "./gates.js";
export { probePremise } from "./probe.js";
export { readEvaluatorTrack } from "./track.js";
export type { EvaluatorTrack } from "./track.js";
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
} from "./verifier-types.js";
