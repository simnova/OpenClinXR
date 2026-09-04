import { describe, expect, it } from "vitest";
import {
  DEFAULT_DEV_AUTH_SECRET,
  signAuthToken,
} from "@openclinxr/auth";
import {
  ASSEMBLED_EXAM_PHASE_TRANSITION_TYPES,
  assembledExamReviewNotEvidenceFor,
  type AssembledExamReviewPacket,
  type AssembledExamReviewTraceInput,
  type AssembledExamStationEvidenceInput,
} from "@openclinxr/review-workflow";
import { ApiApplication } from "../api-application.js";
import type { ApiPersistenceSink } from "../api-types.js";
import {
  ASSEMBLED_EXAM_REVIEW_PACKET_PATH,
  registerAssembledExamReviewRoutes,
} from "./assembled-exam-review-routes.js";

const EXAM_RUN_ID = "exam_run_learner_phase_001_ed_chest_pain_priority_v1__peds_asthma_parent_anxiety_v1";
const ED_STATION_RUN_ID = "run_ed_001";
const PEDS_STATION_RUN_ID = "run_peds_001";
const PACKET_PATH = `/exam-runs/${EXAM_RUN_ID}/assembled-review-packet`;

const PLAN_ID = "plan_maya_wob_001";
const TURN_ID = "turn_maya_wob_001";

function compose(persistence: ApiPersistenceSink = {}) {
  return ApiApplication.create()
    .withContext(undefined, persistence)
    .withCoreMiddleware()
    .withRoutes(registerAssembledExamReviewRoutes)
    .build();
}

function bindOwners(
  composed: ReturnType<typeof compose>,
  learnerId = "learner_phase_001",
): void {
  composed.context.sessionOwners.set(ED_STATION_RUN_ID, learnerId);
  composed.context.sessionOwners.set(PEDS_STATION_RUN_ID, learnerId);
}

function authHeader(identity: { subject: string; role: "learner" | "faculty" | "admin"; learnerId?: string }): Record<string, string> {
  return {
    authorization: `Bearer ${signAuthToken({ identity, secret: DEFAULT_DEV_AUTH_SECRET })}`,
  };
}

function durableEventRef(stationRunId: string, sequence: number): string {
  return `durable://station-runs/${stationRunId}/events/${sequence}`;
}

function phaseTransition(input: {
  stationRunId: string;
  scenarioId: string;
  stationOrder: number;
  eventType: (typeof ASSEMBLED_EXAM_PHASE_TRANSITION_TYPES)[number];
  sequence: number;
  atSecond: number;
  formAtSecond: number;
  phase: "encounter" | "note" | "complete";
  examRunId?: string;
  advanceReason?: string;
}): AssembledExamReviewTraceInput {
  return {
    stationRunId: input.stationRunId,
    sequence: input.sequence,
    eventType: input.eventType,
    source: "system",
    atSecond: input.atSecond,
    payload: {
      scenarioId: input.scenarioId,
      examRunId: input.examRunId ?? EXAM_RUN_ID,
      stationOrder: input.stationOrder,
      phase: input.phase,
      formAtSecond: input.formAtSecond,
      durableEventRef: durableEventRef(input.stationRunId, input.sequence),
      ...(input.advanceReason ? { advanceReason: input.advanceReason } : {}),
    },
  };
}

function canonicalPhaseTransitions(input: {
  stationRunId: string;
  scenarioId: string;
  stationOrder: number;
  startSequence: number;
  advanceReason: string;
  examRunId?: string;
}): AssembledExamReviewTraceInput[] {
  const specs: Array<{
    eventType: (typeof ASSEMBLED_EXAM_PHASE_TRANSITION_TYPES)[number];
    atSecond: number;
    formAtSecond: number;
    phase: "encounter" | "note" | "complete";
    advanceReason?: string;
  }> = [
    { eventType: "encounter.started", atSecond: 60, formAtSecond: 60, phase: "encounter" },
    { eventType: "encounter.ended", atSecond: 900, formAtSecond: 900, phase: "encounter" },
    { eventType: "note.started", atSecond: 900, formAtSecond: 900, phase: "note" },
    { eventType: "note.submitted", atSecond: 1260, formAtSecond: 1260, phase: "note" },
    {
      eventType: "station.advanced",
      atSecond: 1260,
      formAtSecond: 1260,
      phase: "complete",
      advanceReason: input.advanceReason,
    },
  ];
  return specs.map((spec, index) =>
    phaseTransition({
      ...input,
      ...spec,
      sequence: input.startSequence + index,
    }),
  );
}

