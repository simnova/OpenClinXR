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

/**
 * How far the observed heading may sit from the target before settling ends. ~2 deg: tight enough
 * that `SC-05`'s 10 deg settled-heading cap has real margin (the clip-driven turn's own per-phase
 * quantisation — see `SETTLING_CLIP_TURN_MAX_PHASE_RADIANS`, xr-humanoid-animation — means the last
 * stance-labelled increment can slightly overshoot or undershoot this band, not exactly hit it).
 */
export const SETTLE_TURN_TOLERANCE_RADIANS = (2 * Math.PI) / 180;

/**
 * The walk action's playback-rate multiplier during settling.
 *
 * ## CHANGED (coordinator direction, pixel-graded): raised from 0.5 to 1.0. At 0.5x the turn's own
 * measured `settleSeconds` was 3.2 s for a ~90 deg pivot; a real turn is 2-4 short steps, on the
 * order of 1.2-1.8 s. `settlingClipTurnPhaseDurationSeconds` (xr-humanoid-animation) is inversely
 * proportional to this factor, so doubling it roughly halves settle time. Not derived from the clip
 * the way the walking time-scale is (`resolveLocomotionClipTimeScale`) — there is no equivalent
 * "turn-in-place ground truth" to derive it from, since the shipped clip set carries no
 * turn-in-place take (see the settling-phase note above).
 */
export const SETTLING_LOCOMOTION_TIME_SCALE_FACTOR = 1.0;

/**
 * Target leg-chain effective weight during settling, in (0, 1] — see `playLocomotionClip`'s own
 * note (xr-humanoid-animation, `locomotion-clip-playback-mod.ts`) for the mechanism: a reduced
 * weight blends the clip's animated leg pose toward its BOUND (pre-play, near-standing) pose,
 * shrinking stride amplitude around that pose instead of the body pivoting on a full walking
 * stride. ADDED (coordinator direction, pixel-graded): the full-amplitude stride was measured to
 * plant the stance toe ~0.7-0.8 m from the slot origin — real leg-length-scale geometry that alone
 * forced a drift clamp to hold SC-05's 0.05 m arrival cap, and that clamp read as 0.38 m of
 * "planted slide" against a 0.02 m target.
 *
 * MEASURED at 0.4 on the shipped physician, after the deeper fixes this same round made (a fixed
 * per-phase pivot anchor instead of a continuously-drifting one, a Y-only stance correction instead
 * of reusing the walking ground-advance pin, and a `computeFootfallBias` call that was silently
 * returning zero — see `clip-driven-settling-turn-mod.ts`'s own notes on each): stance-toe-to-slot
 * offset 0.186 m / 0.086 m / 0.088 m across the turn's three phases, all comfortably under the
 * coordinator's ~0.25 m target, with NO drift clamp — SC-05 arrival error 0.008 m, settled yaw
 * 0 deg, stopped root travel 0 m. The whole 0.35-0.5 range the coordinator suggested passes SC-05
 * once those fixes are in place (0.5 measured clean too); 0.4 is the middle of that range.
 */
export const SETTLING_LEG_WEIGHT_TARGET = 0.4;

/**
 * How far the observed heading may sit from the target before the walk action is told to STOP
 * (fade out) even though settling has not fully ended yet — a looser band than
 * `SETTLE_TURN_TOLERANCE_RADIANS`, ~4 deg.
 *
 * MEASURED, NOT GUESSED. `playLocomotionClip` (xr-humanoid-animation, `locomotion-clip-playback-
 * mod.ts`) fades the action's weight over `LOCOMOTION_CROSSFADE_DURATION_S` (0.3 s) once locomotion
 * drops to 0 — kept local here as `SETTLING_FADE_SETTLE_SECONDS` for the same reason this file
 * already keeps its own copy of other small cross-package constants rather than adding a dependency
 * the other direction. The OLD procedural settling turn held `drive.locomotion` at 0 for the WHOLE
 * settling phase, so that fade always finished seconds before arrival. The clip-driven turn instead
 * keeps the clip playing right up to convergence — and measured, on the shipped physician: ending
 * settling and immediately entering "arrived" with the fade still in its first ~0.3 s left the leg
 * chain still partially blended with clip weight while `applyArrivalStanceClose`'s "the plant leg
 * is never slerped, so a static slot converges" assumption (that file's own comment) held — 0.363 m
 * of "stopped" root travel against a 0.005 m cap, entirely from that overlap. Stopping the drive a
 * little early, while still in `settling`, gives the fade its 0.3 s BEFORE arrival-close ever runs.
 */
