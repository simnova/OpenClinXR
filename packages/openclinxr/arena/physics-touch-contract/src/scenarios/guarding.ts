/**
 * Guarding scenario — scripted palpation trajectory with guarding threshold events.
 *
 * Simulates a clinician palpating an abdominal region and encountering
 * voluntary muscle guarding (patient tenses abdominal wall in response to pain).
 *
 * Trajectory: approach → palpate with increasing force → guarding threshold
 * exceeded → clinician reduces force → re-test → withdraw.
 *
 * Fully deterministic: same params → same log → same C6 checksums.
 *
 * Case-def shaped (not clinical scoring):
 *   - contactRegionId tracks which quadrant is being palpated
 *   - pinchStrength ramps from 0 to forcePeak
 *   - GuardingThresholdEvent emitted when pinchStrength exceeds guardingThreshold
 *     and a guarding flag activates, modulating subsequent force.
 */

import type { InputLog, PhysicsTickInput } from "../types.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * Guarding threshold event — emitted when palpation force exceeds a threshold
 * and the simulator activates guarding resistance.
 */
export type GuardingThresholdEvent = {
  /** The tick at which guarding was triggered. */
  tick: number;
  /** The contact region where guarding occurred. */
  region: string;
  /** The palpation force level that triggered guarding. */
  force: number;
  /** A case-def emotion event identifier for linking to the emotion timeline. */
  emotionEventId: string;
};

/**
 * Configuration for building a guarding input log.
 */
export type GuardingConfig = {
  /** Total number of ticks (≥ 1). */
  ticks: number;
  /** Hand to use for palpation. */
  handedness: "left" | "right";
  /** Contact region being palpated (e.g. "abdomen_rlq"). */
  contactRegionId: string;
  /** Target position for palpation in world space. */
  targetPosition: { x: number; y: number; z: number };
  /** Duration in ticks to approach the palpation site. */
  approachTicks: number;
  /** Duration in ticks of initial light palpation (ramp to low force). */
  lightPalpationTicks: number;
  /** Duration in ticks of deep palpation (ramp to peak force). */
  deepPalpationTicks: number;
  /** Peak force level (0-1) for deep palpation. */
  forcePeak: number;
  /** Force threshold (0-1) above which guarding is triggered. */
  guardingThreshold: number;
  /** Base string for emotion event IDs (e.g. "guard_rlq"). */
  emotionEventPrefix: string;
  /** Duration in ticks after guarding to hold reduced pressure. */
  postGuardDwellTicks: number;
  /** Duration in ticks to withdraw. */
  releaseTicks: number;
};

/**
 * Default guarding config: right-hand palpation of RLQ with clear guarding.
 *
 * Scaled for a 360-tick (~6 s at 60 Hz) encounter segment.
 * Guarding triggers at force 0.45 during deep palpation.
 */
export const DEFAULT_GUARDING_CONFIG: GuardingConfig = {
  ticks: 360,
  handedness: "right",
  contactRegionId: "abdomen_rlq",
  targetPosition: { x: 0.12, y: 0.42, z: 0.32 },
  approachTicks: 30,
  lightPalpationTicks: 40,
  deepPalpationTicks: 60,
  forcePeak: 0.7,
  guardingThreshold: 0.45,
  emotionEventPrefix: "guard_rlq",
  postGuardDwellTicks: 40,
  releaseTicks: 25,
};

// ---------------------------------------------------------------------------
// Builder
// ---------------------------------------------------------------------------

/**
 * Linear interpolate between two vec3 values.
 */
function lerpVec3(
  a: { x: number; y: number; z: number },
  b: { x: number; y: number; z: number },
  t: number,
): { x: number; y: number; z: number } {
  return {
    x: a.x + (b.x - a.x) * t,
    y: a.y + (b.y - a.y) * t,
    z: a.z + (b.z - a.z) * t,
  };
}

/**
 * Build a deterministic guarding input log.
 *
 * Phases:
 *   1. Approach: hand moves from rest to palpation target
 *   2. Light palpation: shallow force, no guarding expected
 *   3. Deep palpation: force ramps up; triggers guardingThreshold event
 *   4. Post-guard dwell: reduced force at site after guarding response
 *   5. Release: withdraw hand to rest
 *   6. Idle: remaining ticks
 *
 * Returns both the InputLog and the list of GuardingThresholdEvents
 * for integration with the emotion timeline.
 */
