import type { TraceEvent } from "@openclinxr/shared-schemas";
import { describe, expect, it } from "vitest";
import { edChestPainScenario } from "@openclinxr/scenario-fixtures/ed-chest-pain";
import { createLearnerExamFormRunState } from "./learner-exam-form-boot.js";
import {
  hydrateLearnerCanonicalPhaseTraceFromApi,
  MalformedTraceEventsPayloadError,
  parseTraceEventsPayload,
  resolveActiveLearnerStationTraceIdentity,
} from "./learner-phase-trace-source.js";
import {
  applyLearnerExamFlowIntent,
  createLearnerCanonicalPhaseTraceStore,
  LEARNER_CANONICAL_PHASE_TYPES,
  viewLearnerCanonicalExamPhase,
} from "./runtime-state.js";

const examRunId = "exam_run_learner_phase_boot_001";

function assembledRun() {
  const run = createLearnerExamFormRunState(examRunId, [edChestPainScenario], edChestPainScenario.scenarioId);
  expect(run).not.toBeNull();
  return run!;
}

function payloadPhase(eventType: (typeof LEARNER_CANONICAL_PHASE_TYPES)[number]) {
  return eventType === "station.advanced" ? "complete" : eventType.startsWith("note.") ? "note" : "encounter";
}

function persistedEvent(
  identity: { examRunId: string; stationRunId: string; scenarioId: string; stationOrder: number },
  sequence: number,
  eventType: (typeof LEARNER_CANONICAL_PHASE_TYPES)[number],
): TraceEvent {
  const atSecond = sequence;
  return {
    stationRunId: identity.stationRunId,
    sequence,
    eventType,
    occurredAt: new Date(Date.parse("2026-05-03T15:38:58.000Z") + atSecond * 1000).toISOString(),
    atSecond,
    source: "system",
    payload: {
      scenarioId: identity.scenarioId,
      examRunId: identity.examRunId,
      stationOrder: identity.stationOrder,
      phase: payloadPhase(eventType),
      formAtSecond: atSecond,
      durableEventRef: `durable://station-runs/${identity.stationRunId}/events/${sequence}`,
      ...(eventType === "station.advanced" ? { advanceReason: "patient_note_submitted_advancing" } : {}),
    },
  };
}

function jsonFetch(responder: (url: string) => { status: number; body: unknown }): typeof fetch {
  return (async (input: RequestInfo | URL) => {
    const url = String(input);
    const result = responder(url);
    return new Response(JSON.stringify(result.body), {
      status: result.status,
      headers: { "content-type": "application/json" },
    });
  }) as typeof fetch;
}

