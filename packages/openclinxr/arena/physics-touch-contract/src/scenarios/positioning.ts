/**
 * Positioning scenario — light assist input log.
 *
 * Simulates a clinician gently assisting a patient into a specific position
 * for an exam maneuver. Not a strength test — light touch guidance only.
 *
 * Trajectory: approach → gentle contact → guided repositioning → release → idle.
 * Fully deterministic: same params → same log → same C6 checksums.
 *
 * Case-def shaped (not clinical scoring):
 *   - contactRegionId targets positioning contact point (e.g. "shoulder_R")
 *   - pinchStrength stays low (0–0.2 range; gentle assist)
 *   - jointPoses trace a smooth repositioning path
 */

import type { InputLog, PhysicsTickInput } from "../types.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * Configuration for building a positioning input log.
 */
export type PositioningConfig = {
  /** Total number of ticks (≥ 1). */
  ticks: number;
  /** Hand to use for positioning. */
  handedness: "left" | "right";
  /** Contact region being positioned (e.g. "shoulder_R", "elbow_L"). */
  contactRegionId: string;
  /** Starting position of the contact point in world space. */
  startPosition: { x: number; y: number; z: number };
  /** Target position after guided repositioning. */
  endPosition: { x: number; y: number; z: number };
  /** Duration in ticks to approach the start position. */
  approachTicks: number;
  /** Duration in ticks of initial contact (establish gentle hold). */
  contactTicks: number;
  /** Duration in ticks to guide from start to end position. */
  guideTicks: number;
  /** Duration in ticks to dwell at the end position. */
  dwellTicks: number;
  /** Duration in ticks to release and withdraw. */
  releaseTicks: number;
};

/**
 * Default positioning config: right hand guiding left shoulder into a
 * slightly forward-leaning exam position.
 */
export const DEFAULT_POSITIONING_CONFIG: PositioningConfig = {
  ticks: 300,
  handedness: "right",
  contactRegionId: "shoulder_L",
  startPosition: { x: -0.15, y: 0.62, z: 0.28 },
  endPosition: { x: -0.12, y: 0.58, z: 0.35 },
  approachTicks: 25,
  contactTicks: 15,
  guideTicks: 60,
  dwellTicks: 30,
  releaseTicks: 20,
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
 * Build a deterministic positioning input log.
 *
 * Phases:
 *   1. Approach: hand moves from rest to startPosition
 *   2. Contact: light steady contact at startPosition
 *   3. Guide: smooth translation from startPosition to endPosition
 *   4. Dwell: hold at endPosition
 *   5. Release: withdraw to rest
 *   6. Idle: remaining ticks
 */
export function buildPositioningInputLog(
  config: PositioningConfig,
): InputLog {
  const {
    ticks,
    handedness,
    contactRegionId,
    startPosition,
    endPosition,
    approachTicks,
    contactTicks,
    guideTicks,
    dwellTicks,
    releaseTicks,
  } = config;

  const entries: PhysicsTickInput[] = [];

  // Rest position
  const restPos = { x: 0.35, y: 0.75, z: 0.45 };
  const restRotation = { x: 0, y: 0, z: 0, w: 1 };
  let currentPos = { x: restPos.x, y: restPos.y, z: restPos.z };
  let globalTick = 0;

  // Phase 1: Approach
  for (let t = 0; t < approachTicks && globalTick <= ticks; t++) {
    const progress = (t + 1) / approachTicks;
    currentPos = lerpVec3(restPos, startPosition, progress);
    entries.push(buildPosTickInput(globalTick, handedness, currentPos, restRotation, 0, null));
    globalTick++;
  }

  // Phase 2: Contact — gentle hold at start
  for (let t = 0; t < contactTicks && globalTick <= ticks; t++) {
    const pinch = 0.1 * Math.min((t + 1) / (contactTicks * 0.3), 1);
    entries.push(buildPosTickInput(globalTick, handedness, startPosition, restRotation, pinch, contactRegionId));
    globalTick++;
  }

  // Phase 3: Guide — smooth repositioning from start to end
  for (let t = 0; t < guideTicks && globalTick <= ticks; t++) {
    const progress = (t + 1) / guideTicks;
    // Ease-in-out for natural motion
    const eased = easeInOutQuad(progress);
    currentPos = lerpVec3(startPosition, endPosition, eased);
    const pinch = 0.1 + 0.02 * Math.sin(progress * Math.PI); // gentle variation
    entries.push(buildPosTickInput(globalTick, handedness, currentPos, restRotation, pinch, contactRegionId));
    globalTick++;
  }

  // Phase 4: Dwell — hold at end position
  for (let t = 0; t < dwellTicks && globalTick <= ticks; t++) {
    entries.push(buildPosTickInput(globalTick, handedness, endPosition, restRotation, 0.1, contactRegionId));
    globalTick++;
  }

  // Phase 5: Release — withdraw to rest
  const releaseStartPos = { ...endPosition };
  for (let t = 0; t < releaseTicks && globalTick <= ticks; t++) {
    const progress = (t + 1) / releaseTicks;
    currentPos = lerpVec3(releaseStartPos, restPos, progress);
    const pinch = 0.1 * Math.max(1 - progress, 0);
    entries.push(buildPosTickInput(globalTick, handedness, currentPos, restRotation, pinch, contactRegionId));
    globalTick++;
  }

  // Phase 6: Idle
  while (globalTick <= ticks) {
    entries.push(buildPosTickInput(globalTick, handedness, restPos, restRotation, 0, null));
    globalTick++;
  }

  return {
    entries: entries.slice(0, ticks + 1),
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Ease-in-out quadratic for smooth guided motion.
 */
function easeInOutQuad(t: number): number {
  return t < 0.5
    ? 2 * t * t
    : 1 - Math.pow(-2 * t + 2, 2) / 2;
}

/**
 * Build a single PhysicsTickInput for the positioning scenario.
 */
function buildPosTickInput(
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
          z: position.z + 0.02,
        },
        rotation: { ...rotation },
      },
      {
        jointId: "middle_tip",
        position: {
          x: position.x + 0.008,
          y: position.y - 0.04,
          z: position.z + 0.02,
        },
        rotation: { ...rotation },
      },
    ],
    pinchStrength,
    contactRegionId,
  };
}
