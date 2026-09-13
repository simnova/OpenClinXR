import { describe, expect, it } from "vitest";
import {
  buildCounterfactualCheckpoint,
  buildCounterfactualDebrief,
  COUNTERFACTUAL_DEBRIEF_CLAIM_SCOPE,
  COUNTERFACTUAL_DEBRIEF_NOT_EVIDENCE_FOR,
  type CounterfactualReleaseGate,
  type LearnerAttemptRecord,
  type ReviewedAlternative,
} from "@openclinxr/review-workflow/counterfactual-debrief";

/**
 * Consumer-side tests for counterfactual replay in the learner debrief context.
 *
 * These tests verify that the ui-xr consumer receives the correct checkpoint
 * structure, that the actual attempt is never mutated, and that the release
 * gate fails closed for withdrawn/superseded releases.
 */

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

describe("counterfactual replay for learner debrief (consumer side)", () => {
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

    const { alternative } = result.checkpoint;
    expect(alternative.alternativeId).toBe("alt_skip_ack_001");
    expect(alternative.transitionId).toBe("t_medication_first");
    expect(alternative.toBranchId).toBe("medication_education_branch");
    expect(alternative.hypotheticalConsequence).toContain("medication education");
    expect(alternative.authorId).toBe("faculty_dr_jones");
    expect(alternative.reviewedAt).toBe("2026-09-11T16:30:00.000Z");
  });

  it("does not mutate the attempt record across multiple checkpoint builds", () => {
    const attempt = makeAttempt();
    const beforeJson = JSON.stringify(attempt);

    buildCounterfactualDebrief({
      attempt,
      checkpoints: [
        { sourceEventSequence: 2, alternative: makeAlternative() },
        { sourceEventSequence: 4, alternative: makeAlternative() },
        { sourceEventSequence: 6, alternative: makeAlternative() },
      ],
      release: makeRelease(),
    });

    expect(JSON.stringify(attempt)).toBe(beforeJson);
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
