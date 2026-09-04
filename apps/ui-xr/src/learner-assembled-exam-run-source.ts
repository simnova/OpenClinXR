import { LEARNER_CANONICAL_PHASE_TYPES } from "./runtime-state.js";

type TextSink = { textContent: string | null };
type FormWindow = { startsAtSecond: number; endsAtSecond: number };

export const LEARNER_ASSEMBLED_EXAM_RUN_ACTIONS = ["resume_station", "advance_station", "exam_complete"] as const;
export type LearnerAssembledExamRunAction = (typeof LEARNER_ASSEMBLED_EXAM_RUN_ACTIONS)[number];
export type LearnerAssembledExamStationBinding = {
  stationOrder: number;
  slotId: string;
  stationRunId: string;
  scenarioId: string;
  scenarioVersion: number;
};
export type LearnerAssembledExamAdmittedPhaseEvent = {
  examRunId: string;
  stationRunId: string;
  sequence: number;
  eventType: (typeof LEARNER_CANONICAL_PHASE_TYPES)[number];
  atSecond: number;
  formAtSecond: number;
  scenarioId: string;
  stationOrder: number;
  durableEventRef: string;
  phase: "encounter" | "note" | "complete";
  source: string;
  recordedAtIso: string;
  advanceReason?: string;
};
export type LearnerAssembledExamLifecycle = {
  lastAdmittedEventType: string | null;
  nextExpectedEventType: string | null;
  admittedEventTypes: string[];
  durableEventRefs: string[];
  noteSubmitted: boolean;
  phase: string;
};
export type LearnerAssembledExamCurrentStation = {
  stationOrder: number;
  scenarioId: string;
  stationRunId: string;
  slotId: string;
  assembledStation: {
    examRunId: string;
    scenarioId: string;
    stationOrder: number;
    formTiming: { doorway?: FormWindow; encounter: FormWindow; note: FormWindow };
  };
  lifecycle: LearnerAssembledExamLifecycle;
};
export type LearnerAssembledExamRunAggregate = {
  examRunId: string;
  stationRunId: string | null;
  examFormId: string;
  blueprintId: string;
  action: LearnerAssembledExamRunAction;
  currentStation: LearnerAssembledExamCurrentStation | null;
  orderedStations: LearnerAssembledExamStationBinding[];
  admittedPhaseEvents: LearnerAssembledExamAdmittedPhaseEvent[];
  durableEventRefs: string[];
  omissions: unknown[];
  claimBoundary: string;
  notEvidenceFor: string[];
  examEquivalenceGate: false;
};

export class BlockedLearnerExamResumeError extends Error {
  readonly reason: string;

  constructor(reason: string) {
    super(`blocked_resume: ${reason}`);
    this.name = "BlockedLearnerExamResumeError";
    this.reason = reason;
  }
}

export function applyLearnerExamResumeBlockedPresentation(input: {
  reason: string;
  sink: TextSink;
}): void {
  const reason = input.reason.trim().length > 0 ? input.reason.trim() : "durable_identity_mismatch";
  input.sink.textContent = `Exam resume blocked: ${reason.replaceAll("_", " ")}`;
}

/** Only an explicit 404 permits fresh creation; every other GET failure blocks resume. */
export async function fetchLearnerAssembledExamRunAggregate(input: {
  baseUrl: string;
  examRunId: string;
  fetch?: typeof fetch;
}): Promise<{ found: false } | { found: true; aggregate: LearnerAssembledExamRunAggregate }> {
  const examRunId = input.examRunId.trim();
  if (examRunId.length === 0) throw new BlockedLearnerExamResumeError("exam_run_id_missing");
  const url = `${input.baseUrl.replace(/\/$/, "")}/exam-runs/${encodeURIComponent(examRunId)}`;
  let response: Response;
  try {
    response = await (input.fetch ?? globalThis.fetch)(url, { method: "GET" });
  } catch {
    throw new BlockedLearnerExamResumeError("exam_run_unreachable");
  }
  if (response.status === 404) return { found: false };
  if (response.status === 409) {
    const body = await readJsonBody(response);
    const reason = isRecord(body) && typeof body.reason === "string" && body.reason.length > 0
      ? body.reason
      : "stale_identity";
    throw new BlockedLearnerExamResumeError(reason);
  }
  if (!response.ok) throw new BlockedLearnerExamResumeError(`exam_run_get_failed_${response.status}`);
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    throw new BlockedLearnerExamResumeError("exam_run_payload_malformed");
  }
  return { found: true, aggregate: parseLearnerAssembledExamRunAggregate(body, examRunId) };
}

