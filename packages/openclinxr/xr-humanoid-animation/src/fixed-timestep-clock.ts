/** Public subpath entry: keep-only re-exports. Implementation: ./fixed-timestep-clock-mod.js */

export {
  clampFrameDtSeconds,
  consumeFrameTime,
  contactAtClipTime,
  createFixedClockFrameState,
  createFixedTimestepClock,
  FIXED_SUBSTEP_SECONDS,
  interpolateSimScalar,
  isSingleSupportContact,
  MAX_SUBSTEPS_PER_FRAME,
  stepFixedClockFrame,
  substepsForSchedule,
} from "./fixed-timestep-clock-mod.js";