function edStation(): AssembledExamStationEvidenceInput {
  return {
    stationRunId: ED_STATION_RUN_ID,
    scenarioId: "ed_chest_pain_priority_v1",
    stationOrder: 1,
    requiredTraceTags: ["ecg_request", "patient_note_submitted"],
    timeCriticalTraceTagThresholds: { ecg_request: 300 },
    traceEvents: [
      {
        stationRunId: ED_STATION_RUN_ID,
        sequence: 0,
        eventType: "station.started",
        source: "system",
        atSecond: 0,
      },
      {
        stationRunId: ED_STATION_RUN_ID,
        sequence: 7,
        eventType: "learner.order",
        source: "learner",
        tag: "ecg_request",
        atSecond: 500,
      },
      {
        stationRunId: ED_STATION_RUN_ID,
        sequence: 9,
        eventType: "note.submitted",
        source: "learner",
        tag: "patient_note_submitted",
        atSecond: 1260,
      },
    ],
    phaseTransitions: canonicalPhaseTransitions({
      stationRunId: ED_STATION_RUN_ID,
      scenarioId: "ed_chest_pain_priority_v1",
      stationOrder: 1,
      startSequence: 10,
      advanceReason: "patient_note_submitted_advancing",
    }),
    patientNote: {
      stationRunId: ED_STATION_RUN_ID,
      submittedAtSecond: 1260,
      text: "Concern for ACS. ECG requested.",
    },
    blockers: ["awaiting_faculty_comment"],
    advanceReason: "patient_note_submitted_advancing",
    facultyScoreDraft: {
      reviewerId: "faculty_001",
      status: "draft",
      comments: "ED station review.",
    },
  };
}

function pedsStation(): AssembledExamStationEvidenceInput {
  return {
    stationRunId: PEDS_STATION_RUN_ID,
    scenarioId: "peds_asthma_parent_anxiety_v1",
    stationOrder: 2,
    requiredTraceTags: ["work_of_breathing_assessment"],
    traceEvents: [
      {
        stationRunId: PEDS_STATION_RUN_ID,
        sequence: 0,
        eventType: "station.started",
        source: "system",
        atSecond: 0,
      },
      {
        stationRunId: PEDS_STATION_RUN_ID,
        sequence: 4,
        eventType: "actor.turn.planned",
        source: "conversation-policy",
        actorId: "patient_maya_johnson_v1",
        tag: "work_of_breathing_assessment",
        atSecond: 20,
        payload: {
          actorTurnPlan: {
            planId: PLAN_ID,
            planVersion: 1,
            turnId: TURN_ID,
            stationRunId: PEDS_STATION_RUN_ID,
            actorId: "patient_maya_johnson_v1",
            respondingActorId: "patient_maya_johnson_v1",
            turnIndex: 0,
            spokenText: "It feels tight when I breathe.",
            spokenTextForTts: "<soft>It feels tight when I breathe. [breath]</soft>",
            dialogueEmotionFrom: "neutral",
            dialogueEmotionTo: "anxious",
            somaticEmotion: null,
            eventKind: "learner_clinical_question",
            eventKindSource: "classifier",
            intensityBucket: "mid",
            ageBand: "child",
            performancePlanId: "perf_anxious_child_mid",
            facePresetId: "face_anxious_child",
            posePresetId: "pose_upright_child",
            gestureClipIds: [],
            prosody: {
              wrapTags: ["<soft>"],
              inlineTags: ["[breath]"],
              speed: 0.95,
              droppedTags: ["[cry]"],
            },
            voiceId: "mock-maya-johnson",
            languageProvenance: { fallbackUsed: false, providerId: "mock-model" },
            claimScope: "simulated_actor_behavior",
            notEvidenceFor: ["clinical_affect_inference", "empathy_score", "licensure"],
          },
        },
      },
      {
        stationRunId: PEDS_STATION_RUN_ID,
        sequence: 5,
        eventType: "actor.turn.executed",
        source: "voice-gateway",
        actorId: "patient_maya_johnson_v1",
        tag: "work_of_breathing_assessment",
        atSecond: 22,
        payload: {
          actorTurnExecution: {
            planId: PLAN_ID,
            turnId: TURN_ID,
            interruption: { kind: "truncated" },
            renderedProsodyTags: ["<soft>"],
            droppedProsodyTags: ["[breath]"],
            fallback: { language: false, tts: false },
          },
        },
      },
      {
        stationRunId: PEDS_STATION_RUN_ID,
        sequence: 9,
        eventType: "note.submitted",
        source: "learner",
        tag: "patient_note_submitted",
        atSecond: 1260,
      },
    ],
    phaseTransitions: canonicalPhaseTransitions({
      stationRunId: PEDS_STATION_RUN_ID,
      scenarioId: "peds_asthma_parent_anxiety_v1",
      stationOrder: 2,
      startSequence: 10,
      advanceReason: "last_station_note_submitted_exam_complete",
    }),
    patientNote: {
      stationRunId: PEDS_STATION_RUN_ID,
      submittedAtSecond: 1260,
      text: "Work of breathing assessed. Parent anxiety noted.",
    },
    blockers: [],
    advanceReason: "last_station_note_submitted_exam_complete",
    facultyScoreDraft: {
      reviewerId: "faculty_001",
      status: "draft",
      comments: "Peds station review.",
    },
  };
}

