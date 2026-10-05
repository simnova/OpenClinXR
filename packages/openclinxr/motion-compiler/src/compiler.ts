/**
 * Public motion compiler subpath: canonical compile entry and skeleton profile.
 *
 * Narrow re-export — only the symbols real consumers bind.
 */
export type { CompiledMotionClipV1 } from "./compile-motion-program.js";
export { compileMotionProgram } from "./compile-motion-program.js";
export { deriveSkeletonProfileFromRigAsset } from "./derive-skeleton-profile.js";
