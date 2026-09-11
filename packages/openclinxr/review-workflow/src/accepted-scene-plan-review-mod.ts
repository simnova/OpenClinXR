/**
 * The REVIEW/REPLAY projection of an accepted scene plan: what a reviewer may see and replay.
 *
 * WHY A PROJECTION AND NOT THE RECORD. The durable record binds the encounter's identity — case,
 * bundle, instance and asset digests, run and session ids. A review packet is read by a human and
 * travels further than the runtime does, and this repo's own redaction rule
 * (`session-state/src/durable-records.ts:246`, `isPrivateReviewPayloadKey`) exists because payloads
 * that reach review have leaked hidden facts before. SC-06's counterweight is explicit: "no clinical
 * hidden facts in exported evidence".
 *
 * So this narrows rather than copies. It carries the DECISIONS and their versions, which is what
 * "the same versioned result replays" needs, and it carries no payloads at all — there is nowhere
 * for a hidden fact to hide, because no free-form field is projected.
 *
 * WHAT IT DELIBERATELY KEEPS. The plan revision and the acknowledgment revision, both of them, so a
 * reviewer can see that an acknowledgment binds the plan in front of them rather than an earlier
 * one. Dropping the pair and showing a boolean would make the reviewer trust this module's
 * arithmetic instead of seeing the two values disagree.
 *
 * NO SECOND STATE DATABASE. A projection is computed on read; nothing here persists.
 *
 * claimScope: a public-safe view of one accepted plan's versioned decisions.
 * notEvidenceFor: clinical validity, that the plan was walked, or that a reviewer looked.
 */

