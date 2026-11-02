/**
 * Public evidence-capture subpath: the capture-grading verdict used by evidence tests
 * (class "evidence"). General PNG measurement lives on "."; apps and tools keep
 * their own entrypoints.
 */

/** Classify a capture PNG as uniform (rendered nothing) or not; null means undetermined. */
export { classifyCaptureFrame } from "./png-region-luminance.js";
/** The uniform/not-uniform verdict plus the viewport sd and non-black share behind it. */
export type { CaptureFrameClass } from "./png-region-luminance.js";
/** Viewport-luminance-sd ceiling at or below which a frame counts as uniform. */
export { UNIFORM_SD_CEILING } from "./png-region-luminance.js";
