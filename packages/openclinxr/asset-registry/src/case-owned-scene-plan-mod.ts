import { type BedsideApproachPlan, planBedsideApproach, sweptRouteViolations } from "./bedside-approach-path-mod.js";
import type { MeasuredObstacle } from "./bedside-clearance.js";
import type { BedsideTarget, SupportBounds, Vector3 } from "./bedside-target.js";
import { geometryRevisionDigest, type ObservedApproachGeometry } from "./case-approach-intent-mod.js";
import { type BedsideLayoutIntent, resolveBedsideLayoutFromSeed } from "./layout-solve-mod.js";

/**
 * THE CASE-OWNED PRODUCTION CONSUMER of the deterministic layout solver.
 *
 * WHY THIS EXISTS, measured on the unchanged baseline 27efa3d2. A repo-wide grep over `apps`,
 * `packages` and `tools` excluding `dist/` finds `resolveBedsideLayout`
 * (asset-registry/src/layout-variation.ts:126) and `deriveLayoutVariationSeed` (:62) in exactly
 * three places: their declaring module, two test files, and one architecture comment at
 * `index.ts:2821` explaining why the subpath exists. ZERO production callers. SC-06's
 * required_behavior 2 says "Do not just hash an unused layout helper" — that is a description of
 * the CURRENT state, not a hypothetical, and a new hash over the same inert helper closes nothing.
 *
 * So the solver gets a consumer here, and its output is what SC-06 freezes and replays.
 *
 * WHAT THIS ADDS OVER `resolveBedsideApproachIntent`. That function derives the approach side from
 * the case's authored START POSITION and tries exactly one standoff
 * (`case-approach-intent.ts:189-196`). It cannot explore, so "exercise several permitted variation
 * indices" has nowhere to happen. This one takes a SEED and a variation index, explores the
 * authorized candidates in a seed-stable order, and narrows to authored intent when the case
 * states one — so an impossible authored intent fails with the constraints that defeated it
 * instead of being handed a side nobody authored. The seed's exploration is the solver's own
 * (`layout-solve.ts:93-101`); this module supplies the seed and consumes the answer.
 *
 * BROWSER-SAFE BY CONSTRUCTION. No `node:` builtin is reachable from this module: the seed arrives
 * already derived. `scene-plan-freeze.ts` is the node-only half that derives it and hashes bytes.
 *
 * claimScope: geometric resolution and route planning for one case's bedside layout against one
 * observed room, at one variation index.
 * notEvidenceFor: clinical appropriateness of the side, the standoff or the working position; what
 * a browser rendered; gait quality. Those are separate claims with separate evidence.
 */

/** The solver identity that is frozen into the record. A change here moves every seed. */
export const CASE_SCENE_PLAN_SOLVER_VERSION = "openclinxr.bedside-layout-solver.v1";

/**
 * Variation indices this case may explore. A frozen record naming any other index is refused.
 *
 * WHY TEN, and the provenance is a measurement of the SEED, not of the outcome. The seed's first
 * byte picks which side the solver tries first (`layout-solve.ts:93`), so an index only reaches a
 * different decision when it flips that parity. Measured across indices 0-39 for this case: 18
 * right-first, 22 left-first — near even, as a digest should be. But the first FOUR indices are
 * uniformly right-first, so a window of four exercises exactly one order and "several permitted
 * indices explore authorized choices" would have been true of the seeds and false of the layouts.
 * Ten indices makes a one-sided window a 2^-9 event on that measured split.
 *
 * The number is therefore derived from the digest's own distribution and from the size at which a
 * window stops being one-sided. It is not the smallest set that happens to flip — that would be
 * five, and picking five because five works is fitting the constant to the result.
 */
export const CASE_SCENE_PLAN_AUTHORIZED_VARIATION_INDICES = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9] as const;

export type CaseScenePlanConflict = {
  /** Which hard constraint defeated this candidate. */
  constraint: "working_clearance" | "route_blocked" | "swept_occupancy" | "does_not_arrive";
  approachSide: string;
  standoffMeters: number;
  reason: string;
};

export type CaseOwnedScenePlanRefusal = {
  resolved: false;
  seed: string;
  variationIndex: number;
  /** Never empty. Every candidate the solver tried, and the constraint that defeated it. */
  conflicts: CaseScenePlanConflict[];
};

export type CaseOwnedScenePlan = {
  resolved: true;
  seed: string;
  variationIndex: number;
  solverVersion: string;
  approachSide: "patient_left" | "patient_right";
  standoffMeters: number;
  target: BedsideTarget;
  plan: BedsideApproachPlan;
  /** The digest of the geometry this plan was solved against. */
  geometryRevision: string;
  /** Obstacle ids actually observed, so an empty observation cannot masquerade as a clear room. */
  observedObstacleIds: string[];
  floorFrameId: string;
};

export type CaseOwnedScenePlanResult = CaseOwnedScenePlan | CaseOwnedScenePlanRefusal;

export function isAuthorizedVariationIndex(index: number): boolean {
  return (CASE_SCENE_PLAN_AUTHORIZED_VARIATION_INDICES as readonly number[]).includes(index);
}

