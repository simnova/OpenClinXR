/**
 * A09 — the durable record of an ACCEPTED encounter scene plan, and the evidence comparison that
 * decides whether it may still be reopened.
 *
 * WHY THIS EXISTS, measured on the unchanged baseline 27efa3d2. A grep for
 * `acceptedPlan|approachPlan|planRevision|solverRevision|clipRevision` across `apps` and `packages`,
 * excluding `dist` and tests, returns ZERO hits. `resolveBedsideApproachIntent` produces a plan with
 * thirteen fields — measured, none of them a case id, a bundle id, an asset hash, a clip/rig/solver
 * revision, a seed, a variation index, an acknowledgment or an event order — and SC-05 measures an
 * arrival and then discards it when its frame loop returns. There is nothing to reopen.
 *
 * WHY THE INVALIDATION MATTERS MORE THAN THE PERSISTENCE. The one existing invalidation boundary,
 * `beginBedsideApproachExecution`, compares `geometryRevisionDigest`, which covers the floor frame,
 * the support bounds, the monitor bounds and the obstacle boxes — and NOT the identity of the
 * bodies, clips, rigs or the solver. Measured on the baseline: substituting the physician's body for
 * the nurse's, two files whose sha256 genuinely differ (`4a6d8a78…` vs `bc5b9009…`), leaves the
 * digest at `geom-v1-c45e274d-7` in both cases and the executor accepts the stale plan. A record
 * that persisted the plan without persisting the bytes it was accepted against would reproduce that
 * defect with more ceremony.
 *
 * THREE OUTCOMES, NOT TWO. `missing`, `corrupt` and `changed` are distinguished because a consumer
 * must act differently on each: missing means the evidence was never retrieved and the question is
 * unanswered; corrupt means something damaged it and a re-run cannot be assumed to fix it; changed
 * means the world moved and the acceptance is stale. Collapsing them into one "invalid" is how a
 * damaged control silently becomes no control.
 *
 * REPAIR IS NOT OVERWRITING. `reopenAcceptedScenePlan` never rewrites the record it is grading, and
 * `revalidateAcceptedScenePlan` requires a FRESH OBSERVATION carrying its own observer, timestamp
 * and observed digests. SC-06's required_behavior 3: "Repair requires fresh observation/
 * revalidation, not overwriting sidecars."
 *
 * NO SECOND STATE DATABASE. This is a durable record shaped like the ones beside it in
 * `durable-records.ts` — same `durableStore: "database_source_of_truth"` posture, same nonblank-field
 * discipline — and it carries no store of its own.
 *
 * BROWSER-SAFE. Nothing here imports a `node:` builtin: the digests arrive already computed by the
 * server-only half. The reopen path must run in the browser entry, and
 * `asset-registry/src/index.ts:2821` records what a root-reachable `node:` builtin costs.
 *
 * claimScope: identity and evidence binding of one accepted scene plan.
 * notEvidenceFor: that the plan was ever walked, what a browser rendered, or clinical validity.
 */

export const ACCEPTED_SCENE_PLAN_SCHEMA_VERSION = "openclinxr.accepted-scene-plan.v1";

/** What kind of thing an instance is. Support, actor and equipment are counted separately. */
export type AcceptedScenePlanInstanceKind = "support" | "actor" | "equipment";

export type AcceptedScenePlanInstance = {
  instanceId: string;
  kind: AcceptedScenePlanInstanceKind;
  /** The content the instance was bound to — an actor id, a fixture id, an equipment id. */
  contentId: string;
  /** Repo-relative path of the bytes this instance loads, when it loads any. */
  assetPath?: string | undefined;
  /** sha256 of those bytes as observed at acceptance. */
  assetSha256?: string | undefined;
  byteCount?: number | undefined;
};

export type AcceptedScenePlanEvent = {
  sequence: number;
  eventId: string;
  eventType: string;
  atSecond: number;
};

export type AcceptedScenePlanVector3 = { x: number; y: number; z: number };

