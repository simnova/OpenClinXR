/** Deterministic motion planner entry, documented in docs/openclinxr/motion-dsl-consumer-path-2026-09-02.md. */

export type { CompiledMotionClipV1 } from "./compile-motion-program.js";
/**
 * Canonical compile entry + loaded-actor skeleton profile (MSC-C1 gateway path).
 * Pending final independent API review — not already approved. Existing five
 * symbols above remain.
 */
export { compileMotionProgram } from "./compile-motion-program.js";
export { deriveSkeletonProfileFromRigAsset } from "./derive-skeleton-profile.js";
export type { ScenarioMotionCompileInput } from "./deterministic-scenario-motion-planner.js";
export { planMotionProgram } from "./deterministic-scenario-motion-planner.js";
export type { MotionGlbBakeClip } from "./motion-glb-bake.js";
/** Motion GLB bake entry — deterministic GLB with exact clip identity. */
export { bakeMotionProgramToGlb, readMotionGlbClipId } from "./motion-glb-bake.js";
