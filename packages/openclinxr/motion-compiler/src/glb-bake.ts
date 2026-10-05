/**
 * Public motion GLB bake subpath: deterministic GLB with exact clip identity.
 *
 * Narrow re-export — only the symbols real consumers bind. readMotionGlb
 * and its auxiliary types stay internal to the bake module.
 */
export { bakeMotionProgramToGlb, readMotionGlbClipId } from "./motion-glb-bake.js";
export type { MotionGlbBakeClip } from "./motion-glb-bake.js";