describe("learner phase-trace source hydrates the existing admit gate", () => {
  it("resolves stationRunId from the assembled exam run current station", () => {
    const run = assembledRun();
    const identity = resolveActiveLearnerStationTraceIdentity({ examRun: run });
    expect(identity).not.toBeNull();
    expect(identity?.examRunId).toBe(examRunId);
    expect(identity?.scenarioId).toBe(edChestPainScenario.scenarioId);
    expect(identity?.stationOrder).toBe(run.queue.stationQueue[run.currentStationIndex]?.stationOrder);
    expect(identity?.stationRunId).toBe(
      `station_run_${examRunId}_${edChestPainScenario.scenarioId}_${identity?.stationOrder}`,
    );
  });

  it("admits persisted API events as canonical after identity/order/time/durable-ref checks", async () => {
    const run = assembledRun();
    const identity = resolveActiveLearnerStationTraceIdentity({ examRun: run })!;
    const events = LEARNER_CANONICAL_PHASE_TYPES.map((eventType, sequence) =>
      persistedEvent(identity, sequence, eventType),
    );
    const requests: string[] = [];
    const result = await hydrateLearnerCanonicalPhaseTraceFromApi({
      baseUrl: "http://localhost:8787",
      examRun: run,
      store: createLearnerCanonicalPhaseTraceStore(identity),
      stationRunId: identity.stationRunId,
      fetch: ((input: RequestInfo | URL) => {
        requests.push(String(input));
        return jsonFetch(() => ({ status: 200, body: events }))(input);
      }) as typeof fetch,
    });

    expect(requests).toEqual([
      `http://localhost:8787/sessions/${encodeURIComponent(identity.stationRunId)}/trace-events`,
    ]);
    expect(result.fetched).toBe(true);
    expect(result.view.source).toBe("canonical_assembled_exam_phase_trace");
    expect(result.view.fallbackActive).toBe(false);
    expect(result.view.phase).toBe("complete");
    expect(result.view.lastAdvanceReason).toBe("patient_note_submitted_advancing");
    expect(result.view.examEquivalenceGate).toBe(false);
    expect(result.store.persistedEvents.map((event) => event.eventType)).toEqual([...LEARNER_CANONICAL_PHASE_TYPES]);
  });

  it("keeps labeled local fallback on transport absence and does not promote localEvents", async () => {
    const run = assembledRun();
    const identity = resolveActiveLearnerStationTraceIdentity({ examRun: run })!;
    const local = applyLearnerExamFlowIntent(createLearnerCanonicalPhaseTraceStore(identity), {
      kind: "end_encounter",
      atSecond: 12,
      formAtSecond: 12,
      noteTextLength: 0,
      nextScenarioId: "peds_asthma_parent_anxiety_v1",
    });
    expect(local.view.source).toBe("local_exam_flow_fallback");

    const result = await hydrateLearnerCanonicalPhaseTraceFromApi({
      baseUrl: "http://localhost:8787",
      examRun: run,
      store: local.store,
      stationRunId: identity.stationRunId,
      fetch: jsonFetch(() => ({ status: 404, body: { error: "session_not_found" } })),
    });

    expect(result.fetched).toBe(false);
    expect(result.view.source).toBe("local_exam_flow_fallback");
    expect(result.view.fallbackActive).toBe(true);
    expect(result.view.fallbackLabel).toMatch(/local-only fallback/i);
    expect(result.store.persistedEvents).toEqual([]);
    expect(result.store.localEvents.map((event) => event.eventType)).toEqual(
      local.store.localEvents.map((event) => event.eventType),
    );
  });

  it("refuses a malformed 200 payload instead of treating it as local truth", async () => {
    const run = assembledRun();
    const identity = resolveActiveLearnerStationTraceIdentity({ examRun: run })!;
    const local = applyLearnerExamFlowIntent(createLearnerCanonicalPhaseTraceStore(identity), {
      kind: "end_encounter",
      atSecond: 8,
      formAtSecond: 8,
      noteTextLength: 0,
      nextScenarioId: null,
    });

    await expect(
      hydrateLearnerCanonicalPhaseTraceFromApi({
        baseUrl: "http://localhost:8787",
        examRun: run,
        store: local.store,
        stationRunId: identity.stationRunId,
        fetch: jsonFetch(() => ({
          status: 200,
          body: {
            persistedEvents: [persistedEvent(identity, 0, "encounter.started")],
            localEvents: local.store.localEvents,
          },
        })),
      }),
    ).rejects.toBeInstanceOf(MalformedTraceEventsPayloadError);

    expect(viewLearnerCanonicalExamPhase(local.store).source).toBe("local_exam_flow_fallback");
    expect(local.store.persistedEvents).toEqual([]);
  });

  it("does not fetch when baseUrl is absent", async () => {
    const run = assembledRun();
    const identity = resolveActiveLearnerStationTraceIdentity({ examRun: run })!;
    let called = 0;
    const result = await hydrateLearnerCanonicalPhaseTraceFromApi({
      baseUrl: undefined,
      examRun: run,
      store: createLearnerCanonicalPhaseTraceStore(identity),
      fetch: (async () => {
        called += 1;
        return new Response("[]");
      }) as typeof fetch,
    });
    expect(called).toBe(0);
    expect(result.fetched).toBe(false);
    expect(result.view.source).toBe("local_exam_flow_fallback");
  });

  it("skips non-phase API events without inventing a second reducer", async () => {
    const run = assembledRun();
    const identity = resolveActiveLearnerStationTraceIdentity({ examRun: run })!;
    const stationStarted: TraceEvent = {
      stationRunId: identity.stationRunId,
      sequence: 0,
      eventType: "station.started",
      occurredAt: "2026-05-03T15:38:58.000Z",
      atSecond: 0,
      source: "system",
      payload: {
        durableEventRef: `durable://station-runs/${identity.stationRunId}/events/0`,
      },
    };
    const started = persistedEvent(identity, 0, "encounter.started");
    started.sequence = 1;
    started.atSecond = 1;
    started.payload = {
      ...started.payload,
      formAtSecond: 1,
      durableEventRef: `durable://station-runs/${identity.stationRunId}/events/1`,
    };
    const result = await hydrateLearnerCanonicalPhaseTraceFromApi({
      baseUrl: "http://localhost:8787",
      examRun: run,
      store: createLearnerCanonicalPhaseTraceStore(identity),
      stationRunId: identity.stationRunId,
      fetch: jsonFetch(() => ({ status: 200, body: [stationStarted, started] })),
    });
    expect(result.view.source).toBe("canonical_assembled_exam_phase_trace");
    expect(result.store.persistedEvents.map((event) => event.eventType)).toEqual(["encounter.started"]);
  });

  it("refuses a canonical-phase event that fails identity or durable-ref instead of skipping it", async () => {
    const run = assembledRun();
    const identity = resolveActiveLearnerStationTraceIdentity({ examRun: run })!;
    const crossRun = persistedEvent(identity, 0, "encounter.started");
    crossRun.payload = { ...crossRun.payload, examRunId: "exam_run_other" };
    await expect(
      hydrateLearnerCanonicalPhaseTraceFromApi({
        baseUrl: "http://localhost:8787",
        examRun: run,
        store: createLearnerCanonicalPhaseTraceStore(identity),
        stationRunId: identity.stationRunId,
        fetch: jsonFetch(() => ({ status: 200, body: [crossRun] })),
      }),
    ).rejects.toThrow(/canonical_phase_event_refused: cross_run/);
  });

  it("keeps a previously admitted canonical trace when the reload is empty", async () => {
    const run = assembledRun();
    const identity = resolveActiveLearnerStationTraceIdentity({ examRun: run })!;
    const prior = await hydrateLearnerCanonicalPhaseTraceFromApi({
      baseUrl: "http://localhost:8787",
      examRun: run,
      store: createLearnerCanonicalPhaseTraceStore(identity),
      stationRunId: identity.stationRunId,
      fetch: jsonFetch(() => ({
        status: 200,
        body: [
          persistedEvent(identity, 0, "encounter.started"),
          persistedEvent(identity, 1, "encounter.ended"),
        ],
      })),
    });
    expect(prior.view.source).toBe("canonical_assembled_exam_phase_trace");
    expect(prior.view.lastAdmittedSequence).toBe(1);

    const reloaded = await hydrateLearnerCanonicalPhaseTraceFromApi({
      baseUrl: "http://localhost:8787",
      examRun: run,
      store: prior.store,
      stationRunId: identity.stationRunId,
      fetch: jsonFetch(() => ({ status: 200, body: [] })),
    });
    expect(reloaded.fetched).toBe(true);
    expect(reloaded.view.source).toBe("canonical_assembled_exam_phase_trace");
    expect(reloaded.view.lastAdmittedSequence).toBe(1);
    expect(reloaded.store.persistedEvents.map((event) => event.sequence)).toEqual([0, 1]);
  });

  it("refuses a stale canonical payload rather than demoting last sequence", async () => {
    const run = assembledRun();
    const identity = resolveActiveLearnerStationTraceIdentity({ examRun: run })!;
    const prior = await hydrateLearnerCanonicalPhaseTraceFromApi({
      baseUrl: "http://localhost:8787",
      examRun: run,
      store: createLearnerCanonicalPhaseTraceStore(identity),
      stationRunId: identity.stationRunId,
      fetch: jsonFetch(() => ({
        status: 200,
        body: [
          persistedEvent(identity, 0, "encounter.started"),
          persistedEvent(identity, 1, "encounter.ended"),
        ],
      })),
    });

    await expect(
      hydrateLearnerCanonicalPhaseTraceFromApi({
        baseUrl: "http://localhost:8787",
        examRun: run,
        store: prior.store,
        stationRunId: identity.stationRunId,
        fetch: jsonFetch(() => ({
          status: 200,
          body: [persistedEvent(identity, 0, "encounter.started")],
        })),
      }),
    ).rejects.toThrow(/stale_or_regressing_sequence/);
    expect(viewLearnerCanonicalExamPhase(prior.store).lastAdmittedSequence).toBe(1);
  });

  it("labels fetched=true empty phase traces as fallback with an explicit reason", async () => {
    const run = assembledRun();
    const identity = resolveActiveLearnerStationTraceIdentity({ examRun: run })!;
    const stationStarted: TraceEvent = {
      stationRunId: identity.stationRunId,
      sequence: 0,
      eventType: "station.started",
      occurredAt: "2026-05-03T15:38:58.000Z",
      atSecond: 0,
      source: "system",
      payload: {
        durableEventRef: `durable://station-runs/${identity.stationRunId}/events/0`,
      },
    };
    const result = await hydrateLearnerCanonicalPhaseTraceFromApi({
      baseUrl: "http://localhost:8787",
      examRun: run,
      store: createLearnerCanonicalPhaseTraceStore(identity),
      stationRunId: identity.stationRunId,
      fetch: jsonFetch(() => ({ status: 200, body: [stationStarted] })),
    });
    expect(result.fetched).toBe(true);
    expect(result.view.source).toBe("local_exam_flow_fallback");
    expect(result.fallbackReason).toBe("no_canonical_phase_events");
  });

  it("does not fetch a derived stationRunId when the API session id is absent", async () => {
    const run = assembledRun();
    const identity = resolveActiveLearnerStationTraceIdentity({ examRun: run })!;
    let called = 0;
    const result = await hydrateLearnerCanonicalPhaseTraceFromApi({
      baseUrl: "http://localhost:8787",
      examRun: run,
      store: createLearnerCanonicalPhaseTraceStore(identity),
      fetch: (async () => {
        called += 1;
        return new Response("[]");
      }) as typeof fetch,
    });
    expect(called).toBe(0);
    expect(result.fetched).toBe(false);
    expect(result.fallbackReason).toBe("api_station_run_id_absent");
    expect(result.view.source).toBe("local_exam_flow_fallback");
  });

  it("fetches the explicit API stationRunId rather than the derived local identity", async () => {
    const run = assembledRun();
    const derived = resolveActiveLearnerStationTraceIdentity({ examRun: run })!;
    const apiStationRunId = "api_session_from_startSession_001";
    const identity = { ...derived, stationRunId: apiStationRunId };
    const events = [persistedEvent(identity, 0, "encounter.started")];
    const requests: string[] = [];
    const result = await hydrateLearnerCanonicalPhaseTraceFromApi({
      baseUrl: "http://localhost:8787",
      examRun: run,
      store: createLearnerCanonicalPhaseTraceStore(derived),
      stationRunId: apiStationRunId,
      fetch: ((input: RequestInfo | URL) => {
        requests.push(String(input));
        return jsonFetch(() => ({ status: 200, body: events }))(input);
      }) as typeof fetch,
    });
    expect(requests).toEqual([
      `http://localhost:8787/sessions/${encodeURIComponent(apiStationRunId)}/trace-events`,
    ]);
    expect(requests.some((url) => url.includes(derived.stationRunId))).toBe(false);
    expect(result.identity?.stationRunId).toBe(apiStationRunId);
    expect(result.view.source).toBe("canonical_assembled_exam_phase_trace");
  });
});

