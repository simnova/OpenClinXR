/**
 * Diagnosis: POST /exam-runs/:examRunId/phase-events checks selectedStation before
 * duplicate fingerprint. After the last station.advanced, resume action is exam_complete
 * and selectedStation is null, so an exact retry of that last command returns 409
 * stale_identity/station_order_mismatch. A new append after exam_complete uses the same
 * 409, so a closed attempt is not distinguished from a stale identity. Learner runtime
 * cannot retry the last command safely.
 *
 * Measured 2026-09-11 against assembled-exam-run-routes.ts admitPhaseEvent:
 * | case | status | error | saveAssembledExamRun calls | events |
 * | in-progress exact retry | 201 | (none) | increments | unchanged |
 * | exact retry after exam_complete | 409 | stale_identity / station_order_mismatch | no | unchanged |
 * | new append after exam_complete | 409 | stale_identity / station_order_mismatch | no | unchanged |
 *
 * Known-good: stale-identity 409 and durable-save 503 already exist in the same route
 * (assembled-exam-run-routes.test.ts learner/form 409, mongo-unavailable 503).
 * In-progress exact retry already does not append a second event.
 *
 * Counterweight: a same-sequence retry whose payload is not byte-equivalent stays 409
 * sequence_mismatch; a new append after exam_complete must not be that 409.
 */

import { DEFAULT_DEV_AUTH_SECRET, signAuthToken } from "@openclinxr/auth";
import type { ExamForm, ExamTimingPlan } from "@openclinxr/exam-assembly";
import { describe, expect, it } from "vitest";
import {
  type ApiApp,
  ApiApplication,
  type ApiAssembledExamRunRecord,
  type ApiPersistenceSink,
  registerAssembledExamRunRoutes,
} from "../index.js";

const EXAM_RUN_ID = "exam_run_learner_phase_final_001";
const LEARNER_ID = "learner_phase_final_001";
const FORM_ID = "form_pilot_final_001";
const BLUEPRINT_ID = "blueprint_pilot_final_v1";
const SCENARIO_A = "ed_chest_pain_priority_v1";
const SCENARIO_B = "peds_asthma_parent_anxiety_v1";

function coverage(): ExamForm["coverage"] {
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
    stationCount: { required: 2, actual: 2, ok: true },
  };
}

function form(): ExamForm {
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
    breakWindows: [],
    totalStationTimeSeconds: 2520,
    totalBreakTimeSeconds: 0,
    totalFormTimeSeconds: 2520,
  };
}

type CountingSink = ApiPersistenceSink & {
  runs: Map<string, ApiAssembledExamRunRecord>;
  saves: number;
};

function countingSink(): CountingSink {
  const runs = new Map<string, ApiAssembledExamRunRecord>();
  const sink: CountingSink = {
    runs,
    saves: 0,
    saveAssembledExamRun(examRunId, record) {
      sink.saves += 1;
      runs.set(examRunId, structuredClone(record));
    },
    getAssembledExamRun(examRunId) {
      const stored = runs.get(examRunId);
      return stored ? structuredClone(stored) : undefined;
    },
  };
  return sink;
}

function compose(persistence: ApiPersistenceSink) {
  return ApiApplication.create()
    .withContext(undefined, persistence)
    .withCoreMiddleware()
    .withRoutes(registerAssembledExamRunRoutes)
    .build();
}

function learnerAuth(): Record<string, string> {
  return {
    authorization: `Bearer ${signAuthToken({
      identity: { subject: LEARNER_ID, role: "learner", learnerId: LEARNER_ID },
      secret: DEFAULT_DEV_AUTH_SECRET,
    })}`,
  };
}

async function json(response: Response): Promise<Record<string, unknown>> {
  return await response.json() as Record<string, unknown>;
}

function startBody() {
  return {
    learnerId: LEARNER_ID,
    consentAccepted: true,
    examRunId: EXAM_RUN_ID,
    examForm: form(),
    timingPlan: timingPlan(),
  };
}

type PhaseBody = {
  stationRunId: string;
  sequence: number;
  eventType: string;
  scenarioId: string;
  stationOrder: number;
  atSecond: number;
  formAtSecond: number;
  advanceReason?: string;
};

async function postPhase(app: ApiApp, body: PhaseBody): Promise<Response> {
  return await Promise.resolve(app.request(`/exam-runs/${EXAM_RUN_ID}/phase-events`, {
    method: "POST",
    headers: { "content-type": "application/json", ...learnerAuth() },
    body: JSON.stringify({ learnerId: LEARNER_ID, source: "system", ...body }),
  }));
}

function stationRunId(order: 1 | 2): string {
  return `${EXAM_RUN_ID}:station:${order}`;
}

