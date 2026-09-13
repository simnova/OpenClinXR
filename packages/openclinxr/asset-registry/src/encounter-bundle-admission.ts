/** Public subpath entry: keep-only re-exports. Implementation: ./encounter-bundle-admission-mod.js */

export {
  publishFrozenScenePlanAdmission,
  restoreWallAnchorsMovedByGeneratedRoom,
} from "./encounter-bundle-admission-geometry-mod.js";
export {
  admitFrozenScenePlan,
  admitFrozenScenePlanForObservedScene,
  carriedAcceptedScenePlan,
  inspectBundleEligibility,
  inspectPinnedBundleIdentity,
  type ScenePlanAdmission,
  stationIdForSceneClosureScenario,
  verifyCommittedScenePlanAgainstDisk,
} from "./encounter-bundle-admission-mod.js";