export function parseLearnerAssembledExamRunAggregate(
  body: unknown,
  expectedExamRunId: string,
): LearnerAssembledExamRunAggregate {
  if (!isRecord(body)) throw new BlockedLearnerExamResumeError("exam_run_payload_malformed");
  if (body.examEquivalenceGate !== false) throw new BlockedLearnerExamResumeError("exam_equivalence_gate");
  const examRunId = requiredString(body.examRunId, "examRunId");
  if (examRunId !== expectedExamRunId) throw new BlockedLearnerExamResumeError("exam_run_mismatch");
  const action = body.action;
  if (typeof action !== "string" || !(LEARNER_ASSEMBLED_EXAM_RUN_ACTIONS as readonly string[]).includes(action)) {
    throw new BlockedLearnerExamResumeError("exam_run_payload_malformed");
  }
  const stationRunId = body.stationRunId === null || body.stationRunId === undefined
    ? null
    : requiredString(body.stationRunId, "stationRunId");
  const currentStation = parseCurrentStation(body.currentStation, examRunId);
  if (action !== "exam_complete" && currentStation === null) {
    throw new BlockedLearnerExamResumeError("current_station_missing");
  }
  if ((currentStation && currentStation.stationRunId !== stationRunId) || (!currentStation && stationRunId !== null)) {
    throw new BlockedLearnerExamResumeError("station_run_mismatch");
  }
  const orderedStations = parseOrderedStations(body.orderedStations);
  const admittedPhaseEvents = parseAdmittedPhaseEvents(body.admittedPhaseEvents, examRunId, orderedStations);
  validateAggregateProgress(action as LearnerAssembledExamRunAction, currentStation, orderedStations, admittedPhaseEvents);
  const durableEventRefs = requiredStringArray(body.durableEventRefs, "durableEventRefs");
  if (durableEventRefs.join("\0") !== admittedPhaseEvents.map((event) => event.durableEventRef).join("\0")) {
    throw new BlockedLearnerExamResumeError("durable_reference_mismatch");
  }
  const notEvidenceFor = requiredStringArray(body.notEvidenceFor, "notEvidenceFor");
  if (!notEvidenceFor.includes("exam_equivalence")) {
    throw new BlockedLearnerExamResumeError("exam_equivalence_claim_boundary");
  }
  return {
    examRunId,
    stationRunId,
    examFormId: requiredString(body.examFormId, "examFormId"),
    blueprintId: requiredString(body.blueprintId, "blueprintId"),
    action: action as LearnerAssembledExamRunAction,
    currentStation,
    orderedStations,
    admittedPhaseEvents,
    durableEventRefs,
    omissions: Array.isArray(body.omissions) ? body.omissions : [],
    claimBoundary: requiredString(body.claimBoundary, "claimBoundary"),
    notEvidenceFor,
    examEquivalenceGate: false,
  };
}

const PHASE_BY_EVENT_TYPE: Record<
  LearnerAssembledExamAdmittedPhaseEvent["eventType"],
  LearnerAssembledExamAdmittedPhaseEvent["phase"]
> = {
  "encounter.started": "encounter",
  "encounter.ended": "encounter",
  "note.started": "note",
  "note.submitted": "note",
  "station.advanced": "complete",
};

