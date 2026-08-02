/**
 * Passive Range-of-Motion (ROM) scenario — scripted forearm grasp trajectory.
 *
 * Simulates a clinician grasping a patient's forearm and moving it through
 * a prescribed arc to assess passive ROM at the shoulder joint.
 *
 * Trajectory: approach → grasp → controlled rotation through arc → release.
 * Fully deterministic: same params → same log → same C6 checksums.
 *
 * Case-def shaped (not clinical scoring):
 *   - contactRegionId = "forearm_distal_R" or "forearm_distal_L"
 *   - pinchStrength ramps as grasp firmness (0–0.4 range; gentle ROM hold)
 *   - jointPoses drive a wrist-to-elbow chain moving through ROM arc
 */

import type { InputLog, PhysicsTickInput } from "../types.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * Side for the passive ROM exercise.
 */
export type RomSide = "right" | "left";

/**
 * Joint whose ROM is being assessed.
 */
export type RomJoint = "shoulder" | "elbow" | "wrist_joint";

/**
 * Direction of ROM arc.
 */
export type RomDirection = "flexion" | "extension" | "abduction" | "adduction" | "internal_rotation" | "external_rotation";

/**
 * Configuration for building a passive ROM input log.
 */
export type PassiveRomConfig = {
  /** Total number of ticks (≥ 1). */
  ticks: number;
  /** Patient side being examined. */
  side: RomSide;
  /** Joint being assessed. */
  joint: RomJoint;
  /** Direction of ROM arc. */
  direction: RomDirection;
  /** Starting angle in radians for the ROM arc. */
  arcStartRad: number;
  /** Ending angle in radians for the ROM arc. */
  arcEndRad: number;
  /** Grasp target position in world space. */
  graspTarget: { x: number; y: number; z: number };
  /** Duration in ticks to approach the grasp point. */
  approachTicks: number;
  /** Duration in ticks to dwell at the grasp point before moving. */
  preArcDwellTicks: number;
  /** Duration in ticks to complete the ROM arc. */
  arcTicks: number;
  /** Duration in ticks to dwell at arc end. */
  postArcDwellTicks: number;
  /** Duration in ticks to release and withdraw. */
  releaseTicks: number;
};

/**
 * Default config for right shoulder abduction ROM.
 * World-space forearm distal position on a seated patient at (0, 0.48, 0.25).
 */
