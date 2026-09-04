import type { Hono } from "hono";
import { resolveSessionLearnerId } from "@openclinxr/auth";
import type { ExamForm, ExamTimingPlan } from "@openclinxr/exam-assembly";
import {
  ASSEMBLED_EXAM_PHASE_BY_TYPE,
  ASSEMBLED_EXAM_PHASE_TRANSITION_TYPES,
  type AssembledExamPhaseTransitionType,
} from "@openclinxr/review-workflow";
import {
  resumeAssembledExam,
  type AssembledExamAdmittedPhaseEvent,
  type AssembledExamLedgerResumeProjection,
  type AssembledExamResumeDecision,
} from "@openclinxr/scenario-runtime";
import type { ApiAppContext } from "../api-app-context.js";
import { denyIfCannotReadStationRun, isExamForm } from "../api-route-support.js";
import { isRecord } from "../api-support.js";
import type { ApiAppVariables } from "../api-types.js";
import {
  assembledExamRunClaimBoundary,
  assembledExamRunNotEvidenceFor,
  createScenarioRuntimeDurableStoreFromApiPersistence,
  type ApiAssembledExamAdmittedPhaseEvent,
  type ApiAssembledExamRunRecord,
  type ApiAssembledExamStationBinding,
  type ApiRuntimeDurableStore,
} from "../runtime-durable-store.js";

export const ASSEMBLED_EXAM_RUNS_PATH = "/exam-runs";
export const ASSEMBLED_EXAM_RUN_PATH = "/exam-runs/:examRunId";
export const ASSEMBLED_EXAM_RUN_PHASE_EVENTS_PATH = "/exam-runs/:examRunId/phase-events";

const PHASE_RANK = new Map<string, number>(
  ASSEMBLED_EXAM_PHASE_TRANSITION_TYPES.map((eventType, index) => [eventType, index]),
);

export class AssembledExamRunDurableSaveError extends Error {
  readonly code = "durable_save_failed" as const;

  constructor(cause?: unknown) {
    super(cause instanceof Error ? cause.message : "durable_save_failed");
    this.name = "AssembledExamRunDurableSaveError";
  }
}

