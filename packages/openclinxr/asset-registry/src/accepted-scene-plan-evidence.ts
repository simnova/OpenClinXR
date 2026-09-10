/**
 * THE DURABLE RECORD, PINNED STRUCTURALLY RATHER THAN IMPORTED.
 *
 * The authoritative declaration is `@openclinxr/session-state/accepted-scene-plan`, which also owns
 * `requireAcceptedScenePlan` and `acceptedScenePlanProblems` — the durable read and its validation.
 * This package cannot import it. Measured, both directions:
 *
 *  - session-state importing asset-registry is refused by `workspace-architecture.test.ts:1271`,
 *    which pins session-state's dependencies by EXACT EQUALITY to `@openclinxr/shared-schemas` alone;
 *  - asset-registry importing session-state resolves, but adding the edge rewrites `pnpm-lock.yaml`,
 *    a repository-root file outside every frozen write root on this card. This card's own verifier
 *    fails an out-of-scope changed file, correctly, and weakening that clause to admit the lockfile
 *    would be the contract weakening the card forbids.
 *
 * So the shape is restated here, which is the pattern `review-workflow/accepted-scene-plan-review.ts`
 * already uses at the same boundary and for the same reason. The two declarations cannot drift
 * silently: the behavior test assigns a session-state record to this type and compares the two field
 * sets at runtime.
 *
 * The DIVISION is the point, and it is not arbitrary. session-state answers "is this a well-formed
 * durable record" — the durable concern. This module answers "does the world still match what it
 * bound" — the replay concern, which needs the solver. Neither validates the other's question, so
 * there is exactly one implementation of each.
 */
export type DurableAcceptedScenePlanRecord = {
  schemaVersion: string;
  planId: string;
  planRevision: string;
  durableStore: "database_source_of_truth";
  run: { stationRunId: string; sessionId: string; acceptedAtIso: string };
  case: {
    caseId: string;
    caseVersion: number;
    caseSourceVersion: string;
    caseContentSha256: string;
    stationId: string;
    environmentId: string;
  };
  bundle: { bundleId: string; bundleSha256: string };
  instances: Array<{
    instanceId: string;
    kind: "support" | "actor" | "equipment";
    contentId: string;
    assetPath?: string | undefined;
    assetSha256?: string | undefined;
    byteCount?: number | undefined;
  }>;
  revisions: {
    solverVersion: string;
    rigRevision: string;
    clipRevision: string;
    geometryRevision: string;
    rubricVersion: string;
  };
  variation: { seed: string; variationIndex: number };
  resolvedLayout: {
    approachSide: "patient_left" | "patient_right";
    standoffMeters: number;
    targetPosition: { x: number; y: number; z: number };
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
    acknowledgedPlanRevision: string;
  };
  eventOrder: Array<{ sequence: number; eventId: string; eventType: string; atSecond: number }>;
  dialogueTurnIds: string[];
};

/**
 * Comparing a frozen plan's bound evidence with what is observed now, and repairing one that moved.
 *
 * SPLIT OUT OF `accepted-scene-plan.ts` (2026-09-10) because that file reached 623 lines against a
 * 500-line zone budget the architecture gate enforces shrink-only. The cut is at the natural seam:
 * the record and its structural validation are one concern, and what the world looks like TODAY
 * against that record is another. Nothing was weakened to fit — the budget was met by moving the
 * second concern to its own module, which is what the gate's message asks for.
 *
 * THREE OUTCOMES, NOT TWO. `missing`, `corrupt` and `changed` are distinguished because a consumer
 * must act differently on each: missing means the evidence was never retrieved and the question is
 * unanswered; corrupt means something damaged it and a re-run cannot be assumed to fix it; changed
 * means the world moved and the acceptance is stale. Collapsing them into one "invalid" is how a
 * damaged control silently becomes no control.
 *
 * REPAIR IS NOT OVERWRITING. `revalidateAcceptedScenePlan` requires a FRESH OBSERVATION carrying its
 * own observer, timestamp and observed digests, and it produces a NEW record with a new revision and
 * a re-issued acknowledgment. SC-06's required_behavior 3: "Repair requires fresh observation/
 * revalidation, not overwriting sidecars."
 *
 * BROWSER-SAFE. No `node:` builtin: every digest arrives already computed by the server-only half.
 */

function nonblank(value: unknown): boolean {
  return typeof value === "string" && value.trim().length > 0;
}

// ── Evidence comparison ─────────────────────────────────────────────────────────────────────────

