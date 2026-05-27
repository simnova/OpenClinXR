export type FacultyReviewDecision = {
  title: "Blocked by missing evidence" | "Needs scenario iteration" | "Ready for faculty debrief";
  color: "red" | "gold" | "green";
  guidance: string;
  reasons: string[];
  nextActions: string[];
  blockers: string[];
};

export type FacultyReviewPosture = {
  title: "Changes requested draft recommended" | "Ready for faculty scoring draft preparation";
  color: "gold" | "green";
  guidance: string;
  checks: FacultyReviewPostureCheck[];
};

export type FacultyReviewPostureCheck = {
  label: string;
  status: string;
  detail: string;
  color: "green" | "gold" | "orange" | "red";
};

export type FacultyActionItem = {
  label: string;
  status: string;
  detail: string;
  color: "green" | "gold" | "orange" | "red";
};

export type FacultyReviewPath = {
  decision: FacultyReviewDecision;
  posture: FacultyReviewPosture;
  actionChecklist: FacultyActionItem[];
};

export type FacultyReviewPacket = {
  missingRequiredTraceTags: readonly string[];
  lateTraceTags: readonly string[];
  unsafeEvents: readonly string[];
  timeline: readonly {
    atSecond: number;
  }[];
  traceQuality: {
    hasPatientNote: boolean;
    modelFailedEventCount: number;
    hasModelProvenance: boolean;
  };
  patientNote?: {
    submittedAtSecond: number;
  } | null;
  facultyScoreDraft: {
    reviewerId: string;
    status: string;
    comments: string;
  };
};

export type BuildFacultyReviewPathInput = {
  packet: FacultyReviewPacket;
  hasDurableSummary: boolean;
  durableSummaryIsSafe: boolean;
  traceEventCount: number;
  safetyFlagLabels: readonly string[];
};