export function registerAssembledExamRunRoutes(
  app: Hono<{ Variables: ApiAppVariables }>,
  ctx: ApiAppContext,
): void {
  const { persistence, sessionOwners, examRunOwners, assembledExamRuns } = ctx;
  const durable = createScenarioRuntimeDurableStoreFromApiPersistence(persistence);

  app.post(ASSEMBLED_EXAM_RUNS_PATH, async (context) => {
    const body = (await context.req.json().catch(() => ({}))) as {
      learnerId?: unknown;
      consentAccepted?: unknown;
      examRunId?: unknown;
      examForm?: unknown;
      timingPlan?: unknown;
    };
    if (body.consentAccepted !== true) {
      return context.json({ error: "consent_required" }, 400);
    }
    const identity = context.get("identity");
    const learnerId = resolveSessionLearnerId(identity, typeof body.learnerId === "string" ? body.learnerId : undefined);
    if (learnerId.trim().length === 0) {
      return context.json({ error: "learner_id_required" }, 400);
    }
    const form = parseApprovedForm(body.examForm);
    if (!form) {
      return context.json({ error: "invalid_exam_form", reason: "approved_immutable_form_required" }, 400);
    }
    const timingPlan = parseTimingPlan(body.timingPlan, form);
    if (!timingPlan) {
      return context.json({ error: "invalid_timing_plan", reason: "form_timing_mismatch" }, 400);
    }
    const requestedExamRunId = typeof body.examRunId === "string" ? body.examRunId.trim() : "";
    const examRunId = requestedExamRunId.length > 0
      ? requestedExamRunId
      : `exam_run_${learnerId}_${form.examFormId}`;
    const stations = bindStations(examRunId, form, timingPlan);
    if (!stations) {
      return context.json({ error: "invalid_timing_plan", reason: "missing_station_window" }, 400);
    }

    const existing = await loadAssembledExamRun(durable, assembledExamRuns, examRunOwners, sessionOwners, examRunId);
    if (existing) {
      const mismatch = startIdentityMismatch(existing, { examRunId, learnerId, form, stations });
      if (mismatch) {
        return staleIdentity(context, mismatch);
      }
      return context.json(toContract(decide(existing)), existing.admittedPhaseEvents.length === 0 ? 201 : 200);
    }

    const record: ApiAssembledExamRunRecord = {
      examRunId,
      learnerId,
      examFormId: form.examFormId,
      blueprintId: form.blueprintId,
      form,
      timingPlan,
      orderedStations: stations,
      admittedPhaseEvents: [],
      claimBoundary: assembledExamRunClaimBoundary,
      notEvidenceFor: assembledExamRunNotEvidenceFor,
      examEquivalenceGate: false,
    };
    try {
      await persistAssembledExamRun(durable, assembledExamRuns, examRunOwners, sessionOwners, record);
      return context.json(toContract(decide(record)), 201);
    } catch (error) {
      return assembledExamRunError(context, error);
    }
  });

  app.get(ASSEMBLED_EXAM_RUN_PATH, async (context) => {
    const examRunId = context.req.param("examRunId")?.trim() ?? "";
    if (examRunId.length === 0) {
      return context.json({ error: "invalid_exam_run", reason: "examRunId_required" }, 400);
    }
    const record = await loadAssembledExamRun(durable, assembledExamRuns, examRunOwners, sessionOwners, examRunId);
    if (!record) {
      return context.json({ error: "assembled_exam_run_not_found" }, 404);
    }
    const identity = context.get("identity");
    const ownershipDenied = denyIfCannotReadStationRun(identity, examRunOwners, examRunId);
    if (ownershipDenied) {
      return context.json(ownershipDenied.body, ownershipDenied.status);
    }
    try {
      return context.json(toContract(decide(record)));
    } catch (error) {
      return assembledExamRunError(context, error);
    }
  });

  app.post(ASSEMBLED_EXAM_RUN_PHASE_EVENTS_PATH, async (context) => {
    const examRunId = context.req.param("examRunId")?.trim() ?? "";
    if (examRunId.length === 0) {
      return context.json({ error: "invalid_exam_run", reason: "examRunId_required" }, 400);
    }
    const body = (await context.req.json().catch(() => ({}))) as {
      examRunId?: unknown;
      learnerId?: unknown;
      stationRunId?: unknown;
      scenarioId?: unknown;
      eventType?: unknown;
      sequence?: unknown;
      stationOrder?: unknown;
      atSecond?: unknown;
      formAtSecond?: unknown;
      durableEventRef?: unknown;
      advanceReason?: unknown;
      source?: unknown;
    };
    const bodyExamRunId = typeof body.examRunId === "string" ? body.examRunId.trim() : "";
    if (bodyExamRunId.length > 0 && bodyExamRunId !== examRunId) {
      return staleIdentity(context, "exam_run_mismatch");
    }
    const record = await loadAssembledExamRun(durable, assembledExamRuns, examRunOwners, sessionOwners, examRunId);
    if (!record) {
      return context.json({ error: "assembled_exam_run_not_found" }, 404);
    }
    const identity = context.get("identity");
    const ownershipDenied = denyIfCannotReadStationRun(identity, examRunOwners, examRunId);
    if (ownershipDenied) {
      return context.json(ownershipDenied.body, ownershipDenied.status);
    }
    const learnerId = resolveSessionLearnerId(
      identity,
      typeof body.learnerId === "string" ? body.learnerId : undefined,
    );
    if (learnerId !== record.learnerId) {
      return staleIdentity(context, "learner_mismatch");
    }
    const admitted = parsePhaseAdmission(body, examRunId);
    if (!admitted.ok) {
      return context.json({ error: "invalid_phase_event", reason: admitted.reason }, 400);
    }
    try {
      const next = admitPhaseEvent(record, admitted.event);
      await persistAssembledExamRun(durable, assembledExamRuns, examRunOwners, sessionOwners, next);
      return context.json(toContract(decide(next)), 201);
    } catch (error) {
      return assembledExamRunError(context, error);
    }
  });
}

function decide(record: ApiAssembledExamRunRecord): AssembledExamResumeDecision {
  return resumeAssembledExam({
    form: record.form,
    timingPlan: record.timingPlan,
    projection: toProjection(record),
  });
}

function toProjection(record: ApiAssembledExamRunRecord): AssembledExamLedgerResumeProjection {
  return {
    examRunId: record.examRunId,
    formIdentity: {
      examRunId: record.examRunId,
      examFormId: record.examFormId,
      blueprintId: record.blueprintId,
    },
    orderedStations: record.orderedStations,
    admittedPhaseEvents: record.admittedPhaseEvents.map(toOrchestratorEvent),
    omissions: [],
  };
}

