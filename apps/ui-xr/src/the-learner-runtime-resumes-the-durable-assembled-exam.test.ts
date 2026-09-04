import type { ExamFormRunState } from "@openclinxr/exam-assembly";
import { edChestPainScenario } from "@openclinxr/scenario-fixtures/ed-chest-pain";
import { pediatricAsthmaScenario } from "@openclinxr/scenario-fixtures/pediatric-asthma";
import type { TraceEvent } from "@openclinxr/shared-schemas";
import { describe, expect, it } from "vitest";
import {
  bootLearnerExamFormFromApi,
  createLearnerExamFormRunState,
  learnerExamResumeNextStation,
} from "./learner-exam-form-boot.js";
import {
  createLearnerCanonicalPhaseTraceStore,
  LEARNER_CANONICAL_PHASE_TYPES,
  type LearnerCanonicalPhaseTraceStore,
  viewLearnerCanonicalExamPhase,
} from "./runtime-state.js";

/**
 * PLANTED CONTRACT — learner runtime resumes an assembled exam from the durable
 * admitted phase trace after reload.
 *
 * Diagnosis (immutable): bootLearnerExamFormFromApi always called
 * createLearnerExamFormRunState(..., start: true), which rebuilds a local queue
 * at station one and ignores GET /exam-runs/:id. Canonical traces hydrated
 * against that fresh pointer, so reload lost current station, encounter/note
 * phase, form clock, completed outcomes, and next navigation. Inconsistent
 * durable identity could fall through to fixture data.
 *
 * This file pins: resume from the API run aggregate + admitted phase events;
 * blocked-resume on identity/sequence mismatch; never silent fixture switch;
 * examEquivalenceGate stays false.
 */

const BASE_URL = "http://localhost:8787";
const EXAM_RUN_ID = "exam_run_durable_resume_001";
const SCENARIO_A = edChestPainScenario.scenarioId;
const SCENARIO_B = pediatricAsthmaScenario.scenarioId;
const STATION_A_RUN_ID = `${EXAM_RUN_ID}:station:1`;
const STATION_B_RUN_ID = `${EXAM_RUN_ID}:station:2`;
const PRIOR_ADVANCED_AT = "2026-09-04T14:05:06.000Z";

const approvedA = { ...edChestPainScenario, status: "approved" as const };
const approvedB = { ...pediatricAsthmaScenario, status: "approved" as const };

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

function lifecycle(lastAdmittedEventType: string | null, phase: string, admittedEventTypes: string[]) {
  const stationRunId = phase === "complete" ? STATION_A_RUN_ID : STATION_B_RUN_ID;
  const nextExpectedEventType = lastAdmittedEventType === null
    ? LEARNER_CANONICAL_PHASE_TYPES[0]
    : LEARNER_CANONICAL_PHASE_TYPES[
        LEARNER_CANONICAL_PHASE_TYPES.indexOf(lastAdmittedEventType as (typeof LEARNER_CANONICAL_PHASE_TYPES)[number]) + 1
      ] ?? null;
  return {
    lastAdmittedEventType,
    nextExpectedEventType,
    admittedEventTypes,
    durableEventRefs: admittedEventTypes.map((_, index) => `durable://station-runs/${stationRunId}/events/${index}`),
    noteSubmitted: lastAdmittedEventType === "note.submitted" || lastAdmittedEventType === "station.advanced",
    phase,
  };
}

function admittedEvent(input: {
  stationRunId: string;
  scenarioId: string;
  stationOrder: number;
  sequence: number;
  eventType: (typeof LEARNER_CANONICAL_PHASE_TYPES)[number];
  atSecond: number;
  formAtSecond: number;
  recordedAtIso: string;
  advanceReason?: string;
}) {
  return {
    examRunId: EXAM_RUN_ID,
    stationRunId: input.stationRunId,
    scenarioId: input.scenarioId,
    stationOrder: input.stationOrder,
    sequence: input.sequence,
    eventType: input.eventType,
    atSecond: input.atSecond,
    formAtSecond: input.formAtSecond,
    durableEventRef: `durable://station-runs/${input.stationRunId}/events/${input.sequence}`,
    phase: payloadPhase(input.eventType),
    source: "system",
    recordedAtIso: input.recordedAtIso,
    ...(input.advanceReason ? { advanceReason: input.advanceReason } : {}),
  };
}

