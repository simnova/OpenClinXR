import { describe, expect, it } from "vitest";
import {
  DEFAULT_DEV_AUTH_SECRET,
  signAuthToken,
} from "@openclinxr/auth";
import type { ExamForm, ExamTimingPlan } from "@openclinxr/exam-assembly";
import { assembledExamOrchestratorClaimBoundary } from "@openclinxr/scenario-runtime";
import { ApiApplication } from "../api-application.js";
import { createApiApp } from "../app.js";
import type { ApiPersistenceSink } from "../api-types.js";
import {
  assembledExamRunNotEvidenceFor,
  type ApiAssembledExamRunRecord,
} from "../runtime-durable-store.js";
import {
  ASSEMBLED_EXAM_RUNS_PATH,
  registerAssembledExamRunRoutes,
} from "./assembled-exam-run-routes.js";
import { registerSessionRoutes } from "./session-routes.js";

const EXAM_RUN_ID = "exam_run_learner_phase_001";
const LEARNER_ID = "learner_phase_001";
const OTHER_LEARNER_ID = "learner_other_001";
const FORM_ID = "form_pilot_001";
const BLUEPRINT_ID = "blueprint_pilot_v1";
const SCENARIO_A = "ed_chest_pain_priority_v1";
const SCENARIO_B = "peds_asthma_parent_anxiety_v1";

function coverage(ok = true): ExamForm["coverage"] {
  return {
    requiredTraceTags: [],
    coveredTraceTags: [],
    missingTraceTags: [],
    requiredEnvironmentIds: [],
    coveredEnvironmentIds: [],
    missingEnvironmentIds: [],
    requiredSafetyCriticalTraceTags: [],
    coveredSafetyCriticalTraceTags: [],
    missingSafetyCriticalTraceTags: [],
    stationCount: { required: 2, actual: ok ? 2 : 1, ok },
  };
}

function form(overrides: Partial<ExamForm> = {}): ExamForm {
  return {
    examFormId: FORM_ID,
    blueprintId: BLUEPRINT_ID,
    title: "Two-station assembled exam",
    stationRefs: [
      { order: 1, scenarioId: SCENARIO_A, scenarioVersion: 1, title: "ED chest pain" },
      { order: 2, scenarioId: SCENARIO_B, scenarioVersion: 1, title: "Peds asthma" },
    ],
    coverage: coverage(),
    assemblyIssues: [],
    status: "ready_for_review",
    ...overrides,
  };
}

function windowAt(startsAtSecond: number, durationSeconds: number) {
  return {
    startsAtSecond,
    endsAtSecond: startsAtSecond + durationSeconds,
    durationSeconds,
  };
}

function timingPlan(): ExamTimingPlan {
  return {
    blueprintId: BLUEPRINT_ID,
    stationWindows: [
      {
        stationOrder: 1,
        slotId: "slot_a",
        label: "station 1",
        doorway: windowAt(0, 60),
        encounter: windowAt(60, 900),
        note: windowAt(960, 300),
      },
      {
        stationOrder: 2,
        slotId: "slot_b",
        label: "station 2",
        doorway: windowAt(1260, 60),
        encounter: windowAt(1320, 900),
        note: windowAt(2220, 300),
      },
    ],
    breakCheckpoints: [],
    totalStationTimeSeconds: 2520,
  };
}

function memorySink(): ApiPersistenceSink & { runs: Map<string, ApiAssembledExamRunRecord> } {
  const runs = new Map<string, ApiAssembledExamRunRecord>();
  return {
    runs,
    saveAssembledExamRun(examRunId, record) {
      runs.set(examRunId, structuredClone(record));
    },
    getAssembledExamRun(examRunId) {
      const stored = runs.get(examRunId);
      return stored ? structuredClone(stored) : undefined;
    },
  };
}

function compose(persistence: ApiPersistenceSink = memorySink()) {
  return ApiApplication.create()
    .withContext(undefined, persistence)
    .withCoreMiddleware()
    .withRoutes(registerAssembledExamRunRoutes)
    .build();
}