function toOrchestratorEvent(event: ApiAssembledExamAdmittedPhaseEvent): AssembledExamAdmittedPhaseEvent {
  return {
    examRunId: event.examRunId,
    stationRunId: event.stationRunId,
    sequence: event.sequence,
    eventType: event.eventType,
    atSecond: event.atSecond,
    formAtSecond: event.formAtSecond,
    scenarioId: event.scenarioId,
    stationOrder: event.stationOrder,
    durableEventRef: event.durableEventRef,
    phase: event.phase,
    ...(event.advanceReason ? { advanceReason: event.advanceReason } : {}),
  };
}

function toContract(decision: AssembledExamResumeDecision) {
  return {
    examRunId: decision.examRunId,
    stationRunId: decision.selectedStation?.stationRunId ?? null,
    examFormId: decision.examFormId,
    blueprintId: decision.blueprintId,
    action: decision.action,
    currentStation: decision.selectedStation,
    durableEventRefs: decision.durableEventRefs,
    omissions: decision.omissions,
    claimBoundary: decision.claimBoundary,
    notEvidenceFor: decision.notEvidenceFor,
    examEquivalenceGate: false as const,
  };
}

function bindStations(
  examRunId: string,
  form: ExamForm,
  timingPlan: ExamTimingPlan,
): ApiAssembledExamStationBinding[] | undefined {
  const refs = [...form.stationRefs].sort((left, right) => left.order - right.order);
  const stations: ApiAssembledExamStationBinding[] = [];
  for (const ref of refs) {
    const window = timingPlan.stationWindows.find((entry) => entry.stationOrder === ref.order);
    if (!window) {
      return undefined;
    }
    stations.push({
      stationOrder: ref.order,
      slotId: window.slotId,
      stationRunId: `${examRunId}:station:${ref.order}`,
      scenarioId: ref.scenarioId,
      scenarioVersion: ref.scenarioVersion,
    });
  }
  return stations;
}

function parseApprovedForm(value: unknown): ExamForm | undefined {
  if (!isExamForm(value) || typeof value.blueprintId !== "string" || value.blueprintId.trim().length === 0) {
    return undefined;
  }
  if (value.status !== "ready_for_review" || value.coverage?.stationCount?.ok !== true) {
    return undefined;
  }
  if (!Array.isArray(value.assemblyIssues) || value.assemblyIssues.length > 0) {
    return undefined;
  }
  if (value.stationRefs.length === 0) {
    return undefined;
  }
  return value;
}

function parseTimingPlan(value: unknown, form: ExamForm): ExamTimingPlan | undefined {
  if (!isRecord(value) || value["blueprintId"] !== form.blueprintId || !Array.isArray(value["stationWindows"])) {
    return undefined;
  }
  const windows = value["stationWindows"].filter(isStationWindow);
  if (windows.length !== form.stationRefs.length) {
    return undefined;
  }
  for (const ref of form.stationRefs) {
    if (!windows.some((window) => window.stationOrder === ref.order)) {
      return undefined;
    }
  }
  return value as ExamTimingPlan;
}

function isStationWindow(value: unknown): value is ExamTimingPlan["stationWindows"][number] {
  if (!isRecord(value) || typeof value["slotId"] !== "string" || !Number.isInteger(value["stationOrder"])) {
    return false;
  }
  return isWindow(value["doorway"]) && isWindow(value["encounter"]) && isWindow(value["note"]);
}

function isWindow(value: unknown): boolean {
  if (!isRecord(value)) {
    return false;
  }
  return Number.isInteger(value["startsAtSecond"])
    && Number.isInteger(value["endsAtSecond"])
    && (value["startsAtSecond"] as number) >= 0
    && (value["endsAtSecond"] as number) >= (value["startsAtSecond"] as number);
}

function isCanonicalType(value: string): value is AssembledExamPhaseTransitionType {
  return (ASSEMBLED_EXAM_PHASE_TRANSITION_TYPES as readonly string[]).includes(value);
}

function expectedDurableRef(stationRunId: string, sequence: number): string {
  return `durable://station-runs/${stationRunId}/events/${sequence}`;
}

function phaseEventFingerprint(event: ApiAssembledExamAdmittedPhaseEvent): string {
  return [
    event.examRunId,
    event.stationRunId,
    String(event.sequence),
    event.eventType,
    event.phase,
    event.scenarioId,
    String(event.stationOrder),
    String(event.atSecond),
    String(event.formAtSecond),
    event.source,
    event.durableEventRef,
    event.advanceReason ?? "",
  ].join("\0");
}