function durableEvents() {
  const baseMs = Date.parse("2026-09-04T14:00:00.000Z");
  const event = (
    stationRunId: string,
    scenarioId: string,
    stationOrder: number,
    sequence: number,
    eventType: (typeof LEARNER_CANONICAL_PHASE_TYPES)[number],
    atSecond: number,
    formAtSecond: number,
    recordedAtIso = new Date(baseMs + (stationOrder - 1) * 600_000 + sequence * 1000).toISOString(),
    advanceReason?: string,
  ) => admittedEvent({
    stationRunId,
    scenarioId,
    stationOrder,
    sequence,
    eventType,
    atSecond,
    formAtSecond,
    recordedAtIso,
    ...(advanceReason ? { advanceReason } : {}),
  });
  return [
    event(STATION_A_RUN_ID, SCENARIO_A, 1, 0, "encounter.started", 60, 60),
    event(STATION_A_RUN_ID, SCENARIO_A, 1, 1, "encounter.ended", 960, 960),
    event(STATION_A_RUN_ID, SCENARIO_A, 1, 2, "note.started", 960, 960),
    event(STATION_A_RUN_ID, SCENARIO_A, 1, 3, "note.submitted", 1560, 1560),
    event(
      STATION_A_RUN_ID,
      SCENARIO_A,
      1,
      4,
      "station.advanced",
      1560,
      1560,
      PRIOR_ADVANCED_AT,
      "patient_note_submitted_advancing",
    ),
    event(STATION_B_RUN_ID, SCENARIO_B, 2, 0, "encounter.started", 60, 1620),
    event(STATION_B_RUN_ID, SCENARIO_B, 2, 1, "encounter.ended", 960, 2520),
    event(STATION_B_RUN_ID, SCENARIO_B, 2, 2, "note.started", 960, 2520),
  ];
}

