import { evaluateRequiredTraceTags } from "@openclinxr/domain";
import { validateReviewPacket, type PatientNote, type ReviewPacket } from "@openclinxr/shared-schemas";

export type ReviewTraceInput = {
  sequence?: number;
  tag?: string;
  atSecond: number;
  eventType?: string;
  source?: string;
  actorId?: string;
  payload?: Record<string, unknown>;
};

export type BuildReviewPacketInput = {
  stationRunId: string;
  scenarioId: string;
  requiredTraceTags: readonly string[];
  timeCriticalTraceTagThresholds?: Readonly<Record<string, number>>;
  traceEvents: readonly ReviewTraceInput[];
  patientNote?: PatientNote;
  facultyScoreDraft: ReviewPacket["facultyScoreDraft"];
  xrTraceInteractionEvidence?: StationXrTraceEvidenceSummary | null;
};

export type StationXrTraceEvidenceSummary = {
  stationRunId: string;
  source: "quest_cdp_manual_harvest" | "iwsdk_sidecar" | "ui_xr_runtime_trace";
  evidenceRef: string;
  capturedAt: string;
  activeLocomotionSource: string | null;
  locomotionDistanceMeters: number | null;
  locomotionTurnRadians: number | null;
  interactionSignalRefs: string[];
  latestTraceTag: string | null;
  latestTraceLatencyMs: number | null;
  blockers: string[];
  claimBoundary: "xr_trace_evidence_summary_not_score_use_quest_readiness_clinical_validity_or_raw_payload_readiness";
};

export function buildReviewPacket(input: BuildReviewPacketInput): ReviewPacket {
  if (input.facultyScoreDraft.reviewerId.trim().length === 0) {
    throw new Error("Faculty score draft requires reviewer identity");
  }
  if (input.patientNote && input.patientNote.stationRunId !== input.stationRunId) {
    throw new Error("Patient note station run ID must match review packet station run ID");
  }

  const { observed, missing } = evaluateRequiredTraceTags(input.requiredTraceTags, input.traceEvents);
  const reviewTraceEvents = input.xrTraceInteractionEvidence
    ? [...input.traceEvents, xrTraceInteractionSummaryEvent(input.xrTraceInteractionEvidence)]
    : [...input.traceEvents];
  const sortedTraceEvents = reviewTraceEvents.sort(compareTraceInputs);
  const preserveInputSequences = hasUniqueExplicitSequences(sortedTraceEvents);
  const unsafeEvents = input.traceEvents
    .map(unsafeEventLabel)
    .filter((eventType): eventType is string => Boolean(eventType));
  const modelGeneratedEvents = input.traceEvents.filter((event) => event.eventType === "actor.response.generated");
  const modelFailedEvents = input.traceEvents.filter((event) => event.eventType === "actor.response.failed");
  const voiceAudioEvents = input.traceEvents.filter((event) => event.eventType === "voice.audio.generated");
  const lateTraceTagThresholds = input.timeCriticalTraceTagThresholds ?? {};
  const lateTraceTagSet = new Set(lateTraceTags(input.traceEvents, lateTraceTagThresholds));
  const packet: ReviewPacket = {
    stationRunId: input.stationRunId,
    scenarioId: input.scenarioId,
    observedTraceTags: observed,
    missingRequiredTraceTags: missing,
    lateTraceTags: [...lateTraceTagSet],
    unsafeEvents,
    timeline: sortedTraceEvents.map((event, index) => ({
      sequence: preserveInputSequences ? event.sequence as number : index,
      atSecond: event.atSecond,
      eventType: event.eventType ?? "trace.event",
      source: event.source ?? "unknown",
      ...(event.actorId ? { actorId: event.actorId } : {}),
      ...(event.tag ? { tag: event.tag } : {}),
      summary: summarizeTimelineEvent(event, lateTraceTagSet, lateTraceTagThresholds),
    })),
    traceQuality: {
      eventCount: reviewTraceEvents.length,
      modelGeneratedEventCount: modelGeneratedEvents.length,
      modelFailedEventCount: modelFailedEvents.length,
      voiceAudioEventCount: voiceAudioEvents.length,
      blockedGuardrailCount: input.traceEvents.filter(hasBlockedGuardrail).length,
      unsafeEventCount: unsafeEvents.length,
      missingRequiredTraceTagCount: missing.length,
      hasPatientNote: Boolean(input.patientNote),
      hasModelProvenance: modelGeneratedEvents.length > 0 && modelGeneratedEvents.every(hasModelProvenance),
    },
    ...(input.patientNote ? { patientNote: { ...input.patientNote } } : {}),
    facultyScoreDraft: { ...input.facultyScoreDraft },
  };

  const validation = validateReviewPacket(packet);
  if (!validation.ok) {
    throw new Error(`Invalid review packet: ${validation.errors.join("; ")}`);
  }

  return packet;
}

