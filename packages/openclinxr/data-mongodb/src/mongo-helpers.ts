import type {
  DurableClinicalEventRecord,
  DurableConversationTurnRecord,
  DurableEmotionalStateTimelineRecord,
} from "@openclinxr/session-state";
import type { LearnerRuntimeAssetBundle } from "@openclinxr/asset-registry/runtime-bundles";
import {
  FACULTY_SCORE_DRAFT_CLAIM_SCOPE,
  FACULTY_SCORE_DRAFT_NOT_EVIDENCE_FOR,
} from "@openclinxr/review-workflow";
import { type TraceEvent, validateTraceEvent } from "@openclinxr/shared-schemas";
import type { FacultyReviewDecisionRecord, FacultyScoreDraftRecord, ScenarioReviewDecisionRecord } from "./records.js";

export function assertValidTraceEvent(event: TraceEvent): void {
  const validation = validateTraceEvent(event);
  if (!validation.ok) {
    throw new Error(`Invalid trace event: ${validation.errors.join("; ")}`);
  }
}

export function assertValidFacultyScoreDraftRecord(record: FacultyScoreDraftRecord): void {
  const errors = [
    ...(record.stationRunId.trim().length === 0 ? ["stationRunId is required"] : []),
    ...(record.scenarioId.trim().length === 0 ? ["scenarioId is required"] : []),
    ...(record.draftId.trim().length === 0 ? ["draftId is required"] : []),
    ...(record.facultyScoreDraft.reviewerId.trim().length === 0 ? ["facultyScoreDraft.reviewerId is required"] : []),
    ...(record.facultyScoreDraft.status !== "draft" ? ["facultyScoreDraft.status must be draft"] : []),
    ...(record.scoringValidityClaimed !== false ? ["scoringValidityClaimed must be false"] : []),
  ];
  if (errors.length > 0) {
    throw new Error(`Invalid faculty score draft: ${errors.join("; ")}`);
  }
}

export function assertValidFacultyReviewDecisionRecord(record: FacultyReviewDecisionRecord): void {
  const errors = [
    ...(record.stationRunId.trim().length === 0 ? ["stationRunId is required"] : []),
    ...(record.decisionId.trim().length === 0 ? ["decisionId is required"] : []),
    ...(record.runtimePromotionAllowed !== false ? ["runtimePromotionAllowed must be false"] : []),
    ...(record.productionManifestPromotionAllowed !== false ? ["productionManifestPromotionAllowed must be false"] : []),
    ...(record.scoringValidityClaimed !== false ? ["scoringValidityClaimed must be false"] : []),
  ];
  if (errors.length > 0) {
    throw new Error(`Invalid faculty review decision: ${errors.join("; ")}`);
  }
}

export function cloneFacultyScoreDraftRecord(record: FacultyScoreDraftRecord): FacultyScoreDraftRecord {
  return {
    ...record,
    facultyScoreDraft: {
      ...record.facultyScoreDraft,
      rubricScores: { ...record.facultyScoreDraft.rubricScores },
      notEvidenceFor: [...(record.facultyScoreDraft.notEvidenceFor.length > 0
        ? record.facultyScoreDraft.notEvidenceFor
        : FACULTY_SCORE_DRAFT_NOT_EVIDENCE_FOR)],
      scoringValidityClaimed: false,
      status: "draft",
    },
    scoringValidityClaimed: false,
    notEvidenceFor: [...record.notEvidenceFor],
    claimScope: FACULTY_SCORE_DRAFT_CLAIM_SCOPE,
  };
}

export function cloneFacultyReviewDecisionRecord(record: FacultyReviewDecisionRecord): FacultyReviewDecisionRecord {
  return {
    ...record,
    facultyScoreDraft: {
      ...record.facultyScoreDraft,
      rubricScores: { ...record.facultyScoreDraft.rubricScores },
      notEvidenceFor: [...record.facultyScoreDraft.notEvidenceFor],
      scoringValidityClaimed: false,
      status: "draft",
    },
    runtimePromotionAllowed: false,
    productionManifestPromotionAllowed: false,
    scoringValidityClaimed: false,
    notEvidenceFor: [...record.notEvidenceFor],
    claimScope: "faculty_local_review_decision_gated_not_score_use",
  };
}

