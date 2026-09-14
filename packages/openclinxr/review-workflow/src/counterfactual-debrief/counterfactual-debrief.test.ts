import { describe, expect, it } from "vitest";
import {
  COUNTERFACTUAL_DEBRIEF_CLAIM_SCOPE,
  COUNTERFACTUAL_DEBRIEF_NOT_EVIDENCE_FOR,
  buildCounterfactualCheckpoint,
  buildCounterfactualDebrief,
  type CounterfactualReleaseGate,
  type LearnerAttemptRecord,
  type ReviewedAlternative,
} from "./counterfactual-debrief.js";

function attempt(): LearnerAttemptRecord {
  return {
    attemptId: "attempt_ed_001",
    examRunId: "exam_run_local_001",
    stationRunId: "run_ed_001",
    scenarioId: "ed_chest_pain_priority_v1",
    seedId: "case-seed-ed-chest-pain-v1",
    policyVersion: "branch-policy-v1",
    encounterBundleId: "bundle_ed_001",
    timeline: [
      { sequence: 1, eventType: "learner.action", tag: "chief_complaint", atFormSecond: 10 },
      { sequence: 2, eventType: "actor_response", tag: "pain_description", atFormSecond: 45 },
      { sequence: 3, eventType: "learner.action", tag: "history_cardiac", atFormSecond: 90 },
      { sequence: 4, eventType: "learner.observation", tag: "pain_character", atFormSecond: 120 },
      { sequence: 5, eventType: "actor_response", tag: "pain_radiation", atFormSecond: 160 },
    ],
  };
}

function activeRelease(): CounterfactualReleaseGate {
  return {
    releaseId: "feedback_release:exam_run_local_001:1",
    examRunId: "exam_run_local_001",
    releasedAt: "2026-09-11T13:00:00.000Z",
    status: "active",
  };
}

function alternative(): ReviewedAlternative {
  return {
    alternativeId: "alt_watchful_001",
    transitionId: "t_watchful",
    toBranchId: "watchful_waiting",
    hypotheticalConsequence:
      "The patient would have been placed on watchful waiting with serial troponins rather than an ACS workup.",
    authorId: "faculty_dr_smith",
    reviewedAt: "2026-09-10T15:00:00.000Z",
  };
}

// Additional test data for peds scenario (migrated from ui-xr consumer test)
function makeAttempt(): LearnerAttemptRecord {
  return {
    attemptId: "attempt_peds_001",
    examRunId: "exam_run_local_002",
    stationRunId: "run_peds_001",
    scenarioId: "peds_asthma_parent_anxiety_v1",
    seedId: "case-seed-peds-asthma-v1",
    policyVersion: "branch-policy-v2",
    encounterBundleId: "bundle_peds_001",
    timeline: [
      { sequence: 1, eventType: "learner.action", tag: "greeting", atFormSecond: 5 },
      { sequence: 2, eventType: "actor_response", tag: "parent_anxiety_disclosure", atFormSecond: 30 },
      { sequence: 3, eventType: "learner.action", tag: "history_ownership", atFormSecond: 60 },
      { sequence: 4, eventType: "learner.action", tag: "acknowledge_worry", atFormSecond: 95 },
      { sequence: 5, eventType: "actor_response", tag: "parent_relief", atFormSecond: 130 },
      { sequence: 6, eventType: "learner.action", tag: "medication_education", atFormSecond: 180 },
      { sequence: 7, eventType: "actor_response", tag: "anxiety_acknowledged", atFormSecond: 220 },
    ],
  };
}

function makeRelease(): CounterfactualReleaseGate {
  return {
    releaseId: "feedback_release:exam_run_local_002:1",
    examRunId: "exam_run_local_002",
    releasedAt: "2026-09-12T10:00:00.000Z",
    status: "active",
  };
}

function makeAlternative(): ReviewedAlternative {
  return {
    alternativeId: "alt_skip_ack_001",
    transitionId: "t_medication_first",
    toBranchId: "medication_education_branch",
    hypotheticalConsequence:
      "If the learner had proceeded directly to medication education without acknowledging the parent's worry, the parent would have remained anxious and less receptive to the teaching.",
    authorId: "faculty_dr_jones",
    reviewedAt: "2026-09-11T16:30:00.000Z",
  };
}

