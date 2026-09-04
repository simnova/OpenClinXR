/**
 * Learner canonical phase-trace hydration from the existing station trace-events API.
 *
 * Resolves the active station identity from the assembled exam run, fetches persisted events
 * for an explicit API session id, and admits them through admitLearnerCanonicalPhaseEvent.
 * Does not invent a transition reducer.
 *
 * - no baseUrl / no API session id / transport failure → labeled local fallback; localEvents retained
 * - derived `station_run_*` identity is local-only and is never a fetch authority
 * - malformed 200 body → throw (never silently become local truth)
 * - validated persisted events only become canonical after the identity/order/time/durable-ref gate
 */

import type { ExamFormRunState } from "@openclinxr/exam-assembly";
import { validateTraceEvent, type TraceEvent } from "@openclinxr/shared-schemas";
import {
  admitLearnerCanonicalPhaseEvent,
  createLearnerCanonicalPhaseTraceStore,
  LEARNER_CANONICAL_PHASE_TYPES,
  viewLearnerCanonicalExamPhase,
  type LearnerCanonicalExamPhaseView,
  type LearnerCanonicalPhaseTraceStore,
} from "./runtime-state.js";

type TextSink = {
  textContent: string | null;
};

export type LearnerStationTraceIdentity = {
  examRunId: string;
  stationRunId: string;
  scenarioId: string;
  stationOrder: number;
};

export type HydrateLearnerCanonicalPhaseTraceInput = {
  baseUrl: string | undefined;
  examRun: ExamFormRunState;
  store: LearnerCanonicalPhaseTraceStore;
  fetch?: typeof fetch;
  /** Actual API session id from startSession. Required to fetch; derived local ids are not authority. */
  stationRunId?: string;
};

export type HydrateLearnerCanonicalPhaseTraceResult = {
  store: LearnerCanonicalPhaseTraceStore;
  view: LearnerCanonicalExamPhaseView;
  fetched: boolean;
  fallbackReason?: string;
  identity: LearnerStationTraceIdentity | null;
};

export class MalformedTraceEventsPayloadError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MalformedTraceEventsPayloadError";
  }
}

/**
 * Active station identity from the assembled exam-form run.
 * Derived stationRunId is local-store convention only; pass the API session id to fetch.
 */
export function resolveActiveLearnerStationTraceIdentity(input: {
  examRun: ExamFormRunState;
  stationRunId?: string;
}): LearnerStationTraceIdentity | null {
  const station = input.examRun.queue.stationQueue[input.examRun.currentStationIndex];
  if (!station || typeof station.scenarioId !== "string" || station.scenarioId.length === 0) {
    return null;
  }
  if (!Number.isInteger(station.stationOrder) || station.stationOrder < 1) {
    return null;
  }
  const derived = `station_run_${input.examRun.examRunId}_${station.scenarioId}_${station.stationOrder}`;
  const override = input.stationRunId?.trim();
  return {
    examRunId: input.examRun.examRunId,
    stationRunId: override && override.length > 0 ? override : derived,
    scenarioId: station.scenarioId,
    stationOrder: station.stationOrder,
  };
}

export function applyLearnerPhaseTracePresentation(input: {
  view: LearnerCanonicalExamPhaseView;
  sink: TextSink;
}): void {
  if (input.view.fallbackActive) {
    input.sink.textContent =
      input.view.fallbackLabel ?? "local-only fallback — no admitted canonical phase trace for this exam run";
    return;
  }
  const reason = input.view.lastAdvanceReason ? ` — ${input.view.lastAdvanceReason}` : "";
  input.sink.textContent = `Canonical phase ${input.view.phase}${reason}`;
}

export function applyLearnerPhaseTraceRefusePresentation(input: {
  error: unknown;
  sink: TextSink;
}): void {
  const message =
    input.error instanceof Error && input.error.message.length > 0
      ? input.error.message
      : "trace events payload refused";
  input.sink.textContent = `Phase trace bootstrap refused: ${message}`;
}

/**
 * Fetch GET /sessions/:stationRunId/trace-events and admit through the existing gate.
 * Transport absence keeps labeled local fallback. Malformed 200 throws.
 */
