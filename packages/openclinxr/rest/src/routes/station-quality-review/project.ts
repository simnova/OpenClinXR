import {
  ASSEMBLED_EXAM_PHASE_TRANSITION_TYPES,
  type AssembledExamReviewPacket,
  assembledExamReviewNotEvidenceFor,
} from "@openclinxr/review-workflow";

type StationSlice = AssembledExamReviewPacket["stations"][number];
type PhaseRecord = StationSlice["phaseTransitions"][number];

export const STATION_QUALITY_REVIEW_CLAIM_BOUNDARY =
  "station_quality_review_not_exam_equivalence" as const;

export type StationQualityEvidenceCite = {
  packetField: string;
  stationRunId: string;
  sequence?: number;
  durableEventRef?: string;
  eventType?: string;
  atSecond?: number;
};

export type StationQualitySignalKind =
  | "completion"
  | "timing"
  | "required_tag_coverage"
  | "omission"
  | "technical_failure";

export type StationQualitySignal = {
  kind: StationQualitySignalKind;
  code: string;
  flagged: boolean;
  evidence: readonly StationQualityEvidenceCite[];
};

export type StationQualityReviewStation = {
  identity: {
    examRunId: string;
    stationRunId: string;
    scenarioId: string;
    stationOrder: number;
  };
  completion: {
    patientNoteSubmitted: boolean;
    advanceReasonPresent: boolean;
    phaseTransitionsPresent: readonly string[];
    phaseTransitionsMissing: readonly string[];
    signals: readonly StationQualitySignal[];
  };
  timing: {
    lateTraceTags: readonly string[];
    encounterSeconds: number | null;
    noteSeconds: number | null;
    signals: readonly StationQualitySignal[];
  };
  requiredTagCoverage: {
    observed: readonly string[];
    missing: readonly string[];
    signals: readonly StationQualitySignal[];
  };
  omissions: {
    codes: readonly string[];
    signals: readonly StationQualitySignal[];
  };
  technicalFailures: {
    unsafeEvents: readonly string[];
    modelFailedEventCount: number;
    blockedGuardrailCount: number;
    failedEventTypes: readonly string[];
    signals: readonly StationQualitySignal[];
  };
};

export type StationQualityReview = {
  examRunId: string;
  stations: readonly StationQualityReviewStation[];
  claimBoundary: typeof STATION_QUALITY_REVIEW_CLAIM_BOUNDARY;
  notEvidenceFor: typeof assembledExamReviewNotEvidenceFor;
  examEquivalenceGate: false;
  scoringValidityClaimed: false;
};

export function projectStationQualityReview(
  packet: AssembledExamReviewPacket,
): StationQualityReview {
  return {
    examRunId: packet.examRunId,
    stations: packet.stations.map((slice, stationIndex) =>
      projectStation(packet.examRunId, slice, stationIndex),
    ),
    claimBoundary: STATION_QUALITY_REVIEW_CLAIM_BOUNDARY,
    notEvidenceFor: assembledExamReviewNotEvidenceFor,
    examEquivalenceGate: false,
    scoringValidityClaimed: false,
  };
}