function aggregate(overrides: Record<string, unknown> = {}) {
  const events = durableEvents();
  return {
    examRunId: EXAM_RUN_ID,
    stationRunId: STATION_B_RUN_ID,
    examFormId: `form_${EXAM_RUN_ID}`,
    blueprintId: "blueprint_openclinxr_step2cs_style_seed_v1",
    action: "resume_station",
    orderedStations: [
      {
        stationOrder: 1,
        slotId: `station_001_${SCENARIO_A}`,
        stationRunId: STATION_A_RUN_ID,
        scenarioId: SCENARIO_A,
        scenarioVersion: approvedA.version,
      },
      {
        stationOrder: 2,
        slotId: `station_002_${SCENARIO_B}`,
        stationRunId: STATION_B_RUN_ID,
        scenarioId: SCENARIO_B,
        scenarioVersion: approvedB.version,
      },
    ],
    admittedPhaseEvents: events,
    currentStation: {
      stationOrder: 2,
      scenarioId: SCENARIO_B,
      stationRunId: STATION_B_RUN_ID,
      slotId: `station_002_${SCENARIO_B}`,
      assembledStation: {
        examRunId: EXAM_RUN_ID,
        scenarioId: SCENARIO_B,
        stationOrder: 2,
        formTiming: {
          doorway: { startsAtSecond: 1560, endsAtSecond: 1620 },
          encounter: { startsAtSecond: 1620, endsAtSecond: 2520 },
          note: { startsAtSecond: 2520, endsAtSecond: 2820 },
        },
      },
      lifecycle: lifecycle("note.started", "note", ["encounter.started", "encounter.ended", "note.started"]),
    },
    durableEventRefs: events.map((event) => event.durableEventRef),
    omissions: [],
    claimBoundary: "assembled_exam_resume_not_exam_equivalence",
    notEvidenceFor: ["exam_equivalence", "clinical_validity", "scoring_validity"],
    examEquivalenceGate: false,
    ...overrides,
  };
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function examFetch(input: {
  examRun?: { status: number; body: unknown } | "network_error";
  traces?: TraceEvent[] | { status: number; body: unknown };
  requests?: string[];
}): typeof fetch {
  const station2 = `${EXAM_RUN_ID}:station:2`;
  const identity = {
    examRunId: EXAM_RUN_ID,
    stationRunId: station2,
    scenarioId: SCENARIO_B,
    stationOrder: 2,
  };
  const defaultTraces = (["encounter.started", "encounter.ended", "note.started"] as const).map((eventType, sequence) =>
    persistedEvent(identity, sequence, eventType),
  );
  return (async (request: RequestInfo | URL) => {
    const url = String(request);
    input.requests?.push(url);
    if (url.includes("/exam-runs/")) {
      const examRun = input.examRun ?? { status: 200, body: aggregate() };
      if (examRun === "network_error") {
        throw new TypeError("fetch failed");
      }
      return jsonResponse(examRun.status, examRun.body);
    }
    if (url.includes("/station-run-queue")) {
      return jsonResponse(200, { stationQueue: [{ scenarioId: SCENARIO_A }, { scenarioId: SCENARIO_B }] });
    }
    if (url.includes(`/scenarios/${encodeURIComponent(SCENARIO_B)}`)) {
      return jsonResponse(200, approvedB);
    }
    if (url.includes("/scenarios/")) {
      return jsonResponse(200, approvedA);
    }
    if (url.includes("/trace-events")) {
      const traces = input.traces ?? defaultTraces;
      if (Array.isArray(traces)) {
        return jsonResponse(200, traces);
      }
      return jsonResponse(traces.status, traces.body);
    }
    return jsonResponse(404, { error: "not_found" });
  }) as typeof fetch;
}

function bootHarness(fetchImpl: typeof fetch) {
  let state: ExamFormRunState | null = createLearnerExamFormRunState(
    EXAM_RUN_ID,
    [approvedA, approvedB],
    SCENARIO_A,
  );
  let store: LearnerCanonicalPhaseTraceStore = createLearnerCanonicalPhaseTraceStore({
    examRunId: EXAM_RUN_ID,
    stationRunId: `station_run_${EXAM_RUN_ID}_${SCENARIO_A}_1`,
    scenarioId: SCENARIO_A,
    stationOrder: 1,
  });
  const presentationSink = { textContent: "" };
  const phaseSink = { textContent: "" };
  return {
    get state() {
      return state;
    },
    get store() {
      return store;
    },
    presentationSink,
    phaseSink,
    run: () =>
      bootLearnerExamFormFromApi({
        baseUrl: BASE_URL,
        examRunId: EXAM_RUN_ID,
        examScenarioId: SCENARIO_A,
        getState: () => state,
        setState: (next) => {
          state = next;
        },
        updateEvidence: () => undefined,
        presentationSink,
        fetch: fetchImpl,
        phaseTrace: {
          getStore: () => store,
          setStore: (next) => {
            store = next;
          },
          presentationSink: phaseSink,
        },
      }),
  };
}

describe("the learner runtime resumes the durable assembled exam", () => {
  it("reconstructs current station, note phase, clock, completed outcomes, and next navigation from GET /exam-runs", async () => {
    const harness = bootHarness(examFetch({}));
    await harness.run();

    expect(harness.state).not.toBeNull();
    expect(harness.state?.status).toBe("in_progress");
    expect(harness.state?.examEquivalenceGate).toBe(false);
    expect(harness.state?.currentStationIndex).toBe(1);
    expect(harness.state?.queue.stationQueue[harness.state.currentStationIndex]?.scenarioId).toBe(SCENARIO_B);
    expect(harness.state?.stationOutcomes).toHaveLength(1);
    expect(harness.state?.stationOutcomes[0]?.scenarioId).toBe(SCENARIO_A);
    expect(harness.state?.stationOutcomes[0]?.phase).toBe("complete");
    expect(harness.state?.stationOutcomes[0]).toMatchObject({
      startedAtFormSecond: 60,
      endedAtFormSecond: 1560,
      advanceReason: "patient_note_submitted_advancing",
      recordedAtIso: PRIOR_ADVANCED_AT,
    });
    expect(harness.state?.clock.formElapsedSecond).toBe(2520);
    expect(learnerExamResumeNextStation(harness.state)).toBeNull();
    expect(String(harness.presentationSink.textContent)).not.toMatch(/fixture/i);

    const view = viewLearnerCanonicalExamPhase(harness.store);
    expect(view.source).toBe("canonical_assembled_exam_phase_trace");
    expect(view.phase).toBe("note");
    expect(view.fallbackActive).toBe(false);
    expect(view.examEquivalenceGate).toBe(false);
    expect(harness.store.stationRunId).toBe(`${EXAM_RUN_ID}:station:2`);
    expect(harness.store.persistedEvents.map((event) => event.eventType)).toEqual([
      "encounter.started",
      "encounter.ended",
      "note.started",
    ]);
  });

  it("does not recreate a local in-progress queue at station one when a durable aggregate exists", async () => {
    const harness = bootHarness(examFetch({}));
    await harness.run();
    expect(harness.state?.status).not.toBe("blocked");
    expect(harness.state?.currentStationIndex).not.toBe(0);
    expect(harness.state?.queue.stationQueue[0]?.scenarioId).toBe(SCENARIO_A);
  });

  it("blocks rather than fabricating a prior outcome timestamp when the durable event lacks one", async () => {
    const events = durableEvents();
    const advanced = events[4];
    expect(advanced?.eventType).toBe("station.advanced");
    const harness = bootHarness(examFetch({
      examRun: {
        status: 200,
        body: aggregate({
          admittedPhaseEvents: events.map((event, index) => index === 4
            ? { ...event, recordedAtIso: undefined }
            : event),
        }),
      },
    }));
    await harness.run();
    expect(harness.state?.status).toBe("blocked");
    expect(harness.state?.stationOutcomes).toEqual([]);
  });

  it("blocks resume on durable examRun identity mismatch and never labels fixtures", async () => {
    const harness = bootHarness(
      examFetch({
        examRun: { status: 200, body: aggregate({ examRunId: "exam_run_other" }) },
      }),
    );
    await harness.run();
    expect(harness.state?.status).toBe("blocked");
    expect(harness.state?.examEquivalenceGate).toBe(false);
    expect(String(harness.presentationSink.textContent).toLowerCase()).toContain("blocked");
    expect(String(harness.presentationSink.textContent).toLowerCase()).not.toContain("fixture");
  });

  it("blocks resume on 409 stale identity without switching to fixture data", async () => {
    const harness = bootHarness(
      examFetch({
        examRun: {
          status: 409,
          body: { error: "stale_identity", reason: "form_mismatch", examEquivalenceGate: false, notEvidenceFor: ["exam_equivalence"] },
        },
      }),
    );
    await harness.run();
    expect(harness.state?.status).toBe("blocked");
    expect(String(harness.presentationSink.textContent).toLowerCase()).toContain("blocked");
    expect(String(harness.presentationSink.textContent).toLowerCase()).not.toContain("fixture");
  });

  it("blocks resume when the known exam-run GET has a network failure", async () => {
    const requests: string[] = [];
    const harness = bootHarness(examFetch({ examRun: "network_error", requests }));
    await harness.run();
    expect(harness.state?.status).toBe("blocked");
    expect(String(harness.presentationSink.textContent)).toContain("exam run unreachable");
    expect(harness.state?.currentStationIndex).toBe(0);
    expect(requests.some((url) => url.includes("station-run-queue"))).toBe(false);
  });

  it("blocks resume when the known exam-run GET returns 5xx", async () => {
    const requests: string[] = [];
    const harness = bootHarness(examFetch({
      examRun: { status: 503, body: { error: "durable_store_unavailable" } },
      requests,
    }));
    await harness.run();
    expect(harness.state?.status).toBe("blocked");
    expect(String(harness.presentationSink.textContent)).toContain("exam run get failed 503");
    expect(String(harness.presentationSink.textContent)).not.toMatch(/fixture/i);
    expect(requests.some((url) => url.includes("station-run-queue"))).toBe(false);
  });

  it("blocks resume when admitted trace sequence disagrees with the durable aggregate", async () => {
    const identity = {
      examRunId: EXAM_RUN_ID,
      stationRunId: `${EXAM_RUN_ID}:station:2`,
      scenarioId: SCENARIO_B,
      stationOrder: 2,
    };
    const harness = bootHarness(
      examFetch({
        traces: [persistedEvent(identity, 0, "encounter.started")],
      }),
    );
    await harness.run();
    expect(harness.state?.status).toBe("blocked");
    expect(harness.state?.examEquivalenceGate).toBe(false);
    expect(String(harness.presentationSink.textContent).toLowerCase()).toContain("blocked");
    expect(String(harness.presentationSink.textContent).toLowerCase()).not.toContain("fixture");
  });

  it("creates a fresh local form when no durable exam-run aggregate exists (404)", async () => {
    const harness = bootHarness(async (request: RequestInfo | URL) => {
      const url = String(request);
      if (url.includes("/exam-runs/")) {
        return jsonResponse(404, { error: "assembled_exam_run_not_found" });
      }
      if (url.includes("/station-run-queue")) {
        return jsonResponse(200, { stationQueue: [{ scenarioId: SCENARIO_A }] });
      }
      if (url.includes("/scenarios/")) {
        return jsonResponse(200, approvedA);
      }
      return jsonResponse(404, { error: "not_found" });
    });
    await harness.run();
    expect(harness.state?.status).toBe("in_progress");
    expect(harness.state?.currentStationIndex).toBe(0);
    expect(harness.state?.examEquivalenceGate).toBe(false);
    expect(String(harness.presentationSink.textContent)).not.toMatch(/blocked/i);
  });
});
