/**
 * Palpation scenario — scripted abdomen contact trajectory.
 *
 * Builds an InputLog simulating a clinical palpation exam:
 *   - Right hand moves in an ordered sequence across abdominal quadrants.
 *   - Each contact region (abdomen) gets touch inputs with increasing force (pinchStrength).
 *   - Trajectory is fully deterministic: same params → same log → same C6 checksums.
 */

import type { InputLog, PhysicsTickInput } from "../types.js";

/**
 * Palpation quadrant identifiers.
 */
export type PalpationQuadrant =
  | "abdomen_ruq"   // right upper quadrant
  | "abdomen_rlq"   // right lower quadrant
  | "abdomen_luq"   // left upper quadrant
  | "abdomen_llq";  // left lower quadrant

/**
 * Palpation site: a contact point on the abdomen at a specific quadrant.
 */
export type PalpationSite = {
  quadrant: PalpationQuadrant;
  /** Target position in world space for the hand at this site. */
  targetPosition: { x: number; y: number; z: number };
  /** Force level (0-1) representing palpation depth. */
  forceLevel: number;
};

/**
 * Configuration for building a palpation input log.
 */
export type PalpationConfig = {
  /** Total number of physics ticks to simulate. */
  ticks: number;
  /** Peak force level (0-1) for deep palpation. */
  forcePeak: number;
  /** Ordered palpation sites to visit. */
  sites: PalpationSite[];
  /** Duration in ticks to dwell at each site. */
  dwellTicks: number;
  /** Duration in ticks to transition between sites. */
  transitionTicks: number;
};

/**
 * Default palpation sites: standard 4-quadrant abdominal exam.
 */
export const DEFAULT_PALPATION_SITES: PalpationSite[] = [
  {
    quadrant: "abdomen_ruq",
    targetPosition: { x: 0.12, y: 0.58, z: 0.32 },
    forceLevel: 0.3,
  },
  {
    quadrant: "abdomen_rlq",
    targetPosition: { x: 0.12, y: 0.42, z: 0.32 },
    forceLevel: 0.5,
  },
  {
    quadrant: "abdomen_luq",
    targetPosition: { x: -0.12, y: 0.58, z: 0.32 },
    forceLevel: 0.4,
  },
  {
    quadrant: "abdomen_llq",
    targetPosition: { x: -0.12, y: 0.42, z: 0.32 },
    forceLevel: 0.6,
  },
];

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
 * Build a deterministic palpation input log.
 *
 * The trajectory visits sites in order, transitioning between them
 * over transitionTicks, then dwelling for dwellTicks at each site.
 * Force (pinchStrength) ramps from 0 to the site's forceLevel.
 *
 * After all sites are visited, remaining ticks (up to `ticks`) are
 * idle ticks at the last position with decreasing force.
 */
export function buildPalpationInputLog(
  config: PalpationConfig,
): InputLog {
  const {
    ticks,
    sites,
    dwellTicks,
    transitionTicks,
  } = config;

  const entries: PhysicsTickInput[] = [];

  // Start position: hovering above first site
  let currentPos = {
    x: 0,
    y: 0.8,
    z: 0.6,
  };

  let siteTick = 0;

  for (let siteIdx = 0; siteIdx < sites.length; siteIdx++) {
    const site = sites[siteIdx]!;

    // Transition to the site
    const transitionStartPos = { ...currentPos };
    for (let t = 0; t < transitionTicks; t++) {
      const progress = (t + 1) / transitionTicks;
      const pos = lerpVec3(transitionStartPos, site.targetPosition, progress);

      entries.push(buildTickInput(siteTick, pos, site.quadrant, 0));
      siteTick++;
    }

    // Dwell at the site, ramping force
    currentPos = { ...site.targetPosition };
    for (let t = 0; t < dwellTicks; t++) {
      const forceProgress = Math.min((t + 1) / Math.max(dwellTicks * 0.5, 1), 1);
      const force = site.forceLevel * forceProgress;

      entries.push(buildTickInput(siteTick, currentPos, site.quadrant, force));
      siteTick++;
    }

    // Release force gradually
    for (let t = 0; t < Math.floor(dwellTicks * 0.3); t++) {
      const releaseForce =
        site.forceLevel * Math.max(1 - (t + 1) / (dwellTicks * 0.3), 0);
      entries.push(
        buildTickInput(siteTick, currentPos, site.quadrant, releaseForce),
      );
      siteTick++;
    }
  }

  // Fill remaining ticks as idle (hand withdrawn)
  currentPos = { x: 0, y: 0.8, z: 0.6 };
  for (let t = siteTick; t <= ticks; t++) {
    entries.push(buildTickInput(t, currentPos, null, 0));
  }

  return {
    entries: entries.slice(0, ticks + 1),
  };
}

/**
 * Build a single PhysicsTickInput for the palpation scenario.
 */
function buildTickInput(
  tick: number,
  position: { x: number; y: number; z: number },
  contactRegionId: string | null,
  pinchStrength: number,
): PhysicsTickInput {
  return {
    tick,
    handedness: "right",
    jointPoses: [
      {
        jointId: "wrist",
        position: { ...position },
        rotation: { x: 0, y: 0, z: 0, w: 1 },
      },
      {
        jointId: "index_tip",
        position: {
          x: position.x,
          y: position.y - 0.05,
          z: position.z + 0.02,
        },
        rotation: { x: 0, y: 0, z: 0, w: 1 },
      },
      {
        jointId: "middle_tip",
        position: {
          x: position.x + 0.01,
          y: position.y - 0.05,
          z: position.z + 0.02,
        },
        rotation: { x: 0, y: 0, z: 0, w: 1 },
      },
    ],
    pinchStrength,
    contactRegionId,
  };
}
