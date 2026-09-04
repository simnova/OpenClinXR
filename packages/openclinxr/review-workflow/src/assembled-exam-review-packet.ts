import type { PatientNote, ReviewPacket } from "@openclinxr/shared-schemas";
import {
  extractFacultyActorTurnReplays,
} from "./faculty-actor-turn-replay.js";
import {
  buildReviewPacket,
  type BuildReviewPacketInput,
  type ReviewPacketWithEmotionTimeline,
  type ReviewTraceInput,
  type StationXrTraceEvidenceSummary,
} from "./review-packet.js";

/**
 * Canonical encounter→note→advance types from scenario-runtime 73046d48.
 * Copied as a review-domain contract so this package does not import runtime.
 */
export const ASSEMBLED_EXAM_PHASE_TRANSITION_TYPES = [
  "encounter.started",
  "encounter.ended",
  "note.started",
  "note.submitted",
  "station.advanced",
] as const;

export type AssembledExamPhaseTransitionType =
  (typeof ASSEMBLED_EXAM_PHASE_TRANSITION_TYPES)[number];

export const assembledExamReviewNotEvidenceFor = [
  "exam_equivalence",
  "clinical_validity",
  "scoring_validity",
  "quest_readiness",
  "learner_readiness",
  "production_deployment",
  "automated_scoring",
  "clinical_approval",
] as const;

export type AssembledExamReviewTraceInput = ReviewTraceInput & {
  stationRunId?: string;
};

export type AssembledExamStationEvidenceInput = {
  stationRunId: string;
  scenarioId: string;
  stationOrder: number;
  requiredTraceTags: readonly string[];
  timeCriticalTraceTagThresholds?: Readonly<Record<string, number>>;
  traceEvents: readonly AssembledExamReviewTraceInput[];
  phaseTransitions: readonly AssembledExamReviewTraceInput[];
  patientNote?: PatientNote;
  blockers?: readonly string[];
  advanceReason?: string | null;
  facultyScoreDraft: ReviewPacket["facultyScoreDraft"];
  xrTraceInteractionEvidence?: StationXrTraceEvidenceSummary | null;
};

export type BuildAssembledExamReviewPacketInput = {
  examRunId: string;
  learnerId?: string;
  stations: readonly AssembledExamStationEvidenceInput[];
};

export type AssembledExamAuthoredScenarioIdentity = {
  examRunId: string;
  stationRunId: string;
  scenarioId: string;
  stationOrder: number;
};

export type AssembledExamPhaseTransitionRecord = {
  eventType: string;
  sequence: number;
  atSecond: number;
  formAtSecond: number | null;
  phase: string | null;
  advanceReason: string | null;
  durableEventRef: string | null;
};

export type AssembledExamReviewTimelineEntry = {
  examRunId: string;
  stationRunId: string;
  scenarioId: string;
  stationOrder: number;
  sequence: number;
  atSecond: number;
  eventType: string;
  source: string;
  kind: "station_trace" | "phase_transition";
  summary: string;
};

export type AssembledExamStationReviewSlice = {
  identity: AssembledExamAuthoredScenarioIdentity;
  advanceReason: string | null;
  blockers: readonly string[];
  omissions: readonly string[];
  patientNoteSubmitted: boolean;
  phaseTransitions: readonly AssembledExamPhaseTransitionRecord[];
  reviewPacket: ReviewPacketWithEmotionTimeline;
};

export type AssembledExamReviewPacket = {
  examRunId: string;
  learnerId: string | null;
  stations: readonly AssembledExamStationReviewSlice[];
  examTimeline: readonly AssembledExamReviewTimelineEntry[];
  omissions: readonly string[];
  claimBoundary: "assembled_exam_review_packet_not_exam_equivalence";
  notEvidenceFor: typeof assembledExamReviewNotEvidenceFor;
  examEquivalenceGate: false;
};

/**
 * Project one assembled exam run into a faculty-reviewable packet.
 * Station boundaries stay grouped by stationRunId + authored scenario identity.
 */
