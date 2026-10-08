import {
  ACTOR_VISIBILITY_BROWSER_FUNCTION_SOURCE,
  type ActorVisibilityReading,
  type AxisAlignedBox,
  type GateOccluder,
  measureActorVisibility,
} from "./gate-geometry.js";

export type { ActorVisibilityReading, AxisAlignedBox };
export { ACTOR_VISIBILITY_BROWSER_FUNCTION_SOURCE, measureActorVisibility };
export type ActorVisibilityOccluder = GateOccluder;

export const ACTOR_VISIBILITY_METHOD =
  "camera rays to crown, chest, pelvis, left foot and right foot; visible mesh world-AABB intersections; own actor excluded; crown and chest required; lower-body samples reported only";
