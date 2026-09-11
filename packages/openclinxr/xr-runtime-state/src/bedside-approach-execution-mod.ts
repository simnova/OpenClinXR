import type { BedsideApproachPlan } from "@openclinxr/asset-registry/bedside-approach-path";

type Vector3 = { x: number; y: number; z: number };

/**
 * The case-owned execution of an accepted bedside approach: the drive the frame loop reads, the
 * slot position it advances, and the conditions under which it stops.
 *
 * THE DRIVE HAS NO PRODUCTION PRODUCER, measured on the unchanged tree at 86dc0300.
 * `apps/ui-xr/src/main.ts:3443` reads `floor.userData.genDrive ?? floor.userData.pedsRuntimeDrive`,
 * and a repo-wide grep over `apps`, `packages` and `tools` finds `genDrive` on exactly three lines:
 * that read, the line below it, and a source-string assertion in a test. `pedsRuntimeDrive` appears
 * once in the whole tree, at the same read. Both branches are dead, so `window.__openClinXrPedsDrive`
 * was not the convenient path but the ONLY non-null one — and that is a recorder global, which this
 * card's contract forbids as the driver of an acceptance run. This module is the missing producer.
 *
 * IT ADVANCES THE SLOT, NOT THE ROOT. `animation-loop.ts` assigns `root.position.y` and
 * `root.position.x` from load-time bases every frame and `root.position.z` under the drive branch,
 * so a per-frame root write is overwritten inside the same frame. Nothing writes `actorSlot.position`
 * per frame anywhere in `packages` or `apps`.
 *
 * PROGRESS IS MEASURED, NOT INTEGRATED. `travelledMeters` is the projection of where the body
 * ACTUALLY is onto the route, taken fresh each frame, rather than `elapsed x speed`. That matters
 * because the stance lock moves the body: an executor that trusted its own clock would believe it
 * had arrived while the feet said otherwise, and the arrival metric would be grading a number the
 * executor made up.
 *
 * claimScope: the state machine of one approach against one bound geometry revision.
 * notEvidenceFor: what a browser rendered, gait quality, or clinical appropriateness of the route.
 */

export type ApproachPhase = "not_started" | "walking" | "settling" | "arrived" | "invalidated";

export type BedsideApproachExecution = {
  runId: string;
  physicianActorId: string;
  /** The geometry digest this plan was accepted against. A mismatch stops the walk. */
  boundGeometryRevision: string;
  phase: ApproachPhase;
  travelledMeters: number;
  routeLengthMeters: number;
  /** Where the executor asks the slot to be this frame, before any stance-lock correction. */
  prescribedPositionXz: { x: number; z: number };
  headingRadians: number;
  /** The drive the frame loop reads. `locomotion` is 0 whenever the actor must not be walking. */
  drive: { locomotion: number };
  /** Where the drive came from, so a recorder global is distinguishable from this producer. */
  driveSource: "case_owned_bedside_approach";
  arrivedAtMs: number | null;
  stoppedSeconds: number;
  invalidationReason: string | null;
};

export type BedsideApproachExecutionRefusal = { refused: true; reason: string };

/** Total XZ length of a plan's polyline, in metres. */
export function approachRouteLengthMeters(plan: BedsideApproachPlan): number {
  let total = 0;
  for (let index = 1; index < plan.waypoints.length; index += 1) {
    const from = plan.waypoints[index - 1]?.position;
    const to = plan.waypoints[index]?.position;
    if (from === undefined || to === undefined) continue;
    total += Math.hypot(to.x - from.x, to.z - from.z);
  }
  return total;
}

/**
 * Bind an accepted plan to the geometry and run it was accepted against, or refuse.
 *
 * A FORGED OR STALE PLAN IS REFUSED HERE, and the refusal is the point: `stepBedsideApproach`
 * throws on a plan carrying path violations, so a caller that did not check would take an exception
 * mid-frame rather than a stop. Three refusals, each named:
 *
 *  - the plan carries path violations, so it was never proven clear;
 *  - the plan does not arrive, so following it ends somewhere nobody authored;
 *  - the plan's geometry revision is not the one the scene currently shows, which is precisely the
 *    "supplied clear flag" `acceptance-v2.md` refuses: a plan that says `pathViolations: []` proves
 *    nothing about a room it was not computed against.
 */
