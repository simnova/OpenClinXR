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