function xrTraceInteractionSummaryEvent(summary: StationXrTraceEvidenceSummary): ReviewTraceInput {
  return {
    sequence: Number.MAX_SAFE_INTEGER - 1,
    eventType: "xr.trace.interaction",
    source: summary.source,
    ...(summary.latestTraceTag ? { tag: summary.latestTraceTag } : {}),
    atSecond: 0,
    payload: {
      latestTraceTag: summary.latestTraceTag ?? "none",
      source: summary.source,
      latestTraceLatencyMs: summary.latestTraceLatencyMs,
      activeLocomotionSource: summary.activeLocomotionSource,
      locomotionDistanceMeters: summary.locomotionDistanceMeters,
      locomotionTurnRadians: summary.locomotionTurnRadians,
      interactionSignalRefs: [...summary.interactionSignalRefs],
      blockers: [...summary.blockers],
      evidenceRef: summary.evidenceRef,
      claimBoundary: summary.claimBoundary,
    },
  };
}

function traceSequence(event: ReviewTraceInput): number {
  return event.sequence ?? Number.MAX_SAFE_INTEGER;
}

function hasUniqueExplicitSequences(events: readonly ReviewTraceInput[]): boolean {
  const sequences = events.map((event) => event.sequence);
  return sequences.every((sequence): sequence is number => typeof sequence === "number" && Number.isFinite(sequence))
    && new Set(sequences).size === sequences.length;
}

function compareTraceInputs(left: ReviewTraceInput, right: ReviewTraceInput): number {
  return traceSequence(left) - traceSequence(right)
    || left.atSecond - right.atSecond
    || compareOptionalString(left.eventType, right.eventType)
    || compareOptionalString(left.source, right.source)
    || compareOptionalString(left.actorId, right.actorId)
    || compareOptionalString(left.tag, right.tag);
}

function compareOptionalString(left: string | undefined, right: string | undefined): number {
  return (left ?? "").localeCompare(right ?? "");
}

function lateTraceTags(traceEvents: readonly ReviewTraceInput[], thresholds: Readonly<Record<string, number>>): string[] {
  const firstObservedAtSecondByTag = new Map<string, number>();

  for (const event of traceEvents) {
    if (!event.tag) {
      continue;
    }
    const current = firstObservedAtSecondByTag.get(event.tag);
    if (current === undefined || event.atSecond < current) {
      firstObservedAtSecondByTag.set(event.tag, event.atSecond);
    }
  }

  return Object.entries(thresholds)
    .filter(([tag, threshold]) => {
      const firstObservedAtSecond = firstObservedAtSecondByTag.get(tag);
      return firstObservedAtSecond !== undefined && firstObservedAtSecond > threshold;
    })
    .map(([tag]) => tag);
}

