/**
 * Public subpath entry: keep-only re-exports.
 * Implementation: ./case-owned-approach-runtime-mod.js (construction) and
 * ./case-owned-approach-frame-mod.js (per-frame stepping, split out for its file-size budget).
 */

export {
  type CaseOwnedApproachFrame,
  createCaseOwnedBedsideApproach,
  measureStanceGroundAdvance,
} from "./case-owned-approach-runtime-mod.js";
export {
  advanceCaseOwnedBedsideApproach,
  applyCaseOwnedStanceLock,
  sampleLocomotionStanceTrack,
} from "./case-owned-approach-frame-mod.js";
