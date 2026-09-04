/**
 * Deterministic assembled-exam aggregate: resume the current/next station from an
 * immutable exam form plus a restored exam-run ledger projection.
 *
 * Progress is only admitted canonical phase events. This module does not walk
 * exam-assembly form-run pointers or UI-local station indexes.
 */
import type { ExamForm, ExamTimingPlan } from "@openclinxr/exam-assembly";
import {
  ASSEMBLED_EXAM_PHASE_TRANSITION_TYPES,
  type AssembledExamPhase,
  type AssembledExamPhaseTransitionType,
} from "@openclinxr/review-workflow";
import type { AssembledStationContext } from "./runtime-types.js";
import { validateAssembledStationContext } from "./trace.js";

export const assembledExamOrchestratorClaimBoundary =
  "assembled_exam_resume_not_exam_equivalence" as const;

export const assembledExamOrchestratorNotEvidenceFor = [
  "exam_equivalence",
  "clinical_validity",
  "scoring_validity",
  "quest_readiness",
  "learner_readiness",
  "production_deployment",
] as const;

export type AssembledExamLedgerStationBinding = {
  stationOrder: number;
  slotId: string;
  stationRunId: string;
  scenarioId: string | null;
  scenarioVersion: number | null;
};

export type AssembledExamAdmittedPhaseEvent = {
  examRunId: string;
  stationRunId: string;
  sequence: number;
  eventType: AssembledExamPhaseTransitionType;
  atSecond: number;
  formAtSecond: number;
  scenarioId: string;
  stationOrder: number;
  durableEventRef: string;
  phase: AssembledExamPhase;
  advanceReason?: string;
};

export type AssembledExamOmission = {
  kind: string;
  stationRunId: string;
  stationOrder: number;
  reason: string;
};

export type AssembledExamLedgerResumeProjection = {
  examRunId: string;
  formIdentity: { examRunId: string; examFormId: string; blueprintId: string };
  orderedStations: readonly AssembledExamLedgerStationBinding[];
  admittedPhaseEvents: readonly AssembledExamAdmittedPhaseEvent[];
  omissions: readonly AssembledExamOmission[];
};

export type RequestedAssembledExamStation = {
  stationOrder: number;
  scenarioId: string;
  stationRunId?: string;
};

export type ResumeAssembledExamInput = {
  form: ExamForm;
  timingPlan: ExamTimingPlan;
  projection: AssembledExamLedgerResumeProjection;
  requestedStation?: RequestedAssembledExamStation;
};

export type AssembledExamLifecycleState = {
  lastAdmittedEventType: AssembledExamPhaseTransitionType | null;
  nextExpectedEventType: AssembledExamPhaseTransitionType | null;
  admittedEventTypes: AssembledExamPhaseTransitionType[];
  durableEventRefs: string[];
  noteSubmitted: boolean;
  phase: AssembledExamPhase | "not_started";
};

export type AssembledExamResumeAction = "resume_station" | "advance_station" | "exam_complete";

export type AssembledExamSelectedStation = {
  stationOrder: number;
  scenarioId: string;
  stationRunId: string;
  slotId: string;
  assembledStation: AssembledStationContext;
  lifecycle: AssembledExamLifecycleState;
};

export type AssembledExamResumeDecision = {
  action: AssembledExamResumeAction;
  examRunId: string;
  examFormId: string;
  blueprintId: string;
  selectedStation: AssembledExamSelectedStation | null;
  durableEventRefs: string[];
  omissions: AssembledExamOmission[];
  claimBoundary: typeof assembledExamOrchestratorClaimBoundary;
  notEvidenceFor: typeof assembledExamOrchestratorNotEvidenceFor;
  examEquivalenceGate: false;
};

type BoundStation = {
  stationOrder: number;
  scenarioId: string;
  stationRunId: string;
  slotId: string;
  assembledStation: AssembledStationContext;
};

const PHASE_RANK = new Map<string, number>(
  ASSEMBLED_EXAM_PHASE_TRANSITION_TYPES.map((eventType, index) => [eventType, index]),
);

function requireField(value: string, fieldName: string): string {
  if (value.trim().length === 0) {
    throw new Error(`assembled exam orchestrator requires nonblank ${fieldName}`);
  }
  return value;
}

function requirePositiveInt(value: number, fieldName: string): number {
  if (!Number.isInteger(value) || value < 1) {
    throw new Error(`assembled exam orchestrator requires positive integer ${fieldName}`);
  }
  return value;
}

function isCanonicalType(value: string): value is AssembledExamPhaseTransitionType {
  return (ASSEMBLED_EXAM_PHASE_TRANSITION_TYPES as readonly string[]).includes(value);
}

function formTimingFor(timingPlan: ExamTimingPlan, stationOrder: number): AssembledStationContext["formTiming"] {
  const window = timingPlan.stationWindows.find((entry) => entry.stationOrder === stationOrder);
  if (!window) {
    throw new Error(`assembled exam orchestrator missing form timing for stationOrder ${stationOrder}`);
  }
  return {
    doorway: { startsAtSecond: window.doorway.startsAtSecond, endsAtSecond: window.doorway.endsAtSecond },
    encounter: { startsAtSecond: window.encounter.startsAtSecond, endsAtSecond: window.encounter.endsAtSecond },
    note: { startsAtSecond: window.note.startsAtSecond, endsAtSecond: window.note.endsAtSecond },
  };
}