export function buildFacultyReviewPath(input: BuildFacultyReviewPathInput): FacultyReviewPath {
  const hasReplayEvidence = input.packet.timeline.length > 0 || input.traceEventCount > 0;
  const hasDurableSummary = input.hasDurableSummary;
  const durableSummaryIsSafe = input.durableSummaryIsSafe;
  const missingBehaviorCount = input.packet.missingRequiredTraceTags.length;
  const lateBehaviorCount = input.packet.lateTraceTags.length;
  const safetySignalCount = input.safetyFlagLabels.length;
  const hasIterationSignals = missingBehaviorCount > 0
    || lateBehaviorCount > 0
    || safetySignalCount > 0
    || !durableSummaryIsSafe;

  const blockers = buildFacultyReviewDecisionBlockers({
    hasReplayEvidence,
    hasDurableSummary,
    durableSummaryIsSafe,
    packet: input.packet,
    safetyFlagLabels: input.safetyFlagLabels,
  });

  const reasons = [
    hasReplayEvidence
      ? `${input.packet.timeline.length} replay timeline ${pluralize(input.packet.timeline.length, "entry")} and ${input.traceEventCount} trace metadata ${pluralize(input.traceEventCount, "event")} are available.`
      : "Replay timeline and trace metadata are missing for this station run.",
    hasDurableSummary
      ? `Summary-only durable clinical-event evidence is attached and ${durableSummaryIsSafe ? "safe for faculty review" : "requires redaction review"}.`
      : "Durable clinical-event summary is not attached; treat this as missing review evidence.",
    missingBehaviorCount === 0
      ? "Required behavior coverage has no visible missing trace tags."
      : `${missingBehaviorCount} required ${pluralize(missingBehaviorCount, "behavior")} still needs faculty review.`,
    lateBehaviorCount === 0
      ? "No late required behavior signals are visible."
      : `${lateBehaviorCount} late ${pluralize(lateBehaviorCount, "behavior")} should be reviewed for scenario timing.`,
    safetySignalCount === 0
      ? "No unsafe or safety-labelled replay signals are visible."
      : `${safetySignalCount} safety ${pluralize(safetySignalCount, "signal")} should be resolved before learner-facing use.`,
  ];

  const decision: FacultyReviewDecision = !hasReplayEvidence || !hasDurableSummary
    ? {
        title: "Blocked by missing evidence",
        color: "red",
        guidance: "Faculty should not treat this replay as ready for debrief until the missing review-safe evidence is attached.",
        reasons,
        blockers,
        nextActions: [
          "Attach review packet replay evidence before faculty debrief.",
          "Attach or regenerate the durable clinical-event summary before reviewer handoff.",
          "Keep learner launch and score-use gates blocked until missing evidence is resolved.",
        ],
      }
    : hasIterationSignals
      ? {
          title: "Needs scenario iteration",
          color: "gold",
          guidance: "The replay is useful for local faculty review, but visible gaps or safety signals should drive scenario iteration before learner-facing use.",
          reasons,
          blockers,
          nextActions: [
            missingBehaviorCount > 0
              ? "Review missing required behavior evidence before using this replay for debrief."
              : "Confirm required behavior evidence with the faculty reviewer before debrief.",
            lateBehaviorCount > 0
              ? "Review late behavior timing and decide whether the scenario should be revised."
              : "Keep timeline timing visible for debrief preparation.",
            safetySignalCount > 0
              ? "Resolve safety signals or document scenario-iteration changes before learner-facing use."
              : "Preserve the review-safe boundary while preparing debrief notes.",
          ],
        }
      : {
          title: "Ready for faculty debrief",
          color: "green",
          guidance: "The replay has review-safe summary evidence and no visible blocking behavior or safety signals, so it can support local debrief preparation.",
          reasons,
          blockers,
          nextActions: [
            "Use this replay as a local debrief preparation aid while score-use validation remains gated.",
            "Keep faculty notes summary-only and avoid raw clinical-event payloads.",
            "Preserve scenario status, score-use, and learner-launch gates for downstream decisions.",
          ],
        };

  const hasPatientNote = input.packet.traceQuality.hasPatientNote || input.packet.patientNote !== null;
  const hasProviderFailures = input.packet.traceQuality.modelFailedEventCount > 0;
  const needsChanges = input.packet.missingRequiredTraceTags.length > 0
    || input.safetyFlagLabels.length > 0
    || !hasPatientNote
    || input.packet.lateTraceTags.length > 0
    || hasProviderFailures;

  const posture: FacultyReviewPosture = {
    title: needsChanges ? "Changes requested draft recommended" : "Ready for faculty scoring draft preparation",
    color: needsChanges ? "gold" : "green",
    guidance: needsChanges
      ? "Use this posture as a local faculty-review aid: address missing behaviors, safety flags, late behaviors, and evidence gaps before marking the station ready for scoring review."
      : "No missing required behaviors, safety flags, late behaviors, or review-evidence gaps are visible in this replay packet.",
    checks: [
      {
        label: "Required behavior coverage",
        status: input.packet.missingRequiredTraceTags.length === 0 ? "complete" : "needs review",
        detail: `${input.packet.missingRequiredTraceTags.length} missing required trace ${pluralize(input.packet.missingRequiredTraceTags.length, "tag")}`,
        color: input.packet.missingRequiredTraceTags.length === 0 ? "green" : "gold",
      },
      {
        label: "Safety flag review",
        status: input.safetyFlagLabels.length === 0 ? "clear" : "needs review",
        detail: `${input.safetyFlagLabels.length} safety ${pluralize(input.safetyFlagLabels.length, "flag")}`,
        color: input.safetyFlagLabels.length === 0 ? "green" : "red",
      },
      {
        label: "Time-critical behavior review",
        status: input.packet.lateTraceTags.length === 0 ? "on time" : "late behavior present",
        detail: `${input.packet.lateTraceTags.length} late ${pluralize(input.packet.lateTraceTags.length, "behavior")}`,
        color: input.packet.lateTraceTags.length === 0 ? "green" : "orange",
      },
      {
        label: "Patient note evidence",
        status: hasPatientNote ? "available" : "missing",
        detail: hasPatientNote ? "Patient note available for faculty review." : "No patient note is available in this replay packet.",
        color: hasPatientNote ? "green" : "gold",
      },
      {
        label: "Provider evidence posture",
        status: hasProviderFailures ? "provider failure present" : "no provider failures",
        detail: input.packet.traceQuality.hasModelProvenance ? "Model provenance is present." : "No model provenance is present.",
        color: hasProviderFailures ? "red" : "green",
      },
    ],
  };

  const actionChecklist: FacultyActionItem[] = [
    {
      label: "Address missing required behavior evidence",
      status: input.packet.missingRequiredTraceTags.length === 0 ? "complete" : "action needed",
      detail: input.packet.missingRequiredTraceTags.length === 0 ? "All required trace tags are present." : input.packet.missingRequiredTraceTags.join(", "),
      color: input.packet.missingRequiredTraceTags.length === 0 ? "green" : "gold",
    },
    {
      label: "Review safety flags before debrief",
      status: input.safetyFlagLabels.length === 0 ? "clear" : "action needed",
      detail: input.safetyFlagLabels.length === 0 ? "No safety flags are visible in this replay." : input.safetyFlagLabels.join(", "),
      color: input.safetyFlagLabels.length === 0 ? "green" : "red",
    },
    {
      label: "Review late time-critical behaviors",
      status: input.packet.lateTraceTags.length === 0 ? "on time" : "action needed",
      detail: input.packet.lateTraceTags.length === 0 ? "No late time-critical behaviors are visible." : input.packet.lateTraceTags.join(", "),
      color: input.packet.lateTraceTags.length === 0 ? "green" : "orange",
    },
    {
      label: "Use patient note during debrief review",
      status: hasPatientNote ? "available" : "missing",
      detail: input.packet.patientNote ? `Patient note submitted at ${input.packet.patientNote.submittedAtSecond}s.` : "No patient note is available for this station run.",
      color: hasPatientNote ? "green" : "gold",
    },
  ];

  return {
    decision,
    posture,
    actionChecklist,
  };
}

function buildFacultyReviewDecisionBlockers({
  hasReplayEvidence,
  hasDurableSummary,
  durableSummaryIsSafe,
  packet,
  safetyFlagLabels,
}: {
  hasReplayEvidence: boolean;
  hasDurableSummary: boolean;
  durableSummaryIsSafe: boolean;
  packet: FacultyReviewPacket;
  safetyFlagLabels: readonly string[];
}): string[] {
  const blockers = [
    hasReplayEvidence ? undefined : "review_replay_evidence_missing",
    hasDurableSummary ? undefined : "durable_summary_missing",
    hasDurableSummary && !durableSummaryIsSafe ? "durable_summary_requires_redaction_review" : undefined,
    ...packet.missingRequiredTraceTags.map((traceTag) => `missing_required_behavior:${traceTag}`),
    ...packet.lateTraceTags.map((traceTag) => `late_behavior:${traceTag}`),
    ...safetyFlagLabels.map((label) => `safety_signal:${label}`),
  ];

  return blockers.filter((blocker): blocker is string => Boolean(blocker));
}

function pluralize(count: number, singular: string): string {
  return count === 1 ? singular : `${singular}s`;
}
