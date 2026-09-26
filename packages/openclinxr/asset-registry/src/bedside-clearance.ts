import type { Vector3 } from "./bedside-target.js";

/**
 * Whether a clinician can actually stand at a bedside target and get to it.
 *
 * Brief §7 step 3: "with equipment/body clearance, an unobstructed approach zone and monitor
 * visibility ... Report violations against measured mounted geometry." The brief also insists,
 * under Deterministic solving: "Define tolerances and known-good/known-bad controls before calling
 * a check 'reachability'. A nearby hand target does not prove anatomical reach or a traversable
 * route."
 *
 * So this reports violations against AABBs the caller measured off mounted objects. It does not
 * measure them, does not solve, and does not move anybody. Monitor visibility is NOT here: a
 * line-of-sight check needs the monitor's mounted pose and a head height, and inventing either
 * would be the fabrication the brief's own acceptance language guards against.
 *
 * WHERE THE NUMBERS COME FROM, because a threshold with no provenance is an invented one:
 *
 * - `WALKER_SHOULDER_JOINT_SEPARATION_METERS = 0.3681` — the rest-pose `upperarm01.L/R`
 *   (shoulder-joint) separation measured off the shipped physician rig's own bytes
 *   (`apps/ui-xr/public/generated-humanoids/mpfb-clinical-physician-adult.glb`, node
 *   translations composed through the hierarchy, no textures loaded). The shipped nurse rig
 *   measures 0.3323 m at the same joints and 0.2040 m at the hips (`upperleg01.L/R`;
 *   physician hips 0.2212 m), so the physician's shoulders are the widest shipped walker and
 *   the constant covers every shipped walker role. Shoulder JOINTS, not skin: the joint
 *   centres sit inside the deltoid, and the clearance margin below covers flesh, clothing
 *   and arm swing.
 * - `WALKER_BODY_CLEARANCE_METERS = 0.05` — the stated margin on top of the measured
 *   half-breadth: soft tissue and clothing past the joint centres plus swing while walking.
 * - `STANDING_FOOTPRINT_RADIUS_METERS` — the derivation, not a literal: half the measured
 *   shoulder separation plus the stated clearance (0.3681 / 2 + 0.05 ≈ 0.234). It replaces
 *   the old 0.3 m (half of a generic ~0.6 m shoulder breadth) with the shipped rig's own
 *   width. `locomotion-order-mod.ts` and `layout-solve-mod.ts` use this same evaluated
 *   value rather than their own guesses; the derivation lives here.
 * - `APPROACH_CORRIDOR_HALF_WIDTH_METERS` — the same body plus one more clearance margin
 *   for lateral sway while walking (≈ 0.284), which is what a corridor has to admit for
 *   the body to pass along it.
 *
 * Both are stated as adult standing dimensions. A paediatric or seated clinician is out of scope
 * and would need its own figures rather than a scale factor applied to these.
 */

/** Axis-aligned bounds in world metres, as measured off a mounted object. */
export type WorldAabb = { min: Vector3; max: Vector3 };

/** A mounted thing the clinician must not stand inside or walk through. */
export type MeasuredObstacle = { id: string; bounds: WorldAabb };

/**
 * Rest-pose shoulder-joint separation of the widest shipped walker rig (see provenance above).
 * Evaluate once here; every walker-radius consumer uses the evaluated value.
 */
export const WALKER_SHOULDER_JOINT_SEPARATION_METERS = 0.3681;

/** Stated clearance on top of the measured half-breadth: flesh, clothing, arm swing. */
export const WALKER_BODY_CLEARANCE_METERS = 0.05;

export const STANDING_FOOTPRINT_RADIUS_METERS =
  WALKER_SHOULDER_JOINT_SEPARATION_METERS / 2 + WALKER_BODY_CLEARANCE_METERS;
export const APPROACH_CORRIDOR_HALF_WIDTH_METERS =
  STANDING_FOOTPRINT_RADIUS_METERS + WALKER_BODY_CLEARANCE_METERS;

/**
 * An obstacle entirely below this height above the floor is underfoot, not in the body: a
 * trip-level report, never a blocking one. 0.03 m is shoe-sole/step-over scale — anything
 * taller reaches the shin and collides with the body properly.
 */
export const TRIP_HAZARD_HEIGHT_METERS = 0.03;

/**
 * The vertical band a standing body occupies, in metres above the floor.
 *
 * Added after an adversarial review (meta/muse-spark-1.3-contributor, 2026-09-09) pointed out that
 * an XZ-only footprint ignores height in BOTH directions: a ceiling-mounted light at y 2.4 reports
 * a body-clearance violation it has no business reporting, and that kind of false positive is how
 * a check stops being believed. 1.8 m is an approximate adult standing height, an external
 * anthropometric floor rather than a fitted value.
 */
export const STANDING_BODY_HEIGHT_METERS = 1.8;

export type ClearanceViolation = {
  /**
   * `trip_hazard` is NOT blocking: the obstacle is entirely below `TRIP_HAZARD_HEIGHT_METERS`
   * above the floor, so it is underfoot rather than in the body. It is still reported (with
   * its height) so a reviewer sees the trip ledge; every blocking decision site filters to
   * `body_clearance` / `approach_corridor`. Silently dropping it would hide a real fall risk.
   */
  kind: "body_clearance" | "approach_corridor" | "trip_hazard";
  obstacleId: string;
  /** Metres of overlap. Positive is an intrusion; it is never reported at or below zero. */
  overlapMeters: number;
  reason: string;
};

/** True when the whole obstacle sits below trip height above the floor: underfoot, not bodily. */
function isTripLevel(bounds: WorldAabb, floorY: number): boolean {
  return bounds.max.y - floorY < TRIP_HAZARD_HEIGHT_METERS;
}