function persistBody(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    examRunId: EXAM_RUN_ID,
    learnerId: "learner_phase_001",
    stations: [edStation(), pedsStation()],
    ...overrides,
  });
}

async function json(response: Response): Promise<Record<string, unknown>> {
  return response.json() as Promise<Record<string, unknown>>;
}

describe("assembled-exam review packet API", () => {
  it("exposes the faculty exam-run path constant used by the route", () => {
    expect(ASSEMBLED_EXAM_REVIEW_PACKET_PATH).toBe("/exam-runs/:examRunId/assembled-review-packet");
  });

  it("persists and retrieves one exam-run artifact without flattening station evidence", async () => {
    const sinkPackets = new Map<string, AssembledExamReviewPacket>();
    const composed = compose({
      saveAssembledExamReviewPacket: (examRunId, packet) => {
        sinkPackets.set(examRunId, packet);
      },
      getAssembledExamReviewPacket: (examRunId) => sinkPackets.get(examRunId),
    });
    bindOwners(composed);

    const created = await composed.app.request(PACKET_PATH, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: persistBody(),
    });
    expect(created.status).toBe(201);
    const createdBody = await json(created) as unknown as AssembledExamReviewPacket;
    expect(createdBody.examRunId).toBe(EXAM_RUN_ID);
    expect(createdBody.stations.map((station) => station.identity.stationOrder)).toEqual([1, 2]);
    expect(createdBody.stations.map((station) => station.identity.stationRunId)).toEqual([
      ED_STATION_RUN_ID,
      PEDS_STATION_RUN_ID,
    ]);
    expect(createdBody.stations[0]?.reviewPacket.patientNote?.text).toContain("ACS");
    expect(createdBody.stations[1]?.reviewPacket.patientNote?.text).toContain("Work of breathing");
    expect(createdBody.stations[0]?.advanceReason).toBe("patient_note_submitted_advancing");
    expect(createdBody.stations[0]?.phaseTransitions.map((event) => event.eventType)).toEqual([
      ...ASSEMBLED_EXAM_PHASE_TRANSITION_TYPES,
    ]);
    expect(createdBody.stations[0]?.phaseTransitions[0]?.durableEventRef).toBe(
      durableEventRef(ED_STATION_RUN_ID, 10),
    );
    expect(createdBody.stations[0]?.blockers).toEqual(["awaiting_faculty_comment"]);
    expect(createdBody.stations[1]?.reviewPacket.actorTurnReplays).toHaveLength(1);
    expect(createdBody.examTimeline.every((entry) => entry.examRunId === EXAM_RUN_ID)).toBe(true);
    expect(createdBody.examTimeline.some((entry) => entry.stationRunId === ED_STATION_RUN_ID)).toBe(true);
    expect(createdBody.examTimeline.some((entry) => entry.stationRunId === PEDS_STATION_RUN_ID)).toBe(true);
    expect(createdBody.notEvidenceFor).toEqual([...assembledExamReviewNotEvidenceFor]);
    expect(createdBody.examEquivalenceGate).toBe(false);
    expect(sinkPackets.get(EXAM_RUN_ID)?.stations).toHaveLength(2);

    composed.context.assembledExamReviewPackets.clear();

    const fetched = await composed.app.request(PACKET_PATH);
    expect(fetched.status).toBe(200);
    const fetchedBody = await json(fetched) as unknown as AssembledExamReviewPacket;
    expect(fetchedBody).toEqual(createdBody);
    expect(fetchedBody.stations).toHaveLength(2);
    expect(Array.isArray(fetchedBody.stations[0]?.reviewPacket)).toBe(false);
  });

  it("rejects learner callers and missing packets", async () => {
    const composed = compose();
    bindOwners(composed);
    const learner = await composed.app.request(PACKET_PATH, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...authHeader({ subject: "learner_phase_001", role: "learner", learnerId: "learner_phase_001" }),
      },
      body: persistBody(),
    });
    expect(learner.status).toBe(403);
    expect(await json(learner)).toMatchObject({ error: "forbidden", reason: "faculty_role_required" });

    const missing = await composed.app.request(PACKET_PATH);
    expect(missing.status).toBe(404);
  });

  it("compares updates against the stored artifact rather than caller-provided expectations", async () => {
    const composed = compose();
    bindOwners(composed);
    const persist = await composed.app.request(PACKET_PATH, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: persistBody(),
    });
    expect(persist.status).toBe(201);

    const callerExpectationMismatch = await composed.app.request(PACKET_PATH, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: persistBody({ expectedStationRunIds: [ED_STATION_RUN_ID, "run_stale_002"] }),
    });
    expect(callerExpectationMismatch.status).toBe(201);

    const staleExam = await composed.app.request(PACKET_PATH, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: persistBody({ examRunId: "exam_run_other" }),
    });
    expect(staleExam.status).toBe(409);
    expect(await json(staleExam)).toMatchObject({
      error: "stale_identity",
      reason: "exam_run_mismatch",
      notEvidenceFor: [...assembledExamReviewNotEvidenceFor],
    });

    const staleLearner = await composed.app.request(PACKET_PATH, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: persistBody({ learnerId: "learner_other" }),
    });
    expect(staleLearner.status).toBe(409);
    expect(await json(staleLearner)).toMatchObject({
      error: "stale_identity",
      reason: "learner_mismatch",
    });

    const staleStations = await composed.app.request(PACKET_PATH, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: persistBody({
        stations: [edStation(), { ...pedsStation(), stationRunId: "run_stale_002" }],
      }),
    });
    expect(staleStations.status).toBe(409);
    expect(await json(staleStations)).toMatchObject({
      error: "stale_identity",
      reason: "station_run_mismatch",
    });

    const staleGet = await composed.app.request(
      `${PACKET_PATH}?stationRunIds=${ED_STATION_RUN_ID},run_stale_002`,
    );
    expect(staleGet.status).toBe(409);
    expect(await json(staleGet)).toMatchObject({
      error: "stale_identity",
      reason: "station_run_mismatch",
    });
  });

  it("does not publish to memory when durable save fails", async () => {
    const composed = compose({
      saveAssembledExamReviewPacket: () => {
        throw new Error("durable_unavailable");
      },
    });
    bindOwners(composed);

    const response = await composed.app.request(PACKET_PATH, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: persistBody(),
    });
    expect(response.status).toBe(500);
    expect(await json(response)).toMatchObject({
      error: "durable_save_failed",
      reason: "durable_unavailable",
      notEvidenceFor: [...assembledExamReviewNotEvidenceFor],
    });
    expect(composed.context.assembledExamReviewPackets.size).toBe(0);
    expect(composed.context.examRunOwners.size).toBe(0);
  });

  it("rejects cross-run phase-transition evidence from the domain projection", async () => {
    const composed = compose();
    bindOwners(composed);
    const crossRunStation = {
      ...edStation(),
      phaseTransitions: canonicalPhaseTransitions({
        stationRunId: ED_STATION_RUN_ID,
        scenarioId: "ed_chest_pain_priority_v1",
        stationOrder: 1,
        startSequence: 10,
        advanceReason: "patient_note_submitted_advancing",
        examRunId: "exam_run_other",
      }),
    };
    const response = await composed.app.request(PACKET_PATH, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: persistBody({ stations: [crossRunStation, pedsStation()] }),
    });
    expect(response.status).toBe(400);
    expect(await json(response)).toMatchObject({
      error: "cross_run_identity",
      notEvidenceFor: [...assembledExamReviewNotEvidenceFor],
    });
    expect(composed.context.assembledExamReviewPackets.size).toBe(0);
  });
});