function projectStation(
  examRunId: string,
  slice: StationSlice,
  stationIndex: number,
): StationQualityReviewStation {
  const stationRunId = slice.identity.stationRunId;
  const prefix = `stations[${stationIndex}]`;
  const presentTypes = slice.phaseTransitions.map((phase) => phase.eventType);
  const missingTypes = ASSEMBLED_EXAM_PHASE_TRANSITION_TYPES.filter(
    (eventType) => !presentTypes.includes(eventType),
  );
  const advanceReasonPresent = Boolean(slice.advanceReason);
  const completionSignals = [
    ...ASSEMBLED_EXAM_PHASE_TRANSITION_TYPES.map((eventType) =>
      phaseCompletionSignal(stationRunId, prefix, slice.phaseTransitions, eventType, missingTypes),
    ),
    signal("completion", "patient_note_submitted", !slice.patientNoteSubmitted, [
      cite(stationRunId, `${prefix}.patientNoteSubmitted`),
    ]),
    signal("completion", "advance_reason_present", !advanceReasonPresent, [
      cite(stationRunId, `${prefix}.advanceReason`),
    ]),
  ];

  const lateTraceTags = [...slice.reviewPacket.lateTraceTags];
  const encounterSeconds = phaseSpanSeconds(slice.phaseTransitions, "encounter.started", "encounter.ended");
  const noteSeconds = phaseSpanSeconds(slice.phaseTransitions, "note.started", "note.submitted");
  const timingSignals = [
    ...lateTraceTags.map((tag) => lateTagSignal(stationRunId, prefix, slice, tag)),
    ...phaseTimingSignals(stationRunId, prefix, slice.phaseTransitions, encounterSeconds, noteSeconds),
  ];

  const observed = [...slice.reviewPacket.observedTraceTags];
  const missing = [...slice.reviewPacket.missingRequiredTraceTags];
  const coverageSignals = [
    ...observed.map((tag) => coverageSignal(stationRunId, prefix, slice, tag, false)),
    ...missing.map((tag) => coverageSignal(stationRunId, prefix, slice, tag, true)),
  ];

  const omissionCodes = [...slice.omissions];
  const omissionSignals = omissionCodes.map((code, omissionIndex) =>
    signal("omission", code, true, [
      cite(stationRunId, `${prefix}.omissions[${omissionIndex}]`),
    ]),
  );

  const failedEventTypes = unique(
    slice.reviewPacket.timeline
      .filter((entry) => isTechnicalFailureEvent(entry.eventType))
      .map((entry) => entry.eventType),
  );
  const technicalSignals = [
    ...slice.reviewPacket.unsafeEvents.map((unsafeLabel, unsafeIndex) =>
      signal("technical_failure", unsafeLabel, true, [
        cite(stationRunId, `${prefix}.reviewPacket.unsafeEvents[${unsafeIndex}]`),
      ]),
    ),
    ...failedEventTimelineSignals(stationRunId, prefix, slice),
    signal(
      "technical_failure",
      "model_failed_events",
      slice.reviewPacket.traceQuality.modelFailedEventCount > 0,
      [cite(stationRunId, `${prefix}.reviewPacket.traceQuality.modelFailedEventCount`)],
    ),
    signal(
      "technical_failure",
      "blocked_guardrail_events",
      slice.reviewPacket.traceQuality.blockedGuardrailCount > 0,
      [cite(stationRunId, `${prefix}.reviewPacket.traceQuality.blockedGuardrailCount`)],
    ),
  ];

  return {
    identity: { ...slice.identity, examRunId },
    completion: {
      patientNoteSubmitted: slice.patientNoteSubmitted,
      advanceReasonPresent,
      phaseTransitionsPresent: presentTypes,
      phaseTransitionsMissing: missingTypes,
      signals: completionSignals,
    },
    timing: {
      lateTraceTags,
      encounterSeconds,
      noteSeconds,
      signals: timingSignals,
    },
    requiredTagCoverage: {
      observed,
      missing,
      signals: coverageSignals,
    },
    omissions: {
      codes: omissionCodes,
      signals: omissionSignals,
    },
    technicalFailures: {
      unsafeEvents: [...slice.reviewPacket.unsafeEvents],
      modelFailedEventCount: slice.reviewPacket.traceQuality.modelFailedEventCount,
      blockedGuardrailCount: slice.reviewPacket.traceQuality.blockedGuardrailCount,
      failedEventTypes,
      signals: technicalSignals,
    },
  };
}

function phaseCompletionSignal(
  stationRunId: string,
  prefix: string,
  phases: readonly PhaseRecord[],
  eventType: (typeof ASSEMBLED_EXAM_PHASE_TRANSITION_TYPES)[number],
  missingTypes: readonly string[],
): StationQualitySignal {
  const record = phases.find((phase) => phase.eventType === eventType);
  if (!record) {
    return signal("completion", `phase_transition:${eventType}`, true, [
      cite(stationRunId, `${prefix}.omissions`),
      cite(stationRunId, `${prefix}.phaseTransitions`, { eventType }),
    ]);
  }
  const phaseIndex = phases.indexOf(record);
  return signal("completion", `phase_transition:${eventType}`, missingTypes.includes(eventType), [
    cite(stationRunId, `${prefix}.phaseTransitions[${phaseIndex}].durableEventRef`, {
      sequence: record.sequence,
      durableEventRef: record.durableEventRef,
      eventType: record.eventType,
      atSecond: record.atSecond,
    }),
  ]);
}

function lateTagSignal(
  stationRunId: string,
  prefix: string,
  slice: StationSlice,
  tag: string,
): StationQualitySignal {
  const timelineHit = slice.reviewPacket.timeline.find((entry) => entry.tag === tag);
  const lateIndex = slice.reviewPacket.lateTraceTags.indexOf(tag);
  const evidence: StationQualityEvidenceCite[] = [
    cite(stationRunId, `${prefix}.reviewPacket.lateTraceTags[${lateIndex}]`),
  ];
  if (timelineHit) {
    const timelineIndex = slice.reviewPacket.timeline.indexOf(timelineHit);
    evidence.push(cite(stationRunId, `${prefix}.reviewPacket.timeline[${timelineIndex}]`, {
      sequence: timelineHit.sequence,
      eventType: timelineHit.eventType,
      atSecond: timelineHit.atSecond,
    }));
  }
  return signal("timing", `late_trace_tag:${tag}`, true, evidence);
}