export async function hydrateLearnerCanonicalPhaseTraceFromApi(
  input: HydrateLearnerCanonicalPhaseTraceInput,
): Promise<HydrateLearnerCanonicalPhaseTraceResult> {
  const identity = resolveActiveLearnerStationTraceIdentity({
    examRun: input.examRun,
    ...(input.stationRunId !== undefined ? { stationRunId: input.stationRunId } : {}),
  });
  if (!identity) {
    const view = viewLearnerCanonicalExamPhase(input.store);
    return {
      store: input.store,
      view,
      fetched: false,
      fallbackReason: "active_station_identity_unresolved",
      identity: null,
    };
  }

  const aligned = alignStoreToIdentity(input.store, identity);
  if (!input.baseUrl) {
    const view = viewLearnerCanonicalExamPhase(aligned);
    return {
      store: aligned,
      view,
      fetched: false,
      ...(view.fallbackActive ? { fallbackReason: "api_base_url_absent" } : {}),
      identity,
    };
  }

  const apiStationRunId = input.stationRunId?.trim();
  if (!apiStationRunId) {
    const view = viewLearnerCanonicalExamPhase(aligned);
    return {
      store: aligned,
      view,
      fetched: false,
      fallbackReason: "api_station_run_id_absent",
      identity,
    };
  }

  const baseUrl = input.baseUrl.replace(/\/$/, "");
  const fetcher = input.fetch ?? globalThis.fetch;
  const url = `${baseUrl}/sessions/${encodeURIComponent(apiStationRunId)}/trace-events`;

  let body: unknown;
  try {
    body = await getTraceEventsJson(fetcher, url);
  } catch (error) {
    if (error instanceof MalformedTraceEventsPayloadError) {
      throw error;
    }
    const reason =
      error instanceof Error && error.message.length > 0 ? error.message : "trace_events_unreachable";
    const view = viewLearnerCanonicalExamPhase(aligned);
    return {
      store: aligned,
      view,
      fetched: false,
      fallbackReason: reason,
      identity,
    };
  }

  const events = parseTraceEventsPayload(body);
  const phaseEvents = events.filter((event) =>
    (LEARNER_CANONICAL_PHASE_TYPES as readonly string[]).includes(event.eventType),
  );
  if (phaseEvents.length === 0) {
    const view = viewLearnerCanonicalExamPhase(aligned);
    return {
      store: aligned,
      view,
      fetched: true,
      ...(view.fallbackActive ? { fallbackReason: "no_canonical_phase_events" } : {}),
      identity,
    };
  }

  let candidate = createLearnerCanonicalPhaseTraceStore(identity);
  for (const event of phaseEvents) {
    const admitted = admitLearnerCanonicalPhaseEvent(candidate, event);
    if (!admitted.ok) {
      throw new MalformedTraceEventsPayloadError(`canonical_phase_event_refused: ${admitted.reason}`);
    }
    candidate = admitted.store;
  }
  candidate = { ...candidate, localEvents: aligned.localEvents };

  const previousSequence = lastAdmittedSequence(aligned);
  const candidateSequence = lastAdmittedSequence(candidate);
  if (previousSequence !== null && (candidateSequence === null || candidateSequence < previousSequence)) {
    throw new MalformedTraceEventsPayloadError(
      `canonical_phase_event_refused: stale_or_regressing_sequence (had ${previousSequence}, got ${candidateSequence})`,
    );
  }
  if (previousSequence !== null && candidateSequence === previousSequence) {
    const view = viewLearnerCanonicalExamPhase(aligned);
    return { store: aligned, view, fetched: true, identity };
  }

  const view = viewLearnerCanonicalExamPhase(candidate);
  return { store: candidate, view, fetched: true, identity };
}

function lastAdmittedSequence(store: LearnerCanonicalPhaseTraceStore): number | null {
  const last = store.persistedEvents[store.persistedEvents.length - 1];
  return last === undefined ? null : last.sequence;
}

function alignStoreToIdentity(
  store: LearnerCanonicalPhaseTraceStore,
  identity: LearnerStationTraceIdentity,
): LearnerCanonicalPhaseTraceStore {
  if (
    store.examRunId === identity.examRunId
    && store.stationRunId === identity.stationRunId
    && store.scenarioId === identity.scenarioId
    && store.stationOrder === identity.stationOrder
  ) {
    return store;
  }
  return createLearnerCanonicalPhaseTraceStore(identity);
}

export function parseTraceEventsPayload(body: unknown): TraceEvent[] {
  if (!Array.isArray(body)) {
    throw new MalformedTraceEventsPayloadError("trace_events_payload_malformed: expected array");
  }
  const events: TraceEvent[] = [];
  for (const item of body) {
    const validation = validateTraceEvent(item);
    if (!validation.ok) {
      throw new MalformedTraceEventsPayloadError(
        `trace_events_payload_malformed: ${validation.errors.join("; ")}`,
      );
    }
    events.push(item as TraceEvent);
  }
  return events;
}

async function getTraceEventsJson(fetcher: typeof fetch, url: string): Promise<unknown> {
  const response = await fetcher(url, { method: "GET" });
  if (!response.ok) {
    throw new Error(`OpenClinXR learner trace-events GET failed: ${url} ${response.status}`);
  }
  try {
    return await response.json();
  } catch {
    throw new MalformedTraceEventsPayloadError("trace_events_payload_malformed: unparseable json");
  }
}
