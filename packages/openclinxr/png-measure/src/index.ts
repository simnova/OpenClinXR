/**
 * General PNG measurement any consumer may use: the shared 8-bit PNG decoder and the
 * region-aware luminance reader evidence contracts grade captures with. The capture-grading
 * verdict (uniform or not) lives on `./evidence-capture`, not here.
 */

/** Decode an 8-bit non-interlaced PNG into per-pixel luminance and channels; null when undecodable. */
export { decodePng } from "./decode-png.js";
/** Decoded PNG pixels: dimensions, luminance, per-channel bytes, and the greyscale flag. */
export type { DecodedPng } from "./decode-png.js";
/** Summarise luminance over a rectangular region of an 8-bit PNG; null when undecodable. */
export { regionLuminance } from "./png-region-luminance.js";
/** Fractional rectangle selecting the measured region; defaults to the whole image. */
export type { RegionFractions } from "./png-region-luminance.js";
/** Luminance summary over a region: samples, mean, sd, non-black share, median, p90. */
export type { RegionLuminance } from "./png-region-luminance.js";