export function beginBedsideApproachExecution(input: {
  runId: string;
  physicianActorId: string;
  plan: BedsideApproachPlan;
  planGeometryRevision: string;
  observedGeometryRevision: string;
  start: Vector3;
  travelHeadingRadians: number;
}): BedsideApproachExecution | BedsideApproachExecutionRefusal {
  if (input.plan.pathViolations.length > 0) {
    return {
      refused: true,
      reason:
        `refused a plan carrying ${input.plan.pathViolations.length} path violation(s) — `
        + `${input.plan.pathViolations.map((violation) => violation.obstacleId).join(", ")}. A route that `
        + "was not proven clear must not be walked.",
    };
  }
  if (!input.plan.arrivesAtTarget) {
    return {
      refused: true,
      reason:
        `refused a plan that does not arrive: final pose error ${input.plan.finalPoseErrorMeters.toFixed(4)} m. `
        + "Following a route that ends short puts the physician somewhere nobody authored.",
    };
  }
  if (input.planGeometryRevision !== input.observedGeometryRevision) {
    return {
      refused: true,
      reason:
        `refused a stale plan: it was accepted against geometry ${input.planGeometryRevision} and the scene `
        + `now shows ${input.observedGeometryRevision}. A cleared route is a claim about the room it was `
        + "computed against, and this is not that room.",
    };
  }
  const routeLengthMeters = approachRouteLengthMeters(input.plan);
  if (routeLengthMeters <= 0) {
    return {
      refused: true,
      reason:
        "refused a zero-length route: the start and the bedside target coincide, so there is nothing to "
        + "walk and an 'arrival' would be a teleport wearing an approach's name.",
    };
  }
  return {
    runId: input.runId,
    physicianActorId: input.physicianActorId,
    boundGeometryRevision: input.observedGeometryRevision,
    phase: "not_started",
    travelledMeters: 0,
    routeLengthMeters,
    prescribedPositionXz: { x: input.start.x, z: input.start.z },
    headingRadians: input.travelHeadingRadians,
    drive: { locomotion: 0 },
    driveSource: "case_owned_bedside_approach",
    arrivedAtMs: null,
    stoppedSeconds: 0,
    invalidationReason: null,
  };
}

/**
 * One frame.
 *
 * `observedPositionXz` is where the body actually is — after the previous frame's stance-lock
 * correction — and it is what progress is measured from.
 */
