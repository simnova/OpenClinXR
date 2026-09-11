import {
  type BedsideApproachPlan,
  planBedsideApproach,
  sweptRouteViolations,
} from "./bedside-approach-path.js";
import {
  bedsideClearanceViolations,
  type ClearanceViolation,
  type MeasuredObstacle,
  type WorldAabb,
} from "./bedside-clearance.js";
import {
  BEDSIDE_STANDOFF_METERS,
  type BedsideTarget,
  bedsideTargetForClinician,
  type SupportBounds,
  type Vector3,
} from "./bedside-target.js";
import { type MonitorVisibility, monitorVisibilityFrom } from "./monitor-visibility.js";

/**
 * The case's own approach intent, resolved against the geometry the room ACTUALLY mounts.
 *
 * WHY THIS EXISTS, measured on the unchanged tree at 86dc0300:
 *
 *  - `bedsideClinicianPlacement` (bedside-target.ts:112) takes only a posture. It computes the
 *    bedside destination from the literal ED patient position `{x: -0.9, y: 0, z: -0.1}` and the
 *    literal `ED_STRETCHER_DECK_BOUNDS`, for every case in every room. The ward case composes its
 *    patient 0.12 m away from that constant, so the shipped destination misses her by 0.12 m —
 *    2.4x the 0.05 m arrival cap the acceptance contract fixes. `acceptance-v2.md`: "Observe actual
 *    anatomy and equipment configuration rather than substituting fixed ED coordinates."
 *  - It also delivers that destination as the physician's PLACEMENT, so the fourth slot is staged
 *    at the arrived pose and there is nothing left to walk. The case authors his start
 *    (`plantOffsetMeters {x: -1.95, y: 0, z: 1.72}`, "starts at the ward doorway") and the runtime
 *    never reads it.
 *  - Nothing supplied an obstacle set, so no route was ever checked against the room. This card's
 *    contract: "no empty obstacle list or hardcoded ED position can establish safety."
 *
 * WHAT IS DELIBERATELY NOT HERE. No detour, no side substitution and no fallback destination. A
 * blocked authored side REFUSES; picking the other side would be the substitution A05 forbids, and
 * an approach that quietly relocates is one nobody authored.
 *
 * claimScope: geometric resolution of one case's authored approach against one observed room.
 * notEvidenceFor: clinical appropriateness of the side, the standoff or the working position —
 * those are engineering distances and need qualified review, which has not happened.
 */

type ApproachRefusalCode =
  | "physician_not_cast"
  | "non_physician_in_first_clinical_slot"
  | "no_named_floor_frame"
  | "no_observed_obstacle_geometry"
  | "authored_start_unresolvable"
  | "authored_side_blocked"
  | "route_blocked";

type BedsideApproachRefusal = { refused: true; code: ApproachRefusalCode; reason: string };

/** The floor frame a standing start is authored against, observed off the live room. */
export type ObservedFloorFrame = {
  frameId: string;
  originY: number;
  originXz: { x: number; z: number };
  /** Plane normal, so a ramp is refused by the rubric rather than graded as flat. */
  normal: Vector3;
};

/** Everything the runtime saw of the room when this intent was resolved. */
export type ObservedApproachGeometry = {
  floorFrame: ObservedFloorFrame | null;
  supportInstanceId: string;
  supportBounds: SupportBounds;
  obstacles: readonly MeasuredObstacle[];
  monitorBounds: WorldAabb | null;
  /** The instance the monitor bounds came from, so it is not treated as its own occluder. */
  monitorInstanceId: string | null;
  roomCentre: Vector3;
};

export type ResolvedBedsideApproach = {
  refused: false;
  physicianActorId: string;
  /** World start, composed from the case's authored offset against the named floor frame. */
  start: Vector3;
  target: BedsideTarget;
  standoffMeters: number;
  /** The side is derived from the case's own authored start, never defaulted. */
  approachSideSource: "case_authored_start_position";
  plan: BedsideApproachPlan;
  /** Swept-occupancy violations, which the 0.35 m waypoint samples cannot see. */
  sweptViolations: ClearanceViolation[];
  /** Standing-footprint violations at the destination itself: the working clearance. */
  workingClearanceViolations: ClearanceViolation[];
  monitorVisibility: MonitorVisibility | null;
  observedObstacleIds: string[];
  floorFrameId: string;
  /**
   * A digest of the geometry this plan was resolved against. The executor refuses to step a plan
   * whose revision no longer matches what the scene shows, which is how "a change during travel
   * must stop/invalidate the approach" is enforced against a forged or stale plan.
   */
  geometryRevision: string;
};