export function buildGuardingInputLog(
  config: GuardingConfig,
): { log: InputLog; guardEvents: GuardingThresholdEvent[] } {
  const {
    ticks,
    handedness,
    contactRegionId,
    targetPosition,
    approachTicks,
    lightPalpationTicks,
    deepPalpationTicks,
    forcePeak,
    guardingThreshold,
    emotionEventPrefix,
    postGuardDwellTicks,
    releaseTicks,
  } = config;

  const entries: PhysicsTickInput[] = [];
  const guardEvents: GuardingThresholdEvent[] = [];
  let guardingTriggered = false;
  let guardEventCount = 0;

  // Rest position
  const restPos = { x: 0.35, y: 0.75, z: 0.45 };
  const restRotation = { x: 0, y: 0, z: 0, w: 1 };
  let currentPos = { x: restPos.x, y: restPos.y, z: restPos.z };
  let globalTick = 0;

  // Phase 1: Approach
  for (let t = 0; t < approachTicks && globalTick <= ticks; t++) {
    const progress = (t + 1) / approachTicks;
    currentPos = lerpVec3(restPos, targetPosition, progress);
    entries.push(buildGuardTickInput(globalTick, handedness, currentPos, restRotation, 0, null));
    globalTick++;
  }

  // Phase 2: Light palpation — ramp to ~30% of peak
  for (let t = 0; t < lightPalpationTicks && globalTick <= ticks; t++) {
    const progress = (t + 1) / lightPalpationTicks;
    const force = forcePeak * 0.3 * progress;
    entries.push(buildGuardTickInput(globalTick, handedness, targetPosition, restRotation, force, contactRegionId));
    globalTick++;
  }

  // Phase 3: Deep palpation — ramp from light force to peak force
  // Guarding triggers when force crosses guardingThreshold
  for (let t = 0; t < deepPalpationTicks && globalTick <= ticks; t++) {
    const progress = (t + 1) / deepPalpationTicks;
    const force = forcePeak * 0.3 + (forcePeak * 0.7) * progress;

    if (!guardingTriggered && force >= guardingThreshold) {
      guardingTriggered = true;
      guardEventCount++;
      const emotionEventId = `${emotionEventPrefix}_${guardEventCount}`;
      guardEvents.push({
        tick: globalTick,
        region: contactRegionId,
        force,
        emotionEventId,
      });
    }

    // Post-guarding: apply a force reduction factor to simulate clinician easing up
    const effectiveForce = guardingTriggered
      ? force * 0.6 // clinician reduces pressure after guarding detected
      : force;

    entries.push(buildGuardTickInput(globalTick, handedness, targetPosition, restRotation, effectiveForce, contactRegionId));
    globalTick++;
  }

  // If guarding never triggered (e.g., threshold too high), force one event at peak
  if (!guardingTriggered) {
    guardEventCount++;
    guardEvents.push({
      tick: globalTick - 1,
      region: contactRegionId,
      force: forcePeak,
      emotionEventId: `${emotionEventPrefix}_${guardEventCount}`,
    });
  }

  // Phase 4: Post-guard dwell — reduced steady force
  for (let t = 0; t < postGuardDwellTicks && globalTick <= ticks; t++) {
    const force = forcePeak * 0.25; // light re-test pressure
    entries.push(buildGuardTickInput(globalTick, handedness, targetPosition, restRotation, force, contactRegionId));
    globalTick++;
  }

  // Phase 5: Release — withdraw to rest
  const releaseStartPos = { ...targetPosition };
  for (let t = 0; t < releaseTicks && globalTick <= ticks; t++) {
    const progress = (t + 1) / releaseTicks;
    currentPos = lerpVec3(releaseStartPos, restPos, progress);
    const force = forcePeak * 0.1 * Math.max(1 - progress, 0);
    entries.push(buildGuardTickInput(globalTick, handedness, currentPos, restRotation, force, contactRegionId));
    globalTick++;
  }

  // Phase 6: Idle
  while (globalTick <= ticks) {
    entries.push(buildGuardTickInput(globalTick, handedness, restPos, restRotation, 0, null));
    globalTick++;
  }

  return {
    log: { entries: entries.slice(0, ticks + 1) },
    guardEvents,
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Build a single PhysicsTickInput for the guarding scenario.
 */
function buildGuardTickInput(
  tick: number,
  handedness: "left" | "right",
  position: { x: number; y: number; z: number },
  rotation: { x: number; y: number; z: number; w: number },
  pinchStrength: number,
  contactRegionId: string | null,
): PhysicsTickInput {
  return {
    tick,
    handedness,
    jointPoses: [
      {
        jointId: "wrist",
        position: { ...position },
        rotation: { ...rotation },
      },
      {
        jointId: "index_tip",
        position: {
          x: position.x,
          y: position.y - 0.04,
          z: position.z + 0.015,
        },
        rotation: { ...rotation },
      },
      {
        jointId: "middle_tip",
        position: {
          x: position.x + 0.008,
          y: position.y - 0.04,
          z: position.z + 0.015,
        },
        rotation: { ...rotation },
      },
    ],
    pinchStrength,
    contactRegionId,
  };
}