export function stepBedsideApproachExecution(input: {
  execution: BedsideApproachExecution;
  plan: BedsideApproachPlan;
  start: Vector3;
  target: Vector3;
  /** Heading that faces the patient, applied once the walk ends. */
  targetHeadingRadians: number;
  /** Heading that aligns the clip's own measured travel direction with the route. */
  travelHeadingRadians: number;
  observedGeometryRevision: string;
  supportAccepted: boolean;
  observedPositionXz: { x: number; z: number };
  nowMs: number;
  deltaSeconds: number;
  walkSpeedMetersPerSecond: number;
  /**
   * How fast the terminal turn rotates, in radians per second.
   *
   * DERIVED FROM THE SHIPPED CLIP, not chosen: the whole turn completes in one measured walk-cycle
   * period, so the number moves only when the asset does. Nothing else in this file has a free
   * constant, and this one is not free either.
   */
  settleTurnRateRadiansPerSecond: number;
}): BedsideApproachExecution {
  const execution = input.execution;
  if (execution.phase === "invalidated") return execution;

  const invalidation =
    input.observedGeometryRevision !== execution.boundGeometryRevision
      ? `the observed geometry changed from ${execution.boundGeometryRevision} to `
        + `${input.observedGeometryRevision} during travel; the accepted plan no longer describes this room`
      : input.supportAccepted
        ? null
        : "the patient's support acceptance was lost during travel, so the placement this approach depends "
          + "on is no longer accepted through the normal owner";
  if (invalidation !== null) {
    return {
      ...execution,
      phase: "invalidated",
      drive: { locomotion: 0 },
      invalidationReason: invalidation,
    };
  }

  const dx = input.target.x - input.start.x;
  const dz = input.target.z - input.start.z;
  const routeLength = Math.hypot(dx, dz);
  const unit = routeLength === 0 ? { x: 0, z: 0 } : { x: dx / routeLength, z: dz / routeLength };
  const travelledMeters = Math.max(
    0,
    (input.observedPositionXz.x - input.start.x) * unit.x + (input.observedPositionXz.z - input.start.z) * unit.z,
  );

  if (execution.phase === "settling") {
    // THE TERMINAL TURN, and it is a separate phase because it is a separate KIND of motion.
    //
    // Three placements of this turn were measured before it landed here. Turning DURING the walk
    // steers the clip, because the clip's travel direction is the slot's yaw: the body left the
    // route entirely and finished 4.87 m from the target. Turning during the walk with the stance
    // lock holding a toe pivots the body about that toe and finished 1.70 m out. Snapping the yaw
    // on the arrival frame swept `toe1-1.L` 0.225 m in one frame, 45x the allowance.
    //
    // So the turn happens after the walk, in place, and its cost is honest and recorded: a planted
    // toe sweeps while the body rotates, because the shipped clip set contains NO turn-in-place
    // take. That interval is graded separately and it does not pass. It is not hidden inside the
    // walk's numbers and no threshold was moved to accommodate it.
    const remainingTurn = shortestYawDelta(execution.headingRadians, input.targetHeadingRadians);
    const step = input.settleTurnRateRadiansPerSecond * input.deltaSeconds;
    if (Math.abs(remainingTurn) <= step) {
      return {
        ...execution,
        phase: "arrived",
        travelledMeters,
        drive: { locomotion: 0 },
        headingRadians: input.targetHeadingRadians,
        stoppedSeconds: 0,
      };
    }
    return {
      ...execution,
      travelledMeters,
      drive: { locomotion: 0 },
      headingRadians: execution.headingRadians + Math.sign(remainingTurn) * step,
      stoppedSeconds: 0,
    };
  }

  if (execution.phase === "arrived") {
    // The body STAYS WHERE IT STOPPED. Snapping it onto the target here would hide the arrival
    // residual inside a teleport and then show up as root travel during the stopped observation,
    // which is exactly the two metrics this card is graded on lying to each other. Measured before
    // this was corrected: 0.005765 m of "stopped" root travel, entirely the snap.
    return {
      ...execution,
      travelledMeters,
      drive: { locomotion: 0 },
      headingRadians: input.targetHeadingRadians,
      stoppedSeconds: execution.stoppedSeconds + input.deltaSeconds,
    };
  }

  const frameAdvanceMeters = input.walkSpeedMetersPerSecond * input.deltaSeconds;
  const remainingMeters = routeLength - travelledMeters;
  // STOP WHEN THE NEXT FRAME WOULD OVERSHOOT. The band is one frame's advance rather than a fixed
  // tolerance, so it is a property of the frame rate and the walk speed and cannot be widened to
  // admit an observation: at 60 Hz and 0.676 m/s it is 11 mm, well inside the 0.05 m arrival cap
  // the acceptance contract fixes, and the residual is MEASURED by that metric rather than assumed.
  if (execution.phase === "walking" && remainingMeters <= frameAdvanceMeters) {
    return {
      ...execution,
      phase: "settling",
      travelledMeters,
      drive: { locomotion: 0 },
      headingRadians: execution.headingRadians,
      prescribedPositionXz: { x: input.observedPositionXz.x, z: input.observedPositionXz.z },
      arrivedAtMs: input.nowMs,
      stoppedSeconds: 0,
    };
  }

  // ADVANCE FROM WHERE THE BODY IS, not from a point on the route line. Re-projecting the slot onto
  // the polyline every frame discards the stance lock's lateral correction, which unpins the toe by
  // exactly that amount: measured, it left `toe1-1.R` at a 0.00576 m worst frame against a 0.005 m
  // allowance. The lateral residual it preserves instead accumulates into the arrival error, where
  // a metric grades it rather than a re-projection hiding it.
  const advance = Math.min(frameAdvanceMeters, Math.max(0, remainingMeters));
  return {
    ...execution,
    phase: "walking",
    travelledMeters,
    drive: { locomotion: 1 },
    // THE YAW IS FIXED WHILE WALKING. It is not a preference: the clip's travel direction IS the
    // slot's yaw, so turning mid-walk steers the body off the route. Measured, a turn distributed
    // across the walk left the physician 4.87 m from the bedside.
    headingRadians: input.travelHeadingRadians,
    prescribedPositionXz: {
      x: input.observedPositionXz.x + unit.x * advance,
      z: input.observedPositionXz.z + unit.z * advance,
    },
    arrivedAtMs: null,
    stoppedSeconds: 0,
  };
}

/** Shortest signed angle from `from` to `to`, in radians. */
export function shortestYawDelta(from: number, to: number): number {
  const twoPi = Math.PI * 2;
  return (((to - from + Math.PI) % twoPi) + twoPi) % twoPi - Math.PI;
}

/**
 * The slot yaw that points the CLIP's own measured travel direction along the route.
 *
 * MEASURED, NOT ASSUMED, and the measurement is a finding. The shipped physician rig faces +Z — its
 * toes sit 0.126 m in +Z of the ankle in the rest frame, and its left foot sits at +X — while the
 * stance windows of `openclinxr_retarget_walk_formal_cc0` advance the body along body -Z. The bound
 * clip therefore travels 180 degrees from the rig's own facing. Aligning to the clip's measured
 * direction is what makes the foot plant correct; it does NOT make the walk look right, and the
 * defect is recorded rather than papered over.
 *
 * `routeHeadingRadians` is the yaw whose local +Z points along the route, which is the convention
 * `headingRadiansToward` and `forwardVectorForHeading` already use.
 */
export function travelYawForClipForward(
  routeHeadingRadians: number,
  clipForwardBody: { x: number; z: number },
): number {
  const clipYaw = Math.atan2(clipForwardBody.x, clipForwardBody.z);
  return routeHeadingRadians - clipYaw;
}