describe("counterfactual debrief", () => {
  it("builds a checkpoint with the actual path and the hypothetical alternative", () => {
    const result = buildCounterfactualCheckpoint({
      attempt: attempt(),
      sourceEventSequence: 3,
      alternative: alternative(),
      release: activeRelease(),
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const { checkpoint } = result;
    expect(checkpoint.attemptId).toBe("attempt_ed_001");
    expect(checkpoint.stationRunId).toBe("run_ed_001");
    expect(checkpoint.scenarioId).toBe("ed_chest_pain_priority_v1");
    expect(checkpoint.encounterBundleId).toBe("bundle_ed_001");
    expect(checkpoint.policyVersion).toBe("branch-policy-v1");
    expect(checkpoint.sourceEventSequence).toBe(3);
    expect(checkpoint.actualPath.sourceEventTag).toBe("history_cardiac");
    expect(checkpoint.actualPath.sourceEventType).toBe("learner.action");
    expect(checkpoint.actualPath.sourceEventAtFormSecond).toBe(90);
    expect(checkpoint.actualPath.eventCount).toBe(5);
    expect(checkpoint.actualPath.eventsBefore).toHaveLength(2);
    expect(checkpoint.actualPath.eventsAfter).toHaveLength(2);
    expect(checkpoint.alternative.alternativeId).toBe("alt_watchful_001");
    expect(checkpoint.alternative.transitionId).toBe("t_watchful");
    expect(checkpoint.alternative.toBranchId).toBe("watchful_waiting");
    expect(checkpoint.alternative.hypotheticalConsequence).toContain("watchful waiting");
    expect(checkpoint.alternative.authorId).toBe("faculty_dr_smith");
    expect(checkpoint.claimScope).toBe(COUNTERFACTUAL_DEBRIEF_CLAIM_SCOPE);
    expect(checkpoint.notEvidenceFor).toEqual(COUNTERFACTUAL_DEBRIEF_NOT_EVIDENCE_FOR);
  });

  it("does not mutate the attempt record — snapshot is byte-equal", () => {
    const before = attempt();
    const beforeJson = JSON.stringify(before);

    buildCounterfactualCheckpoint({
      attempt: before,
      sourceEventSequence: 3,
      alternative: alternative(),
      release: activeRelease(),
    });

    const afterJson = JSON.stringify(before);
    expect(beforeJson).toEqual(afterJson);
  });

  it("refuses a withdrawn release and returns the correct refusal", () => {
    const result = buildCounterfactualCheckpoint({
      attempt: attempt(),
      sourceEventSequence: 3,
      alternative: alternative(),
      release: { ...activeRelease(), status: "withdrawn" },
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.refusal.reason).toBe("feedback_release_not_active");
    expect(result.refusal.releaseStatus).toBe("withdrawn");
  });

  it("refuses a superseded release and returns the correct refusal", () => {
    const result = buildCounterfactualCheckpoint({
      attempt: attempt(),
      sourceEventSequence: 3,
      alternative: alternative(),
      release: { ...activeRelease(), status: "superseded" },
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.refusal.reason).toBe("feedback_release_not_active");
    expect(result.refusal.releaseStatus).toBe("superseded");
  });

  it("refuses a release minted for a different exam run", () => {
    const result = buildCounterfactualCheckpoint({
      attempt: attempt(),
      sourceEventSequence: 3,
      alternative: alternative(),
      release: { ...activeRelease(), examRunId: "other_run" },
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.refusal.reason).toBe("feedback_release_exam_run_mismatch");
  });

  it("refuses a source event sequence not in the timeline", () => {
    const result = buildCounterfactualCheckpoint({
      attempt: attempt(),
      sourceEventSequence: 99,
      alternative: alternative(),
      release: activeRelease(),
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.refusal.reason).toBe("source_event_out_of_range");
  });

  it("refuses a zero source event sequence", () => {
    const result = buildCounterfactualCheckpoint({
      attempt: attempt(),
      sourceEventSequence: 0,
      alternative: alternative(),
      release: activeRelease(),
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.refusal.reason).toBe("source_event_out_of_range");
  });

  it("builds the first event correctly (no events before)", () => {
    const result = buildCounterfactualCheckpoint({
      attempt: attempt(),
      sourceEventSequence: 1,
      alternative: alternative(),
      release: activeRelease(),
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.checkpoint.actualPath.eventsBefore).toHaveLength(0);
    expect(result.checkpoint.actualPath.eventsAfter).toHaveLength(4);
  });

  it("builds the last event correctly (no events after)", () => {
    const result = buildCounterfactualCheckpoint({
      attempt: attempt(),
      sourceEventSequence: 5,
      alternative: alternative(),
      release: activeRelease(),
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.checkpoint.actualPath.eventsBefore).toHaveLength(4);
    expect(result.checkpoint.actualPath.eventsAfter).toHaveLength(0);
  });

  it("returns claim scope and notEvidenceFor on the batch result", () => {
    const result = buildCounterfactualDebrief({
      attempt: attempt(),
      checkpoints: [
        { sourceEventSequence: 2, alternative: alternative() },
        { sourceEventSequence: 4, alternative: alternative() },
      ],
      release: activeRelease(),
    });
    expect(result.claimScope).toBe(COUNTERFACTUAL_DEBRIEF_CLAIM_SCOPE);
    expect(result.notEvidenceFor).toEqual(COUNTERFACTUAL_DEBRIEF_NOT_EVIDENCE_FOR);
    expect(result.checkpoints).toHaveLength(2);
    expect(result.refusals).toHaveLength(0);
  });

  it("batch build separates successful checkpoints from refusals", () => {
    const result = buildCounterfactualDebrief({
      attempt: attempt(),
      checkpoints: [
        { sourceEventSequence: 2, alternative: alternative() },
        { sourceEventSequence: 99, alternative: alternative() },
      ],
      release: activeRelease(),
    });
    expect(result.checkpoints).toHaveLength(1);
    expect(result.refusals).toHaveLength(1);
    expect(result.refusals[0]?.reason).toBe("source_event_out_of_range");
  });

  it("batch build fails all checkpoints when release is withdrawn", () => {
    const result = buildCounterfactualDebrief({
      attempt: attempt(),
      checkpoints: [
        { sourceEventSequence: 2, alternative: alternative() },
        { sourceEventSequence: 4, alternative: alternative() },
      ],
      release: { ...activeRelease(), status: "withdrawn" },
    });
    expect(result.checkpoints).toHaveLength(0);
    expect(result.refusals).toHaveLength(2);
    for (const refusal of result.refusals) {
      expect(refusal.reason).toBe("feedback_release_not_active");
    }
  });

  it("batch build does not mutate the attempt record", () => {
    const before = attempt();
    const beforeJson = JSON.stringify(before);

    buildCounterfactualDebrief({
      attempt: before,
      checkpoints: [
        { sourceEventSequence: 1, alternative: alternative() },
        { sourceEventSequence: 3, alternative: alternative() },
        { sourceEventSequence: 5, alternative: alternative() },
      ],
      release: activeRelease(),
    });

    const afterJson = JSON.stringify(before);
    expect(beforeJson).toEqual(afterJson);
  });
});

describe("counterfactual debrief (consumer-side peds scenario)", () => {
  it("returns a checkpoint pinned to the attempt and release", () => {
    const result = buildCounterfactualCheckpoint({
      attempt: makeAttempt(),
      sourceEventSequence: 3,
      alternative: makeAlternative(),
      release: makeRelease(),
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const cp = result.checkpoint;
    expect(cp.attemptId).toBe("attempt_peds_001");
    expect(cp.examRunId).toBe("exam_run_local_002");
    expect(cp.stationRunId).toBe("run_peds_001");
    expect(cp.scenarioId).toBe("peds_asthma_parent_anxiety_v1");
    expect(cp.encounterBundleId).toBe("bundle_peds_001");
    expect(cp.policyVersion).toBe("branch-policy-v2");
    expect(cp.releaseId).toBe("feedback_release:exam_run_local_002:1");
    expect(cp.claimScope).toBe(COUNTERFACTUAL_DEBRIEF_CLAIM_SCOPE);
  });

  it("preserves the actual timeline around the source event", () => {
    const result = buildCounterfactualCheckpoint({
      attempt: makeAttempt(),
      sourceEventSequence: 4,
      alternative: makeAlternative(),
      release: makeRelease(),
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const { actualPath } = result.checkpoint;
    expect(actualPath.sourceEventTag).toBe("acknowledge_worry");
    expect(actualPath.sourceEventAtFormSecond).toBe(95);
    expect(actualPath.eventsBefore).toHaveLength(3);
    expect(actualPath.eventsAfter).toHaveLength(3);
    expect(actualPath.eventCount).toBe(7);
  });

  it("surfaces the faculty-reviewed alternative without executing a model", () => {
    const result = buildCounterfactualCheckpoint({
      attempt: makeAttempt(),
      sourceEventSequence: 3,
      alternative: makeAlternative(),
      release: makeRelease(),
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    // Renamed from `alternative`: that shadows the module-level `alternative()` builder at :40,
    // which biome's noShadow refuses as an ERROR here. A shadowed binding is how two discarded
    // slices hid a defect from typecheck, so this is a rename rather than a suppression.
    const { alternative: reviewedAlternative } = result.checkpoint;
    expect(reviewedAlternative.alternativeId).toBe("alt_skip_ack_001");
    expect(reviewedAlternative.transitionId).toBe("t_medication_first");
    expect(reviewedAlternative.toBranchId).toBe("medication_education_branch");
    expect(reviewedAlternative.hypotheticalConsequence).toContain("medication education");
    expect(reviewedAlternative.authorId).toBe("faculty_dr_jones");
    expect(reviewedAlternative.reviewedAt).toBe("2026-09-11T16:30:00.000Z");
  });

  it("does not mutate the attempt record across multiple checkpoint builds", () => {
    const attemptRecord = makeAttempt();
    const beforeJson = JSON.stringify(attemptRecord);

    buildCounterfactualDebrief({
      attempt: attemptRecord,
      checkpoints: [
        { sourceEventSequence: 2, alternative: makeAlternative() },
        { sourceEventSequence: 4, alternative: makeAlternative() },
        { sourceEventSequence: 6, alternative: makeAlternative() },
      ],
      release: makeRelease(),
    });

    expect(JSON.stringify(attemptRecord)).toBe(beforeJson);
  });

  it("fails closed on a withdrawn release", () => {
    const result = buildCounterfactualCheckpoint({
      attempt: makeAttempt(),
      sourceEventSequence: 3,
      alternative: makeAlternative(),
      release: { ...makeRelease(), status: "withdrawn" },
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.refusal.reason).toBe("feedback_release_not_active");
    expect(result.refusal.releaseStatus).toBe("withdrawn");
  });

  it("fails closed on a superseded release", () => {
    const result = buildCounterfactualCheckpoint({
      attempt: makeAttempt(),
      sourceEventSequence: 3,
      alternative: makeAlternative(),
      release: { ...makeRelease(), status: "superseded" },
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.refusal.reason).toBe("feedback_release_not_active");
    expect(result.refusal.releaseStatus).toBe("superseded");
  });

  it("fails closed when the release exam run does not match", () => {
    const result = buildCounterfactualCheckpoint({
      attempt: makeAttempt(),
      sourceEventSequence: 3,
      alternative: makeAlternative(),
      release: { ...makeRelease(), examRunId: "exam_run_other" },
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.refusal.reason).toBe("feedback_release_exam_run_mismatch");
  });

  it("returns all notEvidenceFor claims on the batch result", () => {
    const result = buildCounterfactualDebrief({
      attempt: makeAttempt(),
      checkpoints: [
        { sourceEventSequence: 3, alternative: makeAlternative() },
        { sourceEventSequence: 5, alternative: makeAlternative() },
      ],
      release: makeRelease(),
    });
    expect(result.checkpoints).toHaveLength(2);
    expect(result.refusals).toHaveLength(0);
    expect(result.claimScope).toBe(COUNTERFACTUAL_DEBRIEF_CLAIM_SCOPE);
    expect(result.notEvidenceFor).toEqual(COUNTERFACTUAL_DEBRIEF_NOT_EVIDENCE_FOR);
  });
});