function composeWithSessions(persistence: ApiPersistenceSink = memorySink()) {
  return ApiApplication.create()
    .withContext(undefined, persistence)
    .withCoreMiddleware()
    .withRoutes((app, ctx) => {
      registerAssembledExamRunRoutes(app, ctx);
      registerSessionRoutes(app, ctx);
    })
    .build();
}

function authHeader(identity: { subject: string; role: "learner" | "faculty" | "admin"; learnerId?: string }): Record<string, string> {
  return {
    authorization: `Bearer ${signAuthToken({ identity, secret: DEFAULT_DEV_AUTH_SECRET })}`,
  };
}

function learnerAuth(learnerId = LEARNER_ID): Record<string, string> {
  return authHeader({ subject: learnerId, role: "learner", learnerId });
}

async function json(response: Response): Promise<Record<string, unknown>> {
  return await response.json() as Record<string, unknown>;
}

function startBody(overrides: Record<string, unknown> = {}) {
  return {
    learnerId: LEARNER_ID,
    consentAccepted: true,
    examRunId: EXAM_RUN_ID,
    examForm: form(),
    timingPlan: timingPlan(),
    ...overrides,
  };
}

describe("assembled-exam run API", () => {
  it("starts from an approved form, persists first, and returns the current station contract", async () => {
    const sink = memorySink();
    const composed = compose(sink);
    const created = await composed.app.request(ASSEMBLED_EXAM_RUNS_PATH, {
      method: "POST",
      headers: { "content-type": "application/json", ...learnerAuth() },
      body: JSON.stringify(startBody()),
    });
    const body = await json(created);
    expect(created.status).toBe(201);
    expect(sink.runs.has(EXAM_RUN_ID)).toBe(true);
    expect(body.examRunId).toBe(EXAM_RUN_ID);
    expect(body.stationRunId).toBe(`${EXAM_RUN_ID}:station:1`);
    expect(body.action).toBe("resume_station");
    expect(body.examEquivalenceGate).toBe(false);
    expect(body.claimBoundary).toBe(assembledExamOrchestratorClaimBoundary);
    const currentStation = body.currentStation as { stationOrder: number; scenarioId: string; assembledStation: unknown };
    expect(currentStation.stationOrder).toBe(1);
    expect(currentStation.scenarioId).toBe(SCENARIO_A);
    expect(currentStation.assembledStation).toEqual({
      examRunId: EXAM_RUN_ID,
      scenarioId: SCENARIO_A,
      stationOrder: 1,
      formTiming: {
        doorway: { startsAtSecond: 0, endsAtSecond: 60 },
        encounter: { startsAtSecond: 60, endsAtSecond: 960 },
        note: { startsAtSecond: 960, endsAtSecond: 1260 },
      },
    });
  });

  it("resumes the same aggregate after a process restart", async () => {
    const sink = memorySink();
    const first = compose(sink);
    const started = await first.app.request(ASSEMBLED_EXAM_RUNS_PATH, {
      method: "POST",
      headers: { "content-type": "application/json", ...learnerAuth() },
      body: JSON.stringify(startBody()),
    });
    expect(started.status).toBe(201);
    const admitted = await first.app.request(`/exam-runs/${EXAM_RUN_ID}/phase-events`, {
      method: "POST",
      headers: { "content-type": "application/json", ...learnerAuth() },
      body: JSON.stringify({
        learnerId: LEARNER_ID,
        stationRunId: `${EXAM_RUN_ID}:station:1`,
        sequence: 0,
        eventType: "encounter.started",
        scenarioId: SCENARIO_A,
        stationOrder: 1,
        atSecond: 60,
        formAtSecond: 60,
        durableEventRef: `durable://station-runs/${EXAM_RUN_ID}:station:1/events/0`,
      }),
    });
    expect(admitted.status).toBe(201);

    const restarted = compose(sink);
    restarted.context.assembledExamRuns.clear();
    restarted.context.examRunOwners.clear();
    const resumed = await restarted.app.request(`/exam-runs/${EXAM_RUN_ID}`, {
      headers: learnerAuth(),
    });
    const body = await json(resumed);
    expect(resumed.status).toBe(200);
    expect(body.examRunId).toBe(EXAM_RUN_ID);
    expect(body.stationRunId).toBe(`${EXAM_RUN_ID}:station:1`);
    const currentStation = body.currentStation as { lifecycle: { lastAdmittedEventType: string } };
    expect(currentStation.lifecycle.lastAdmittedEventType).toBe("encounter.started");
  });

  it("rejects learner, form, station-order, sequence, and durable-reference mismatches", async () => {
    const sink = memorySink();
    const composed = compose(sink);
    const started = await composed.app.request(ASSEMBLED_EXAM_RUNS_PATH, {
      method: "POST",
      headers: { "content-type": "application/json", ...learnerAuth() },
      body: JSON.stringify(startBody()),
    });
    expect(started.status).toBe(201);

    const learner = await composed.app.request(ASSEMBLED_EXAM_RUNS_PATH, {
      method: "POST",
      headers: { "content-type": "application/json", ...learnerAuth(OTHER_LEARNER_ID) },
      body: JSON.stringify(startBody({ learnerId: OTHER_LEARNER_ID })),
    });
    expect(learner.status).toBe(409);
    expect((await json(learner)).reason).toBe("learner_mismatch");

    const formMismatch = await composed.app.request(ASSEMBLED_EXAM_RUNS_PATH, {
      method: "POST",
      headers: { "content-type": "application/json", ...learnerAuth() },
      body: JSON.stringify(startBody({
        examForm: form({ examFormId: "form_other" }),
      })),
    });
    expect(formMismatch.status).toBe(409);
    expect((await json(formMismatch)).reason).toBe("form_mismatch");

    const stationOrder = await composed.app.request(`/exam-runs/${EXAM_RUN_ID}/phase-events`, {
      method: "POST",
      headers: { "content-type": "application/json", ...learnerAuth() },
      body: JSON.stringify({
        learnerId: LEARNER_ID,
        stationRunId: `${EXAM_RUN_ID}:station:2`,
        sequence: 0,
        eventType: "encounter.started",
        scenarioId: SCENARIO_B,
        stationOrder: 2,
        atSecond: 60,
        formAtSecond: 60,
      }),
    });
    expect(stationOrder.status).toBe(409);
    expect((await json(stationOrder)).reason).toBe("station_order_mismatch");

    const sequence = await composed.app.request(`/exam-runs/${EXAM_RUN_ID}/phase-events`, {
      method: "POST",
      headers: { "content-type": "application/json", ...learnerAuth() },
      body: JSON.stringify({
        learnerId: LEARNER_ID,
        stationRunId: `${EXAM_RUN_ID}:station:1`,
        sequence: 1,
        eventType: "encounter.started",
        scenarioId: SCENARIO_A,
        stationOrder: 1,
        atSecond: 60,
        formAtSecond: 60,
      }),
    });
    expect(sequence.status).toBe(409);
    expect((await json(sequence)).reason).toBe("sequence_mismatch");

    const durableRef = await composed.app.request(`/exam-runs/${EXAM_RUN_ID}/phase-events`, {
      method: "POST",
      headers: { "content-type": "application/json", ...learnerAuth() },
      body: JSON.stringify({
        learnerId: LEARNER_ID,
        stationRunId: `${EXAM_RUN_ID}:station:1`,
        sequence: 0,
        eventType: "encounter.started",
        scenarioId: SCENARIO_A,
        stationOrder: 1,
        atSecond: 60,
        formAtSecond: 60,
        durableEventRef: "durable://station-runs/other/events/0",
      }),
    });
    expect(durableRef.status).toBe(400);
    expect((await json(durableRef)).reason).toBe("durable_reference_mismatch");
  });

  it("rejects a same-sequence retry whose payload is not an exact match", async () => {
    const sink = memorySink();
    const composed = compose(sink);
    const started = await composed.app.request(ASSEMBLED_EXAM_RUNS_PATH, {
      method: "POST",
      headers: { "content-type": "application/json", ...learnerAuth() },
      body: JSON.stringify(startBody()),
    });
    expect(started.status).toBe(201);
    const stationRunId = `${EXAM_RUN_ID}:station:1`;
    const durableEventRef = `durable://station-runs/${stationRunId}/events/0`;
    const admittedBody = {
      learnerId: LEARNER_ID,
      stationRunId,
      sequence: 0,
      eventType: "encounter.started",
      scenarioId: SCENARIO_A,
      stationOrder: 1,
      atSecond: 60,
      formAtSecond: 60,
      source: "system",
      durableEventRef,
    };
    const admitted = await composed.app.request(`/exam-runs/${EXAM_RUN_ID}/phase-events`, {
      method: "POST",
      headers: { "content-type": "application/json", ...learnerAuth() },
      body: JSON.stringify(admittedBody),
    });
    expect(admitted.status).toBe(201);
    const exactRetry = await composed.app.request(`/exam-runs/${EXAM_RUN_ID}/phase-events`, {
      method: "POST",
      headers: { "content-type": "application/json", ...learnerAuth() },
      body: JSON.stringify(admittedBody),
    });
    expect(exactRetry.status).toBe(201);
    const storedBefore = structuredClone(sink.runs.get(EXAM_RUN_ID));
    expect(storedBefore?.admittedPhaseEvents).toHaveLength(1);

    const mutated = await composed.app.request(`/exam-runs/${EXAM_RUN_ID}/phase-events`, {
      method: "POST",
      headers: { "content-type": "application/json", ...learnerAuth() },
      body: JSON.stringify({
        ...admittedBody,
        atSecond: 90,
        formAtSecond: 90,
        source: "learner",
      }),
    });
    expect(mutated.status).toBe(409);
    expect((await json(mutated)).reason).toBe("sequence_mismatch");
    expect(sink.runs.get(EXAM_RUN_ID)).toEqual(storedBefore);
    expect(sink.runs.get(EXAM_RUN_ID)?.admittedPhaseEvents[0]?.atSecond).toBe(60);
    expect(sink.runs.get(EXAM_RUN_ID)?.admittedPhaseEvents[0]?.source).toBe("system");
  });

  it("does not acknowledge a mutation when durable save fails", async () => {
    const sink: ApiPersistenceSink = {
      saveAssembledExamRun: () => {
        throw new Error("mongo unavailable");
      },
    };
    const composed = compose(sink);
    const created = await composed.app.request(ASSEMBLED_EXAM_RUNS_PATH, {
      method: "POST",
      headers: { "content-type": "application/json", ...learnerAuth() },
      body: JSON.stringify(startBody()),
    });
    expect(created.status).toBe(503);
    expect(composed.context.assembledExamRuns.size).toBe(0);
    expect((await json(created)).notEvidenceFor).toEqual([...assembledExamRunNotEvidenceFor]);
  });

  it("leaves standalone single-station sessions working", async () => {
    const composed = composeWithSessions();
    const session = await composed.app.request("/sessions", {
      method: "POST",
      headers: { "content-type": "application/json", ...learnerAuth() },
      body: JSON.stringify({ learnerId: LEARNER_ID, consentAccepted: true }),
    });
    const body = await json(session);
    expect(session.status).toBe(201);
    expect(typeof body.stationRunId).toBe("string");
    expect(body.examRunId).toBeUndefined();
  });

  it("keeps production createApiApp session start available beside exam-run routes", async () => {
    const app = createApiApp();
    const session = await app.request("/sessions", {
      method: "POST",
      headers: { "content-type": "application/json", ...learnerAuth() },
      body: JSON.stringify({ learnerId: LEARNER_ID, consentAccepted: true }),
    });
    expect(session.status).toBe(201);
    const exam = await app.request(ASSEMBLED_EXAM_RUNS_PATH, {
      method: "POST",
      headers: { "content-type": "application/json", ...learnerAuth() },
      body: JSON.stringify(startBody()),
    });
    expect(exam.status).toBe(201);
  });
});
