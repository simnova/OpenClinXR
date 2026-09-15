/** Deterministic motion planner entry, documented in docs/openclinxr/motion-dsl-consumer-path-2026-09-02.md. */
export { planMotionProgram } from "./deterministic-scenario-motion-planner.js";
export type { ScenarioMotionCompileInput } from "./deterministic-scenario-motion-planner.js";

/** Motion GLB bake entry — deterministic GLB with exact clip identity. */
export { bakeMotionProgramToGlb, readMotionGlbClipId } from "./motion-glb-bake.js";
export type { MotionGlbBakeClip } from "./motion-glb-bake.js";
