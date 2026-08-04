import { describe, expect, it } from "vitest";
import { buildReviewPacket } from "./index.js";
import {
  buildFacultyScoreDraft,
  buildReviewDecisionDraft,
  FACULTY_SCORE_DRAFT_CLAIM_SCOPE,
  FACULTY_SCORE_DRAFT_NOT_EVIDENCE_FOR,
  summarizeReviewPacketForDecision,
} from "./faculty-score-decision-draft.js";

function samplePacket(overrides?: {
  late?: boolean;
  missing?: boolean;
  reviewerId?: string;
}) {
  return buildReviewPacket({
    stationRunId: "run_draft_001",
    scenarioId: "ed_chest_pain_priority_v1",
    requiredTraceTags: overrides?.missing
      ? ["ecg_request", "patient_note_submitted", "missing_behavior_tag"]
      : ["ecg_request", "patient_note_submitted"],
    ...(overrides?.late
      ? { timeCriticalTraceTagThresholds: { urgent_escalation: 500 } }
      : {}),
    traceEvents: [
      { sequence: 0, eventType: "station.started", source: "system", atSecond: 0 },
      { sequence: 1, eventType: "learner.order", source: "learner", tag: "ecg_request", atSecond: 240 },
      {
        sequence: 2,
        eventType: "learner.escalation",
        source: "learner",
        tag: "urgent_escalation",
        atSecond: overrides?.late ? 620 : 300,
      },
      {
        sequence: 3,
        eventType: "note.submitted",
        source: "learner",
        tag: "patient_note_submitted",
        atSecond: 1260,
      },
    ],
    patientNote: {
      stationRunId: "run_draft_001",
      submittedAtSecond: 1260,
      text: "Concern for ACS. ECG requested.",
    },
    facultyScoreDraft: {
      reviewerId: overrides?.reviewerId ?? "faculty_001",
      status: "draft",
      comments: "Initial draft comments.",
    },
  });
}

describe("FacultyScoreDraft gated builders", () => {
  it("buildFacultyScoreDraft always gates scoringValidityClaimed and notEvidenceFor", () => {
    const draft = buildFacultyScoreDraft({
      reviewerId: "faculty_002",
      comments: "ECG timing acceptable for local debrief.",
      rubricScores: { urgent_recognition: 2, communication_team_family: 1 },
    });

    expect(draft).toEqual({
      reviewerId: "faculty_002",
      status: "draft",
      comments: "ECG timing acceptable for local debrief.",
      rubricScores: { urgent_recognition: 2, communication_team_family: 1 },
      scoringValidityClaimed: false,
      notEvidenceFor: [...FACULTY_SCORE_DRAFT_NOT_EVIDENCE_FOR],
    });
    expect(draft.scoringValidityClaimed).toBe(false);
    expect(draft.notEvidenceFor).toEqual([
      "clinical_validity",
      "exam_equivalence",
      "scoring",
      "learner_readiness",
    ]);
  });

  it("buildFacultyScoreDraft rejects empty reviewer identity", () => {
    expect(() =>
      buildFacultyScoreDraft({ reviewerId: "   ", comments: "x" }),
    ).toThrow(/reviewer identity/);
  });

  it("summarizeReviewPacketForDecision projects counts without patient note text", () => {
    const packet = samplePacket({ late: true });
    const summary = summarizeReviewPacketForDecision({
      stationRunId: packet.stationRunId,
      scenarioId: packet.scenarioId,
      packet,
    });

    expect(summary).toMatchObject({
      stationRunId: "run_draft_001",
      scenarioId: "ed_chest_pain_priority_v1",
      timelineEntryCount: 4,
      hasPatientNote: true,
      facultyScoreDraftStatus: "draft",
      facultyReviewerId: "faculty_001",
    });
    expect(summary.lateTraceTags).toContain("urgent_escalation");
    expect(JSON.stringify(summary)).not.toContain("Concern for ACS");
  });

  it("buildReviewDecisionDraft composes path decision + gated faculty score draft", () => {
    const packet = samplePacket({ late: true });
    const draft = buildReviewDecisionDraft({
      stationRunId: packet.stationRunId,
      scenarioId: packet.scenarioId,
      packet,
      facultyScoreDraft: {
        reviewerId: "faculty_002",
        comments: "Late escalation needs scenario timing review.",
        rubricScores: { urgent_recognition: 1 },
      },
      hasDurableSummary: true,
      durableSummaryIsSafe: true,
      traceEventCount: packet.timeline.length,
      safetyFlagLabels: packet.unsafeEvents,
    });

    expect(draft.decisionTitle).toBe("Needs scenario iteration");
    expect(draft.decisionColor).toBe("gold");
    expect(draft.blockers).toContain("late_behavior:urgent_escalation");
    expect(draft.facultyScoreDraft).toMatchObject({
      reviewerId: "faculty_002",
      status: "draft",
      comments: "Late escalation needs scenario timing review.",
      rubricScores: { urgent_recognition: 1 },
      scoringValidityClaimed: false,
    });
    expect(draft.scoringValidityClaimed).toBe(false);
    expect(draft.notEvidenceFor).toEqual([...FACULTY_SCORE_DRAFT_NOT_EVIDENCE_FOR]);
    expect(draft.claimScope).toBe(FACULTY_SCORE_DRAFT_CLAIM_SCOPE);
    expect(draft.packetSummary.lateTraceTags).toContain("urgent_escalation");
    expect(draft.packetSummary.timelineEntryCount).toBe(4);
  });

  it("buildReviewDecisionDraft stays gated even when evidence looks complete", () => {
    const packet = samplePacket();
    const draft = buildReviewDecisionDraft({
      stationRunId: packet.stationRunId,
      scenarioId: packet.scenarioId,
      packet,
      facultyScoreDraft: {
        reviewerId: "faculty_003",
        comments: "Ready for local debrief prep only.",
        rubricScores: { urgent_recognition: 3 },
      },
      hasDurableSummary: true,
      durableSummaryIsSafe: true,
      traceEventCount: packet.timeline.length,
      safetyFlagLabels: [],
    });

    expect(draft.decisionTitle).toBe("Ready for faculty debrief");
    expect(draft.scoringValidityClaimed).toBe(false);
    expect(draft.facultyScoreDraft.scoringValidityClaimed).toBe(false);
    expect(draft.notEvidenceFor).toContain("scoring");
    expect(draft.notEvidenceFor).toContain("clinical_validity");
    expect(draft.notEvidenceFor).toContain("exam_equivalence");
    expect(draft.notEvidenceFor).toContain("learner_readiness");
  });

  it("buildReviewDecisionDraft surfaces blocked posture when durable summary missing", () => {
    const packet = samplePacket();
    const draft = buildReviewDecisionDraft({
      stationRunId: packet.stationRunId,
      scenarioId: packet.scenarioId,
      packet,
      facultyScoreDraft: {
        reviewerId: "faculty_004",
        comments: "Cannot score without durable summary.",
      },
      hasDurableSummary: false,
      durableSummaryIsSafe: false,
      traceEventCount: packet.timeline.length,
      safetyFlagLabels: [],
    });

    expect(draft.decisionTitle).toBe("Blocked by missing evidence");
    expect(draft.decisionColor).toBe("red");
    expect(draft.blockers).toContain("durable_summary_missing");
    expect(draft.scoringValidityClaimed).toBe(false);
    expect(draft.facultyScoreDraft.rubricScores).toEqual({});
  });
});