type BedsideApproachIntent = ResolvedBedsideApproach | BedsideApproachRefusal;

/**
 * FNV-1a over a canonical rendering of the observed geometry.
 *
 * Not `node:crypto`: this module is reachable from the browser entry, and
 * `asset-registry/src/index.ts` already records that a root-reachable `node:` builtin breaks the
 * client bundle. Millimetre rounding is deliberate — a revision that changed on float noise would
 * invalidate every plan on every frame and the stop would become the normal case.
 */
export function geometryRevisionDigest(geometry: ObservedApproachGeometry): string {
  const round = (value: number): string => (Math.round(value * 1000) / 1000).toFixed(3);
  const box = (bounds: WorldAabb | SupportBounds): string =>
    `${round(bounds.min.x)},${round(bounds.min.y)},${round(bounds.min.z)};${round(bounds.max.x)},${round(bounds.max.y)},${round(bounds.max.z)}`;
  const parts = [
    `floor:${geometry.floorFrame?.frameId ?? "(none)"}@${round(geometry.floorFrame?.originY ?? Number.NaN)}`,
    `support:${geometry.supportInstanceId}[${box(geometry.supportBounds)}]`,
    `monitor:${geometry.monitorBounds ? box(geometry.monitorBounds) : "(none)"}`,
    ...[...geometry.obstacles]
      .map((obstacle) => `obstacle:${obstacle.id}[${box(obstacle.bounds)}]`)
      .sort(),
  ];
  let hash = 0x811c9dc5;
  const text = parts.join("|");
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return `geom-v1-${hash.toString(16).padStart(8, "0")}-${parts.length}`;
}

/**
 * Which side of the support the CASE put its physician on.
 *
 * The side axis is the support's SHORT plan axis, the same choice `bedsideTargetForClinician`
 * makes, because the patient lies along the long one. The sign comes from the authored start:
 * a physician who starts on the +side of that axis approaches from the +side. Nothing here
 * defaults — a case that authors no start reaches this function's caller as a refusal first.
 */
function approachSideForAuthoredStart(input: {
  start: Vector3;
  supportBounds: SupportBounds;
}): "patient_left" | "patient_right" {
  const spanX = input.supportBounds.max.x - input.supportBounds.min.x;
  const spanZ = input.supportBounds.max.z - input.supportBounds.min.z;
  const axis = spanX >= spanZ ? "z" : "x";
  const centre = (input.supportBounds.min[axis] + input.supportBounds.max[axis]) / 2;
  return input.start[axis] >= centre ? "patient_right" : "patient_left";
}

