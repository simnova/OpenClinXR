/**
 * Sidecar-test subpath: the PNG measurement the station evidence sidecars bind (class
 * "package"). The tools/openclinxr/evidence re-export shims bind "." (class "evidence"),
 * so each entrypoint serves one consumer class (precedent: xr-dialogue "./evidence-viseme").
 */

/** Decode an 8-bit non-interlaced PNG into per-pixel luminance and channels; null when undecodable. */
export { decodePng } from "./decode-png.js";
/** Summarise luminance over a rectangular region of an 8-bit PNG; null when undecodable. */
export { regionLuminance } from "./png-region-luminance.js";