/** True when the obstacle's vertical span overlaps the band a standing body occupies. */
function overlapsStandingHeight(bounds: WorldAabb, floorY: number, bodyHeight: number): boolean {
  return bounds.max.y > floorY && bounds.min.y < floorY + bodyHeight;
}

/**
 * XZ overlap depth of a circle against a box, gated on vertical overlap: positive when they
 * intersect in plan AND the box occupies some of the body's height band.
 *
 * The gate is not cosmetic. Without it the check is a plan-view stamp: it reports a ceiling light
 * as blocking a standing clinician and cannot tell a floor cable from a wall cabinet.
 */
function circleBoxOverlapXz(
  centre: Vector3,
  radius: number,
  bounds: WorldAabb,
  bodyHeight: number,
  floorY: number,
): number {
  if (!overlapsStandingHeight(bounds, floorY, bodyHeight)) return 0;
  const nearestX = Math.min(Math.max(centre.x, bounds.min.x), bounds.max.x);
  const nearestZ = Math.min(Math.max(centre.z, bounds.min.z), bounds.max.z);
  const distance = Math.hypot(centre.x - nearestX, centre.z - nearestZ);
  return radius - distance;
}

/**
 * Violations for a clinician standing at `standingPosition` and walking to it from `approachFrom`.
 *
 * The corridor is sampled along its centre line rather than swept analytically. Sampling can miss
 * an obstacle thinner than its step, so the step is deliberately smaller than the narrowest thing
 * in the shipped equipment catalogue (an IV pole, ~0.05 m). That is a stated limit, not a proof of
 * absence: this reports the violations it finds and never claims a route is clear.
 */
export function bedsideClearanceViolations(input: {
  standingPosition: Vector3;
  approachFrom?: Vector3 | undefined;
  obstacles: readonly MeasuredObstacle[];
  bodyHeightMeters?: number | undefined;
  /**
   * Floor height under the clinician, in metres. DEFAULTS TO 0 rather than to the probe point's
   * own y, which is what it used to use.
   *
   * A review (meta/muse-spark-1.3-contributor, 2026-09-09) pointed out that taking the band from
   * the probe's y flattens the check against whatever height the caller happened to pass. A
   * placement position carries y 0.95 (the actor slot's own offset), so the body band became
   * 0.95-2.75 m: a 0.45 m stool underfoot vanished and a ceiling fixture came back.
   */
  floorY?: number | undefined;
}): ClearanceViolation[] {
  const violations: ClearanceViolation[] = [];

  for (const obstacle of input.obstacles) {
    const floor = input.floorY ?? 0;
    const overlap = circleBoxOverlapXz(
      input.standingPosition,
      STANDING_FOOTPRINT_RADIUS_METERS,
      obstacle.bounds,
      input.bodyHeightMeters ?? STANDING_BODY_HEIGHT_METERS,
      floor,
    );
    if (overlap > 0) {
      if (isTripLevel(obstacle.bounds, floor)) {
        violations.push({
          kind: "trip_hazard",
          obstacleId: obstacle.id,
          overlapMeters: overlap,
          reason:
            `trip-level ledge ${obstacle.id}: ${(obstacle.bounds.max.y - floor).toFixed(3)} m above the floor, `
            + `within the standing footprint by ${overlap.toFixed(3)} m — reported, not blocking`,
        });
        continue;
      }
      violations.push({
        kind: "body_clearance",
        obstacleId: obstacle.id,
        overlapMeters: overlap,
        reason: `the standing footprint (r=${STANDING_FOOTPRINT_RADIUS_METERS} m) intersects ${obstacle.id} by ${overlap.toFixed(3)} m`,
      });
    }
  }

  const from = input.approachFrom;
  if (!from) return violations;

  const dx = input.standingPosition.x - from.x;
  const dz = input.standingPosition.z - from.z;
  const length = Math.hypot(dx, dz);
  if (length === 0) return violations;

  const stepMeters = 0.04;
  const steps = Math.max(1, Math.ceil(length / stepMeters));
  const corridorFloor = input.floorY ?? 0;
  for (const obstacle of input.obstacles) {
    let worst = 0;
    for (let i = 0; i <= steps; i += 1) {
      const t = i / steps;
      const point: Vector3 = {
        x: from.x + dx * t,
        y: input.standingPosition.y,
        z: from.z + dz * t,
      };
      const overlap = circleBoxOverlapXz(
        point,
        APPROACH_CORRIDOR_HALF_WIDTH_METERS,
        obstacle.bounds,
        input.bodyHeightMeters ?? STANDING_BODY_HEIGHT_METERS,
        corridorFloor,
      );
      if (overlap > worst) worst = overlap;
    }
    if (worst > 0) {
      if (isTripLevel(obstacle.bounds, corridorFloor)) {
        violations.push({
          kind: "trip_hazard",
          obstacleId: obstacle.id,
          overlapMeters: worst,
          reason:
            `trip-level ledge ${obstacle.id}: ${(obstacle.bounds.max.y - corridorFloor).toFixed(3)} m above the floor, `
            + `crossing the approach corridor by ${worst.toFixed(3)} m — reported, not blocking`,
        });
        continue;
      }
      violations.push({
        kind: "approach_corridor",
        obstacleId: obstacle.id,
        overlapMeters: worst,
        reason: `the approach corridor (half-width ${APPROACH_CORRIDOR_HALF_WIDTH_METERS} m) is blocked by ${obstacle.id} by ${worst.toFixed(3)} m`,
      });
    }
  }

  return violations;
}