function stationScript(order: 1 | 2, scenarioId: string, times: readonly [number, number, number]): PhaseBody[] {
  const runId = stationRunId(order);
  const [encounterStart, encounterEnd, noteEnd] = times;
  return [
    {
      stationRunId: runId,
      sequence: 0,
      eventType: "encounter.started",
      scenarioId,
      stationOrder: order,
      atSecond: encounterStart,
      formAtSecond: encounterStart,
    },
    {
      stationRunId: runId,
      sequence: 1,
      eventType: "encounter.ended",
      scenarioId,
      stationOrder: order,
      atSecond: encounterEnd,
      formAtSecond: encounterEnd,
    },
    {
      stationRunId: runId,
      sequence: 2,
      eventType: "note.started",
      scenarioId,
      stationOrder: order,
      atSecond: encounterEnd,
      formAtSecond: encounterEnd,
    },
    {
      stationRunId: runId,
      sequence: 3,
      eventType: "note.submitted",
      scenarioId,
      stationOrder: order,
      atSecond: noteEnd,
      formAtSecond: noteEnd,
    },
    {
      stationRunId: runId,
      sequence: 4,
      eventType: "station.advanced",
      scenarioId,
      stationOrder: order,
      atSecond: noteEnd,
      formAtSecond: noteEnd,
      advanceReason: "patient_note_submitted_advancing",
    },
  ];
}

async function startExam(app: ApiApp) {
  const created = await app.request("/exam-runs", {
    method: "POST",
    headers: { "content-type": "application/json", ...learnerAuth() },
    body: JSON.stringify(startBody()),
  });
  expect(created.status).toBe(201);
}

async function admitAll(app: ApiApp, bodies: PhaseBody[]) {
  for (const body of bodies) {
    const response = await postPhase(app, body);
    expect(response.status).toBe(201);
  }
}

describe("exam-run phase events refuse duplicates and finalized runs", () => {
  it("keeps an in-progress exact retry at one admitted event", async () => {
    const sink = countingSink();
    const composed = compose(sink);
    await startExam(composed.app);
    expect(sink.saves).toBe(1);
    const [firstBody] = stationScript(1, SCENARIO_A, [60, 960, 1260]);
    if (!firstBody) {
      throw new Error("station script missing encounter.started");
    }
    const admitted = await postPhase(composed.app, firstBody);
    expect(admitted.status).toBe(201);
    expect(sink.saves).toBe(2);
    const retry = await postPhase(composed.app, firstBody);
    expect(retry.status).toBe(201);
    expect((await json(retry))["action"]).toBe("resume_station");
    expect(sink.runs.get(EXAM_RUN_ID)?.admittedPhaseEvents).toHaveLength(1);
  });

  it.fails("returns the already-admitted last command when retried after exam_complete", async () => {
    const sink = countingSink();
    const composed = compose(sink);
    await startExam(composed.app);
    const station1 = stationScript(1, SCENARIO_A, [60, 960, 1260]);
    const station2 = stationScript(2, SCENARIO_B, [1320, 2220, 2520]);
    await admitAll(composed.app, [...station1, ...station2]);
    const last = station2[station2.length - 1];
    if (!last) {
      throw new Error("station 2 script missing station.advanced");
    }
    const savesAfterComplete = sink.saves;
    expect(sink.runs.get(EXAM_RUN_ID)?.admittedPhaseEvents).toHaveLength(10);
    const retry = await postPhase(composed.app, last);
    const body = await json(retry);
    expect(retry.status).toBe(201);
    expect(body["action"]).toBe("exam_complete");
    expect(body["error"]).toBeUndefined();
    expect(sink.runs.get(EXAM_RUN_ID)?.admittedPhaseEvents).toHaveLength(10);
    expect(sink.saves).toBe(savesAfterComplete);
  });

  it.fails("refuses a new append after exam_complete as finalized, not stale_identity", async () => {
    const sink = countingSink();
    const composed = compose(sink);
    await startExam(composed.app);
    await admitAll(composed.app, [
      ...stationScript(1, SCENARIO_A, [60, 960, 1260]),
      ...stationScript(2, SCENARIO_B, [1320, 2220, 2520]),
    ]);
    const stored = structuredClone(sink.runs.get(EXAM_RUN_ID));
    const append = await postPhase(composed.app, {
      stationRunId: stationRunId(1),
      sequence: 5,
      eventType: "encounter.started",
      scenarioId: SCENARIO_A,
      stationOrder: 1,
      atSecond: 2521,
      formAtSecond: 2521,
    });
    const body = await json(append);
    expect(append.status).toBe(409);
    expect(body["error"]).toBe("finalized");
    expect(body["reason"]).toBe("exam_run_already_final");
    expect(body["examEquivalenceGate"]).toBe(false);
    expect(sink.runs.get(EXAM_RUN_ID)).toEqual(stored);
  });

  it("still refuses a same-sequence retry whose payload is not an exact match", async () => {
    const sink = countingSink();
    const composed = compose(sink);
    await startExam(composed.app);
    const [firstBody] = stationScript(1, SCENARIO_A, [60, 960, 1260]);
    if (!firstBody) {
      throw new Error("station script missing encounter.started");
    }
    expect((await postPhase(composed.app, firstBody)).status).toBe(201);
    const mutated = await postPhase(composed.app, {
      ...firstBody,
      atSecond: 90,
      formAtSecond: 90,
    });
    const body = await json(mutated);
    expect(mutated.status).toBe(409);
    expect(body["error"]).toBe("stale_identity");
    expect(body["reason"]).toBe("sequence_mismatch");
  });
});
