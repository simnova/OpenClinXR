/**
 * Whole-face regression module (card tsk_0e618fa5e9ac3e15).
 *
 * One place that re-renders the face station's actual output for every case in
 * case-inputs.json and compares it with the last accepted whole-face state, so a
 * change made for one region cannot silently move a region no card named.
 *
 * Regions are measured ONLY by src/regions.py (single implementation, driven
 * through mise); the TypeScript surface below is types, the pure decision, the
 * sheet composer, promotion and the render wiring.
 *
 * The STEP 2 RED contract imports only from here; the implementations live in
 * the sibling modules and this file is their public surface.
 */
export type { Landmark } from "./regions.js";
export type { RegionBounds, RegionMetric } from "./metrics.js";
export { evaluateFaceRegression, summarizeCheckResults } from "./check.js";
export type { CaseCheckResult, CheckVerdict, RegionThreshold, RegionVerdict } from "./check.js";
export { promoteGolden } from "./promote.js";
export type { PromoteResult } from "./promote.js";
export {
  pickLatestCompletedRun,
  renderCase,
  resolveCaseRenderInputs,
  resolveCaseRun,
  sha256File,
  verifyInputShas,
  writeCaseVariant,
  CAPTURE_TOOL,
} from "./render.js";
export type { CaseRenderInputs, CaseRunReport, CaseRunResolution, RenderOutcome, RunRecord, ShaCheck } from "./render.js";
export { writeRegionSheet } from "./sheets.js";
export { deriveMaxDE, deriveMinSsimL, thresholdsFromCalibration } from "./thresholds.js";
export type { Calibration, MetricThreshold } from "./thresholds.js";
