
import {
  acknowledgmentBindsPlan,
  compareScenePlanEvidence,
  type DurableAcceptedScenePlanRecord,
  type ObservedScenePlanEvidence,
  type ScenePlanEvidenceConflict,
} from "./accepted-scene-plan-evidence.js";
import type { ObservedApproachGeometry } from "./case-approach-intent.js";
import {
  type CaseOwnedScenePlanResult,
  resolveCaseOwnedScenePlan,
} from "./case-owned-scene-plan.js";
import type { BedsideLayoutIntent } from "./layout-solve.js";

/**
 * THE NORMAL CONSUMER that reopens a frozen encounter and refuses a stale one.
 *
 * This is the single production entry point SC-06 exists to add. On the unchanged baseline nothing
 * reopens an accepted bedside approach at all: the plan lives for the lifetime of one frame loop
 * (`station-bedside-approach.ts` holds it in a mutable state object and drops it on re-resolution),
 * the only externalization is an in-memory evidence ring that dies on reload, and the one
 * invalidation check compares a geometry digest that is blind to which body, clip, rig or solver
 * the plan was accepted against.
 *
 * IT RE-SOLVES; IT DOES NOT RE-READ. The frozen layout in the record is NOT trusted as the answer.
 * The persisted seed is fed back through the same case-owned solver and the result is compared with
 * what was frozen. A reopen that read the recorded side back out and reported it as reproduced would
 * pass on a record whose layout had been edited by hand, which is the whole class of defect this
 * card grades.
 *
 * BROWSER-SAFE. Every import here is a `node:`-free subpath — `layout-solve`, not `layout-variation`.
 * The seed is a string that was derived server-side and persisted; deriving it again in the browser
 * is what broke the ui-xr bundle on 2026-09-09 (`asset-registry/src/index.ts:2821`), and it would
 * also let the replay disagree with the freeze about the inputs while still looking self-consistent.
 *
 * NO SECOND STATE DATABASE. The record is the durable one from `@openclinxr/session-state`; this
 * module holds no store and writes nothing.
 *
 * claimScope: whether one frozen scene plan may be reopened against one present observation.
 * notEvidenceFor: that the reopened plan was walked, what a browser rendered, or clinical validity.
 */

/**
 * The frozen acceptance rubric, quoted from `proof-contract-v2.md`'s SC-05 row: "Arrival error must
 * be at most 0.05 m, settled heading error at most 10 degrees, and root movement remain stopped for
 * two seconds." The stopped-travel figure is SC-05's own `SC05_ACCEPTANCE_LIMITS`
 * (`proofs/sc-05/verify-core.ts:211`). SC-06 REUSES these; it does not set its own, because "the
 * same versioned result replays" is a claim about the rubric that accepted it.
 */
/** The schema version this consumer reopens. Restated with the pinned record type, not imported. */
export const ACCEPTED_SCENE_PLAN_SCHEMA_VERSION = "openclinxr.accepted-scene-plan.v1";

export const FROZEN_SCENE_RUBRIC = {
  rubricVersion: "openclinxr.scene-closure-arrival-rubric.v1",
  arrivalErrorMaxMeters: 0.05,
  settledHeadingErrorMaxDegrees: 10,
  stoppedObservationMinSeconds: 2,
  stoppedRootTravelMaxMeters: 0.005,
} as const;

/**
 * How far a re-solved target may sit from the frozen one before the reproduction has failed.
 *
 * PROVENANCE, and it is deliberately NOT a fraction of anything being measured. Re-solving is a
 * re-EXECUTION of a pure function on persisted inputs, not a re-measurement of the world, so the
 * only difference a correct replay can produce is IEEE-754 rounding: about 2.2e-16 m at the metre
 * scale these coordinates live at. 1e-9 m is seven orders of magnitude above that noise floor and
 * 5e7 times below the 0.05 m arrival cap above, so it cannot be cleared by a real disagreement and
 * cannot be tripped by float dust. A tolerance derived from the observed offset instead would pass
 * by construction, which is the tautology `PROTO_VERIFY_DELEGATION.md` records under #151.
 */
export const LAYOUT_REPRODUCTION_TOLERANCE_METERS = 1e-9;