export type DurableAcceptedScenePlanRecord = {
  schemaVersion: typeof ACCEPTED_SCENE_PLAN_SCHEMA_VERSION;
  planId: string;
  /**
   * A digest over the frozen DECISIONS. The acknowledgment binds this value, so a plan edited after
   * acceptance cannot silently reuse the acknowledgment that approved a different one.
   */
  planRevision: string;
  durableStore: "database_source_of_truth";
  run: {
    stationRunId: string;
    sessionId: string;
    acceptedAtIso: string;
  };
  case: {
    caseId: string;
    caseVersion: number;
    caseSourceVersion: string;
    caseContentSha256: string;
    stationId: string;
    environmentId: string;
  };
  bundle: {
    bundleId: string;
    bundleSha256: string;
  };
  /** Support, actor and equipment instances, each with the bytes it actually loaded. */
  instances: AcceptedScenePlanInstance[];
  revisions: {
    solverVersion: string;
    rigRevision: string;
    clipRevision: string;
    geometryRevision: string;
    rubricVersion: string;
  };
  variation: {
    seed: string;
    variationIndex: number;
  };
  resolvedLayout: {
    approachSide: "patient_left" | "patient_right";
    standoffMeters: number;
    targetPosition: AcceptedScenePlanVector3;
    targetHeadingRadians: number;
    floorFrameId: string;
    observedObstacleIds: string[];
    waypointCount: number;
    routeLengthMeters: number;
  };
  arrival: {
    arrivalErrorMeters: number;
    settledHeadingErrorDegrees: number;
    stoppedSeconds: number;
    stoppedRootTravelMeters: number;
  };
  acknowledgment: {
    acknowledgedBy: string;
    acknowledgedAtIso: string;
    /** Must equal `planRevision`. A mismatch is a stale acknowledgment, refused on reopen. */
    acknowledgedPlanRevision: string;
  };
  /** The order events were actually applied in, not the order they were scheduled. */
  eventOrder: AcceptedScenePlanEvent[];
  /** Dialogue turn identity, when the encounter had any. An empty list is a recorded decision. */
  dialogueTurnIds: string[];
};

// ── Validation ──────────────────────────────────────────────────────────────────────────────────

export type AcceptedScenePlanRead =
  | { status: "ok"; record: DurableAcceptedScenePlanRecord }
  | { status: "absent"; reason: string }
  | { status: "malformed"; reason: string }
  | { status: "wrong_schema"; reason: string };

function isRecordObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * The same predicate as `isRecordObject`, but WIDENING to an index signature.
 *
 * `isRecordObject` narrows an already-typed section to the intersection, which keeps the concrete
 * shape and makes `section[field]` a TS7053 under `noImplicitAny`. Validation reads fields by name
 * from a candidate that may not have them, so it needs the wide view; the narrow one is right
 * everywhere the value arrived as `unknown`.
 */
function asRecord(value: unknown): Record<string, unknown> | null {
  return isRecordObject(value) ? (value as Record<string, unknown>) : null;
}

function nonblank(value: unknown): boolean {
  return typeof value === "string" && value.trim().length > 0;
}

/**
 * Read a candidate as an accepted scene plan, or refuse — distinguishing absent from damaged.
 *
 * `null`/`undefined` returns `absent`, and everything a consumer would read as "no plan yet, carry
 * on" stops here instead. That distinction is the same one `requireSupineControlFreeze` draws, and
 * for the same reason: a corrupted record silently becoming no record is how evidence that depended
 * on it keeps being trusted.
 */
export function requireAcceptedScenePlan(candidate: unknown): AcceptedScenePlanRead {
  if (candidate === null || candidate === undefined) {
    return {
      status: "absent",
      reason:
        "no accepted scene plan was supplied; a plan that does not exist cannot be reopened and cannot "
        + "invalidate anything",
    };
  }
  if (!isRecordObject(candidate)) {
    return { status: "malformed", reason: `expected a JSON object, found ${typeof candidate}` };
  }
  if (candidate["schemaVersion"] !== ACCEPTED_SCENE_PLAN_SCHEMA_VERSION) {
    return {
      status: "wrong_schema",
      reason:
        `expected schemaVersion ${JSON.stringify(ACCEPTED_SCENE_PLAN_SCHEMA_VERSION)}, found `
        + JSON.stringify(candidate["schemaVersion"]),
    };
  }
  const problems = acceptedScenePlanProblems(candidate as Partial<DurableAcceptedScenePlanRecord>);
  if (problems.length > 0) {
    return { status: "wrong_schema", reason: problems.join("; ") };
  }
  return { status: "ok", record: candidate as DurableAcceptedScenePlanRecord };
}

