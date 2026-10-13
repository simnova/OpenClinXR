/**
 * Begin-step of the case-owned bedside approach (split 2026-10-13,
 * stop-any-route budget split).
 *
 * Moved whole out of `bedside-approach-execution-mod.ts` under that file's
 * 500-line zone budget (behaviour and comments unchanged, only the module
 * boundary moved). Re-exported from the `./bedside-approach-execution`
 * subpath entry, so importers keep their path and the public surface is
 * unchanged.
 */

import type { BedsideApproachPlan } from "@openclinxr/asset-registry/bedside-approach-path";
import { approachRouteLengthMeters } from "./walk-exit-window.js";
import type { BedsideApproachExecution } from "./bedside-approach-execution-mod.js";

type Vector3 = { x: number; y: number; z: number };

export type BedsideApproachExecutionRefusal = { refused: true; reason: string };

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
    stopElapsedSeconds: 0,
    stopClipTimeS: 0,
    stopTriggerXz: null,
  };
}