export function buildAssembledExamReviewPacket(
  input: BuildAssembledExamReviewPacketInput,
): AssembledExamReviewPacket {
  if (input.examRunId.trim().length === 0) {
    throw new Error("Assembled exam review packet requires examRunId");
  }
  if (input.stations.length === 0) {
    throw new Error("Assembled exam review packet requires at least one station");
  }

  rejectCrossRunEvidence(input);
  rejectDuplicateSequences(input);
  rejectOutOfOrderEvidence(input);

  const stations = [...input.stations]
    .sort((left, right) => left.stationOrder - right.stationOrder)
    .map((station) => projectStationSlice(input.examRunId, station));

  const examTimeline = stations.flatMap((station) =>
    examTimelineForStation(station),
  );
  const omissions = uniquePreserve(stations.flatMap((station) => station.omissions));

  return {
    examRunId: input.examRunId,
    learnerId: input.learnerId?.trim() ? input.learnerId : null,
    stations,
    examTimeline,
    omissions,
    claimBoundary: "assembled_exam_review_packet_not_exam_equivalence",
    notEvidenceFor: assembledExamReviewNotEvidenceFor,
    examEquivalenceGate: false,
  };
}

function projectStationSlice(
  examRunId: string,
  station: AssembledExamStationEvidenceInput,
): AssembledExamStationReviewSlice {
  const packetInput: BuildReviewPacketInput = {
    stationRunId: station.stationRunId,
    scenarioId: station.scenarioId,
    requiredTraceTags: station.requiredTraceTags,
    traceEvents: station.traceEvents.map(toReviewTraceInput),
    facultyScoreDraft: station.facultyScoreDraft,
    ...(station.timeCriticalTraceTagThresholds
      ? { timeCriticalTraceTagThresholds: station.timeCriticalTraceTagThresholds }
      : {}),
    ...(station.patientNote ? { patientNote: station.patientNote } : {}),
    ...(station.xrTraceInteractionEvidence
      ? { xrTraceInteractionEvidence: station.xrTraceInteractionEvidence }
      : {}),
  };
  const reviewPacket = buildReviewPacket(packetInput);
  const phaseTransitions = station.phaseTransitions
    .map(toPhaseTransitionRecord)
    .sort((left, right) => left.sequence - right.sequence);
  const advanceReason = station.advanceReason?.trim() ? station.advanceReason : null;
  const blockers = [...(station.blockers ?? [])];
  const omissions = stationOmissions(station, reviewPacket, phaseTransitions, advanceReason);

  return {
    identity: {
      examRunId,
      stationRunId: station.stationRunId,
      scenarioId: station.scenarioId,
      stationOrder: station.stationOrder,
    },
    advanceReason,
    blockers,
    omissions,
    patientNoteSubmitted: Boolean(reviewPacket.patientNote) || hasNoteSubmitted(station),
    phaseTransitions,
    reviewPacket,
  };
}

function examTimelineForStation(
  station: AssembledExamStationReviewSlice,
): AssembledExamReviewTimelineEntry[] {
  const identity = station.identity;
  const traceEntries: AssembledExamReviewTimelineEntry[] = station.reviewPacket.timeline.map(
    (entry) => ({
      examRunId: identity.examRunId,
      stationRunId: identity.stationRunId,
      scenarioId: identity.scenarioId,
      stationOrder: identity.stationOrder,
      sequence: entry.sequence,
      atSecond: entry.atSecond,
      eventType: entry.eventType,
      source: entry.source,
      kind: "station_trace",
      summary: entry.summary,
    }),
  );
  const phaseEntries: AssembledExamReviewTimelineEntry[] = station.phaseTransitions.map(
    (entry) => ({
      examRunId: identity.examRunId,
      stationRunId: identity.stationRunId,
      scenarioId: identity.scenarioId,
      stationOrder: identity.stationOrder,
      sequence: entry.sequence,
      atSecond: entry.atSecond,
      eventType: entry.eventType,
      source: "system",
      kind: "phase_transition",
      summary: summarizePhaseTransition(entry),
    }),
  );
  return [...traceEntries, ...phaseEntries].sort(
    (left, right) => left.sequence - right.sequence || left.atSecond - right.atSecond,
  );
}