/**
 * Every structural problem with a candidate record. Empty means it is usable.
 *
 * The empty-collection clauses are the ones that matter: a record with no instances validates every
 * scene, and a record with no event order validates every history — both are worth less than no
 * record while reporting healthy, which is the shape `requireSupineControlFreeze` learned to refuse
 * from an empty hash map.
 */
export function acceptedScenePlanProblems(
  candidate: Partial<DurableAcceptedScenePlanRecord>,
): string[] {
  const problems: string[] = [];
  if (!nonblank(candidate.planId)) problems.push("planId is blank");
  if (!nonblank(candidate.planRevision)) problems.push("planRevision is blank");
  if (candidate.durableStore !== "database_source_of_truth") {
    problems.push("durableStore must be database_source_of_truth");
  }

  const run = asRecord(candidate.run);
  if (run === null) problems.push("run section is missing");
  else {
    if (!nonblank(run["stationRunId"])) problems.push("run.stationRunId is blank");
    if (!nonblank(run["sessionId"])) problems.push("run.sessionId is blank");
    if (!nonblank(run["acceptedAtIso"])) problems.push("run.acceptedAtIso is blank");
  }

  const caseSection = asRecord(candidate.case);
  if (caseSection === null) problems.push("case section is missing");
  else {
    for (const field of ["caseId", "caseSourceVersion", "caseContentSha256", "stationId", "environmentId"]) {
      if (!nonblank(caseSection[field])) problems.push(`case.${field} is blank`);
    }
    if (!Number.isInteger(caseSection["caseVersion"])) problems.push("case.caseVersion is not an integer");
  }

  const bundle = asRecord(candidate.bundle);
  if (bundle === null) problems.push("bundle section is missing");
  else {
    if (!nonblank(bundle["bundleId"])) problems.push("bundle.bundleId is blank");
    if (!nonblank(bundle["bundleSha256"])) problems.push("bundle.bundleSha256 is blank");
  }

  const instances = candidate.instances;
  if (!Array.isArray(instances) || instances.length === 0) {
    problems.push("instances is empty; a plan bound to no instance validates every scene");
  } else {
    const seen = new Set<string>();
    for (const instance of instances) {
      if (!isRecordObject(instance)) {
        problems.push("an instance entry is not an object");
        continue;
      }
      const instanceId = String(instance["instanceId"]);
      if (!nonblank(instanceId)) problems.push("an instance has a blank instanceId");
      if (seen.has(instanceId)) problems.push(`duplicate instanceId ${instanceId}`);
      seen.add(instanceId);
      if (!nonblank(instance["contentId"])) problems.push(`instance ${instanceId} has a blank contentId`);
      if (!["support", "actor", "equipment"].includes(String(instance["kind"]))) {
        problems.push(`instance ${instanceId} has unknown kind ${String(instance["kind"])}`);
      }
      const assetPath = instance["assetPath"];
      if (assetPath !== undefined && !nonblank(instance["assetSha256"])) {
        problems.push(`instance ${instanceId} names ${String(assetPath)} with no sha256`);
      }
    }
  }

  const revisions = asRecord(candidate.revisions);
  if (revisions === null) problems.push("revisions section is missing");
  else {
    for (const field of ["solverVersion", "rigRevision", "clipRevision", "geometryRevision", "rubricVersion"]) {
      if (!nonblank(revisions[field])) problems.push(`revisions.${field} is blank`);
    }
  }

  const variation = candidate.variation;
  if (!isRecordObject(variation)) problems.push("variation section is missing");
  else {
    if (!/^[0-9a-f]{64}$/u.test(String(variation["seed"]))) {
      problems.push("variation.seed is not a 64-hex digest");
    }
    const index = variation["variationIndex"];
    if (!Number.isInteger(index) || Number(index) < 0) {
      problems.push("variation.variationIndex is not a non-negative integer");
    }
  }

  const layout = asRecord(candidate.resolvedLayout);
  if (layout === null) problems.push("resolvedLayout section is missing");
  else {
    if (!["patient_left", "patient_right"].includes(String(layout["approachSide"]))) {
      problems.push(`resolvedLayout.approachSide is ${String(layout["approachSide"])}`);
    }
    if (!Number.isFinite(layout["standoffMeters"])) problems.push("resolvedLayout.standoffMeters is not finite");
    if (!nonblank(layout["floorFrameId"])) problems.push("resolvedLayout.floorFrameId is blank");
    const obstacleIds = layout["observedObstacleIds"];
    if (!Array.isArray(obstacleIds) || obstacleIds.length === 0) {
      problems.push(
        "resolvedLayout.observedObstacleIds is empty; a clearance claim from an empty observation is the "
        + "observation failing, not the room being clear",
      );
    }
    const target = asRecord(layout["targetPosition"]);
    if (target === null || !["x", "y", "z"].every((axis) => Number.isFinite(target[axis]))) {
      problems.push("resolvedLayout.targetPosition is not a finite vector");
    }
    if (!Number.isFinite(layout["targetHeadingRadians"])) {
      problems.push("resolvedLayout.targetHeadingRadians is not finite");
    }
    if (!Number.isInteger(layout["waypointCount"]) || Number(layout["waypointCount"]) < 2) {
      problems.push("resolvedLayout.waypointCount is under 2, so no route was frozen");
    }
  }

  const arrival = asRecord(candidate.arrival);
  if (arrival === null) problems.push("arrival section is missing");
  else {
    for (const field of [
      "arrivalErrorMeters",
      "settledHeadingErrorDegrees",
      "stoppedSeconds",
      "stoppedRootTravelMeters",
    ]) {
      if (!Number.isFinite(arrival[field])) problems.push(`arrival.${field} is not finite`);
    }
  }

  const acknowledgment = asRecord(candidate.acknowledgment);
  if (acknowledgment === null) problems.push("acknowledgment section is missing");
  else {
    if (!nonblank(acknowledgment["acknowledgedBy"])) problems.push("acknowledgment.acknowledgedBy is blank");
    if (!nonblank(acknowledgment["acknowledgedAtIso"])) problems.push("acknowledgment.acknowledgedAtIso is blank");
    if (!nonblank(acknowledgment["acknowledgedPlanRevision"])) {
      problems.push("acknowledgment.acknowledgedPlanRevision is blank");
    }
  }

  const eventOrder = candidate.eventOrder;
  if (!Array.isArray(eventOrder) || eventOrder.length === 0) {
    problems.push("eventOrder is empty; a plan with no recorded history validates every history");
  } else {
    let previousSequence = Number.NEGATIVE_INFINITY;
    let previousAtSecond = Number.NEGATIVE_INFINITY;
    for (const event of eventOrder) {
      if (!isRecordObject(event)) {
        problems.push("an eventOrder entry is not an object");
        continue;
      }
      const sequence = Number(event["sequence"]);
      const atSecond = Number(event["atSecond"]);
      if (!nonblank(event["eventId"])) problems.push("an eventOrder entry has a blank eventId");
      if (!nonblank(event["eventType"])) problems.push("an eventOrder entry has a blank eventType");
      if (!Number.isInteger(sequence) || sequence <= previousSequence) {
        problems.push(`eventOrder sequence ${String(event["sequence"])} does not increase`);
      }
      if (!Number.isFinite(atSecond) || atSecond < previousAtSecond) {
        problems.push(`eventOrder atSecond ${String(event["atSecond"])} moves backwards`);
      }
      previousSequence = sequence;
      previousAtSecond = atSecond;
    }
  }

  if (!Array.isArray(candidate.dialogueTurnIds)) problems.push("dialogueTurnIds is not an array");
  return problems;
}
