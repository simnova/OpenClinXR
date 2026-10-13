/** Public subpath entry: keep-only re-exports. Implementation: ./bedside-approach-execution-mod.js */

export {
  type BedsideApproachExecution,
  SETTLING_FADE_SETTLE_SECONDS,
  SETTLING_LEG_WEIGHT_TARGET,
  stepBedsideApproachExecution,
  travelYawForClipForward,
} from "./bedside-approach-execution-mod.js";

export { beginBedsideApproachExecution } from "./bedside-approach-begin-mod.js";

export {
  type StopClipTrigger,
  buildDistanceCurve,
  distanceCurveInverseS,
  sampleStopRootTrackXZ,
} from "./bedside-approach-stop-mod.js";