function stationOmissions(
  station: AssembledExamStationEvidenceInput,
  reviewPacket: ReviewPacketWithEmotionTimeline,
  phaseTransitions: readonly AssembledExamPhaseTransitionRecord[],
  advanceReason: string | null,
): string[] {
  const presentTypes = new Set(phaseTransitions.map((event) => event.eventType));
  const omissions: string[] = [];
  for (const eventType of ASSEMBLED_EXAM_PHASE_TRANSITION_TYPES) {
    if (!presentTypes.has(eventType)) {
      omissions.push(`missing_phase_transition:${eventType}`);
    }
  }
  if (!station.patientNote && !hasNoteSubmitted(station)) {
    omissions.push("missing_patient_note");
  }
  if (!advanceReason) {
    omissions.push("missing_advance_reason");
  }
  for (const tag of reviewPacket.missingRequiredTraceTags) {
    omissions.push(`missing_required_trace_tag:${tag}`);
  }
  for (const replay of reviewPacket.actorTurnReplays) {
    if (!replay.execution) {
      omissions.push(`missing_actor_turn_execution:${replay.planId}`);
    }
  }
  const plannedKeys = new Set(
    extractFacultyActorTurnReplays(station.traceEvents).map((replay) => replay.planId),
  );
  if (station.traceEvents.some((event) => hasActorTurnPayload(event)) && plannedKeys.size === 0) {
    omissions.push("missing_actor_turn_provenance");
  }
  return uniquePreserve(omissions);
}

function rejectCrossRunEvidence(input: BuildAssembledExamReviewPacketInput): void {
  const seenStationRunIds = new Set<string>();
  const seenStationOrders = new Set<number>();
  for (const station of input.stations) {
    if (station.stationRunId.trim().length === 0 || station.scenarioId.trim().length === 0) {
      throw new Error("Assembled exam review packet rejects cross-run evidence");
    }
    if (seenStationRunIds.has(station.stationRunId) || seenStationOrders.has(station.stationOrder)) {
      throw new Error("Assembled exam review packet rejects cross-run evidence");
    }
    seenStationRunIds.add(station.stationRunId);
    seenStationOrders.add(station.stationOrder);

    if (station.patientNote && station.patientNote.stationRunId !== station.stationRunId) {
      throw new Error("Assembled exam review packet rejects cross-run evidence");
    }
    if (
      station.xrTraceInteractionEvidence
      && station.xrTraceInteractionEvidence.stationRunId !== station.stationRunId
    ) {
      throw new Error("Assembled exam review packet rejects cross-run evidence");
    }

    for (const event of [...station.traceEvents, ...station.phaseTransitions]) {
      if (event.stationRunId && event.stationRunId !== station.stationRunId) {
        throw new Error("Assembled exam review packet rejects cross-run evidence");
      }
      const payloadExamRunId = payloadString(event.payload, "examRunId");
      if (payloadExamRunId && payloadExamRunId !== input.examRunId) {
        throw new Error("Assembled exam review packet rejects cross-run evidence");
      }
      const payloadScenarioId = payloadString(event.payload, "scenarioId");
      if (payloadScenarioId && payloadScenarioId !== station.scenarioId) {
        throw new Error("Assembled exam review packet rejects cross-run evidence");
      }
      const payloadStationOrder = event.payload?.["stationOrder"];
      if (typeof payloadStationOrder === "number" && payloadStationOrder !== station.stationOrder) {
        throw new Error("Assembled exam review packet rejects cross-run evidence");
      }
      const plan = event.payload?.["actorTurnPlan"];
      if (isRecord(plan) && typeof plan["stationRunId"] === "string" && plan["stationRunId"] !== station.stationRunId) {
        throw new Error("Assembled exam review packet rejects cross-run evidence");
      }
    }
  }
}

function rejectDuplicateSequences(input: BuildAssembledExamReviewPacketInput): void {
  for (const station of input.stations) {
    const sequences = [...station.traceEvents, ...station.phaseTransitions]
      .map((event) => event.sequence)
      .filter((sequence): sequence is number => typeof sequence === "number");
    if (new Set(sequences).size !== sequences.length) {
      throw new Error("Assembled exam review packet rejects duplicate-sequence evidence");
    }
  }
}

function rejectOutOfOrderEvidence(input: BuildAssembledExamReviewPacketInput): void {
  for (const station of input.stations) {
    rejectNonMonotonic(station.traceEvents);
    rejectNonMonotonic(station.phaseTransitions);
    rejectPhaseTypeOrder(station.phaseTransitions);
  }
}

