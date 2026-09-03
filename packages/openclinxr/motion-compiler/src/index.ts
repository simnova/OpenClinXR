export * from "./canonical-motion-contract.js";
export * from "./compile-motion-program.js";
export type { DerivedSkeletonProfile } from "./derive-skeleton-profile.js";
// The compiler-surface contract (clause 1) makes the package root the surface a bake-off consumer
// reaches through: a primitive registry, and the derivers that build the SkeletonProfile every
// body primitive requires. derive-skeleton-profile and region-anchors both declare `Vec3`/`Quat`
// structurally, so the re-exports are named rather than `export *`.
export { deriveSkeletonProfileFromRigAsset } from "./derive-skeleton-profile.js";
export * from "./deterministic-scenario-motion-planner.js";
// The M3 motion-evidence aggregator declares its own tuple `Vec3` (the sibling derivers' Vec3 is an
// object shape), so these re-exports are named rather than `export *` - same rule as above.
export type {
  DeclaredContact,
  EffectorKey,
  GateResult,
  GateVerdict,
  MotionClipFixture,
  MotionEvidenceReport,
  MotionGateId,
  MotionGateSpec,
  MotionVerdict,
} from "./evidence/motion-evidence.js";
export { combineMotionVerdict, MOTION_GATE_IDS, runMotionEvidenceGates } from "./evidence/motion-evidence.js";
export * from "./motion-body-region.js";
export * from "./motion-program.js";
export * from "./primitive-registry.js";
export * from "./program/compile-scenario-motion.js";
export type { ProducedProfile, RigAsset } from "./regions/region-anchors.js";
export { deriveSkeletonProfile } from "./regions/region-anchors.js";