export function resolveBedsideApproachIntent(input: {
  /** The physician the case cast, or null when it cast none. */
  physicianActorId: string | null;
  /** Who actually occupies the first clinical slot, and the role the case gives them. */
  firstClinicalSlotActorId: string;
  firstClinicalSlotRole: string;
  /** The composed world position of the patient, as the placement owner resolved it. */
  patientWorldPosition: Vector3;
  /** The composed world start, or a refusal reason when the authored start did not resolve. */
  start: Vector3 | { refused: true; reason: string };
  geometry: ObservedApproachGeometry;
  standoffMeters?: number;
  waypointSpacingMeters?: number;
}): BedsideApproachIntent {
  const physicianActorId = input.physicianActorId;
  if (physicianActorId === null || physicianActorId.trim() === "") {
    return {
      refused: true,
      code: "physician_not_cast",
      reason:
        "the case cast no physician into the approaching slot. An encounter with no physician has no "
        + "approach; promoting whoever else is on stage would be the actor substitution A05 forbids.",
    };
  }
  if (input.firstClinicalSlotActorId === physicianActorId && input.firstClinicalSlotRole !== "physician") {
    return {
      refused: true,
      code: "non_physician_in_first_clinical_slot",
      reason:
        `${input.firstClinicalSlotActorId} occupies the approaching slot with role `
        + `"${input.firstClinicalSlotRole}". A nurse in the first clinical slot is not a physician who `
        + "walks to the bedside, and casting one as the approacher is the substitution A05 forbids.",
    };
  }
  const floorFrame = input.geometry.floorFrame;
  if (floorFrame === null) {
    return {
      refused: true,
      code: "no_named_floor_frame",
      reason:
        "no floor frame was observed in the scene. acceptance-v2.md: \"Standing requires a named floor "
        + "frame\"; without one a standing start has no anchor and a signed contact height has no datum.",
    };
  }
  if (input.geometry.obstacles.length === 0) {
    return {
      refused: true,
      code: "no_observed_obstacle_geometry",
      reason:
        "the runtime observed no obstacle geometry at all. acceptance-v2.md: \"Do not claim a route clear "
        + "from empty obstacle input.\" An empty list is the observation failing, not the room being empty.",
    };
  }
  if ("refused" in input.start) {
    return { refused: true, code: "authored_start_unresolvable", reason: input.start.reason };
  }

  const standoffMeters = input.standoffMeters ?? BEDSIDE_STANDOFF_METERS;
  const approachSide = approachSideForAuthoredStart({
    start: input.start,
    supportBounds: input.geometry.supportBounds,
  });
  const target = bedsideTargetForClinician({
    patientPosition: input.patientWorldPosition,
    supportBounds: input.geometry.supportBounds,
    approachSide,
    standoffMeters,
  });
  const destination: Vector3 = { x: target.position.x, y: input.start.y, z: target.position.z };

  const workingClearanceViolations = bedsideClearanceViolations({
    standingPosition: destination,
    obstacles: input.geometry.obstacles,
    floorY: floorFrame.originY,
  });
  if (workingClearanceViolations.length > 0) {
    return {
      refused: true,
      code: "authored_side_blocked",
      reason:
        `the ${approachSide} side the case's authored start selects is blocked at the destination by `
        + `${workingClearanceViolations.map((violation) => violation.obstacleId).join(", ")}. The other side is `
        + "NOT substituted: a physician standing where nobody authored is worse than an approach that refuses.",
    };
  }

  const plan = planBedsideApproach({
    from: input.start,
    target: destination,
    facing: input.patientWorldPosition,
    obstacles: input.geometry.obstacles,
    ...(input.waypointSpacingMeters === undefined ? {} : { spacingMeters: input.waypointSpacingMeters }),
  });
  const sweptViolations = sweptRouteViolations({
    waypoints: plan.waypoints,
    obstacles: input.geometry.obstacles,
    floorY: floorFrame.originY,
  });
  if (plan.pathViolations.length > 0 || sweptViolations.length > 0) {
    const blocked = [...plan.pathViolations, ...sweptViolations].map((violation) => violation.obstacleId);
    return {
      refused: true,
      code: "route_blocked",
      reason:
        `the route from the authored start to the bedside is blocked by ${[...new Set(blocked)].join(", ")}. `
        + `${sweptViolations.length} of those were found only by the swept re-sample, which is the thin-obstacle `
        + "case the 0.35 m waypoints cannot see.",
    };
  }

  return {
    refused: false,
    physicianActorId,
    start: input.start,
    target,
    standoffMeters,
    approachSideSource: "case_authored_start_position",
    plan,
    sweptViolations,
    workingClearanceViolations,
    monitorVisibility:
      input.geometry.monitorBounds === null
        ? null
        : monitorVisibilityFrom({
            standingPosition: destination,
            monitorBounds: input.geometry.monitorBounds,
            roomCentre: input.geometry.roomCentre,
            // THE SCREEN IS NOT ITS OWN OCCLUDER. `monitorVisibilityFrom` casts one ray from the
            // eye to the screen's CENTRE, which lies inside the screen's own bounds, so leaving the
            // display in the occluder list makes every monitor report itself blocked — measured on
            // this ward, `visible: false, reason: "occluded", obstacleId: "…:wall_board"` from a
            // position with clear line of sight.
            obstacles: input.geometry.obstacles.filter(
              (obstacle) => obstacle.id !== input.geometry.monitorInstanceId,
            ),
          }),
    observedObstacleIds: input.geometry.obstacles.map((obstacle) => obstacle.id),
    floorFrameId: floorFrame.frameId,
    geometryRevision: geometryRevisionDigest(input.geometry),
  };
}