export type FrozenSceneRefusalReason =
  /** The three the DURABLE READ owns. This module never produces them; its caller maps them here. */
  | "plan_absent"
  | "plan_malformed"
  | "plan_wrong_schema"
  | "stale_acknowledgment"
  | "evidence_missing"
  | "evidence_corrupt"
  | "evidence_changed"
  | "unsatisfiable_intent"
  | "layout_not_reproduced"
  | "arrival_outside_rubric"
  | "dialogue_identity_mismatch";

export type FrozenSceneReproduction = {
  approachSide: "patient_left" | "patient_right";
  standoffMeters: number;
  targetPosition: { x: number; y: number; z: number };
  targetHeadingRadians: number;
  /** Distance between the re-solved target and the frozen one. Zero on an exact reproduction. */
  targetOffsetMeters: number;
  waypointCount: number;
  seed: string;
  variationIndex: number;
};

export type FrozenSceneReopen =
  | {
      status: "reopened";
      record: DurableAcceptedScenePlanRecord;
      reproduced: FrozenSceneReproduction;
    }
  | {
      status: "refused";
      reason: FrozenSceneRefusalReason;
      detail: string;
      /** Empty for refusals that are not about bound evidence. Never invented. */
      conflicts: ScenePlanEvidenceConflict[];
    };

/** What the room and the case look like right now, as the consumer observed them. */
export type FrozenSceneObservation = {
  evidence: ObservedScenePlanEvidence;
  geometry: ObservedApproachGeometry;
  patientWorldPosition: { x: number; y: number; z: number };
  start: { x: number; y: number; z: number };
  /** The case's authored intent, if it states one. Absent means the seed explores. */
  intent?: BedsideLayoutIntent | undefined;
};

/**
 * A conflict list's most severe kind, which becomes the refusal reason.
 *
 * Corrupt outranks missing outranks changed. The ordering is not cosmetic: corrupt means a re-run
 * cannot be assumed to help, missing means the question was never asked, and changed means the
 * answer moved — and a consumer that showed "changed" for bytes that would not decode would be
 * reporting a comparison nobody performed.
 */
function severestConflict(conflicts: readonly ScenePlanEvidenceConflict[]): FrozenSceneRefusalReason {
  if (conflicts.some((conflict) => conflict.kind === "corrupt")) return "evidence_corrupt";
  if (conflicts.some((conflict) => conflict.kind === "missing")) return "evidence_missing";
  return "evidence_changed";
}

/** Event types whose ids must appear in `dialogueTurnIds`, and vice versa. */
const DIALOGUE_EVENT_TYPES = new Set(["actor_turn", "learner_turn", "dialogue_turn"]);

/**
 * Reopen a frozen encounter through the normal consumer, or refuse with what disagreed.
 *
 * The order of the gates is the contract, cheapest and most decisive first: a record that is not a
 * record cannot be graded, an acknowledgment that binds a different revision makes every later
 * comparison moot, and evidence that moved makes the re-solve meaningless because it would be
 * solving a different problem.
 */