/**
 * What a consumer actually observed when it went to reopen the plan.
 *
 * Every field is OPTIONAL and its absence is meaningful: an undefined digest means the evidence was
 * not retrieved, which is `missing`, and is a different answer from a digest that came back
 * different, which is `changed`. `corruptPaths` names evidence that was present and unreadable.
 */
export type ObservedScenePlanEvidence = {
  caseContentSha256?: string | undefined;
  bundleSha256?: string | undefined;
  /** sha256 by repo-relative asset path, as observed now. */
  assetSha256ByPath: Record<string, string | undefined>;
  /** Paths that were present but could not be read or decoded. */
  corruptPaths?: readonly string[] | undefined;
  solverVersion?: string | undefined;
  rigRevision?: string | undefined;
  clipRevision?: string | undefined;
  geometryRevision?: string | undefined;
  stationRunId?: string | undefined;
};

export type ScenePlanEvidenceConflictKind = "missing" | "corrupt" | "changed";

export type ScenePlanEvidenceConflict = {
  subject: string;
  kind: ScenePlanEvidenceConflictKind;
  expected: string;
  observed: string;
  detail: string;
};

/**
 * Compare the bytes and revisions a record was accepted against with what is observed now.
 *
 * A `corrupt` finding outranks `changed` for the same subject: bytes that would not decode have no
 * digest to compare, so reporting them as "changed" would invent a comparison nobody made.
 */
export function compareScenePlanEvidence(
  record: DurableAcceptedScenePlanRecord,
  observed: ObservedScenePlanEvidence,
): ScenePlanEvidenceConflict[] {
  const conflicts: ScenePlanEvidenceConflict[] = [];
  const corrupt = new Set(observed.corruptPaths ?? []);

  const compareScalar = (
    subject: string,
    expected: string,
    actual: string | undefined,
    detail: string,
  ): void => {
    if (actual === undefined) {
      conflicts.push({ subject, kind: "missing", expected, observed: "(not retrieved)", detail });
      return;
    }
    if (actual !== expected) {
      conflicts.push({ subject, kind: "changed", expected, observed: actual, detail });
    }
  };

  compareScalar(
    "case.caseContentSha256",
    record.case.caseContentSha256,
    observed.caseContentSha256,
    "the persisted case document the plan was accepted against",
  );
  compareScalar(
    "bundle.bundleSha256",
    record.bundle.bundleSha256,
    observed.bundleSha256,
    "the compiled bundle the plan was accepted against",
  );
  compareScalar(
    "revisions.solverVersion",
    record.revisions.solverVersion,
    observed.solverVersion,
    "a different solver produces a different layout from the same seed",
  );
  compareScalar(
    "revisions.rigRevision",
    record.revisions.rigRevision,
    observed.rigRevision,
    "the rig the frozen clip was retargeted onto",
  );
  compareScalar(
    "revisions.clipRevision",
    record.revisions.clipRevision,
    observed.clipRevision,
    "the locomotion clip the accepted approach played",
  );
  compareScalar(
    "revisions.geometryRevision",
    record.revisions.geometryRevision,
    observed.geometryRevision,
    "the room geometry the route was cleared against",
  );

  for (const instance of record.instances) {
    if (instance.assetPath === undefined || instance.assetSha256 === undefined) continue;
    const subject = `instance.${instance.instanceId}.${instance.assetPath}`;
    if (corrupt.has(instance.assetPath)) {
      conflicts.push({
        subject,
        kind: "corrupt",
        expected: instance.assetSha256,
        observed: "(present, unreadable)",
        detail: "the bytes are on disk and did not decode; a re-run cannot be assumed to fix that",
      });
      continue;
    }
    const actual = observed.assetSha256ByPath[instance.assetPath];
    if (actual === undefined) {
      conflicts.push({
        subject,
        kind: "missing",
        expected: instance.assetSha256,
        observed: "(absent)",
        detail: "the asset the instance loads was not retrieved at all",
      });
      continue;
    }
    if (actual !== instance.assetSha256) {
      conflicts.push({
        subject,
        kind: "changed",
        expected: instance.assetSha256,
        observed: actual,
        detail: "the instance loads different bytes than the plan was accepted against",
      });
    }
  }

  if (observed.stationRunId !== undefined && observed.stationRunId !== record.run.stationRunId) {
    conflicts.push({
      subject: "run.stationRunId",
      kind: "changed",
      expected: record.run.stationRunId,
      observed: observed.stationRunId,
      detail: "an acknowledgment from one run cannot accept another run's geometry",
    });
  }
  return conflicts;
}

