/**
 * Counterfactual debrief: faculty-authored alternative checkpoints
 * that replay the immutable actual path beside a reviewed alternative
 * and its explicitly hypothetical consequence.
 *
 * Pinned to attempt, station, bundle, policy, source event, author,
 * and release version. Never executes a live model during replay.
 * Never blends hypothetical events into the original trace or assessment.
 * Withdrawn or superseded alternatives fail closed.
 */

export const COUNTERFACTUAL_DEBRIEF_CLAIM_SCOPE =
  "counterfactual_debrief_formative_not_score_use" as const;

export const COUNTERFACTUAL_DEBRIEF_NOT_EVIDENCE_FOR = [
  "exam_equivalence",
  "clinical_validity",
  "scoring_validity",
  "assessment_validity",
  "learner_readiness",
  "quest_readiness",
  "production_deployment",
  "adaptive_high_stakes_scoring",
] as const;

/** A trace event from the learner's actual recorded attempt. */
export type AttemptTraceEvent = {
  readonly sequence: number;
  readonly eventType: string;
  readonly tag: string;
  readonly atFormSecond: number;
};

/** The immutable record of what the learner actually did. */
export type LearnerAttemptRecord = {
  readonly attemptId: string;
  readonly examRunId: string;
  readonly stationRunId: string;
  readonly scenarioId: string;
  readonly seedId: string;
  readonly policyVersion: string;
  readonly encounterBundleId: string;
  readonly timeline: readonly AttemptTraceEvent[];
};

/** A faculty-reviewed alternative action at a specific evidence-linked moment. */
export type ReviewedAlternative = {
  readonly alternativeId: string;
  readonly transitionId: string;
  readonly toBranchId: string;
  /** Faculty-provided description of the hypothetical consequence. No live model call. */
  readonly hypotheticalConsequence: string;
  readonly authorId: string;
  readonly reviewedAt: string;
};

/** Release gate metadata for surfacing counterfactuals to a learner. */
export type CounterfactualReleaseGate = {
  readonly releaseId: string;
  readonly examRunId: string;
  readonly releasedAt: string;
  readonly status: "active" | "superseded" | "withdrawn";
};

/** Input for building a single counterfactual checkpoint. */
export type BuildCounterfactualCheckpointInput = {
  readonly attempt: LearnerAttemptRecord;
  readonly sourceEventSequence: number;
  readonly alternative: ReviewedAlternative;
  readonly release: CounterfactualReleaseGate;
};

/** The immutable actual path at the checkpoint. */
export type ActualPathSnapshot = {
  readonly stationRunId: string;
  readonly scenarioId: string;
  readonly sourceEventSequence: number;
  readonly sourceEventType: string;
  readonly sourceEventTag: string;
  readonly sourceEventAtFormSecond: number;
  readonly eventsBefore: readonly AttemptTraceEvent[];
  readonly eventsAfter: readonly AttemptTraceEvent[];
  readonly eventCount: number;
};

/** The hypothetical alternative path — explicitly labelled, never executed. */
export type HypotheticalAlternativePath = {
  readonly alternativeId: string;
  readonly transitionId: string;
  readonly toBranchId: string;
  readonly hypotheticalConsequence: string;
  readonly authorId: string;
  readonly reviewedAt: string;
};

/** A single counterfactual checkpoint surfaced to the learner debrief. */
export type CounterfactualCheckpoint = {
  readonly attemptId: string;
  readonly examRunId: string;
  readonly stationRunId: string;
  readonly scenarioId: string;
  readonly encounterBundleId: string;
  readonly policyVersion: string;
  readonly sourceEventSequence: number;
  readonly actualPath: ActualPathSnapshot;
  readonly alternative: HypotheticalAlternativePath;
  readonly releaseId: string;
  readonly releasedAt: string;
  readonly claimScope: typeof COUNTERFACTUAL_DEBRIEF_CLAIM_SCOPE;
  readonly notEvidenceFor: typeof COUNTERFACTUAL_DEBRIEF_NOT_EVIDENCE_FOR;
};

/** Refusal when the release gate blocks the counterfactual. */
export type CounterfactualRefusal = {
  readonly reason:
    | "feedback_release_not_active"
    | "feedback_release_exam_run_mismatch"
    | "source_event_not_found"
    | "source_event_out_of_range";
  readonly releaseStatus?: string;
  readonly releaseId?: string;
};

export type BuildCounterfactualCheckpointResult =
  | { ok: true; checkpoint: CounterfactualCheckpoint; attemptSnapshot: LearnerAttemptRecord }
  | { ok: false; refusal: CounterfactualRefusal };

/**
 * Build a single counterfactual checkpoint.
 *
 * The attempt record is never mutated — the caller receives a snapshot
 * for byte-equality comparison after the call. The alternative path is
 * explicitly hypothetical and is never blended into the original trace.
 */