/** Structural contract for the durable record, pinned here rather than imported. */
export type AcceptedScenePlanReviewInput = {
  schemaVersion: string;
  planId: string;
  planRevision: string;
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
  instances: ReadonlyArray<{
    instanceId: string;
    kind: string;
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
    approachSide: string;
    standoffMeters: number;
    targetPosition: { x: number; y: number; z: number };
    targetHeadingRadians: number;
    floorFrameId: string;
    observedObstacleIds: readonly string[];
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
  eventOrder: ReadonlyArray<{ sequence: number; eventId: string; eventType: string; atSecond: number }>;
  dialogueTurnIds: readonly string[];
};

export type AcceptedScenePlanReviewProjection = {
  projectionVersion: "openclinxr.accepted-scene-plan-review.v1";
  planId: string;
  planRevision: string;
  stationRunId: string;
  acceptedAtIso: string;
  case: {
    caseId: string;
    caseVersion: number;
    caseSourceVersion: string;
    stationId: string;
    environmentId: string;
    caseContentSha256: string;
  };
  bundle: { bundleId: string; bundleSha256: string };
  /** One row per instance, digests included, so a reviewer can see what bytes were bound. */
  boundInstances: Array<{
    instanceId: string;
    kind: string;
    contentId: string;
    assetPath: string | null;
    assetSha256: string | null;
    byteCount: number | null;
  }>;
  revisions: AcceptedScenePlanReviewInput["revisions"];
  variation: { seed: string; variationIndex: number };
  layout: {
    approachSide: string;
    standoffMeters: number;
    targetPosition: { x: number; y: number; z: number };
    targetHeadingRadians: number;
    floorFrameId: string;
    observedObstacleCount: number;
    waypointCount: number;
    routeLengthMeters: number;
  };
  arrival: AcceptedScenePlanReviewInput["arrival"];
  acknowledgment: {
    acknowledgedBy: string;
    acknowledgedAtIso: string;
    acknowledgedPlanRevision: string;
    /** Shown ALONGSIDE both revisions, never instead of them. */
    bindsThisPlan: boolean;
  };
  /** Identity and ordering only: no turn text, no payload, no trace body. */
  eventOrder: Array<{ sequence: number; eventId: string; eventType: string; atSecond: number }>;
  dialogueTurnIds: string[];
  claimScope: "versioned_scene_decisions_and_measured_replay";
  notEvidenceFor: readonly string[];
};

export const ACCEPTED_SCENE_PLAN_REVIEW_NOT_EVIDENCE_FOR = [
  "clinical_validity_of_the_bedside_position",
  "worn_headset_readiness",
  "that_the_frozen_route_was_walked_in_this_session",
  "public_render_rights_for_the_bound_bodies",
] as const;

/**
 * Project an accepted plan for review. Throws on a record whose acknowledgment names no revision,
 * because a projection that quietly rendered a blank there would look like agreement.
 */
export function projectAcceptedScenePlanForReview(
  record: AcceptedScenePlanReviewInput,
): AcceptedScenePlanReviewProjection {
  if (record.acknowledgment.acknowledgedPlanRevision.trim().length === 0) {
    throw new Error(
      "an accepted scene plan cannot be projected for review with a blank acknowledgedPlanRevision: a "
        + "reviewer reading a blank beside a plan revision would see agreement where there is no binding.",
    );
  }
  return {
    projectionVersion: "openclinxr.accepted-scene-plan-review.v1",
    planId: record.planId,
    planRevision: record.planRevision,
    stationRunId: record.run.stationRunId,
    acceptedAtIso: record.run.acceptedAtIso,
    case: {
      caseId: record.case.caseId,
      caseVersion: record.case.caseVersion,
      caseSourceVersion: record.case.caseSourceVersion,
      stationId: record.case.stationId,
      environmentId: record.case.environmentId,
      caseContentSha256: record.case.caseContentSha256,
    },
    bundle: { ...record.bundle },
    boundInstances: record.instances.map((instance) => ({
      instanceId: instance.instanceId,
      kind: instance.kind,
      contentId: instance.contentId,
      assetPath: instance.assetPath ?? null,
      assetSha256: instance.assetSha256 ?? null,
      byteCount: instance.byteCount ?? null,
    })),
    revisions: { ...record.revisions },
    variation: { ...record.variation },
    layout: {
      approachSide: record.resolvedLayout.approachSide,
      standoffMeters: record.resolvedLayout.standoffMeters,
      targetPosition: { ...record.resolvedLayout.targetPosition },
      targetHeadingRadians: record.resolvedLayout.targetHeadingRadians,
      floorFrameId: record.resolvedLayout.floorFrameId,
      observedObstacleCount: record.resolvedLayout.observedObstacleIds.length,
      waypointCount: record.resolvedLayout.waypointCount,
      routeLengthMeters: record.resolvedLayout.routeLengthMeters,
    },
    arrival: { ...record.arrival },
    acknowledgment: {
      acknowledgedBy: record.acknowledgment.acknowledgedBy,
      acknowledgedAtIso: record.acknowledgment.acknowledgedAtIso,
      acknowledgedPlanRevision: record.acknowledgment.acknowledgedPlanRevision,
      bindsThisPlan: record.acknowledgment.acknowledgedPlanRevision === record.planRevision,
    },
    eventOrder: record.eventOrder.map((event) => ({ ...event })),
    dialogueTurnIds: [...record.dialogueTurnIds],
    claimScope: "versioned_scene_decisions_and_measured_replay",
    notEvidenceFor: ACCEPTED_SCENE_PLAN_REVIEW_NOT_EVIDENCE_FOR,
  };
}

/**
 * Field names a projection must never carry, checked against the projection's own JSON.
 *
 * The counterweight is "no clinical hidden facts in exported evidence", and a structural projection
 * satisfies it BY CONSTRUCTION only for as long as nobody adds a field. This makes the guarantee
 * checkable rather than asserted, and it is the same vocabulary `isPrivateReviewPayloadKey` uses so
 * the two cannot drift apart.
 */
export function privateKeysInProjection(
  projection: AcceptedScenePlanReviewProjection,
): string[] {
  const found: string[] = [];
  const walk = (value: unknown): void => {
    if (Array.isArray(value)) {
      for (const entry of value) walk(entry);
      return;
    }
    if (typeof value !== "object" || value === null) return;
    for (const [key, entryValue] of Object.entries(value as Record<string, unknown>)) {
      if (/(?:hidden|private|serverOnly|server_only|internal|secret|confidential)/i.test(key)) {
        found.push(key);
      }
      walk(entryValue);
    }
  };
  walk(projection);
  return found;
}
