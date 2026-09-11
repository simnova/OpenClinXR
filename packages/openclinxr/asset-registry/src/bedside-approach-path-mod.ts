import {
  bedsideClearanceViolations,
  type ClearanceViolation,
  type MeasuredObstacle,
} from "./bedside-clearance.js";
import { headingRadiansToward, type Vector3 } from "./bedside-target.js";

/**
 * A bounded walk from an entry point to a proven bedside target.
 *
 * Brief §7 step 4: "Start with a bounded actor path and validated clip/goal executor, stopping at
 * the proven target ... Measure continuous-path collisions, foot sliding, final pose and equipment
 * clearance."
 *
 * WHAT THIS IS: the bounded path and its continuous-path collision and final-pose measurements.
 *
 * WHAT IT IS NOT, said plainly because step 4's sentence contains four things and delivering two
 * while implying four is how this effort went wrong at the start:
 *
 * - NO executor. Nothing plays a clip or drives a skeleton. The waypoints are a route, not motion.
 * - NO foot-sliding measurement. That needs a played clip and foot-contact sampling across frames;
 *   it cannot be computed from a polyline and is not approximated here.
 * - The patient is untouched. Step 4 says "keep the patient statically supine until posture-safe
 *   animation is separately demonstrated", and nothing here moves her.
 *
 * "Bounded" is literal: a straight polyline between two points, sampled. It is not a planner and
 * will not route around an obstacle — it REPORTS that the route is blocked and stops. Returning a
 * detour would be inventing a path nobody validated.
 */

export type ApproachWaypoint = { position: Vector3; headingRadians: number };

export type BedsideApproachPlan = {
  waypoints: ApproachWaypoint[];
  /** Collisions found along the walked path, not merely at its endpoints. */
  pathViolations: ClearanceViolation[];
  /** True when the last waypoint is the target and faces the patient. */
  arrivesAtTarget: boolean;
  /** Metres between the final waypoint and the requested target. */
  finalPoseErrorMeters: number;
};

/** Default spacing between waypoints, in metres. A normal walking stride is ~0.7 m. */
export const APPROACH_WAYPOINT_SPACING_METERS = 0.35;

/**
 * The step a SWEPT occupancy check resamples the route at, in metres.
 *
 * 0.04 m, and the derivation is SC-00's: the narrowest obstacle in the shipped catalogue is an IV
 * pole at ~0.05 m, and `bedside-clearance.ts` already steps its corridor check at 0.04 m. A sweep
 * coarser than the thinnest thing it must find can step over one. Deliberately NOT
 * `APPROACH_WAYPOINT_SPACING_METERS`: waypoints are a stride, the sweep is a measurement.
 */
export const SWEPT_OCCUPANCY_SAMPLE_SPACING_METERS = 0.04;

/**
 * Violations found by SWEEPING the occupied standing volume along the route, not by sampling
 * waypoints.
 *
 * WHY THIS IS SEPARATE FROM `planBedsideApproach`. That function checks the waypoints it emitted,
 * 0.35 m apart, each against a 0.3 m standing footprint. SC-00 measured the blind spot and gave it
 * a width: with a 0.3 m footprint and 0.35 m spacing the two circles stop covering the segment
 * between them once the lateral offset passes `sqrt(0.09 - 0.0306) = 0.244 m`, and a 0.05 m pole at
 * 0.30 m lateral sits outside both circles while the swept body passes 0.275 m from it. Measured on
 * the unchanged tree at 86dc0300, `planBedsideApproach` returned `pathViolations: []` for exactly
 * that pole on a doorway-to-bedside route.
 *
 * `acceptance-v2.md`: "acceptance must detect thin obstacles between prior 0.35 m samples and test
 * swept occupied volume including actor dimensions."
 *
 * The plan's own shape is untouched. `the-approach-path-stops-at-the-target.test.ts` clause (5)
 * asserts its key set exactly, and a route check that changed that shape would be a different
 * contract wearing the same name.
 */