function phaseTimingSignals(
  stationRunId: string,
  prefix: string,
  phases: readonly PhaseRecord[],
  encounterSeconds: number | null,
  noteSeconds: number | null,
): StationQualitySignal[] {
  return [
    spanSignal(stationRunId, prefix, phases, "encounter_duration", encounterSeconds, "encounter.started", "encounter.ended"),
    spanSignal(stationRunId, prefix, phases, "note_duration", noteSeconds, "note.started", "note.submitted"),
  ].filter((item): item is StationQualitySignal => Boolean(item));
}

function spanSignal(
  stationRunId: string,
  prefix: string,
  phases: readonly PhaseRecord[],
  code: string,
  seconds: number | null,
  startType: string,
  endType: string,
): StationQualitySignal | undefined {
  if (seconds === null) {
    return undefined;
  }
  const start = phases.find((phase) => phase.eventType === startType);
  const end = phases.find((phase) => phase.eventType === endType);
  if (!start || !end) {
    return undefined;
  }
  return signal("timing", code, false, [
    cite(stationRunId, `${prefix}.phaseTransitions[${phases.indexOf(start)}].durableEventRef`, {
      sequence: start.sequence,
      durableEventRef: start.durableEventRef,
      eventType: start.eventType,
      atSecond: start.atSecond,
    }),
    cite(stationRunId, `${prefix}.phaseTransitions[${phases.indexOf(end)}].durableEventRef`, {
      sequence: end.sequence,
      durableEventRef: end.durableEventRef,
      eventType: end.eventType,
      atSecond: end.atSecond,
    }),
  ]);
}

function coverageSignal(
  stationRunId: string,
  prefix: string,
  slice: StationSlice,
  tag: string,
  flagged: boolean,
): StationQualitySignal {
  const field = flagged ? "missingRequiredTraceTags" : "observedTraceTags";
  const list = flagged ? slice.reviewPacket.missingRequiredTraceTags : slice.reviewPacket.observedTraceTags;
  const tagIndex = list.indexOf(tag);
  const evidence: StationQualityEvidenceCite[] = [
    cite(stationRunId, `${prefix}.reviewPacket.${field}[${tagIndex}]`),
  ];
  const timelineHit = slice.reviewPacket.timeline.find((entry) => entry.tag === tag);
  if (timelineHit) {
    evidence.push(cite(stationRunId, `${prefix}.reviewPacket.timeline[${slice.reviewPacket.timeline.indexOf(timelineHit)}]`, {
      sequence: timelineHit.sequence,
      eventType: timelineHit.eventType,
      atSecond: timelineHit.atSecond,
    }));
  }
  return signal("required_tag_coverage", `required_trace_tag:${tag}`, flagged, evidence);
}

function failedEventTimelineSignals(
  stationRunId: string,
  prefix: string,
  slice: StationSlice,
): StationQualitySignal[] {
  return slice.reviewPacket.timeline
    .map((entry, timelineIndex) => ({ entry, timelineIndex }))
    .filter(({ entry }) => isTechnicalFailureEvent(entry.eventType))
    .map(({ entry, timelineIndex }) =>
      signal("technical_failure", `event:${entry.eventType}`, true, [
        cite(stationRunId, `${prefix}.reviewPacket.timeline[${timelineIndex}]`, {
          sequence: entry.sequence,
          eventType: entry.eventType,
          atSecond: entry.atSecond,
        }),
      ]),
    );
}

function phaseSpanSeconds(
  phases: readonly PhaseRecord[],
  startType: string,
  endType: string,
): number | null {
  const start = phases.find((phase) => phase.eventType === startType);
  const end = phases.find((phase) => phase.eventType === endType);
  if (!start || !end) {
    return null;
  }
  return end.atSecond - start.atSecond;
}

function isTechnicalFailureEvent(eventType: string): boolean {
  return eventType === "actor.response.failed"
    || eventType.startsWith("unsafe.")
    || eventType.startsWith("safety.");
}

function signal(
  kind: StationQualitySignalKind,
  code: string,
  flagged: boolean,
  evidence: readonly StationQualityEvidenceCite[],
): StationQualitySignal {
  return { kind, code, flagged, evidence };
}

function cite(
  stationRunId: string,
  packetField: string,
  extra: Omit<StationQualityEvidenceCite, "packetField" | "stationRunId"> = {},
): StationQualityEvidenceCite {
  return { packetField, stationRunId, ...extra };
}

function unique(values: readonly string[]): string[] {
  return [...new Set(values)];
}