export function reopenFrozenScene(
  record: DurableAcceptedScenePlanRecord,
  observation: FrozenSceneObservation,
): FrozenSceneReopen {
  // THE DURABLE READ HAPPENS FIRST, IN THE CALLER. `requireAcceptedScenePlan`
  // (`@openclinxr/session-state/accepted-scene-plan`) turns an untrusted candidate into one of
  // absent / malformed / wrong_schema / ok, and only an `ok` record reaches here. That is not a
  // convenience: this module cannot import that package (see the note on the pinned record type in
  // `accepted-scene-plan-evidence.ts`), and re-implementing the validation here would be the second
  // declaration of a contract that already has an owner.
  //
  // What is NOT delegated is the pair of properties a permissive validator could wave through and
  // this module still depends on: the schema version, and a seed that was actually derived. Both are
  // re-checked below, so a caller that skipped the read cannot reach the reproduction.
  if (record.schemaVersion !== ACCEPTED_SCENE_PLAN_SCHEMA_VERSION) {
    return {
      status: "refused",
      reason: "plan_wrong_schema",
      detail:
        `expected schemaVersion ${JSON.stringify(ACCEPTED_SCENE_PLAN_SCHEMA_VERSION)}, found `
        + JSON.stringify(record.schemaVersion),
      conflicts: [],
    };
  }
  if (!/^[0-9a-f]{64}$/u.test(record.variation.seed)) {
    return {
      status: "refused",
      reason: "plan_wrong_schema",
      detail:
        `variation.seed ${JSON.stringify(record.variation.seed)} is not a 64-hex digest, so it was `
        + "not derived and the layout it claims to reproduce was never seeded",
      conflicts: [],
    };
  }

  if (!acknowledgmentBindsPlan(record)) {
    return {
      status: "refused",
      reason: "stale_acknowledgment",
      detail:
        `the acknowledgment approves plan revision ${record.acknowledgment.acknowledgedPlanRevision} and `
        + `this plan is revision ${record.planRevision}. An edit after acceptance cannot silently reuse `
        + "the approval of a plan nobody has seen.",
      conflicts: [],
    };
  }

  const dialogueProblem = dialogueIdentityProblem(record);
  if (dialogueProblem !== null) {
    return {
      status: "refused",
      reason: "dialogue_identity_mismatch",
      detail: dialogueProblem,
      conflicts: [],
    };
  }

  const conflicts = compareScenePlanEvidence(record, observation.evidence);
  if (conflicts.length > 0) {
    return {
      status: "refused",
      reason: severestConflict(conflicts),
      detail: conflicts
        .map((conflict) => `${conflict.subject} ${conflict.kind}: ${conflict.detail}`)
        .join("; "),
      conflicts,
    };
  }

  const resolved: CaseOwnedScenePlanResult = resolveCaseOwnedScenePlan({
    seed: record.variation.seed,
    variationIndex: record.variation.variationIndex,
    patientWorldPosition: observation.patientWorldPosition,
    start: observation.start,
    geometry: observation.geometry,
    ...(observation.intent === undefined ? {} : { intent: observation.intent }),
  });
  if (!resolved.resolved) {
    return {
      status: "refused",
      reason: "unsatisfiable_intent",
      detail: resolved.conflicts
        .map(
          (conflict) =>
            `${conflict.constraint} on ${conflict.approachSide} at ${conflict.standoffMeters} m: ${conflict.reason}`,
        )
        .join("; "),
      conflicts: [],
    };
  }

  const frozenTarget = record.resolvedLayout.targetPosition;
  const targetOffsetMeters = Math.hypot(
    resolved.target.position.x - frozenTarget.x,
    resolved.target.position.y - frozenTarget.y,
    resolved.target.position.z - frozenTarget.z,
  );
  const reproduced: FrozenSceneReproduction = {
    approachSide: resolved.approachSide,
    standoffMeters: resolved.standoffMeters,
    targetPosition: resolved.target.position,
    targetHeadingRadians: resolved.target.headingRadians,
    targetOffsetMeters,
    waypointCount: resolved.plan.waypoints.length,
    seed: resolved.seed,
    variationIndex: resolved.variationIndex,
  };

  const layoutProblems: string[] = [];
  if (resolved.approachSide !== record.resolvedLayout.approachSide) {
    layoutProblems.push(
      `approach side re-solved to ${resolved.approachSide}, frozen as ${record.resolvedLayout.approachSide}`,
    );
  }
  if (resolved.standoffMeters !== record.resolvedLayout.standoffMeters) {
    layoutProblems.push(
      `standoff re-solved to ${resolved.standoffMeters} m, frozen as ${record.resolvedLayout.standoffMeters} m`,
    );
  }
  if (targetOffsetMeters > LAYOUT_REPRODUCTION_TOLERANCE_METERS) {
    layoutProblems.push(
      `re-solved target sits ${targetOffsetMeters.toExponential(3)} m from the frozen target, over the `
        + `${LAYOUT_REPRODUCTION_TOLERANCE_METERS.toExponential(0)} m reproduction tolerance`,
    );
  }
  if (resolved.solverVersion !== record.revisions.solverVersion) {
    layoutProblems.push(
      `solver ${resolved.solverVersion} re-solved a plan frozen under ${record.revisions.solverVersion}`,
    );
  }
  if (layoutProblems.length > 0) {
    return {
      status: "refused",
      reason: "layout_not_reproduced",
      detail: layoutProblems.join("; "),
      conflicts: [],
    };
  }

  const arrivalProblems = arrivalRubricProblems(record);
  if (arrivalProblems.length > 0) {
    return {
      status: "refused",
      reason: "arrival_outside_rubric",
      detail: arrivalProblems.join("; "),
      conflicts: [],
    };
  }

  return { status: "reopened", record, reproduced };
}

