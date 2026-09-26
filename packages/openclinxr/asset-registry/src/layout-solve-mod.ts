import { planBedsideApproach, planRoutedBedsideApproach, sweptRouteViolations } from "./bedside-approach-path-mod.js";
import { bedsideClearanceViolations, type MeasuredObstacle } from "./bedside-clearance.js";
import {
  type BedsideTarget,
  bedsideTargetForClinician,
  ED_STRETCHER_DECK_BOUNDS,
  type SupportBounds,
  type Vector3,
} from "./bedside-target.js";
import { planRouteWaypoints } from "./route-planner-mod.js";

/** The walker's standing-footprint radius the route planner inflates obstacles by (SC-00's 0.3 m). */
export const ROUTE_PLANNER_WALKER_RADIUS_METERS = 0.3;

/**
 * One corner of a routed (non-straight) approach, world XZ, in walking order including the start
 * and the target. Y is not carried here — a consumer re-attaches the floor Y it already has.
 *
 * FORMAT FOR THE NEXT STEP (runtime executor, xr-humanoid-animation, not built here): this is the
 * waypoint polyline `resolvedLayout.routeWaypoints` on a `DurableAcceptedScenePlanRecord`, first
 * point is the walker's staged start, last point is the bedside target
 * (`resolvedLayout.targetPosition`), and every point in between is a corner the route planner found
 * around an inflated fixture footprint. An executor plays the walk as a sequence of straight
 * segments between consecutive points, in order — no smoothing or curve-fitting is implied or
 * required; `bedside-approach-path-mod.ts`'s `sweptRouteViolations` already validates the polyline
 * as straight SEGMENTS, so an executor that walks straight lines between points reproduces exactly
 * what was checked.
 */
export type RouteWaypoint = { x: number; z: number };

/**
 * The BROWSER-SAFE half of deterministic layout variation: the candidate search, given a seed.
 *
 * WHY THE SPLIT EXISTS. `layout-variation.ts` derives the seed with `node:crypto`, which a browser
 * cannot resolve — `asset-registry/src/index.ts:2821` records that a root-reachable `node:` builtin
 * broke the ui-xr bundle twice, most recently on 2026-09-09 when this very module's parent was
 * value-exported from the "." entry. SC-06's required_behavior 4 asks to "keep server-only
 * hashing/generation outside browser entry or provide explicit browser-safe interface", and this is
 * that interface: the SEED arrives as a string, already derived, and nothing here hashes anything.
 *
 * That division is not a workaround, it is the replay contract. A frozen encounter persists its
 * seed; reopening it must reproduce the same layout from that persisted seed WITHOUT re-deriving
 * it, because re-deriving would mean the replay could disagree with the freeze about what the
 * inputs were and still look self-consistent.
 *
 * claimScope: deterministic selection of one bedside side and standoff against measured obstacles.
 * notEvidenceFor: clinical appropriateness of the side, the standoff or the working position.
 */

export type ResolvedLayout =
  | {
      resolved: true;
      seed: string;
      target: BedsideTarget;
      approachSide: "patient_left" | "patient_right";
      standoffMeters: number;
      /**
       * Present only when the STRAIGHT route was blocked and the grid-A* planner
       * (`route-planner-mod.ts`) found a clear detour around the inflated fixture footprints.
       * Absent means the straight line already cleared — the common case, and the cheapest to
       * walk. See this file's `RouteWaypoint` doc for the format a runtime executor consumes.
       */
      routeWaypoints?: readonly RouteWaypoint[] | undefined;
    }
  | {
      resolved: false;
      seed: string;
      /** Every candidate tried, and why each failed. Never empty on a refusal. */
      unsatisfied: Array<{ approachSide: string; standoffMeters: number; reason: string }>;
    };

/** Standoffs the resolver will try, nearest first. */
export const STANDOFF_CANDIDATES_METERS = [0.75, 0.9, 1.05] as const;

/**
 * Slide along the bed's head/foot axis the resolver will try, nearest-to-centre first, when the
 * direct-across position (0) is blocked. A factory should not need a hand-authored standing spot
 * per room: this is the second free dimension search, alongside side and standoff, over the room's
 * own measured fixtures.
 */
export const ALONG_BED_OFFSET_CANDIDATES_METERS = [0, 0.3, -0.3, 0.6, -0.6, 0.9, -0.9] as const;

/**
 * Explicit authored intent for the bedside target.
 *
 * Brief §3, deterministic solving: *"fail unsatisfied explicit intent rather than substituting a
 * different target."* Without this the resolver tried BOTH sides and every standoff, so a case that
 * authored "approach from the patient's left" would silently be given the right side whenever the
 * left was blocked — a substitution the author never sees and the seed makes look deliberate.
 *
 * Intent NARROWS the candidate set; it never widens it. An authored side with no authored standoff
 * still tries every standoff on THAT side, which is search within the intent rather than around it.
 */
