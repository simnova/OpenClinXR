/**
 * Render-parity station entrypoint: the Blender/three.js parity capture
 * harness (moved from the evidence parity tooling, P2e).
 *
 * The reviewed surface is the thin-CLI contract (parse/run) plus preset
 * resolution through the built dist (the T4 dist gate binds resolveLevers).
 */
export { runRuntimeCapture } from "./runtime-capture.js";
export { parseCaptureArgs } from "./capture-args.js";
export { resolveLevers } from "./capture-args.js";
export type { CaptureCli } from "./capture-args.js";