/**
 * Resolve one variation of the case's bedside layout, or refuse with every constraint that failed.
 *
 * TWO STAGES, and the division of labour is the contract. The solver decides the LAYOUT — which
 * side and which standoff — against the measured obstacles and the case's intent, and its answer is
 * taken as given. This function then checks the ROUTE to that answer: path violations, arrival, and
 * swept occupancy, the last of which is the thin-obstacle case the 0.35 m waypoint samples cannot
 * see (`bedside-approach-path.ts:54`).
 *
 * A failure at either stage REFUSES with the constraints named. Nothing falls back to the other
 * side: the solver's own doctrine is to "fail unsatisfied explicit intent rather than substituting a
 * different target", and a route check that silently re-ran the solver with the losing side excluded
 * would be that substitution wearing this function's name.
 */
export function resolveCaseOwnedScenePlan(input: {
  seed: string;
  variationIndex: number;
  patientWorldPosition: Vector3;
  start: Vector3;
  supportBounds?: SupportBounds | undefined;
  geometry: ObservedApproachGeometry;
  /** The case's authored intent. Absent means the seed explores the authorized candidates. */
  intent?: BedsideLayoutIntent | undefined;
  waypointSpacingMeters?: number | undefined;
}): CaseOwnedScenePlanResult {
  if (!isAuthorizedVariationIndex(input.variationIndex)) {
    throw new Error(
      `resolveCaseOwnedScenePlan: variation index ${input.variationIndex} is not authorized. `
        + `Authorized indices are ${CASE_SCENE_PLAN_AUTHORIZED_VARIATION_INDICES.join(", ")}; exploring `
        + "outside them would let a replay claim a choice the case never permitted.",
    );
  }
  const floorFrame = input.geometry.floorFrame;
  if (floorFrame === null) {
    throw new Error(
      "resolveCaseOwnedScenePlan: no floor frame was observed. A standing target has no anchor and a "
        + "signed contact height has no datum, so there is nothing to freeze.",
    );
  }
  if (input.geometry.obstacles.length === 0) {
    throw new Error(
      "resolveCaseOwnedScenePlan: the runtime observed no obstacle geometry at all. An empty list is "
        + "the observation failing, not the room being empty, and a plan solved against it would be a "
        + "clearance claim with no measurement behind it.",
    );
  }

  const bounds = input.supportBounds ?? input.geometry.supportBounds;
  const geometryRevision = geometryRevisionDigest(input.geometry);
  const observedObstacleIds = input.geometry.obstacles.map((obstacle) => obstacle.id);
  const obstacles: readonly MeasuredObstacle[] = input.geometry.obstacles;

  // THE SOLVER OWNS THE LAYOUT DECISION. It is handed the real measured obstacles and the case's
  // real intent, and what it returns is what gets frozen. It is not probed, ranked or second-
  // guessed here: a consumer that re-derived the side would make the solver decorative again,
  // which is the defect this card exists to close.
  const layout = resolveBedsideLayoutFromSeed({
    seed: input.seed,
    patientPosition: input.patientWorldPosition,
    supportBounds: bounds,
    obstacles,
    ...(input.intent === undefined ? {} : { intent: input.intent }),
  });
  if (!layout.resolved) {
    return {
      resolved: false,
      seed: input.seed,
      variationIndex: input.variationIndex,
      conflicts: layout.unsatisfied.map((entry) => ({
        constraint: "working_clearance" as const,
        approachSide: entry.approachSide,
        standoffMeters: entry.standoffMeters,
        reason: entry.reason,
      })),
    };
  }

  // The ROUTE is this consumer's half: the solver checks the destination's standing footprint and
  // never looks at how the physician gets there. A blocked route REFUSES with the obstacle named;
  // it does not fall back to the other side, because a physician standing where nobody authored is
  // worse than an approach that refuses.
  const destination: Vector3 = {
    x: layout.target.position.x,
    y: input.start.y,
    z: layout.target.position.z,
  };
  const plan = planBedsideApproach({
    from: input.start,
    target: destination,
    facing: input.patientWorldPosition,
    obstacles,
    ...(input.waypointSpacingMeters === undefined
      ? {}
      : { spacingMeters: input.waypointSpacingMeters }),
  });
  const conflicts: CaseScenePlanConflict[] = [];
  if (plan.pathViolations.length > 0) {
    conflicts.push({
      constraint: "route_blocked",
      approachSide: layout.approachSide,
      standoffMeters: layout.standoffMeters,
      reason: plan.pathViolations
        .map((violation) => `${violation.obstacleId}: ${violation.reason}`)
        .join("; "),
    });
  }
  if (!plan.arrivesAtTarget) {
    conflicts.push({
      constraint: "does_not_arrive",
      approachSide: layout.approachSide,
      standoffMeters: layout.standoffMeters,
      reason: `final pose error ${plan.finalPoseErrorMeters.toFixed(4)} m`,
    });
  }
  const swept = sweptRouteViolations({
    waypoints: plan.waypoints,
    obstacles,
    floorY: floorFrame.originY,
  });
  if (swept.length > 0) {
    conflicts.push({
      constraint: "swept_occupancy",
      approachSide: layout.approachSide,
      standoffMeters: layout.standoffMeters,
      reason: swept.map((violation) => `${violation.obstacleId}: ${violation.reason}`).join("; "),
    });
  }
  if (conflicts.length > 0) {
    return { resolved: false, seed: input.seed, variationIndex: input.variationIndex, conflicts };
  }

  return {
    resolved: true,
    seed: input.seed,
    variationIndex: input.variationIndex,
    solverVersion: CASE_SCENE_PLAN_SOLVER_VERSION,
    approachSide: layout.approachSide,
    standoffMeters: layout.standoffMeters,
    target: layout.target,
    plan,
    geometryRevision,
    observedObstacleIds,
    floorFrameId: floorFrame.frameId,
  };
}
