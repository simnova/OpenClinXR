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

/** Canonical encounter→note→advance types from scenario-runtime 73046d48. */
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

export const ASSEMBLED_EXAM_PHASE_BY_TYPE = {
  "encounter.started": "encounter",
  "encounter.ended": "encounter",
  "note.started": "note",
  "note.submitted": "note",
  "station.advanced": "complete",
} as const;

export type AssembledExamPhase = (typeof ASSEMBLED_EXAM_PHASE_BY_TYPE)[AssembledExamPhaseTransitionType];

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
  eventType: AssembledExamPhaseTransitionType;
  sequence: number;
  atSecond: number;
  formAtSecond: number;
  phase: AssembledExamPhase;
  advanceReason: string | null;
  durableEventRef: string;
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

export function buildAssembledExamReviewPacket(
  input: BuildAssembledExamReviewPacketInput,
): AssembledExamReviewPacket {
  if (input.examRunId.trim().length === 0) {
    fail("requires examRunId");
  }
  if (input.stations.length === 0) {
    fail("requires at least one station");
  }

  rejectInvalidStationOrders(input);
  rejectCrossRunEvidence(input);
  rejectMalformedPhaseTransitions(input);
  rejectDuplicateSequences(input);
  rejectOutOfOrderTraceEvents(input);

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
  const traces = station.reviewPacket.timeline.map((entry) => ({
    ...identity,
    sequence: entry.sequence,
    atSecond: entry.atSecond,
    eventType: entry.eventType,
    source: entry.source,
    kind: "station_trace" as const,
    summary: entry.summary,
  }));
  const phases = station.phaseTransitions.map((entry) => ({
    ...identity,
    sequence: entry.sequence,
    atSecond: entry.atSecond,
    eventType: entry.eventType,
    source: "system",
    kind: "phase_transition" as const,
    summary: summarizePhaseTransition(entry),
  }));
  return [...traces, ...phases].sort(
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

function rejectInvalidStationOrders(input: BuildAssembledExamReviewPacketInput): void {
  const seen = new Set<number>();
  for (const station of input.stations) {
    if (!isPositiveInteger(station.stationOrder) || seen.has(station.stationOrder)) {
      fail("requires positive unique integer stationOrder");
    }
    seen.add(station.stationOrder);
  }
}

function rejectCrossRunEvidence(input: BuildAssembledExamReviewPacketInput): void {
  const seenStationRunIds = new Set<string>();
  for (const station of input.stations) {
    if (station.stationRunId.trim().length === 0 || station.scenarioId.trim().length === 0) {
      fail("rejects cross-run evidence");
    }
    if (seenStationRunIds.has(station.stationRunId)) {
      fail("rejects cross-run evidence");
    }
    seenStationRunIds.add(station.stationRunId);

    if (station.patientNote && station.patientNote.stationRunId !== station.stationRunId) {
      fail("rejects cross-run evidence");
    }
    if (
      station.xrTraceInteractionEvidence
      && station.xrTraceInteractionEvidence.stationRunId !== station.stationRunId
    ) {
      fail("rejects cross-run evidence");
    }

    for (const event of station.traceEvents) {
      if (event.stationRunId && event.stationRunId !== station.stationRunId) {
        fail("rejects cross-run evidence");
      }
      const payloadExamRunId = payloadString(event.payload, "examRunId");
      if (payloadExamRunId && payloadExamRunId !== input.examRunId) {
        fail("rejects cross-run evidence");
      }
      const payloadScenarioId = payloadString(event.payload, "scenarioId");
      if (payloadScenarioId && payloadScenarioId !== station.scenarioId) {
        fail("rejects cross-run evidence");
      }
      const plan = payloadValue(event.payload, "actorTurnPlan");
      const planStationRunId = isRecord(plan) ? payloadString(plan, "stationRunId") : null;
      if (planStationRunId && planStationRunId !== station.stationRunId) {
        fail("rejects cross-run evidence");
      }
    }
  }
}

function rejectMalformedPhaseTransitions(input: BuildAssembledExamReviewPacketInput): void {
  const rank = new Map<string, number>(
    ASSEMBLED_EXAM_PHASE_TRANSITION_TYPES.map((eventType, index) => [eventType, index]),
  );

  for (const station of input.stations) {
    const seenTypes = new Set<string>();
    for (const event of station.phaseTransitions) {
      const eventType = event.eventType;
      if (!eventType || !isPhaseTransitionType(eventType)) {
        fail("rejects unknown phase-transition type");
      }
      if (seenTypes.has(eventType)) {
        fail("rejects duplicate phase-transition type");
      }
      seenTypes.add(eventType);

      if (!isNonNegativeInteger(event.sequence) || !isNonNegativeInteger(event.atSecond)) {
        fail("rejects malformed phase-transition numerics");
      }
      const formAtSecond = payloadValue(event.payload, "formAtSecond");
      if (!isNonNegativeInteger(formAtSecond)) {
        fail("rejects malformed phase-transition numerics");
      }

      if (event.stationRunId !== station.stationRunId) {
        fail("rejects malformed phase-transition provenance");
      }
      if (payloadString(event.payload, "examRunId") !== input.examRunId) {
        fail("rejects malformed phase-transition provenance");
      }
      if (payloadString(event.payload, "scenarioId") !== station.scenarioId) {
        fail("rejects malformed phase-transition provenance");
      }
      if (payloadValue(event.payload, "stationOrder") !== station.stationOrder) {
        fail("rejects malformed phase-transition provenance");
      }
      if (payloadString(event.payload, "phase") !== ASSEMBLED_EXAM_PHASE_BY_TYPE[eventType]) {
        fail("rejects malformed phase-transition provenance");
      }
      const expectedRef = durableEventRef(station.stationRunId, event.sequence);
      if (payloadString(event.payload, "durableEventRef") !== expectedRef) {
        fail("rejects malformed phase-transition provenance");
      }

      if (eventType === "station.advanced") {
        const payloadReason = payloadString(event.payload, "advanceReason");
        const stationReason = station.advanceReason?.trim() ? station.advanceReason : null;
        if (!payloadReason || payloadReason !== stationReason) {
          fail("rejects advance-reason mismatch");
        }
      }
    }

    const ordered = [...station.phaseTransitions].sort(
      (left, right) => (left.sequence as number) - (right.sequence as number),
    );
    let lastRank = -1;
    let lastAtSecond = 0;
    let lastFormAtSecond = 0;
    for (const [index, event] of ordered.entries()) {
      const currentRank = rank.get(event.eventType ?? "") ?? -1;
      if (currentRank < lastRank) {
        fail("rejects out-of-order evidence");
      }
      const atSecond = event.atSecond;
      const orderedFormAtSecond = payloadValue(event.payload, "formAtSecond");
      if (
        index > 0
        && (atSecond < lastAtSecond || !isNonNegativeInteger(orderedFormAtSecond) || orderedFormAtSecond < lastFormAtSecond)
      ) {
        fail("rejects out-of-order evidence");
      }
      lastRank = currentRank;
      lastAtSecond = atSecond;
      lastFormAtSecond = orderedFormAtSecond as number;
    }
  }
}

function rejectDuplicateSequences(input: BuildAssembledExamReviewPacketInput): void {
  for (const station of input.stations) {
    const sequences = [...station.traceEvents, ...station.phaseTransitions]
      .map((event) => event.sequence)
      .filter((sequence): sequence is number => typeof sequence === "number");
    if (new Set(sequences).size !== sequences.length) {
      fail("rejects duplicate-sequence evidence");
    }
  }
}

function rejectOutOfOrderTraceEvents(input: BuildAssembledExamReviewPacketInput): void {
  for (const station of input.stations) {
    const sequenced = station.traceEvents.filter(
      (event): event is AssembledExamReviewTraceInput & { sequence: number } =>
        typeof event.sequence === "number",
    );
    const ordered = [...sequenced].sort((left, right) => left.sequence - right.sequence);
    for (let index = 1; index < ordered.length; index += 1) {
      const previous = ordered[index - 1]!;
      const current = ordered[index]!;
      if (current.sequence <= previous.sequence || current.atSecond < previous.atSecond) {
        fail("rejects out-of-order evidence");
      }
    }
  }
}

function toReviewTraceInput(event: AssembledExamReviewTraceInput): ReviewTraceInput {
  const { stationRunId: _stationRunId, ...rest } = event;
  return rest;
}

function toPhaseTransitionRecord(
  event: AssembledExamReviewTraceInput,
): AssembledExamPhaseTransitionRecord {
  const eventType = event.eventType as AssembledExamPhaseTransitionType;
  return {
    eventType,
    sequence: event.sequence as number,
    atSecond: event.atSecond,
    formAtSecond: payloadValue(event.payload, "formAtSecond") as number,
    phase: ASSEMBLED_EXAM_PHASE_BY_TYPE[eventType],
    advanceReason: payloadString(event.payload, "advanceReason"),
    durableEventRef: payloadString(event.payload, "durableEventRef") ?? "",
  };
}

function durableEventRef(stationRunId: string, sequence: number): string {
  return `durable://station-runs/${stationRunId}/events/${sequence}`;
}

function isPhaseTransitionType(value: string): value is AssembledExamPhaseTransitionType {
  return (ASSEMBLED_EXAM_PHASE_TRANSITION_TYPES as readonly string[]).includes(value);
}

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
}

function isPositiveInteger(value: unknown): value is number {
  return isNonNegativeInteger(value) && value > 0;
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
  return Boolean(payloadValue(event.payload, "actorTurnPlan") || payloadValue(event.payload, "actorTurnExecution"));
}

function payloadValue(payload: Record<string, unknown> | undefined, key: string): unknown {
  return payload?.[key];
}

function payloadString(payload: Record<string, unknown> | undefined, key: string): string | null {
  const value = payloadValue(payload, key);
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function uniquePreserve(values: readonly string[]): string[] {
  return [...new Set(values)];
}

function fail(suffix: string): never {
  throw new Error(`Assembled exam review packet ${suffix}`);
}