export function assertValidScenarioReviewDecision(record: ScenarioReviewDecisionRecord): void {
  const errors = [
    ...(record.scenarioId.trim().length === 0 ? ["scenarioId is required"] : []),
    ...(record.reviewerId.trim().length === 0 ? ["reviewerId is required"] : []),
    ...(record.evidenceRefs.length === 0 || record.evidenceRefs.some((ref) => ref.trim().length === 0)
      ? ["nonblank evidenceRefs are required"]
      : []),
    ...(record.reviewedAt.trim().length === 0 ? ["reviewedAt is required"] : []),
  ];
  if (errors.length > 0) {
    throw new Error(`Invalid scenario review decision: ${errors.join("; ")}`);
  }
}

export function cloneConversationTurnForMongo(record: DurableConversationTurnRecord): DurableConversationTurnRecord {
  return {
    ...record,
    rawAudioStored: false,
    traceContextTags: [...record.traceContextTags],
    provenanceRefs: [...record.provenanceRefs],
  };
}

export function cloneTraceEventForMongo(event: TraceEvent): TraceEvent {
  return {
    ...event,
    payload: cloneJsonRecord(event.payload),
  };
}

export function cloneLearnerRuntimeAssetBundleForMongo(bundle: LearnerRuntimeAssetBundle): LearnerRuntimeAssetBundle {
  return JSON.parse(JSON.stringify(bundle)) as LearnerRuntimeAssetBundle;
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function assertLearnerSafeRuntimeAssetBundle(bundle: LearnerRuntimeAssetBundle): void {
  assertNonblankMongoField(bundle.bundleId, "bundleId");
  if (bundle.identityScope !== "learner_runtime_opaque_bundle") {
    throw new Error("learner runtime asset bundles must use identityScope learner_runtime_opaque_bundle");
  }
  const forbiddenIdentityFields = ["tenantId", "userId", "examRunId", "encounterId"];
  const leakedIdentityFields = forbiddenIdentityFields.filter((field) => field in (bundle as unknown as Record<string, unknown>));
  if (leakedIdentityFields.length > 0) {
    throw new Error(`learner runtime asset bundles must not expose identity fields: ${leakedIdentityFields.join(", ")}`);
  }
  if (!Array.isArray(bundle.actors) || bundle.actors.length === 0) {
    throw new Error("learner runtime asset bundles require actors");
  }
}

export function assertDatabaseSourceOfTruth(record: { durableStore: string }): void {
  if (record.durableStore !== "database_source_of_truth") {
    throw new Error("durable Mongo records must use durableStore database_source_of_truth");
  }
}

export function assertValidConversationTurnForMongo(record: DurableConversationTurnRecord): void {
  assertDatabaseSourceOfTruth(record);
  assertNonblankMongoField(record.turnId, "turnId");
  assertNonblankMongoField(record.stationRunId, "stationRunId");
  assertNonblankMongoField(record.actorId, "actorId");
  assertNonblankMongoField(record.text, "text");
  assertNonblankMongoField(record.emotionalState, "emotionalState");
  assertNonblankMongoField(record.routingReason, "routingReason");
  if (record.sourceKind !== "text" && record.sourceKind !== "voice_transcript") {
    throw new Error("durable Mongo conversation turns require a known sourceKind");
  }
  if (record.rawAudioStored !== false) {
    throw new Error("durable Mongo conversation turns must not store raw audio");
  }
  assertNonnegativeFiniteMongoSecond(record.atSecond, "conversation turns");
  assertNonblankMongoStringArray(record.traceContextTags, "traceContextTags");
  assertNonblankMongoStringArray(record.provenanceRefs, "provenanceRefs");
}

export function assertValidEmotionalStateTimelineForMongo(record: DurableEmotionalStateTimelineRecord): void {
  assertDatabaseSourceOfTruth(record);
  assertNonblankMongoField(record.stationRunId, "stationRunId");
  assertNonblankMongoField(record.actorId, "actorId");
  assertNonblankMongoField(record.emotionalState, "emotionalState");
  assertNonblankMongoField(record.sourceTurnId, "sourceTurnId");
  assertNonnegativeFiniteMongoSecond(record.atSecond, "emotional-state timeline records");
}

export function assertNonblankMongoField(value: string, fieldName: string): void {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`durable Mongo records require nonblank ${fieldName}`);
  }
}