export function buildCounterfactualCheckpoint(
  input: BuildCounterfactualCheckpointInput,
): BuildCounterfactualCheckpointResult {
  const { attempt, sourceEventSequence, alternative, release } = input;

  // Gate: release must be active.
  if (release.status !== "active") {
    return {
      ok: false,
      refusal: {
        reason: "feedback_release_not_active",
        releaseStatus: release.status,
        releaseId: release.releaseId,
      },
    };
  }

  // Gate: release must match the attempt's exam run.
  if (release.examRunId !== attempt.examRunId) {
    return {
      ok: false,
      refusal: {
        reason: "feedback_release_exam_run_mismatch",
        releaseId: release.releaseId,
      },
    };
  }

  // Locate the source event in the attempt timeline.
  const sourceEvent = attempt.timeline.find(
    (e) => e.sequence === sourceEventSequence,
  );
  if (!sourceEvent) {
    return {
      ok: false,
      refusal: {
        reason: sourceEventSequence < 1 || sourceEventSequence > (attempt.timeline.at(-1)?.sequence ?? 0)
          ? "source_event_out_of_range"
          : "source_event_not_found",
      },
    };
  }

  const eventsBefore = attempt.timeline.filter(
    (e) => e.sequence < sourceEventSequence,
  );
  const eventsAfter = attempt.timeline.filter(
    (e) => e.sequence > sourceEventSequence,
  );

  const snapshot: LearnerAttemptRecord = {
    attemptId: attempt.attemptId,
    examRunId: attempt.examRunId,
    stationRunId: attempt.stationRunId,
    scenarioId: attempt.scenarioId,
    seedId: attempt.seedId,
    policyVersion: attempt.policyVersion,
    encounterBundleId: attempt.encounterBundleId,
    timeline: [...attempt.timeline],
  };

  const checkpoint: CounterfactualCheckpoint = {
    attemptId: attempt.attemptId,
    examRunId: attempt.examRunId,
    stationRunId: attempt.stationRunId,
    scenarioId: attempt.scenarioId,
    encounterBundleId: attempt.encounterBundleId,
    policyVersion: attempt.policyVersion,
    sourceEventSequence: sourceEvent.sequence,
    actualPath: {
      stationRunId: attempt.stationRunId,
      scenarioId: attempt.scenarioId,
      sourceEventSequence: sourceEvent.sequence,
      sourceEventType: sourceEvent.eventType,
      sourceEventTag: sourceEvent.tag,
      sourceEventAtFormSecond: sourceEvent.atFormSecond,
      eventsBefore,
      eventsAfter,
      eventCount: attempt.timeline.length,
    },
    alternative: {
      alternativeId: alternative.alternativeId,
      transitionId: alternative.transitionId,
      toBranchId: alternative.toBranchId,
      hypotheticalConsequence: alternative.hypotheticalConsequence,
      authorId: alternative.authorId,
      reviewedAt: alternative.reviewedAt,
    },
    releaseId: release.releaseId,
    releasedAt: release.releasedAt,
    claimScope: COUNTERFACTUAL_DEBRIEF_CLAIM_SCOPE,
    notEvidenceFor: COUNTERFACTUAL_DEBRIEF_NOT_EVIDENCE_FOR,
  };

  return { ok: true, checkpoint, attemptSnapshot: snapshot };
}

/**
 * Build multiple counterfactual checkpoints for an attempt in one pass.
 * Returns both the successful checkpoints and any refusals.
 */
export type BuildCounterfactualDebriefInput = {
  readonly attempt: LearnerAttemptRecord;
  readonly checkpoints: readonly {
    readonly sourceEventSequence: number;
    readonly alternative: ReviewedAlternative;
  }[];
  readonly release: CounterfactualReleaseGate;
};

export type CounterfactualDebriefResult = {
  readonly attemptId: string;
  readonly examRunId: string;
  readonly checkpoints: readonly CounterfactualCheckpoint[];
  readonly refusals: readonly CounterfactualRefusal[];
  readonly claimScope: typeof COUNTERFACTUAL_DEBRIEF_CLAIM_SCOPE;
  readonly notEvidenceFor: typeof COUNTERFACTUAL_DEBRIEF_NOT_EVIDENCE_FOR;
};

export function buildCounterfactualDebrief(
  input: BuildCounterfactualDebriefInput,
): CounterfactualDebriefResult {
  const checkpoints: CounterfactualCheckpoint[] = [];
  const refusals: CounterfactualRefusal[] = [];

  for (const cp of input.checkpoints) {
    const result = buildCounterfactualCheckpoint({
      attempt: input.attempt,
      sourceEventSequence: cp.sourceEventSequence,
      alternative: cp.alternative,
      release: input.release,
    });
    if (result.ok) {
      checkpoints.push(result.checkpoint);
    } else {
      refusals.push(result.refusal);
    }
  }

  return {
    attemptId: input.attempt.attemptId,
    examRunId: input.attempt.examRunId,
    checkpoints,
    refusals,
    claimScope: COUNTERFACTUAL_DEBRIEF_CLAIM_SCOPE,
    notEvidenceFor: COUNTERFACTUAL_DEBRIEF_NOT_EVIDENCE_FOR,
  };
}