/**
 * Does the frozen arrival still satisfy the rubric it was accepted under?
 *
 * This grades the RECORD, not a fresh walk: a reopen proves the versioned decisions replay, and
 * `out-of-scope` on this card is explicit that reproducibility "covers recorded versioned decisions
 * and measured replay, not bit-identical learned inference/physics". A record whose arrival never
 * met the rubric was never acceptable, and reopening must not launder it.
 */
export function arrivalRubricProblems(record: DurableAcceptedScenePlanRecord): string[] {
  const problems: string[] = [];
  const arrival = record.arrival;
  if (arrival.arrivalErrorMeters > FROZEN_SCENE_RUBRIC.arrivalErrorMaxMeters) {
    problems.push(
      `arrival error ${arrival.arrivalErrorMeters} m exceeds ${FROZEN_SCENE_RUBRIC.arrivalErrorMaxMeters} m`,
    );
  }
  if (arrival.settledHeadingErrorDegrees > FROZEN_SCENE_RUBRIC.settledHeadingErrorMaxDegrees) {
    problems.push(
      `settled heading error ${arrival.settledHeadingErrorDegrees} deg exceeds `
        + `${FROZEN_SCENE_RUBRIC.settledHeadingErrorMaxDegrees} deg`,
    );
  }
  if (arrival.stoppedSeconds < FROZEN_SCENE_RUBRIC.stoppedObservationMinSeconds) {
    problems.push(
      `stopped observation ${arrival.stoppedSeconds} s is under `
        + `${FROZEN_SCENE_RUBRIC.stoppedObservationMinSeconds} s`,
    );
  }
  if (arrival.stoppedRootTravelMeters > FROZEN_SCENE_RUBRIC.stoppedRootTravelMaxMeters) {
    problems.push(
      `root travelled ${arrival.stoppedRootTravelMeters} m after the stop, over `
        + `${FROZEN_SCENE_RUBRIC.stoppedRootTravelMaxMeters} m`,
    );
  }
  if (record.revisions.rubricVersion !== FROZEN_SCENE_RUBRIC.rubricVersion) {
    problems.push(
      `the plan was accepted under rubric ${record.revisions.rubricVersion} and this consumer applies `
        + `${FROZEN_SCENE_RUBRIC.rubricVersion}`,
    );
  }
  return problems;
}

/**
 * Do the recorded dialogue turn ids and the recorded event order agree?
 *
 * "include dialogue turn identity when applicable" is a binding requirement, not a field to fill:
 * an event order carrying a turn that no turn id names, or a turn id no event order applied, is a
 * replay that cannot reconstruct what was said. Returns null when they agree, including when the
 * encounter had no dialogue at all — an empty pair agrees.
 */
export function dialogueIdentityProblem(record: DurableAcceptedScenePlanRecord): string | null {
  const declared = new Set(record.dialogueTurnIds);
  const applied = new Set(
    record.eventOrder
      .filter((event) => DIALOGUE_EVENT_TYPES.has(event.eventType))
      .map((event) => event.eventId),
  );
  const unnamed = [...applied].filter((eventId) => !declared.has(eventId));
  const unapplied = [...declared].filter((turnId) => !applied.has(turnId));
  if (unnamed.length === 0 && unapplied.length === 0) return null;
  const parts: string[] = [];
  if (unnamed.length > 0) {
    parts.push(`event order applies dialogue turns no turn id names: ${unnamed.join(", ")}`);
  }
  if (unapplied.length > 0) {
    parts.push(`dialogueTurnIds names turns the event order never applied: ${unapplied.join(", ")}`);
  }
  return parts.join("; ");
}
