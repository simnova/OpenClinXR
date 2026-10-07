/**
 * Seat problem construction (MADR 0061 mouth executor).
 *
 * The executor builds the solver's input from GLB bytes: the content hash the
 * receipt echoes plus the fixed evaluator clock the step3 capture ran against.
 * No solution is computed here; the solver plug-in answers the problem (d6).
 */
import { createHash } from "node:crypto";
import type { Problem } from "@openclinxr/station-mouth-objective";

/** Cue-track identity the solution must satisfy: the step3 fixed-capture line. */
export const STEP3_TRACK_ID = "step3-fixed-capture";
/** Fixed evaluator clock, frames per second (mouth-evaluator refuses anything else). */
export const STEP3_FRAME_RATE = 30;
/** Committed fixed-capture track frame count (docs/openclinxr/mouth-dynamics/teeth-gap/fixed-capture/metrics.json). */
export const STEP3_FRAME_COUNT = 124;

/** Options for buildProblem: the one operator-set target (mouth-tuning rung 4). */
export type BuildProblemOptions = {
  /** Rest rim-gap target, head-local mm; the committed seat uses 3.743. */
  targetGapMm: number;
};

/** Hex SHA-256 of bytes. */
export function inputHashForBytes(glbBytes: Uint8Array): string {
  return createHash("sha256").update(glbBytes).digest("hex");
}

/**
 * Build the solver input for unseated GLB bytes.
 *
 * Fail-closed on a non-positive target. The target itself travels with the
 * apply provenance (MADR 0061 d2 fields are additive; the M1 Problem shape
 * carries asset and track identity, and a later card may extend it).
 */
export function buildProblem(glbBytes: Uint8Array, options: BuildProblemOptions): Problem {
  if (!Number.isFinite(options.targetGapMm) || options.targetGapMm <= 0) {
    throw new Error(`bad targetGapMm ${options.targetGapMm}`);
  }
  return {
    inputHash: inputHashForBytes(glbBytes),
    trackId: STEP3_TRACK_ID,
    frameRate: STEP3_FRAME_RATE,
    frameCount: STEP3_FRAME_COUNT,
  };
}