function bindStations(
  form: ExamForm,
  timingPlan: ExamTimingPlan,
  projection: AssembledExamLedgerResumeProjection,
): BoundStation[] {
  const formRefs = [...form.stationRefs].sort((left, right) => left.order - right.order);
  if (formRefs.length === 0) {
    throw new Error("assembled exam orchestrator requires an ordered exam form");
  }
  const seenFormOrders = new Set<number>();
  const seenFormScenarios = new Set<string>();
  for (const ref of formRefs) {
    requirePositiveInt(ref.order, "stationOrder");
    requireField(ref.scenarioId, "scenarioId");
    if (seenFormOrders.has(ref.order)) {
      throw new Error(`duplicated station identity: stationOrder ${ref.order}`);
    }
    if (seenFormScenarios.has(ref.scenarioId)) {
      throw new Error(`duplicated station identity: scenarioId ${ref.scenarioId}`);
    }
    seenFormOrders.add(ref.order);
    seenFormScenarios.add(ref.scenarioId);
  }

  const boundStations = [...projection.orderedStations].sort((left, right) => left.stationOrder - right.stationOrder);
  if (boundStations.length !== formRefs.length) {
    throw new Error(
      `out-of-form station identity: projection has ${boundStations.length} stations, form has ${formRefs.length}`,
    );
  }
  const seenOrders = new Set<number>();
  const seenRuns = new Set<string>();
  return boundStations.map((station, index) => {
    const ref = formRefs[index];
    if (!ref) {
      throw new Error(`out-of-form station identity: stationOrder ${station.stationOrder}`);
    }
    requirePositiveInt(station.stationOrder, "stationOrder");
    requireField(station.slotId, "slotId");
    requireField(station.stationRunId, "stationRunId");
    const scenarioId = requireField(station.scenarioId ?? "", "scenarioId");
    if (seenOrders.has(station.stationOrder) || seenRuns.has(station.stationRunId)) {
      throw new Error(
        `duplicated station identity: stationOrder ${station.stationOrder} stationRunId ${station.stationRunId}`,
      );
    }
    seenOrders.add(station.stationOrder);
    seenRuns.add(station.stationRunId);
    if (station.stationOrder !== ref.order || scenarioId !== ref.scenarioId) {
      throw new Error(
        `out-of-form station identity: projection ${station.stationOrder}:${scenarioId} does not match form ${ref.order}:${ref.scenarioId}`,
      );
    }
    return {
      stationOrder: station.stationOrder,
      scenarioId,
      stationRunId: station.stationRunId,
      slotId: station.slotId,
      assembledStation: validateAssembledStationContext(
        {
          examRunId: projection.examRunId,
          scenarioId,
          stationOrder: station.stationOrder,
          formTiming: formTimingFor(timingPlan, station.stationOrder),
        },
        scenarioId,
      ),
    };
  });
}

function eventsForStation(
  projection: AssembledExamLedgerResumeProjection,
  station: BoundStation,
): AssembledExamAdmittedPhaseEvent[] {
  const events = projection.admittedPhaseEvents
    .filter((event) => event.stationRunId === station.stationRunId)
    .sort((left, right) => (PHASE_RANK.get(left.eventType) ?? -1) - (PHASE_RANK.get(right.eventType) ?? -1));
  const seenTypes = new Set<string>();
  let previousRank = -1;
  for (const event of events) {
    if (event.examRunId !== projection.examRunId) {
      throw new Error(`out-of-form station identity: event examRunId ${event.examRunId}`);
    }
    if (!isCanonicalType(event.eventType)) {
      throw new Error(`assembled exam orchestrator rejects noncanonical event type ${event.eventType}`);
    }
    if (event.stationOrder !== station.stationOrder || event.scenarioId !== station.scenarioId) {
      throw new Error(
        `out-of-form station identity: event ${event.eventType} ${event.stationOrder}:${event.scenarioId}`,
      );
    }
    if (seenTypes.has(event.eventType)) {
      throw new Error(`duplicated station identity: ${event.eventType} already admitted for ${station.stationRunId}`);
    }
    const rank = PHASE_RANK.get(event.eventType) ?? -1;
    if (rank !== previousRank + 1) {
      throw new Error(`out-of-order transition: ${event.eventType} on stationOrder ${station.stationOrder}`);
    }
    seenTypes.add(event.eventType);
    previousRank = rank;
  }
  return events;
}

