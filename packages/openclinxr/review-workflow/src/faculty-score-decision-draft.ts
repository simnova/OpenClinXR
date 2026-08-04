import {
  buildFacultyReviewPath,
  type FacultyReviewDecision,
  type FacultyReviewPacket,
} from "./faculty-review-path.js";

/**
 * Claim-control for faculty score / decision DRAFTS.
 * Scoring remains GATED — drafts never claim scoring validity or learner readiness.
 */
export const FACULTY_SCORE_DRAFT_NOT_EVIDENCE_FOR = [
  "clinical_validity",
  "exam_equivalence",
  "scoring",
  "learner_readiness",
] as const;

export type FacultyScoreNotEvidenceFor = (typeof FACULTY_SCORE_DRAFT_NOT_EVIDENCE_FOR)[number];

export const FACULTY_SCORE_DRAFT_CLAIM_SCOPE =
  "faculty_review_decision_draft_gated_not_score_use" as const;

/** Gated faculty score draft — local review aid only; not score-use evidence. */
export type FacultyScoreDraft = {
  reviewerId: string;
  status: "draft";
  comments: string;
  /** Rubric item → draft ordinal/score values. Never evidence for score-use validity. */
  rubricScores: Readonly<Record<string, number>>;
  scoringValidityClaimed: false;
  notEvidenceFor: readonly FacultyScoreNotEvidenceFor[];
};

/** Packet projection safe for faculty decision drafting (no raw clinical payloads). */
export type ReviewPacketDecisionSummary = {
  stationRunId: string;
  scenarioId: string;
  timelineEntryCount: number;
  missingRequiredTraceTags: readonly string[];
  lateTraceTags: readonly string[];
  unsafeEvents: readonly string[];
  hasPatientNote: boolean;
  hasModelProvenance: boolean;
  modelFailedEventCount: number;
  facultyScoreDraftStatus: string;
  facultyReviewerId: string;
};

/** Faculty review decision draft with hard-gated scoring claim boundary. */
export type ReviewDecisionDraft = {
  stationRunId: string;
  scenarioId: string;
  decisionTitle: FacultyReviewDecision["title"];
  decisionColor: FacultyReviewDecision["color"];
  guidance: string;
  reasons: readonly string[];
  blockers: readonly string[];
  nextActions: readonly string[];
  packetSummary: ReviewPacketDecisionSummary;
  facultyScoreDraft: FacultyScoreDraft;
  scoringValidityClaimed: false;
  notEvidenceFor: readonly FacultyScoreNotEvidenceFor[];
  claimScope: typeof FACULTY_SCORE_DRAFT_CLAIM_SCOPE;
};

export type BuildFacultyScoreDraftInput = {
  reviewerId: string;
  comments: string;
  rubricScores?: Readonly<Record<string, number>>;
};

export type SummarizeReviewPacketForDecisionInput = {
  stationRunId: string;
  scenarioId: string;
  packet: FacultyReviewPacket;
};

export type BuildReviewDecisionDraftInput = {
  stationRunId: string;
  scenarioId: string;
  packet: FacultyReviewPacket;
  /** Incoming draft fields from faculty; claim gates are always forced. */
  facultyScoreDraft: BuildFacultyScoreDraftInput;
  hasDurableSummary: boolean;
  durableSummaryIsSafe: boolean;
  traceEventCount: number;
  safetyFlagLabels: readonly string[];
};

/**
 * Build a gated FacultyScoreDraft. Always sets scoringValidityClaimed=false
 * and the fixed notEvidenceFor boundary.
 */
export function buildFacultyScoreDraft(input: BuildFacultyScoreDraftInput): FacultyScoreDraft {
  const reviewerId = input.reviewerId.trim();
  if (reviewerId.length === 0) {
    throw new Error("Faculty score draft requires reviewer identity");
  }

  return {
    reviewerId,
    status: "draft",
    comments: input.comments,
    rubricScores: { ...(input.rubricScores ?? {}) },
    scoringValidityClaimed: false,
    notEvidenceFor: [...FACULTY_SCORE_DRAFT_NOT_EVIDENCE_FOR],
  };
}

/**
 * Summarize a review packet into decision-safe fields (counts + tags only).
 * Does not copy patient-note text or raw payloads.
 */
export function summarizeReviewPacketForDecision(
  input: SummarizeReviewPacketForDecisionInput,
): ReviewPacketDecisionSummary {
  const { packet, stationRunId, scenarioId } = input;
  return {
    stationRunId,
    scenarioId,
    timelineEntryCount: packet.timeline.length,
    missingRequiredTraceTags: [...packet.missingRequiredTraceTags],
    lateTraceTags: [...packet.lateTraceTags],
    unsafeEvents: [...packet.unsafeEvents],
    hasPatientNote: packet.traceQuality.hasPatientNote || packet.patientNote != null,
    hasModelProvenance: packet.traceQuality.hasModelProvenance,
    modelFailedEventCount: packet.traceQuality.modelFailedEventCount,
    facultyScoreDraftStatus: packet.facultyScoreDraft.status,
    facultyReviewerId: packet.facultyScoreDraft.reviewerId,
  };
}

/**
 * Compose a ReviewDecisionDraft from packet + faculty draft inputs.
 * Scoring stays GATED: scoringValidityClaimed is always false.
 */
export function buildReviewDecisionDraft(input: BuildReviewDecisionDraftInput): ReviewDecisionDraft {
  const facultyScoreDraft = buildFacultyScoreDraft(input.facultyScoreDraft);
  const packetSummary = summarizeReviewPacketForDecision({
    stationRunId: input.stationRunId,
    scenarioId: input.scenarioId,
    packet: input.packet,
  });
  const path = buildFacultyReviewPath({
    packet: input.packet,
    hasDurableSummary: input.hasDurableSummary,
    durableSummaryIsSafe: input.durableSummaryIsSafe,
    traceEventCount: input.traceEventCount,
    safetyFlagLabels: input.safetyFlagLabels,
  });

  return {
    stationRunId: input.stationRunId,
    scenarioId: input.scenarioId,
    decisionTitle: path.decision.title,
    decisionColor: path.decision.color,
    guidance: path.decision.guidance,
    reasons: [...path.decision.reasons],
    blockers: [...path.decision.blockers],
    nextActions: [...path.decision.nextActions],
    packetSummary,
    facultyScoreDraft,
    scoringValidityClaimed: false,
    notEvidenceFor: [...FACULTY_SCORE_DRAFT_NOT_EVIDENCE_FOR],
    claimScope: FACULTY_SCORE_DRAFT_CLAIM_SCOPE,
  };
}