export function sweptRouteViolations(input: {
  waypoints: readonly ApproachWaypoint[];
  obstacles: readonly MeasuredObstacle[];
  spacingMeters?: number;
  floorY?: number;
}): ClearanceViolation[] {
  const spacing = input.spacingMeters ?? SWEPT_OCCUPANCY_SAMPLE_SPACING_METERS;
  const worstByObstacle = new Map<string, number>();
  for (let index = 1; index < input.waypoints.length; index += 1) {
    const from = input.waypoints[index - 1]?.position;
    const to = input.waypoints[index]?.position;
    if (from === undefined || to === undefined) continue;
    const dx = to.x - from.x;
    const dz = to.z - from.z;
    const length = Math.hypot(dx, dz);
    const steps = Math.max(1, Math.ceil(length / spacing));
    for (let step = 0; step <= steps; step += 1) {
      const t = step / steps;
      const point: Vector3 = { x: from.x + dx * t, y: from.y, z: from.z + dz * t };
      for (const violation of bedsideClearanceViolations({
        standingPosition: point,
        obstacles: input.obstacles,
        ...(input.floorY === undefined ? {} : { floorY: input.floorY }),
      })) {
        if (violation.kind !== "body_clearance") continue;
        const worst = worstByObstacle.get(violation.obstacleId) ?? 0;
        if (violation.overlapMeters > worst) {
          worstByObstacle.set(violation.obstacleId, violation.overlapMeters);
        }
      }
    }
  }
  const violations: ClearanceViolation[] = [];
  for (const [obstacleId, overlapMeters] of worstByObstacle) {
    violations.push({
      kind: "approach_corridor",
      obstacleId,
      overlapMeters,
      reason:
        `the swept standing volume, resampled every ${spacing} m along the route, intersects ${obstacleId} `
        + `by ${overlapMeters.toFixed(3)} m; the ${APPROACH_WAYPOINT_SPACING_METERS} m waypoint samples do `
        + "not cover the segment between them",
    });
  }
  return violations;
}

export function planBedsideApproach(input: {
  from: Vector3;
  target: Vector3;
  facing: Vector3;
  obstacles: readonly MeasuredObstacle[];
  spacingMeters?: number;
}): BedsideApproachPlan {
  const spacing = input.spacingMeters ?? APPROACH_WAYPOINT_SPACING_METERS;
  const dx = input.target.x - input.from.x;
  const dz = input.target.z - input.from.z;
  const length = Math.hypot(dx, dz);
  const steps = Math.max(1, Math.ceil(length / spacing));

  const waypoints: ApproachWaypoint[] = [];
  for (let i = 0; i <= steps; i += 1) {
    const t = i / steps;
    const position: Vector3 = {
      x: input.from.x + dx * t,
      y: input.target.y,
      z: input.from.z + dz * t,
    };
    // Walking waypoints face the way they are going; the FINAL one faces the patient, because
    // arriving at a bedside looking down the corridor is not arriving.
    const headingRadians = i === steps
      ? headingRadiansToward(position, input.facing)
      : headingRadiansToward(position, input.target);
    waypoints.push({ position, headingRadians });
  }

  // Continuous-path collision: every waypoint is checked, not just the destination. A route that
  // ends clear having passed through a cart is the failure this exists to catch.
  const pathViolations: ClearanceViolation[] = [];
  const seen = new Set<string>();
  for (const waypoint of waypoints) {
    for (const violation of bedsideClearanceViolations({
      standingPosition: waypoint.position,
      obstacles: input.obstacles,
    })) {
      const key = `${violation.kind}:${violation.obstacleId}`;
      if (seen.has(key)) continue;
      seen.add(key);
      pathViolations.push(violation);
    }
  }

  const last = waypoints[waypoints.length - 1];
  const finalPoseErrorMeters = last
    ? Math.hypot(last.position.x - input.target.x, last.position.z - input.target.z)
    : Number.POSITIVE_INFINITY;

  return {
    waypoints,
    pathViolations,
    // STOPS AT the target: arrival requires the final waypoint to be the target within a
    // millimetre, so a path that overshoots or falls short is not called an arrival.
    arrivesAtTarget: finalPoseErrorMeters <= 0.001 && pathViolations.length === 0,
    finalPoseErrorMeters,
  };
}
