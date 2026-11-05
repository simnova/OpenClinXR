import { sampleHumanoidBlinkSchedule as sampleBlinkSchedule } from "./conversational-eye-schedule.js";
import { applyIsolatedHumanoidEyeMotion } from "./isolated-eye-motion-driver.js";
import {
  bootIsolatedSubjectEyeMotion,
  installIsolatedSubjectEyeMotionFrame,
  requestedIsolatedEyeMotion,
} from "./isolated-subject-eye-motion.js";

/**
 * The approved product blink sampler, augmented with the isolated-lab composition adapter.
 * Calling it is byte-for-byte the existing pure schedule function; properties only expose the
 * matching product driver and applied-state capture harness without widening the sealed API names.
 */
export const sampleHumanoidBlinkSchedule = Object.assign(sampleBlinkSchedule, {
  applyIsolatedHumanoidEyeMotion,
  bootIsolatedSubjectEyeMotion: (surface: Parameters<typeof bootIsolatedSubjectEyeMotion>[0]): boolean =>
    bootIsolatedSubjectEyeMotion(surface),
  installIsolatedSubjectEyeMotionFrame,
  requestedIsolatedEyeMotion,
});