export const DEFAULT_PASSIVE_ROM_CONFIG: PassiveRomConfig = {
  ticks: 480,
  side: "right",
  joint: "shoulder",
  direction: "abduction",
  arcStartRad: 0.0,    // arm at side
  arcEndRad: 1.2,      // ~69° abduction
  graspTarget: { x: 0.22, y: 0.48, z: 0.25 },
  approachTicks: 30,
  preArcDwellTicks: 20,
  arcTicks: 120,
  postArcDwellTicks: 30,
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
 * Build a deterministic passive ROM input log.
 *
 * Phases:
 *   1. Approach: hand moves from rest position to grasp target
 *   2. Pre-arc dwell: hand holds at grasp with steady pinch
 *   3. Arc: hand traces the ROM arc (forearm moves along a circular path)
 *   4. Post-arc dwell: hold at end of ROM
 *   5. Release: withdraw hand back to rest
 *   6. Idle: remaining ticks with no contact
 */
export function buildPassiveRomInputLog(
  config: PassiveRomConfig,
): InputLog {
  const {
    ticks,
    side,
    joint,
    direction,
    arcStartRad,
    arcEndRad,
    graspTarget,
    approachTicks,
    preArcDwellTicks,
    arcTicks,
    postArcDwellTicks,
    releaseTicks,
  } = config;

  const entries: PhysicsTickInput[] = [];
  const contactRegionId = `forearm_distal_${side === "right" ? "R" : "L"}`;
  const handedness = side === "right" ? "right" : "left";

  // Rest position — clinician's hand at neutral
  const restPos = { x: 0.35, y: 0.7, z: 0.45 };
  const restRotation = { x: 0, y: 0, z: 0, w: 1 };

  let currentPos = { x: restPos.x, y: restPos.y, z: restPos.z };
  let globalTick = 0;

  // Phase 1: Approach — move from rest to grasp target
  for (let t = 0; t < approachTicks && globalTick <= ticks; t++) {
    const progress = (t + 1) / approachTicks;
    currentPos = lerpVec3(restPos, graspTarget, progress);
    entries.push(buildRomTickInput(globalTick, handedness, currentPos, restRotation, 0, null));
    globalTick++;
  }

  // Phase 2: Pre-arc dwell — steady grasp, no movement
  for (let t = 0; t < preArcDwellTicks && globalTick <= ticks; t++) {
    const pinch = 0.25 * Math.min((t + 1) / (preArcDwellTicks * 0.3), 1);
    entries.push(buildRomTickInput(globalTick, handedness, currentPos, restRotation, pinch, contactRegionId));
    globalTick++;
  }

  // Phase 3: Arc — trace ROM path
  // The grasp target moves along an arc determined by joint/direction.
  // For shoulder abduction: forearm moves laterally outward.
  const arcCenter = { x: 0.12, y: 0.55, z: 0.2 }; // shoulder pivot
  const arcRadius = 0.18; // approx forearm length from shoulder
  const arcAxis = getArcAxis(joint, direction);

  for (let t = 0; t < arcTicks && globalTick <= ticks; t++) {
    const progress = (t + 1) / arcTicks;
    const angle = arcStartRad + (arcEndRad - arcStartRad) * progress;
    currentPos = computeArcPosition(arcCenter, arcRadius, angle, arcAxis);
    const pinch = 0.25 + 0.05 * Math.sin(progress * Math.PI); // gentle variation
    entries.push(buildRomTickInput(globalTick, handedness, currentPos, restRotation, pinch, contactRegionId));
    globalTick++;
  }

  // Phase 4: Post-arc dwell — hold at end
  for (let t = 0; t < postArcDwellTicks && globalTick <= ticks; t++) {
    entries.push(buildRomTickInput(globalTick, handedness, currentPos, restRotation, 0.2, contactRegionId));
    globalTick++;
  }

  // Phase 5: Release — withdraw to rest, decreasing pinch
  const releaseStartPos = { ...currentPos };
  for (let t = 0; t < releaseTicks && globalTick <= ticks; t++) {
    const progress = (t + 1) / releaseTicks;
    currentPos = lerpVec3(releaseStartPos, restPos, progress);
    const pinch = 0.2 * Math.max(1 - progress, 0);
    entries.push(buildRomTickInput(globalTick, handedness, currentPos, restRotation, pinch, contactRegionId));
    globalTick++;
  }

  // Phase 6: Idle — remaining ticks
  while (globalTick <= ticks) {
    entries.push(buildRomTickInput(globalTick, handedness, restPos, restRotation, 0, null));
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
 * Build a single PhysicsTickInput for the ROM scenario.
 */
function buildRomTickInput(
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

/**
 * Get the axis of rotation for an arc based on joint and direction.
 * Returns a normalized direction vector.
 */
function getArcAxis(
  joint: RomJoint,
  direction: RomDirection,
): { x: number; y: number; z: number } {
  // Shoulder abduction/adduction: rotation around z-axis (anterior-posterior)
  if (joint === "shoulder") {
    if (direction === "abduction" || direction === "adduction") {
      return { x: 0, y: 0, z: 1 };
    }
    if (direction === "flexion" || direction === "extension") {
      return { x: 0, y: 0, z: 1 };
    }
    if (direction === "internal_rotation" || direction === "external_rotation") {
      return { x: 0, y: 1, z: 0 };
    }
  }

  // Elbow flexion/extension: rotation around z-axis
  if (joint === "elbow") {
    return { x: 0, y: 0, z: 1 };
  }

  // Wrist flexion/extension: rotation around z-axis
  return { x: 0, y: 0, z: 1 };
}

/**
 * Compute a position on a circular arc given center, radius, angle, and rotation axis.
 * For shoulder abduction (z-axis rotation):
 *   x = center.x + radius * cos(angle)
 *   y = center.y + radius * sin(angle)
 *   z = center.z
 */
function computeArcPosition(
  center: { x: number; y: number; z: number },
  radius: number,
  angle: number,
  axis: { x: number; y: number; z: number },
): { x: number; y: number; z: number } {
  // Simple case: z-axis rotation (most clinical ROM arcs)
  if (Math.abs(axis.z) > 0.9) {
    return {
      x: center.x + radius * Math.cos(angle),
      y: center.y + radius * Math.sin(angle),
      z: center.z,
    };
  }
  // y-axis rotation
  if (Math.abs(axis.y) > 0.9) {
    return {
      x: center.x + radius * Math.cos(angle),
      y: center.y,
      z: center.z + radius * Math.sin(angle),
    };
  }
  // x-axis rotation
  return {
    x: center.x,
    y: center.y + radius * Math.cos(angle),
    z: center.z + radius * Math.sin(angle),
  };
}