type PhaseEventBody = {
  stationRunId?: unknown;
  scenarioId?: unknown;
  eventType?: unknown;
  sequence?: unknown;
  stationOrder?: unknown;
  atSecond?: unknown;
  formAtSecond?: unknown;
  durableEventRef?: unknown;
  advanceReason?: unknown;
  source?: unknown;
};

function parsePhaseAdmission(
  body: PhaseEventBody,
  examRunId: string,
): { ok: true; event: ApiAssembledExamAdmittedPhaseEvent } | { ok: false; reason: string } {
  const stationRunId = typeof body.stationRunId === "string" ? body.stationRunId.trim() : "";
  const scenarioId = typeof body.scenarioId === "string" ? body.scenarioId.trim() : "";
  const eventType = typeof body.eventType === "string" ? body.eventType.trim() : "";
  const sequence = body.sequence;
  const stationOrder = body.stationOrder;
  const atSecond = body.atSecond;
  const formAtSecond = body.formAtSecond;
  if (!stationRunId || !scenarioId || !isCanonicalType(eventType)) {
    return { ok: false, reason: "canonical_fields_required" };
  }
  if (!Number.isInteger(sequence) || (sequence as number) < 0) {
    return { ok: false, reason: "sequence_invalid" };
  }
  if (!Number.isInteger(stationOrder) || (stationOrder as number) < 1) {
    return { ok: false, reason: "station_order_invalid" };
  }
  if (!Number.isInteger(atSecond) || !Number.isInteger(formAtSecond)) {
    return { ok: false, reason: "timing_invalid" };
  }
  const expectedRef = expectedDurableRef(stationRunId, sequence as number);
  const providedRef = typeof body.durableEventRef === "string" ? body.durableEventRef.trim() : "";
  if (providedRef.length > 0 && providedRef !== expectedRef) {
    return { ok: false, reason: "durable_reference_mismatch" };
  }
  if (eventType === "station.advanced" && typeof body.advanceReason !== "string") {
    return { ok: false, reason: "advance_reason_required" };
  }
  if (eventType !== "station.advanced" && body.advanceReason !== undefined) {
    return { ok: false, reason: "illegal_advance_reason" };
  }
  return {
    ok: true,
    event: {
      examRunId,
      stationRunId,
      sequence: sequence as number,
      eventType,
      atSecond: atSecond as number,
      formAtSecond: formAtSecond as number,
      scenarioId,
      stationOrder: stationOrder as number,
      durableEventRef: expectedRef,
      phase: ASSEMBLED_EXAM_PHASE_BY_TYPE[eventType],
      source: typeof body.source === "string" && body.source.trim().length > 0 ? body.source : "system",
      ...(eventType === "station.advanced" ? { advanceReason: String(body.advanceReason).trim() } : {}),
    },
  };
}

function admitPhaseEvent(
  record: ApiAssembledExamRunRecord,
  event: ApiAssembledExamAdmittedPhaseEvent,
): ApiAssembledExamRunRecord {
  const current = decide(record).selectedStation;
  if (!current) {
    throw new AssembledExamRunIdentityError("station_order_mismatch");
  }
  if (
    event.stationOrder !== current.stationOrder
    || event.scenarioId !== current.scenarioId
    || event.stationRunId !== current.stationRunId
  ) {
    throw new AssembledExamRunIdentityError("station_order_mismatch");
  }
  const prior = record.admittedPhaseEvents
    .filter((row) => row.stationRunId === event.stationRunId)
    .sort((left, right) => left.sequence - right.sequence);
  const last = prior[prior.length - 1];
  const existing = prior.find((row) => row.sequence === event.sequence);
  if (existing) {
    if (phaseEventFingerprint(existing) === phaseEventFingerprint(event)) {
      return record;
    }
    throw new AssembledExamRunIdentityError("sequence_mismatch");
  }
  const expectedSequence = last ? last.sequence + 1 : 0;
  if (event.sequence !== expectedSequence) {
    throw new AssembledExamRunIdentityError("sequence_mismatch");
  }
  const lastRank = last ? (PHASE_RANK.get(last.eventType) ?? -1) : -1;
  const newRank = PHASE_RANK.get(event.eventType) ?? -1;
  if (newRank !== lastRank + 1) {
    throw new AssembledExamRunIdentityError("sequence_mismatch");
  }
  if (last && (event.atSecond < last.atSecond || event.formAtSecond < last.formAtSecond)) {
    throw new AssembledExamRunIdentityError("sequence_mismatch");
  }
  return {
    ...record,
    admittedPhaseEvents: [...record.admittedPhaseEvents, event],
  };
}

