/**
 * Re-export shim: the decoder moved to `@openclinxr/png-measure` (st-png-measure).
 * Root importers stay unchanged; new code imports the package by name.
 */

/** Decode an 8-bit non-interlaced PNG into per-pixel luminance and channels; null when undecodable. */
export { decodePng } from "@openclinxr/png-measure";
/** Decoded PNG pixels: dimensions, luminance, per-channel bytes, and the greyscale flag. */
export type { DecodedPng } from "@openclinxr/png-measure";