function parseOrderedStations(value: unknown): LearnerAssembledExamStationBinding[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new BlockedLearnerExamResumeError("ordered_stations_missing");
  }
  const stations = value.map((item) => {
    if (!isRecord(item)) throw new BlockedLearnerExamResumeError("ordered_station_malformed");
    return {
      stationOrder: requiredPositiveInt(item.stationOrder, "orderedStation.stationOrder"),
      slotId: requiredString(item.slotId, "orderedStation.slotId"),
      stationRunId: requiredString(item.stationRunId, "orderedStation.stationRunId"),
      scenarioId: requiredString(item.scenarioId, "orderedStation.scenarioId"),
      scenarioVersion: requiredPositiveInt(item.scenarioVersion, "orderedStation.scenarioVersion"),
    };
  });
  const seenOrders = new Set<number>();
  const seenRuns = new Set<string>();
  for (let index = 0; index < stations.length; index += 1) {
    const station = stations[index];
    const previous = stations[index - 1];
    if (!station || seenOrders.has(station.stationOrder) || seenRuns.has(station.stationRunId)
      || (previous && station.stationOrder <= previous.stationOrder)) {
      throw new BlockedLearnerExamResumeError("ordered_station_identity_mismatch");
    }
    seenOrders.add(station.stationOrder);
    seenRuns.add(station.stationRunId);
  }
  return stations;
}

function parseAdmittedPhaseEvents(
  value: unknown,
  examRunId: string,
  stations: readonly LearnerAssembledExamStationBinding[],
): LearnerAssembledExamAdmittedPhaseEvent[] {
  if (!Array.isArray(value)) throw new BlockedLearnerExamResumeError("admitted_phase_events_missing");
  const stationByRun = new Map(stations.map((station) => [station.stationRunId, station]));
  const previousByRun = new Map<string, LearnerAssembledExamAdmittedPhaseEvent>();
  let previousStationOrder = -1;
  const events: LearnerAssembledExamAdmittedPhaseEvent[] = [];
  for (const item of value) {
    if (!isRecord(item)) throw new BlockedLearnerExamResumeError("admitted_phase_event_malformed");
    const eventType = requiredString(item.eventType, "admittedPhaseEvent.eventType");
    if (!(LEARNER_CANONICAL_PHASE_TYPES as readonly string[]).includes(eventType)) {
      throw new BlockedLearnerExamResumeError("admitted_phase_event_type_mismatch");
    }
    const typedEventType = eventType as LearnerAssembledExamAdmittedPhaseEvent["eventType"];
    const stationRunId = requiredString(item.stationRunId, "admittedPhaseEvent.stationRunId");
    const stationOrder = requiredPositiveInt(item.stationOrder, "admittedPhaseEvent.stationOrder");
    const scenarioId = requiredString(item.scenarioId, "admittedPhaseEvent.scenarioId");
    const station = stationByRun.get(stationRunId);
    if (!station || station.stationOrder !== stationOrder || station.scenarioId !== scenarioId) {
      throw new BlockedLearnerExamResumeError("admitted_phase_event_identity_mismatch");
    }
    const sequence = requiredNonnegativeInt(item.sequence, "admittedPhaseEvent.sequence");
    const atSecond = requiredNonnegativeInt(item.atSecond, "admittedPhaseEvent.atSecond");
    const formAtSecond = requiredNonnegativeInt(item.formAtSecond, "admittedPhaseEvent.formAtSecond");
    const durableEventRef = requiredString(item.durableEventRef, "admittedPhaseEvent.durableEventRef");
    if (durableEventRef !== `durable://station-runs/${stationRunId}/events/${sequence}`) {
      throw new BlockedLearnerExamResumeError("durable_reference_mismatch");
    }
    const phase = requiredString(item.phase, "admittedPhaseEvent.phase");
    if (phase !== PHASE_BY_EVENT_TYPE[typedEventType]) {
      throw new BlockedLearnerExamResumeError("admitted_phase_event_phase_mismatch");
    }
    const recordedAtIso = requiredString(item.recordedAtIso, "admittedPhaseEvent.recordedAtIso");
    if (!Number.isFinite(Date.parse(recordedAtIso))) {
      throw new BlockedLearnerExamResumeError("admitted_phase_event_timestamp_malformed");
    }
    const previous = previousByRun.get(stationRunId);
    const expectedSequence = previous ? previous.sequence + 1 : 0;
    if (sequence !== expectedSequence || typedEventType !== LEARNER_CANONICAL_PHASE_TYPES[expectedSequence]
      || stationOrder < previousStationOrder || (previous && (atSecond < previous.atSecond
        || formAtSecond < previous.formAtSecond || Date.parse(recordedAtIso) < Date.parse(previous.recordedAtIso)))) {
      throw new BlockedLearnerExamResumeError("sequence_mismatch");
    }
    const advanceReason = item.advanceReason;
    if ((typedEventType === "station.advanced" && (typeof advanceReason !== "string" || !advanceReason.trim()))
      || (typedEventType !== "station.advanced" && advanceReason !== undefined)) {
      throw new BlockedLearnerExamResumeError("advance_reason_mismatch");
    }
    const event: LearnerAssembledExamAdmittedPhaseEvent = {
      examRunId: requiredString(item.examRunId, "admittedPhaseEvent.examRunId"),
      stationRunId,
      sequence,
      eventType: typedEventType,
      atSecond,
      formAtSecond,
      scenarioId,
      stationOrder,
      durableEventRef,
      phase: phase as LearnerAssembledExamAdmittedPhaseEvent["phase"],
      source: requiredString(item.source, "admittedPhaseEvent.source"),
      recordedAtIso,
      ...(typeof advanceReason === "string" ? { advanceReason: advanceReason.trim() } : {}),
    };
    if (event.examRunId !== examRunId) throw new BlockedLearnerExamResumeError("exam_run_mismatch");
    events.push(event);
    previousByRun.set(stationRunId, event);
    previousStationOrder = stationOrder;
  }
  return events;
}