/**
 * Does the acknowledgment still bind THIS plan?
 *
 * The counterweight this closes is "changed geometry/plan/version cannot silently reuse
 * acknowledgment": an edit that moves `planRevision` leaves the acknowledgment pointing at a
 * revision that no longer exists, and a reopen that only compared bytes would not notice.
 */
export function acknowledgmentBindsPlan(record: DurableAcceptedScenePlanRecord): boolean {
  return record.acknowledgment.acknowledgedPlanRevision === record.planRevision;
}

// ── Repair ──────────────────────────────────────────────────────────────────────────────────────

/**
 * A fresh observation, offered as the basis for re-accepting an invalidated plan.
 *
 * The point of the type is that it CANNOT be satisfied by editing the old record: it carries its own
 * observer, its own timestamp and the digests that were actually seen. `revalidateAcceptedScenePlan`
 * produces a NEW record with a new plan revision and an unset acknowledgment, so re-acceptance is a
 * separate recorded act rather than a sidecar overwrite.
 */
export type FreshScenePlanObservation = {
  observedBy: string;
  observedAtIso: string;
  evidence: ObservedScenePlanEvidence;
  /** The plan revision the fresh observation supports. Must differ from the invalidated one. */
  planRevision: string;
};

export type ScenePlanRevalidation =
  | { status: "revalidated"; record: DurableAcceptedScenePlanRecord }
  | { status: "refused"; reason: string; conflicts: ScenePlanEvidenceConflict[] };

/**
 * Re-accept an invalidated plan FROM A FRESH OBSERVATION, or refuse.
 *
 * Three refusals, and each is a way the "repair" could have been an overwrite:
 *  - the fresh observation still conflicts with the record, so nothing was actually fixed;
 *  - the fresh observation reuses the invalidated plan revision, which is a sidecar edit wearing a
 *    new timestamp;
 *  - the observation names no observer, so nobody is accountable for having looked.
 *
 * The returned record's acknowledgment is deliberately CLEARED to the fresh observer with the new
 * revision, so a reviewer who accepted the old plan has not implicitly accepted this one.
 */
export function revalidateAcceptedScenePlan(
  record: DurableAcceptedScenePlanRecord,
  observation: FreshScenePlanObservation,
): ScenePlanRevalidation {
  if (!nonblank(observation.observedBy)) {
    return {
      status: "refused",
      reason: "a fresh observation must name its observer; an unattributed re-baseline is an overwrite",
      conflicts: [],
    };
  }
  if (!nonblank(observation.observedAtIso)) {
    return {
      status: "refused",
      reason: "a fresh observation must carry the time it was taken",
      conflicts: [],
    };
  }
  if (observation.planRevision === record.planRevision) {
    return {
      status: "refused",
      reason:
        `the fresh observation reuses plan revision ${record.planRevision}. Re-accepting an invalidated `
        + "plan under its own old revision is exactly the sidecar overwrite this path exists to refuse.",
      conflicts: [],
    };
  }
  const rebased: DurableAcceptedScenePlanRecord = {
    ...record,
    planRevision: observation.planRevision,
    revisions: {
      ...record.revisions,
      solverVersion: observation.evidence.solverVersion ?? record.revisions.solverVersion,
      rigRevision: observation.evidence.rigRevision ?? record.revisions.rigRevision,
      clipRevision: observation.evidence.clipRevision ?? record.revisions.clipRevision,
      geometryRevision: observation.evidence.geometryRevision ?? record.revisions.geometryRevision,
    },
    case: {
      ...record.case,
      caseContentSha256: observation.evidence.caseContentSha256 ?? record.case.caseContentSha256,
    },
    bundle: {
      ...record.bundle,
      bundleSha256: observation.evidence.bundleSha256 ?? record.bundle.bundleSha256,
    },
    instances: record.instances.map((instance) => {
      if (instance.assetPath === undefined) return instance;
      const observed = observation.evidence.assetSha256ByPath[instance.assetPath];
      return observed === undefined ? instance : { ...instance, assetSha256: observed };
    }),
    acknowledgment: {
      acknowledgedBy: observation.observedBy,
      acknowledgedAtIso: observation.observedAtIso,
      acknowledgedPlanRevision: observation.planRevision,
    },
  };
  const residual = compareScenePlanEvidence(rebased, observation.evidence);
  if (residual.length > 0) {
    return {
      status: "refused",
      reason: "the fresh observation still conflicts with the plan, so nothing was repaired",
      conflicts: residual,
    };
  }
  return { status: "revalidated", record: rebased };
}
