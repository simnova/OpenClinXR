/**
 * Shared mouth-seat gate thresholds (MADR 0060 d4).
 *
 * Single source for the numbers the evaluator records against and the verifier gates on.
 * Values are pinned independently by the mouth-solver test literals, which keep their own
 * copies; a change here must move those pins in the same commit.
 */

/** Rim-gap rest target, head-local mm. */
export const RIM_TARGET_MM = 6.485;

/** Rim-gap gate half-width around the target, mm. */
export const RIM_BAND_MM = 0.5;

/** Upper-arch silence bound: max head-local displacement on any viseme, mm. */
export const UPPER_DISPLACEMENT_BOUND_MM = 0.5;

/** Penetration gate: frames allowed with penetrating verts. */
export const PENETRATION_FRAMES_MAX = 0;

/** Ground-truth dy gate: absolute signed bias bound, capture-crop px. */
export const DY_GATE_BIAS_PX = 3;

/** Ground-truth dy gate: detrended tracking-shape median bound, capture-crop px. */
export const DY_GATE_DETRENDED_MEDIAN_PX = 2;

/** Ground-truth dy gate: blowout bound on max absolute error, capture-crop px. */
export const DY_GATE_MAX_PX = 5;