function validateAggregateProgress(
  action: LearnerAssembledExamRunAction,
  current: LearnerAssembledExamCurrentStation | null,
  stations: readonly LearnerAssembledExamStationBinding[],
  events: readonly LearnerAssembledExamAdmittedPhaseEvent[],
): void {
  const eventsByRun = new Map(stations.map((station) => [
    station.stationRunId,
    events.filter((event) => event.stationRunId === station.stationRunId),
  ]));
  if (action === "exam_complete") {
    if (current || stations.some((station) => eventsByRun.get(station.stationRunId)?.at(-1)?.eventType !== "station.advanced")) {
      throw new BlockedLearnerExamResumeError("exam_complete_progress_mismatch");
    }
    return;
  }
  if (!current) throw new BlockedLearnerExamResumeError("current_station_missing");
  const currentIndex = stations.findIndex((station) => station.stationOrder === current.stationOrder
    && station.scenarioId === current.scenarioId && station.stationRunId === current.stationRunId
    && station.slotId === current.slotId);
  if (currentIndex < 0 || current.assembledStation.scenarioId !== current.scenarioId
    || current.assembledStation.stationOrder !== current.stationOrder) {
    throw new BlockedLearnerExamResumeError("current_station_identity_mismatch");
  }
  for (let index = 0; index < stations.length; index += 1) {
    const station = stations[index];
    const stationEvents = station ? eventsByRun.get(station.stationRunId) ?? [] : [];
    if ((index < currentIndex && stationEvents.at(-1)?.eventType !== "station.advanced")
      || (index > currentIndex && stationEvents.length > 0)) {
      throw new BlockedLearnerExamResumeError("station_sequence_mismatch");
    }
  }
  const currentEvents = eventsByRun.get(current.stationRunId) ?? [];
  const last = currentEvents.at(-1);
  const nextExpected = LEARNER_CANONICAL_PHASE_TYPES[(last?.sequence ?? -1) + 1] ?? null;
  if (last?.eventType === "station.advanced" || current.lifecycle.lastAdmittedEventType !== (last?.eventType ?? null)
    || current.lifecycle.nextExpectedEventType !== nextExpected || current.lifecycle.phase !== (last?.phase ?? "not_started")
    || current.lifecycle.noteSubmitted !== currentEvents.some((event) => event.eventType === "note.submitted")
    || current.lifecycle.admittedEventTypes.join("\0") !== currentEvents.map((event) => event.eventType).join("\0")
    || current.lifecycle.durableEventRefs.join("\0") !== currentEvents.map((event) => event.durableEventRef).join("\0")
    || (action === "advance_station") !== (last?.eventType === "note.submitted")) {
    throw new BlockedLearnerExamResumeError("sequence_mismatch");
  }
}