function rejectNonMonotonic(events: readonly AssembledExamReviewTraceInput[]): void {
  const sequenced = events.filter(
    (event): event is AssembledExamReviewTraceInput & { sequence: number } =>
      typeof event.sequence === "number",
  );
  const ordered = [...sequenced].sort((left, right) => left.sequence - right.sequence);
  for (let index = 1; index < ordered.length; index += 1) {
    const previous = ordered[index - 1];
    const current = ordered[index];
    if (!previous || !current) {
      continue;
    }
    if (current.sequence <= previous.sequence) {
      throw new Error("Assembled exam review packet rejects out-of-order evidence");
    }
    if (current.atSecond < previous.atSecond) {
      throw new Error("Assembled exam review packet rejects out-of-order evidence");
    }
    const previousForm = payloadNumber(previous.payload, "formAtSecond");
    const currentForm = payloadNumber(current.payload, "formAtSecond");
    if (previousForm !== null && currentForm !== null && currentForm < previousForm) {
      throw new Error("Assembled exam review packet rejects out-of-order evidence");
    }
  }
}

function rejectPhaseTypeOrder(events: readonly AssembledExamReviewTraceInput[]): void {
  const rank = new Map<string, number>(
    ASSEMBLED_EXAM_PHASE_TRANSITION_TYPES.map((eventType, index) => [eventType, index]),
  );
  const ranked = events
    .filter((event) => event.eventType && rank.has(event.eventType) && typeof event.sequence === "number")
    .sort((left, right) => (left.sequence as number) - (right.sequence as number));
  let lastRank = -1;
  for (const event of ranked) {
    const currentRank = rank.get(event.eventType ?? "") ?? -1;
    if (currentRank < lastRank) {
      throw new Error("Assembled exam review packet rejects out-of-order evidence");
    }
    lastRank = currentRank;
  }
}

function toReviewTraceInput(event: AssembledExamReviewTraceInput): ReviewTraceInput {
  return {
    ...(typeof event.sequence === "number" ? { sequence: event.sequence } : {}),
    ...(event.tag ? { tag: event.tag } : {}),
    atSecond: event.atSecond,
    ...(event.eventType ? { eventType: event.eventType } : {}),
    ...(event.source ? { source: event.source } : {}),
    ...(event.actorId ? { actorId: event.actorId } : {}),
    ...(event.payload ? { payload: event.payload } : {}),
  };
}

function toPhaseTransitionRecord(
  event: AssembledExamReviewTraceInput,
): AssembledExamPhaseTransitionRecord {
  return {
    eventType: event.eventType ?? "trace.event",
    sequence: event.sequence ?? Number.MAX_SAFE_INTEGER,
    atSecond: event.atSecond,
    formAtSecond: payloadNumber(event.payload, "formAtSecond"),
    phase: payloadString(event.payload, "phase"),
    advanceReason: payloadString(event.payload, "advanceReason"),
    durableEventRef: payloadString(event.payload, "durableEventRef"),
  };
}

function summarizePhaseTransition(entry: AssembledExamPhaseTransitionRecord): string {
  return [
    `phase transition ${entry.eventType}`,
    entry.phase ? `phase ${entry.phase}` : undefined,
    entry.advanceReason ? `advanceReason ${entry.advanceReason}` : undefined,
    entry.durableEventRef ? `durable event ${entry.durableEventRef}` : "durable event reference unavailable",
  ].filter(Boolean).join("; ");
}

function hasNoteSubmitted(station: AssembledExamStationEvidenceInput): boolean {
  return [...station.traceEvents, ...station.phaseTransitions].some(
    (event) => event.eventType === "note.submitted" || event.tag === "patient_note_submitted",
  );
}

function hasActorTurnPayload(event: AssembledExamReviewTraceInput): boolean {
  return Boolean(event.payload?.["actorTurnPlan"] || event.payload?.["actorTurnExecution"]);
}

function payloadString(payload: Record<string, unknown> | undefined, key: string): string | null {
  const value = payload?.[key];
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

function payloadNumber(payload: Record<string, unknown> | undefined, key: string): number | null {
  const value = payload?.[key];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function uniquePreserve(values: readonly string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    if (seen.has(value)) {
      continue;
    }
    seen.add(value);
    result.push(value);
  }
  return result;
}
