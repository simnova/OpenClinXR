/**
 * Re-export shim: region luminance moved to `@openclinxr/png-measure` (st-png-measure).
 * Root importers stay unchanged; new code imports the package by name. General measurement
 * binds "."; the capture-grading verdict binds "./evidence-capture".
 */

/** Summarise luminance over a rectangular region of an 8-bit PNG; null when undecodable. */
export { regionLuminance } from "@openclinxr/png-measure";
/** Fractional rectangle selecting the measured region; defaults to the whole image. */
export type { RegionFractions } from "@openclinxr/png-measure";
/** Luminance summary over a region: samples, mean, sd, non-black share, median, p90. */
export type { RegionLuminance } from "@openclinxr/png-measure";
/** Classify a capture PNG as uniform (rendered nothing) or not; null means undetermined. */
export { classifyCaptureFrame } from "@openclinxr/png-measure/evidence-capture";
/** The uniform/not-uniform verdict plus the viewport sd and non-black share behind it. */
export type { CaptureFrameClass } from "@openclinxr/png-measure/evidence-capture";
/** Viewport-luminance-sd ceiling at or below which a frame counts as uniform. */
export { UNIFORM_SD_CEILING } from "@openclinxr/png-measure/evidence-capture";