function parseCurrentStation(value: unknown, examRunId: string): LearnerAssembledExamCurrentStation | null {
  if (value === null || value === undefined) return null;
  if (!isRecord(value)) throw new BlockedLearnerExamResumeError("current_station_malformed");
  const lifecycle = value.lifecycle;
  if (!isRecord(lifecycle)) throw new BlockedLearnerExamResumeError("lifecycle_missing");
  const assembledStation = parseAssembledStation(value.assembledStation, examRunId);
  return {
    stationOrder: requiredPositiveInt(value.stationOrder, "stationOrder"),
    scenarioId: requiredString(value.scenarioId, "scenarioId"),
    stationRunId: requiredString(value.stationRunId, "stationRunId"),
    slotId: requiredString(value.slotId, "slotId"),
    assembledStation,
    lifecycle: {
      lastAdmittedEventType: typeof lifecycle.lastAdmittedEventType === "string" ? lifecycle.lastAdmittedEventType : null,
      nextExpectedEventType: typeof lifecycle.nextExpectedEventType === "string" ? lifecycle.nextExpectedEventType : null,
      admittedEventTypes: requiredStringArray(lifecycle.admittedEventTypes, "lifecycle.admittedEventTypes"),
      durableEventRefs: requiredStringArray(lifecycle.durableEventRefs, "lifecycle.durableEventRefs"),
      noteSubmitted: lifecycle.noteSubmitted === true,
      phase: requiredString(lifecycle.phase, "lifecycle.phase"),
    },
  };
}

function parseAssembledStation(
  value: unknown,
  examRunId: string,
): LearnerAssembledExamCurrentStation["assembledStation"] {
  if (!isRecord(value)) throw new BlockedLearnerExamResumeError("assembled_station_missing");
  const parsedExamRunId = requiredString(value.examRunId, "assembledStation.examRunId");
  if (parsedExamRunId !== examRunId) throw new BlockedLearnerExamResumeError("exam_run_mismatch");
  const formTiming = value.formTiming;
  if (!isRecord(formTiming) || !isRecord(formTiming.encounter) || !isRecord(formTiming.note)) {
    throw new BlockedLearnerExamResumeError("form_timing_malformed");
  }
  return {
    examRunId: parsedExamRunId,
    scenarioId: requiredString(value.scenarioId, "assembledStation.scenarioId"),
    stationOrder: requiredPositiveInt(value.stationOrder, "assembledStation.stationOrder"),
    formTiming: {
      ...(isRecord(formTiming.doorway) ? { doorway: parseWindow(formTiming.doorway, "doorway") } : {}),
      encounter: parseWindow(formTiming.encounter, "encounter"),
      note: parseWindow(formTiming.note, "note"),
    },
  };
}

function parseWindow(value: Record<string, unknown>, label: string): FormWindow {
  const start = value.startsAtSecond;
  const end = value.endsAtSecond;
  if (!Number.isInteger(start) || !Number.isInteger(end) || (start as number) < 0 || (end as number) < (start as number)) {
    throw new BlockedLearnerExamResumeError(`form_timing_malformed:${label}`);
  }
  return { startsAtSecond: start as number, endsAtSecond: end as number };
}

function requiredString(value: unknown, field: string): string {
  if (typeof value !== "string" || !value.trim()) throw new BlockedLearnerExamResumeError(`${field}_missing`);
  return value.trim();
}

function requiredPositiveInt(value: unknown, field: string): number {
  if (!Number.isInteger(value) || (value as number) < 1) throw new BlockedLearnerExamResumeError(`${field}_missing`);
  return value as number;
}

function requiredNonnegativeInt(value: unknown, field: string): number {
  if (!Number.isInteger(value) || (value as number) < 0) throw new BlockedLearnerExamResumeError(`${field}_missing`);
  return value as number;
}

function requiredStringArray(value: unknown, field: string): string[] {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string" || !item.trim())) {
    throw new BlockedLearnerExamResumeError(`${field}_malformed`);
  }
  return value.map((item) => (item as string).trim());
}

async function readJsonBody(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
