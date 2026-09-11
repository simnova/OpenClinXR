import type { MeasuredObstacle, WorldAabb } from "./bedside-clearance.js";
import type { Vector3 } from "./bedside-target.js";

/**
 * Whether the clinician can actually see the monitor from where they stand.
 *
 * Brief §7 step 3 asks for "monitor visibility" beside clearance and the approach zone, and its
 * acceptance section is explicit that this is a PHYSICAL check: SceneEval's "support/accessibility
 * metrics are VLM-based and are not physical proof". So this is a segment-versus-bounds test
 * against measured geometry, with no learned component.
 *
 * TWO FAILURES, and a check with only the first is the one worth being careful about:
 *
 *   1. OCCLUSION — something stands between the eye and the screen.
 *   2. THE WRONG SIDE — the clinician is behind the monitor. Nothing occludes the segment and
 *      the screen is invisible anyway. A pure occlusion check calls this visible, which is how
 *      "monitor visibility" becomes a green box that means nothing.
 *
 * WHERE THE NUMBERS COME FROM:
 *
 * - `STANDING_EYE_HEIGHT_METERS = 1.55` — approximate adult standing eye height, between the
 *   commonly cited ~1.51 m female and ~1.63 m male figures. An external anthropometric floor, not
 *   a value chosen to make this station pass. A seated or paediatric clinician needs its own
 *   figure rather than a scale factor.
 * - `MIN_VIEWING_SIDE_DOT = 0` — strictly in front of the screen plane. Zero is the geometric
 *   boundary, not a tuned threshold: at exactly zero the viewer is edge-on to a screen with no
 *   thickness and sees nothing.
 */

export const STANDING_EYE_HEIGHT_METERS = 1.55;
export const MIN_VIEWING_SIDE_DOT = 0;

export type MonitorVisibility =
  | { visible: true }
  | { visible: false; reason: "occluded"; obstacleId: string }
  | { visible: false; reason: "behind_screen"; dot: number };

/** Centre of an AABB. */
function centreOf(bounds: WorldAabb): Vector3 {
  return {
    x: (bounds.min.x + bounds.max.x) / 2,
    y: (bounds.min.y + bounds.max.y) / 2,
    z: (bounds.min.z + bounds.max.z) / 2,
  };
}

/**
 * The screen's outward normal: the axis the box is THINNEST along, pointed away from the wall.
 *
 * The shipped monitor is `BoxGeometry(0.8, 0.55, 0.08)` (xr-station-room/src/index.ts:346), so its
 * thin axis is Z and the screen faces along ±Z. `roomCentre` disambiguates the sign — a screen
 * faces into the room it is mounted in, not through the wall behind it.
 */
export function screenNormal(bounds: WorldAabb, roomCentre: Vector3): Vector3 {
  const centre = centreOf(bounds);
  const spans = {
    x: bounds.max.x - bounds.min.x,
    y: bounds.max.y - bounds.min.y,
    z: bounds.max.z - bounds.min.z,
  };
  const thinnest = spans.x <= spans.y && spans.x <= spans.z ? "x" : spans.z <= spans.y ? "z" : "y";
  const towardRoom = roomCentre[thinnest] - centre[thinnest];
  const sign = towardRoom >= 0 ? 1 : -1;
  return { x: thinnest === "x" ? sign : 0, y: thinnest === "y" ? sign : 0, z: thinnest === "z" ? sign : 0 };
}

/** Slab-method segment/AABB intersection. */
function segmentIntersectsAabb(from: Vector3, to: Vector3, bounds: WorldAabb): boolean {
  let tMin = 0;
  let tMax = 1;
  for (const axis of ["x", "y", "z"] as const) {
    const origin = from[axis];
    const delta = to[axis] - origin;
    const lo = bounds.min[axis];
    const hi = bounds.max[axis];
    if (Math.abs(delta) < 1e-12) {
      if (origin < lo || origin > hi) return false;
      continue;
    }
    const t1 = (lo - origin) / delta;
    const t2 = (hi - origin) / delta;
    tMin = Math.max(tMin, Math.min(t1, t2));
    tMax = Math.min(tMax, Math.max(t1, t2));
    if (tMin > tMax) return false;
  }
  return true;
}

/**
 * Can a clinician standing at `standingPosition` see the monitor?
 *
 * The eye is the standing position raised to eye height; the target is the monitor's centre. This
 * is one ray to one point, which is a LOWER BOUND on visibility: a screen half-blocked by a pole
 * can report visible because its centre happens to be clear. Stated rather than hidden — the
 * check is honest about occlusion of the centre, not about how much of the screen is readable.
 */
export function monitorVisibilityFrom(input: {
  standingPosition: Vector3;
  monitorBounds: WorldAabb;
  roomCentre: Vector3;
  obstacles: readonly MeasuredObstacle[];
  eyeHeightMeters?: number;
}): MonitorVisibility {
  const eye: Vector3 = {
    x: input.standingPosition.x,
    y: (input.eyeHeightMeters ?? STANDING_EYE_HEIGHT_METERS),
    z: input.standingPosition.z,
  };
  const screenCentre = centreOf(input.monitorBounds);
  const normal = screenNormal(input.monitorBounds, input.roomCentre);
  const toEye = { x: eye.x - screenCentre.x, y: eye.y - screenCentre.y, z: eye.z - screenCentre.z };
  const dot = toEye.x * normal.x + toEye.y * normal.y + toEye.z * normal.z;
  if (dot <= MIN_VIEWING_SIDE_DOT) return { visible: false, reason: "behind_screen", dot };

  for (const obstacle of input.obstacles) {
    if (segmentIntersectsAabb(eye, screenCentre, obstacle.bounds)) {
      return { visible: false, reason: "occluded", obstacleId: obstacle.id };
    }
  }
  return { visible: true };
}

/**
 * The shipped ED bay's monitor, MEASURED: `BoxGeometry(0.8, 0.55, 0.08)` positioned at
 * `(1.7, 1.45, -0.65)` (xr-station-room/src/index.ts:346-350).
 */
export const ED_MONITOR_BOUNDS: WorldAabb = {
  min: { x: 1.7 - 0.4, y: 1.45 - 0.275, z: -0.65 - 0.04 },
  max: { x: 1.7 + 0.4, y: 1.45 + 0.275, z: -0.65 + 0.04 },
};