describe("assembled start-session body from exam-form run", () => {
  it("includes examRunId, scenarioId, positive stationOrder, and form timing", async () => {
    const { buildAssembledStationStartSessionInput } = await import("./station-api-client.js");
    const run = assembledRun();
    const body = buildAssembledStationStartSessionInput({
      learnerId: "quest3_local_learner",
      scenarioId: edChestPainScenario.scenarioId,
      examRun: run,
    });
    expect(body.consentAccepted).toBe(true);
    expect(body.scenarioId).toBe(edChestPainScenario.scenarioId);
    expect(body.assembledStation?.examRunId).toBe(examRunId);
    expect(body.assembledStation?.scenarioId).toBe(edChestPainScenario.scenarioId);
    expect(body.assembledStation?.stationOrder).toBeGreaterThan(0);
    expect(body.assembledStation?.formTiming.encounter.endsAtSecond).toBeGreaterThan(
      body.assembledStation?.formTiming.encounter.startsAtSecond ?? 0,
    );
    expect(body.assembledStation?.formTiming.note.endsAtSecond).toBeGreaterThan(
      body.assembledStation?.formTiming.note.startsAtSecond ?? 0,
    );
  });

  it("omits assembled context when the exam run is missing rather than inventing identity", async () => {
    const { buildAssembledStationStartSessionInput } = await import("./station-api-client.js");
    const body = buildAssembledStationStartSessionInput({
      learnerId: "quest3_local_learner",
      scenarioId: edChestPainScenario.scenarioId,
      examRun: null,
    });
    expect(body.assembledStation).toBeUndefined();
  });
});

describe("parseTraceEventsPayload", () => {
  it("throws on a non-array 200 body", () => {
    expect(() => parseTraceEventsPayload({ events: [] })).toThrow(MalformedTraceEventsPayloadError);
  });

  it("throws on an array item that fails validateTraceEvent", () => {
    expect(() => parseTraceEventsPayload([{ eventType: "encounter.started" }])).toThrow(
      MalformedTraceEventsPayloadError,
    );
  });
});