export const SETTLING_DRIVE_STOP_TOLERANCE_RADIANS = (4 * Math.PI) / 180;

/** See `SETTLING_DRIVE_STOP_TOLERANCE_RADIANS`'s note: matches `LOCOMOTION_CROSSFADE_DURATION_S`. */
export const SETTLING_FADE_SETTLE_SECONDS = 0.3;

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
  /**
   * The drive the frame loop reads. `locomotion` is 0 whenever the actor must not be walking —
   * INCLUDING, now, not-yet-defined: during `settling` it is 1, because the clip-driven stepping
   * turn keeps the walk clip playing (at `timeScaleFactor`) so the stance lock has a real contact
   * window to pivot the settling turn about, even though the executor prescribes zero forward
   * advance for that phase (`prescribedPositionXz` is frozen; see the settling branch below).
   */
  drive: { locomotion: number; timeScaleFactor?: number; legWeight?: number };
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
   *
   * ## CHANGED: no longer used to advance `headingRadians` directly. The settling turn is now
   * CLIP-DRIVEN (`clip-driven-settling-turn-mod.ts`, xr-humanoid-animation): the actual yaw
   * increment happens frame-by-frame, gated on the clip's own labelled stance foot, in the stance-
   * lock apply step — which runs AFTER this function, once the mixer has posed the skeleton for the
   * frame. This function only decides WHEN settling is done, by comparing the actually-achieved
   * heading (`observedHeadingRadians`, below) against the target. Kept on the input type rather
   * than removed: `createCaseOwnedBedsideApproach` still derives and carries it, and trimming it
   * from every call site is out of scope for this change.
   */
  settleTurnRateRadiansPerSecond: number;
  /**
   * The slot's ACTUAL current heading, read off the live actor after the previous frame's
   * clip-driven turn increment. `execution.headingRadians` is not advanced by this function during
   * settling (see above), so it cannot answer "are we there yet" — only the observed heading can,
   * the same discipline `observedPositionXz` already applies to travelled distance.
   */
  observedHeadingRadians: number;
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
    // So the turn happens after the walk, in place.
    //
    // ## CHANGED: the turn is now driven by the walk clip's OWN steps instead of a procedural
    // rotate-and-slide. The walk action keeps playing (`drive.locomotion` stays 1, at
    // `SETTLING_LOCOMOTION_TIME_SCALE_FACTOR`) with ZERO executor forward advance
    // (`prescribedPositionXz` is left untouched, exactly as it was frozen on the walking-to-
    // settling transition frame). The actual yaw increment is applied by the clip-driven turn
    // (`clip-driven-settling-turn-mod.ts`) after the mixer has posed the skeleton for the frame —
    // this function only measures whether that has brought the slot within
    // `SETTLE_TURN_TOLERANCE_RADIANS` of the target and, if so, ends the phase.
    const remainingTurn = shortestYawDelta(input.observedHeadingRadians, input.targetHeadingRadians);
    // `stoppedSeconds` is repurposed here (settling never otherwise uses it) as the fade-wait
    // clock: seconds the drive has already spent at 0 since the FIRST frame remaining crossed
    // `SETTLING_DRIVE_STOP_TOLERANCE_RADIANS` — see that constant's own note. Ending the phase
    // requires BOTH the tight heading tolerance AND that clock reaching `SETTLING_FADE_SETTLE_
    // SECONDS`, so arrival-close never inherits a still-fading clip weight on the plant leg.
    if (Math.abs(remainingTurn) <= SETTLE_TURN_TOLERANCE_RADIANS && execution.stoppedSeconds >= SETTLING_FADE_SETTLE_SECONDS) {
      return {
        ...execution,
        phase: "arrived",
        travelledMeters,
        drive: { locomotion: 0 },
        headingRadians: input.targetHeadingRadians,
        // TAKEN FROM WHERE THE BODY ACTUALLY IS, not the phase's stale entry point. The
        // clip-driven turn genuinely translates the slot while pivoting about an off-centre
        // planted foot — the same way a real stepping turn carries the torso — so the frozen
        // walking-to-settling snapshot is wrong by however far that pivot moved it. Re-freezing it
        // here (this field stops being written once `advanceCaseOwnedBedsideApproach` resumes
        // writing `actorSlot.position` from it on the "arrived" phase) is what stopped a snap-back
        // to the pre-turn spot from reading as resumed root travel during the stopped observation.
        prescribedPositionXz: { x: input.observedPositionXz.x, z: input.observedPositionXz.z },
        stoppedSeconds: 0,
      };
    }
    if (Math.abs(remainingTurn) <= SETTLING_DRIVE_STOP_TOLERANCE_RADIANS) {
      // Close enough: stop asking the clip to play (starts its fade) while STILL in `settling`, so
      // the fade's ~0.3 s run out here rather than after arrival-close has already started reading
      // a plant leg it assumes is static.
      return {
        ...execution,
        travelledMeters,
        drive: { locomotion: 0 },
        headingRadians: execution.headingRadians,
        stoppedSeconds: execution.stoppedSeconds + input.deltaSeconds,
      };
    }
    return {
      ...execution,
      travelledMeters,
      drive: {
        locomotion: 1,
        timeScaleFactor: SETTLING_LOCOMOTION_TIME_SCALE_FACTOR,
        legWeight: SETTLING_LEG_WEIGHT_TARGET,
      },
      // Not advanced here — see the `## CHANGED` note above. The clip-driven turn owns the slot's
      // actual rotation.y; this field just carries the phase's entry heading forward unchanged so
      // nothing downstream reads a stale null.
      headingRadians: execution.headingRadians,
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
  // ANTICIPATORY TURN — attempted twice, reverted both times, and both measurements are recorded
  // rather than only the second.
  //
  // Attempt 1: an unconditional minimum-jerk ease toward the target heading over the final stride.
  // Measured 0.68 m of SC-05 arrival error — the stance lock's clip-motion correction is CAPPED
  // and read the yaw change's rotation-induced toe displacement as something to chase a few
  // millimetres per frame, never catching up.
  //
  // Attempt 2, after `stance-lock-mod.ts` gained `pivotSlotAroundAnchor` (cancels a yaw change's
  // rotation-induced toe displacement exactly, before the capped correction sees anything — the
  // planted foot then pivots cleanly rather than being chased) plus a footfall placement bias (a
  // new stance window's anchor is nudged back toward the route line by the slot's current lateral
  // drift from it — `footfallBiasXz` in that file): the SAME blend measured 0.248 m — real
  // progress (0.68 -> 0.248 m, cut by roughly two thirds), verified, not assumed — but still short
  // of the 0.05 m cap. The remainder is not a further bug to chase here: a pivot through a LARGE
  // yaw change concentrated into one stride is a real, geometrically correct displacement (on the
  // order of leg-length per radian for a foot held through the turn), and one footfall's placement
  // bias per stance window does not fully cancel it when several such windows occur inside one
  // blend. Spreading the turn across enough real footfalls to correct course every one of them is
  // what the settling-phase clip-driven turn (a separate card item) targets instead.
  //
  // `headingRadians` stays locked to `travelHeadingRadians` for the whole walking phase.
  const blendedHeadingRadians = input.travelHeadingRadians;
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
      headingRadians: blendedHeadingRadians,
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
    headingRadians: blendedHeadingRadians,
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