function lifecycleFrom(events: readonly AssembledExamAdmittedPhaseEvent[]): AssembledExamLifecycleState {
  const admittedEventTypes = events.map((event) => event.eventType);
  const lastAdmittedEventType = admittedEventTypes[admittedEventTypes.length - 1] ?? null;
  const lastRank = lastAdmittedEventType === null ? -1 : (PHASE_RANK.get(lastAdmittedEventType) ?? -1);
  const nextExpectedEventType = ASSEMBLED_EXAM_PHASE_TRANSITION_TYPES[lastRank + 1] ?? null;
  const noteSubmitted = admittedEventTypes.includes("note.submitted");
  const lastEvent = events[events.length - 1];
  return {
    lastAdmittedEventType,
    nextExpectedEventType,
    admittedEventTypes,
    durableEventRefs: events.map((event) => event.durableEventRef),
    noteSubmitted,
    phase: lastEvent?.phase ?? "not_started",
  };
}

function refuseSkip(bound: BoundStation[], eventsByRun: Map<string, AssembledExamAdmittedPhaseEvent[]>): void {
  for (let index = 1; index < bound.length; index += 1) {
    const previous = bound[index - 1];
    const current = bound[index];
    if (!previous || !current) {
      continue;
    }
    const previousComplete = (eventsByRun.get(previous.stationRunId) ?? []).some(
      (event) => event.eventType === "station.advanced",
    );
    const currentEvents = eventsByRun.get(current.stationRunId) ?? [];
    if (currentEvents.length > 0 && !previousComplete) {
      throw new Error(
        `skipped station identity: stationOrder ${current.stationOrder} has events before stationOrder ${previous.stationOrder} advanced`,
      );
    }
  }
}

/**
 * Select the current or next station from durable admitted progress and reconstruct
 * its canonical lifecycle. Advance is legal only after note.submitted is admitted.
 */
export function resumeAssembledExam(input: ResumeAssembledExamInput): AssembledExamResumeDecision {
  const { form, timingPlan, projection } = input;
  requireField(form.examFormId, "examFormId");
  requireField(form.blueprintId, "blueprintId");
  requireField(projection.examRunId, "examRunId");
  if (projection.formIdentity.examRunId !== projection.examRunId) {
    throw new Error("assembled exam orchestrator examRunId does not match projection form identity");
  }
  if (projection.formIdentity.examFormId !== form.examFormId || projection.formIdentity.blueprintId !== form.blueprintId) {
    throw new Error(
      `out-of-form station identity: projection form ${projection.formIdentity.examFormId}/${projection.formIdentity.blueprintId}`,
    );
  }
  if (timingPlan.blueprintId !== form.blueprintId) {
    throw new Error(`out-of-form station identity: timing plan blueprint ${timingPlan.blueprintId}`);
  }

  const bound = bindStations(form, timingPlan, projection);
  const knownRuns = new Set(bound.map((station) => station.stationRunId));
  for (const event of projection.admittedPhaseEvents) {
    if (!knownRuns.has(event.stationRunId)) {
      throw new Error(`out-of-form station identity: event stationRunId ${event.stationRunId}`);
    }
  }

  const eventsByRun = new Map<string, AssembledExamAdmittedPhaseEvent[]>();
  for (const station of bound) {
    eventsByRun.set(station.stationRunId, eventsForStation(projection, station));
  }
  refuseSkip(bound, eventsByRun);

  const current = bound.find((station) =>
    !(eventsByRun.get(station.stationRunId) ?? []).some((event) => event.eventType === "station.advanced"),
  );

  const durableEventRefs = bound.flatMap((station) =>
    (eventsByRun.get(station.stationRunId) ?? []).map((event) => event.durableEventRef),
  );
  const omissions = [...projection.omissions];
  const base = {
    examRunId: projection.examRunId,
    examFormId: form.examFormId,
    blueprintId: form.blueprintId,
    durableEventRefs,
    omissions,
    claimBoundary: assembledExamOrchestratorClaimBoundary,
    notEvidenceFor: assembledExamOrchestratorNotEvidenceFor,
    examEquivalenceGate: false as const,
  };

  if (!current) {
    if (input.requestedStation) {
      throw new Error(
        `skipped station identity: requested stationOrder ${input.requestedStation.stationOrder} after exam complete`,
      );
    }
    return { ...base, action: "exam_complete", selectedStation: null };
  }

  const events = eventsByRun.get(current.stationRunId) ?? [];
  const lifecycle = lifecycleFrom(events);
  if (input.requestedStation) {
    const requested = input.requestedStation;
    const runMismatch = requested.stationRunId !== undefined && requested.stationRunId !== current.stationRunId;
    if (requested.stationOrder !== current.stationOrder || requested.scenarioId !== current.scenarioId || runMismatch) {
      throw new Error(
        `skipped station identity: requested ${requested.stationOrder}:${requested.scenarioId} is not current ${current.stationOrder}:${current.scenarioId}`,
      );
    }
  }

  const action: AssembledExamResumeAction = lifecycle.noteSubmitted ? "advance_station" : "resume_station";
  if (action === "advance_station" && lifecycle.lastAdmittedEventType !== "note.submitted") {
    throw new Error("assembled exam orchestrator advances only after admitted note.submitted");
  }

  return {
    ...base,
    action,
    selectedStation: {
      stationOrder: current.stationOrder,
      scenarioId: current.scenarioId,
      stationRunId: current.stationRunId,
      slotId: current.slotId,
      assembledStation: current.assembledStation,
      lifecycle,
    },
  };
}
