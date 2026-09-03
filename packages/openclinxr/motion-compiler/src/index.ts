export * from "./canonical-motion-contract.js";
export * from "./motion-program.js";
export * from "./motion-body-region.js";
export * from "./deterministic-scenario-motion-planner.js";
export * from "./program/compile-scenario-motion.js";
export * from "./compile-motion-program.js";
export * from "./primitive-registry.js";

// The compiler-surface contract (clause 1) makes the package root the surface a bake-off consumer
// reaches through: a primitive registry, and the derivers that build the SkeletonProfile every
// body primitive requires. derive-skeleton-profile and region-anchors both declare `Vec3`/`Quat`
// structurally, so the re-exports are named rather than `export *`.
export { deriveSkeletonProfileFromRigAsset } from "./derive-skeleton-profile.js";
export type { DerivedSkeletonProfile } from "./derive-skeleton-profile.js";
export { deriveSkeletonProfile } from "./regions/region-anchors.js";
export type { ProducedProfile, RigAsset } from "./regions/region-anchors.js";