export function assertNonblankMongoStringArray(values: string[], fieldName: string): void {
  if (!Array.isArray(values) || values.some((value) => typeof value !== "string" || value.trim().length === 0)) {
    throw new Error(`durable Mongo records require ${fieldName} to contain only nonblank strings`);
  }
}

export function assertNonnegativeFiniteMongoSecond(value: number, recordLabel: string): void {
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`durable Mongo ${recordLabel} require a nonnegative finite atSecond`);
  }
}

const durableClinicalEventKinds = new Set<DurableClinicalEventRecord["eventKind"]>([
  "clinical_action_recorded",
  "order_status_changed",
  "finding_recorded",
  "checklist_item_updated",
  "rubric_progress_updated",
  "case_status_changed",
]);

export function assertValidClinicalEventForMongo(record: DurableClinicalEventRecord): void {
  assertDatabaseSourceOfTruth(record);
  assertNonblankClinicalEventField(record.clinicalEventId, "clinicalEventId");
  assertNonblankClinicalEventField(record.stationRunId, "stationRunId");
  assertNonblankClinicalEventField(record.label, "label");
  assertNonblankMongoStringArray(record.provenanceRefs, "provenanceRefs");
  assertClinicalEventProvenanceRefsMatchStationRun(record);
  if (record.actorId !== undefined) {
    assertNonblankClinicalEventField(record.actorId, "actorId");
  }
  if (record.traceTag !== undefined) {
    assertNonblankClinicalEventField(record.traceTag, "traceTag");
  }
  if (record.status !== undefined) {
    assertNonblankClinicalEventField(record.status, "status");
  }
  if (!durableClinicalEventKinds.has(record.eventKind)) {
    throw new Error("durable Mongo clinical-event records require a known eventKind");
  }
  if (!Number.isFinite(record.atSecond) || record.atSecond < 0) {
    throw new Error("durable Mongo clinical-event records require a nonnegative finite atSecond");
  }
}

function assertNonblankClinicalEventField(value: string, fieldName: string): void {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`durable Mongo clinical-event records require nonblank ${fieldName}`);
  }
}

function assertClinicalEventProvenanceRefsMatchStationRun(record: DurableClinicalEventRecord): void {
  const malformedTraceRef = record.provenanceRefs.find((ref) => {
    if (!ref.startsWith("trace:")) {
      return false;
    }
    const [, stationRunId, sequenceOrTimestamp] = ref.split(":");
    return !stationRunId || stationRunId.trim().length === 0 || !sequenceOrTimestamp || sequenceOrTimestamp.trim().length === 0;
  });
  if (malformedTraceRef) {
    throw new Error(`durable Mongo clinical-event provenanceRefs trace ref ${malformedTraceRef} must include stationRunId and sequence`);
  }
  const mismatchedTraceRef = record.provenanceRefs.find((ref) => {
    const [scheme, stationRunId] = ref.split(":");
    return scheme === "trace" && stationRunId !== record.stationRunId;
  });
  if (mismatchedTraceRef) {
    throw new Error(
      `durable Mongo clinical-event provenanceRefs trace ref ${mismatchedTraceRef} must match stationRunId ${record.stationRunId}`,
    );
  }
}

export function cloneClinicalEventForMongo(record: DurableClinicalEventRecord): DurableClinicalEventRecord {
  return {
    ...record,
    payload: {
      public: cloneJsonRecord(record.payload.public),
      ...(record.payload.private
        ? {
          private: cloneClinicalEventPrivatePayload(record.payload.private),
        }
        : {}),
    },
    provenanceRefs: [...record.provenanceRefs],
  };
}

function cloneClinicalEventPrivatePayload(
  payload: NonNullable<DurableClinicalEventRecord["payload"]["private"]>,
): NonNullable<DurableClinicalEventRecord["payload"]["private"]> {
  return {
    ...(cloneJsonRecord(payload) as NonNullable<DurableClinicalEventRecord["payload"]["private"]>),
    hiddenFactRefs: [...(payload.hiddenFactRefs ?? [])],
    serverOnlyNotes: [...(payload.serverOnlyNotes ?? [])],
  };
}

function cloneJsonRecord(record: Record<string, unknown>): Record<string, unknown> {
  return JSON.parse(JSON.stringify(record)) as Record<string, unknown>;
}
