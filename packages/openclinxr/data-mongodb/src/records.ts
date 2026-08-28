import type { ExamStationRunQueue } from "@openclinxr/exam-assembly";
import {
  FACULTY_SCORE_DRAFT_CLAIM_SCOPE,
  type FacultyScoreDraft,
  type ReviewDecisionDraft,
} from "@openclinxr/review-workflow";

/** Mirrors apps/api ApiFacultyScoreDraftRecord without importing apps/api. */
export type FacultyScoreDraftRecord = {
  stationRunId: string;
  scenarioId: string;
  draftId: string;
  savedAt: string;
  facultyScoreDraft: FacultyScoreDraft;
  scoringValidityClaimed: false;
  notEvidenceFor: readonly string[];
  claimScope: typeof FACULTY_SCORE_DRAFT_CLAIM_SCOPE;
};

/** Mirrors apps/api ApiFacultyReviewDecisionRecord without importing apps/api. */
export type FacultyReviewDecisionRecord = {
  stationRunId: string;
  scenarioId: string;
  decisionId: string;
  savedAt: string;
  localDecision: "hold" | "local_promote_candidate";
  decisionDraft: ReviewDecisionDraft;
  facultyScoreDraft: FacultyScoreDraft;
  runtimePromotionAllowed: false;
  productionManifestPromotionAllowed: false;
  scoringValidityClaimed: false;
  notEvidenceFor: readonly string[];
  claimScope: "faculty_local_review_decision_gated_not_score_use";
};

export type ExamStationRunQueueSnapshot = {
  snapshotId: string;
  createdAt: string;
  reviewerId?: string;
  queue: ExamStationRunQueue;
};

export type ScenarioReviewDecisionRecord = {
  scenarioId: string;
  version: number;
  reviewerRole: "clinical" | "psychometric" | "legal" | "simulationQa";
  reviewerId: string;
  decision: "approved" | "changes_requested";
  comments: string;
  evidenceRefs: string[];
  reviewedAt: string;
};

/**
 * One record per {scenarioId, caseDefVersion, compileVersion} — the unique
 * materialization-evidence key. contentHash is the sha256 of the artifact bytes
 * at the matching compile-node sourceBlobName, or null when the artifact is not
 * yet on disk. Never a placeholder literal.
 */
export type EncounterMaterializationEvidenceRecord = {
  scenarioId: string;
  caseDefVersion: number;
  compileVersion: number;
  source: "generated_station_runtime_bundle_materialization_contracts";
  generatedAt: string;
  compileNodes: Array<{
    nodeId: string;
    family: "ActorVariant" | "EquipVariant";
    sourceBlobName: string;
    contentHash: string | null;
  }>;
};

export const durableActorTurnPersistenceScope = {
  approvedProposal: "proposals/approved/proposal-durable-actor-turn-persistence-promotion.md",
  actorTurnScope: "conversation_turns_and_emotional_state_timeline_only",
  clinicalActionsIncluded: false,
  redisRedkaIncluded: false,
  databaseOnly: true,
  notEvidenceFor: [
    "api_runtime_wiring",
    "redis_redka_cache_layer",
    "realtime_synchronization",
    "clinical_record_retention_policy",
  ],
} as const;

export const durableClinicalEventPersistenceScope = {
  approvedProposal: "proposals/approved/proposal-durable-clinical-event-persistence.md",
  eventScope: "clinical_actions_orders_findings_checklists_rubric_and_case_progress",
  idempotencyBehavior: "clinical_event_id_is_insert_once_status_history_uses_distinct_event_ids",
  actorTurnScopeChanged: false,
  redisRedkaIncluded: false,
  databaseOnly: true,
  notEvidenceFor: [
    "api_runtime_wiring",
    "redis_redka_cache_layer",
    "realtime_synchronization",
    "clinical_record_retention_policy",
    "clinical_assessment_validity",
  ],
} as const;