function summarizeTimelineEvent(
  event: ReviewTraceInput,
  lateTraceTagSet: ReadonlySet<string>,
  lateTraceTagThresholds: Readonly<Record<string, number>>,
): string {
  if (event.eventType === "xr.trace.interaction") {
    const latestTraceTag = payloadString(event.payload, "latestTraceTag") ?? "none";
    const source = payloadString(event.payload, "source") ?? "unknown";
    const claimBoundary = payloadString(event.payload, "claimBoundary") ?? "xr_trace_evidence_summary_not_score_use_quest_readiness_clinical_validity_or_raw_payload_readiness";
    return `XR trace interaction evidence: latest ${latestTraceTag} from ${source}; ${claimBoundary}`;
  }

  if (event.eventType === "learner.utterance" && event.actorId) {
    return [
      `Learner turn to ${event.actorId} recorded`,
      tagSummary(event),
      durableEventSummary(event, { includeUnavailable: false }),
      "payload text withheld",
    ].filter(Boolean).join("; ");
  }

  if (event.eventType === "actor.interaction.routed" && event.actorId) {
    return [
      `Actor interaction routed to ${event.actorId}`,
      tagSummary(event),
      durableEventSummary(event, { includeUnavailable: false }),
      "routing payload text withheld",
    ].filter(Boolean).join("; ");
  }

  if (event.eventType === "actor.response.generated" && event.actorId) {
    const providerId = nestedPayloadString(event.payload, ["provenance", "providerId"]) ?? "model provider";
    const responseKind = payloadString(event.payload, "responseKind");
    const guardrailStatus = nestedPayloadString(event.payload, ["provenance", "guardrail", "status"]);
    return [
      `${event.actorId} response generated by ${providerId}${responseKind ? ` (${responseKind})` : ""}`,
      guardrailStatus ? `guardrail ${guardrailStatus}` : undefined,
      durableEventSummary(event),
    ].filter(Boolean).join("; ");
  }

  if (event.eventType === "actor.response.failed" && event.actorId) {
    return [`${event.actorId} response generation failed`, durableEventSummary(event)].join("; ");
  }

  if (event.eventType === "voice.audio.generated" && event.actorId) {
    return [`${event.actorId} voice audio generated`, durableEventSummary(event)].join("; ");
  }

  if (event.eventType === "note.submitted") {
    return "Patient note submitted";
  }

  if (unsafeEventLabel(event)) {
    return `Unsafe/safety event recorded: ${unsafeEventLabel(event)}`;
  }

  return [
    `${event.source ?? "unknown"} ${event.eventType ?? "trace.event"}`,
    tagSummary(event),
    lateTagSummary(event, lateTraceTagSet, lateTraceTagThresholds),
  ].filter(Boolean).join("; ");
}

function unsafeEventLabel(event: ReviewTraceInput): string | undefined {
  if (event.tag?.startsWith("unsafe_")) {
    return event.tag;
  }
  if (event.eventType?.startsWith("unsafe.") || event.eventType?.startsWith("safety.")) {
    return event.eventType;
  }
  return undefined;
}

function hasBlockedGuardrail(event: ReviewTraceInput): boolean {
  return nestedPayloadString(event.payload, ["provenance", "guardrail", "status"]) === "blocked" || payloadString(event.payload, "responseKind") === "blocked_fallback";
}

function hasModelProvenance(event: ReviewTraceInput): boolean {
  return Boolean(recordValue(event.payload, "provenance"));
}

function tagSummary(event: ReviewTraceInput): string | undefined {
  return event.tag ? `tag ${event.tag}` : undefined;
}

function lateTagSummary(
  event: ReviewTraceInput,
  lateTraceTagSet: ReadonlySet<string>,
  lateTraceTagThresholds: Readonly<Record<string, number>>,
): string | undefined {
  if (!event.tag || !lateTraceTagSet.has(event.tag)) {
    return undefined;
  }
  const threshold = lateTraceTagThresholds[event.tag];
  return typeof threshold === "number" ? `late after ${threshold}s threshold` : "late trace tag";
}

function durableEventSummary(event: ReviewTraceInput, options: { includeUnavailable?: boolean } = {}): string | undefined {
  const durableEventRef = payloadString(event.payload, "durableEventRef");
  if (durableEventRef) {
    return `durable event ${durableEventRef}`;
  }
  return options.includeUnavailable === false ? undefined : "durable event reference unavailable";
}

function payloadString(payload: Record<string, unknown> | undefined, key: string): string | undefined {
  const value = payload?.[key];
  return typeof value === "string" ? value : undefined;
}

function nestedPayloadString(payload: Record<string, unknown> | undefined, keys: readonly string[]): string | undefined {
  let value: unknown = payload;
  for (const key of keys) {
    if (!isRecord(value)) {
      return undefined;
    }
    value = value[key];
  }

  return typeof value === "string" ? value : undefined;
}

function recordValue(payload: Record<string, unknown> | undefined, key: string): Record<string, unknown> | undefined {
  const value = payload?.[key];
  return isRecord(value) ? value : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