export type BedsideLayoutIntent = {
  approachSide?: "patient_left" | "patient_right" | undefined;
  standoffMeters?: number | undefined;
  alongOffsetMeters?: number | undefined;
};

/** A seed is a lowercase hex digest. Rejected here so a caller cannot pass a wall clock. */
export const LAYOUT_SEED_PATTERN = /^[0-9a-f]{64}$/u;

/**
 * Resolve a bedside layout for one already-derived seed, or REFUSE with the constraints that failed.
 *
 * Candidate order comes from the seed, so two variation indices explore the sides in different
 * orders while each stays reproducible. Hard constraints are applied BEFORE ranking: a candidate
 * with any clearance violation is never returned, whatever its rank.
 *
 * On failure it returns every candidate it tried with its reason, rather than falling back to a
 * position that violates something.
 */
export function resolveBedsideLayoutFromSeed(input: {
  seed: string;
  patientPosition: Vector3;
  supportBounds?: SupportBounds | undefined;
  obstacles: readonly MeasuredObstacle[];
  /** Authored intent. Absent means the seed explores; present means it does not. */
  intent?: BedsideLayoutIntent | undefined;
  /**
   * Where the walker starts, so a candidate is also checked for a clear ROUTE and swept
   * occupancy, not only a clear standing footprint. Absent (the historical signature) means the
   * search stays footprint-only, as `resolveCaseOwnedScenePlan`'s own separate route/swept check
   * already covers — a caller passing this widens the search itself instead of hand-authoring a
   * standing spot per room.
   */
  start?: Vector3 | undefined;
  /** Required with `start`: the floor's world Y, for the swept-occupancy sample height. */
  floorY?: number | undefined;
}): ResolvedLayout {
  if (!LAYOUT_SEED_PATTERN.test(input.seed)) {
    throw new Error(
      `resolveBedsideLayoutFromSeed: refused seed ${JSON.stringify(input.seed)}. A seed is the 64-hex `
        + "digest deriveLayoutVariationSeed produces; accepting anything else would let a wall clock or a "
        + "random string choose the layout while the record still called it deterministic.",
    );
  }
  const seed = input.seed;
  const bounds = input.supportBounds ?? ED_STRETCHER_DECK_BOUNDS;
  // One byte of the digest picks which side is tried first. Stable for a given seed, different
  // across indices, and never a random choice at call time.
  const sideFirst =
    Number.parseInt(seed.slice(0, 2), 16) % 2 === 0 ? "patient_right" : "patient_left";
  const seedOrderedSides =
    sideFirst === "patient_right"
      ? (["patient_right", "patient_left"] as const)
      : (["patient_left", "patient_right"] as const);
  // Explicit intent replaces the seed's exploration. A failure below then reports the authored
  // target as unsatisfied instead of handing back the other side.
  const sides = input.intent?.approachSide ? [input.intent.approachSide] : seedOrderedSides;
  const standoffs =
    input.intent?.standoffMeters === undefined
      ? STANDOFF_CANDIDATES_METERS
      : [input.intent.standoffMeters];
  const alongOffsets =
    input.intent?.alongOffsetMeters === undefined
      ? ALONG_BED_OFFSET_CANDIDATES_METERS
      : [input.intent.alongOffsetMeters];

  type Candidate = {
    approachSide: "patient_left" | "patient_right";
    standoffMeters: number;
    alongOffsetMeters: number;
    target: BedsideTarget;
  };
  const candidates: Candidate[] = [];
  const unsatisfied: Array<{ approachSide: string; standoffMeters: number; reason: string }> = [];

  // PASS 0 — footprint only, in seed order. A candidate whose STANDING FOOTPRINT collides never
  // reaches either route pass; recording it here keeps this identical to the pre-router behaviour.
  for (const approachSide of sides) {
    for (const standoffMeters of standoffs) {
      for (const alongOffsetMeters of alongOffsets) {
        const target = bedsideTargetForClinician({
          patientPosition: input.patientPosition,
          supportBounds: bounds,
          approachSide,
          standoffMeters,
          alongOffsetMeters,
        });
        const violations = bedsideClearanceViolations({
          standingPosition: target.position,
          obstacles: input.obstacles,
        });
        if (violations.length > 0) {
          unsatisfied.push({
            approachSide,
            standoffMeters,
            reason: `along ${alongOffsetMeters}m: ${violations.map((violation) => violation.reason).join("; ")}`,
          });
          continue;
        }
        candidates.push({ approachSide, standoffMeters, alongOffsetMeters, target });
      }
    }
  }

  if (input.start === undefined) {
    const first = candidates[0];
    if (first) {
      return { resolved: true, seed, target: first.target, approachSide: first.approachSide, standoffMeters: first.standoffMeters };
    }
    return { resolved: false, seed, unsatisfied };
  }
  const start = input.start;

  // PASS 1 — STRAIGHT LINE ONLY, over every footprint-clear candidate, in seed order. A candidate
  // whose straight route is already clear is preferred over ANY routed candidate that comes
  // earlier in the search: routing is a fallback for when nothing resolves the plain way, never a
  // shortcut that preempts a nearer, simpler, already-clear candidate later in the list.
  const straightResults = new Map<Candidate, { plan: ReturnType<typeof planBedsideApproach>; sweptCount: number }>();
  for (const candidate of candidates) {
    const routeTarget: Vector3 = { x: candidate.target.position.x, y: start.y, z: candidate.target.position.z };
    const plan = planBedsideApproach({
      from: start,
      target: routeTarget,
      facing: input.patientPosition,
      obstacles: input.obstacles,
    });
    const swept = sweptRouteViolations({
      waypoints: plan.waypoints,
      obstacles: input.obstacles,
      ...(input.floorY === undefined ? {} : { floorY: input.floorY }),
    });
    const blocked = plan.pathViolations.length > 0 || !plan.arrivesAtTarget || swept.length > 0;
    if (!blocked) {
      return {
        resolved: true,
        seed,
        target: candidate.target,
        approachSide: candidate.approachSide,
        standoffMeters: candidate.standoffMeters,
      };
    }
    straightResults.set(candidate, { plan, sweptCount: swept.length });
  }

  // PASS 2 — ROUTED FALLBACK, only reached when NO candidate resolved via a straight line. A human
  // walking a room with no direct-across spot steps around the nearest obstacle rather than
  // reporting it as unsatisfiable_intent; this is that step, tried in the SAME seed order, after
  // the plain search has genuinely been exhausted.
  for (const candidate of candidates) {
    const routeTarget: Vector3 = { x: candidate.target.position.x, y: start.y, z: candidate.target.position.z };
    const straight = straightResults.get(candidate);
    const routedWaypoints = planRouteWaypoints({
      start: { x: start.x, z: start.z },
      target: { x: routeTarget.x, z: routeTarget.z },
      obstacles: input.obstacles,
      walkerRadiusMeters: ROUTE_PLANNER_WALKER_RADIUS_METERS,
    });
    let routedBlockedReason: string | null = null;
    if (routedWaypoints !== null && routedWaypoints.length >= 2) {
      const polyline: Vector3[] = routedWaypoints.map((point) => ({ x: point.x, y: start.y, z: point.z }));
      const routedPlan = planRoutedBedsideApproach({
        polyline,
        target: routeTarget,
        facing: input.patientPosition,
        obstacles: input.obstacles,
      });
      const routedSwept = sweptRouteViolations({
        waypoints: routedPlan.waypoints,
        obstacles: input.obstacles,
        ...(input.floorY === undefined ? {} : { floorY: input.floorY }),
      });
      const routedBlocked = routedPlan.pathViolations.length > 0 || !routedPlan.arrivesAtTarget || routedSwept.length > 0;
      if (!routedBlocked) {
        return {
          resolved: true,
          seed,
          target: candidate.target,
          approachSide: candidate.approachSide,
          standoffMeters: candidate.standoffMeters,
          routeWaypoints: routedWaypoints,
        };
      }
      routedBlockedReason = "routed: a detour was found but still failed clearance/swept checks";
    } else {
      routedBlockedReason = "routed: no path found around the inflated fixture footprints";
    }

    const routeReasons: string[] = [];
    if (straight) {
      if (straight.plan.pathViolations.length > 0) {
        routeReasons.push(
          `route: ${straight.plan.pathViolations.map((violation) => `${violation.obstacleId}: ${violation.reason}`).join("; ")}`,
        );
      }
      if (!straight.plan.arrivesAtTarget) {
        routeReasons.push(`does not arrive: final pose error ${straight.plan.finalPoseErrorMeters.toFixed(4)} m`);
      }
      if (straight.sweptCount > 0) {
        routeReasons.push(`swept: ${straight.sweptCount} obstacle(s) intersected along the straight route`);
      }
    }
    routeReasons.push(routedBlockedReason);
    unsatisfied.push({
      approachSide: candidate.approachSide,
      standoffMeters: candidate.standoffMeters,
      reason: `along ${candidate.alongOffsetMeters}m: ${routeReasons.join("; ")}`,
    });
  }
  return { resolved: false, seed, unsatisfied };
}