class AssembledExamRunIdentityError extends Error {
  readonly reason: StaleIdentityReason;
  constructor(reason: StaleIdentityReason) {
    super(reason);
    this.name = "AssembledExamRunIdentityError";
    this.reason = reason;
  }
}

type StaleIdentityReason =
  | "exam_run_mismatch"
  | "learner_mismatch"
  | "form_mismatch"
  | "station_order_mismatch"
  | "sequence_mismatch"
  | "durable_reference_mismatch";

function startIdentityMismatch(
  existing: ApiAssembledExamRunRecord,
  input: {
    examRunId: string;
    learnerId: string;
    form: ExamForm;
    stations: ApiAssembledExamStationBinding[];
  },
): StaleIdentityReason | undefined {
  if (existing.examRunId !== input.examRunId) {
    return "exam_run_mismatch";
  }
  if (existing.learnerId !== input.learnerId) {
    return "learner_mismatch";
  }
  if (existing.examFormId !== input.form.examFormId || existing.blueprintId !== input.form.blueprintId) {
    return "form_mismatch";
  }
  const existingKey = existing.orderedStations
    .map((station) => `${station.stationOrder}:${station.scenarioId}:${station.stationRunId}`)
    .join("|");
  const nextKey = input.stations
    .map((station) => `${station.stationOrder}:${station.scenarioId}:${station.stationRunId}`)
    .join("|");
  if (existingKey !== nextKey) {
    return "form_mismatch";
  }
  return undefined;
}

async function persistAssembledExamRun(
  durable: ApiRuntimeDurableStore,
  memory: Map<string, ApiAssembledExamRunRecord>,
  examRunOwners: Map<string, string>,
  sessionOwners: Map<string, string>,
  record: ApiAssembledExamRunRecord,
): Promise<void> {
  try {
    await durable.saveAssembledExamRun(record.examRunId, record);
  } catch (error) {
    throw new AssembledExamRunDurableSaveError(error);
  }
  memory.set(record.examRunId, record);
  bindOwners(examRunOwners, sessionOwners, record);
}

async function loadAssembledExamRun(
  durable: ApiRuntimeDurableStore,
  memory: Map<string, ApiAssembledExamRunRecord>,
  examRunOwners: Map<string, string>,
  sessionOwners: Map<string, string>,
  examRunId: string,
): Promise<ApiAssembledExamRunRecord | undefined> {
  const fromSink = await durable.getAssembledExamRun(examRunId);
  if (fromSink) {
    memory.set(examRunId, fromSink);
    bindOwners(examRunOwners, sessionOwners, fromSink);
    return fromSink;
  }
  const fromMemory = memory.get(examRunId);
  if (fromMemory) {
    bindOwners(examRunOwners, sessionOwners, fromMemory);
  }
  return fromMemory;
}

function bindOwners(
  examRunOwners: Map<string, string>,
  sessionOwners: Map<string, string>,
  record: ApiAssembledExamRunRecord,
): void {
  examRunOwners.set(record.examRunId, record.learnerId);
  for (const station of record.orderedStations) {
    sessionOwners.set(station.stationRunId, record.learnerId);
  }
}

function staleIdentity(
  context: { json: (body: unknown, status?: 409) => Response },
  reason: StaleIdentityReason,
): Response {
  return context.json({
    error: "stale_identity",
    reason,
    examEquivalenceGate: false,
    notEvidenceFor: [...assembledExamRunNotEvidenceFor],
  }, 409);
}

function assembledExamRunError(
  context: { json: (body: unknown, status?: 409 | 503) => Response },
  error: unknown,
): Response {
  if (error instanceof AssembledExamRunDurableSaveError) {
    return context.json({
      error: "durable_save_failed",
      examEquivalenceGate: false,
      notEvidenceFor: [...assembledExamRunNotEvidenceFor],
    }, 503);
  }
  if (error instanceof AssembledExamRunIdentityError) {
    return staleIdentity(context, error.reason);
  }
  const message = error instanceof Error ? error.message : "assembled_exam_run_failed";
  if (message.includes("out-of-form") || message.includes("skipped station") || message.includes("duplicated")) {
    return staleIdentity(context, "form_mismatch");
  }
  return context.json({
    error: "assembled_exam_run_failed",
    reason: message,
    examEquivalenceGate: false,
    notEvidenceFor: [...assembledExamRunNotEvidenceFor],
  }, 409);
}
