import { describe, expect, it } from "vitest";
import { DEFAULT_DEV_AUTH_SECRET, signAuthToken } from "@openclinxr/auth";
import {
  ASSEMBLED_EXAM_PHASE_TRANSITION_TYPES,
  buildAssembledExamReviewPacket,
  type AssembledExamReviewPacket,
  type AssembledExamReviewTraceInput,
  type AssembledExamStationEvidenceInput,
} from "@openclinxr/review-workflow";
import { ApiApplication } from "../api-application.js";
import type { ApiPersistenceSink } from "../api-types.js";
import {
  assembledExamDispositionNotEvidenceFor,
  assembledExamPacketDigest,
  type ApiAssembledExamDispositionRecord,
} from "../runtime-durable-store.js";
import { registerAssembledExamReviewRoutes } from "./assembled-exam-review-routes.js";
import {
  ASSEMBLED_EXAM_DISPOSITION_PATH,
  registerAssembledExamDispositionRoutes,
} from "./assembled-exam-disposition-routes.js";

const EXAM_RUN_ID = "exam_run_learner_phase_001_ed_chest_pain_priority_v1__peds_asthma_parent_anxiety_v1";
const ED_STATION_RUN_ID = "run_ed_001";
const PEDS_STATION_RUN_ID = "run_peds_001";
const PACKET_PATH = `/exam-runs/${EXAM_RUN_ID}/assembled-review-packet`;
const DISPOSITION_PATH = `/exam-runs/${EXAM_RUN_ID}/assembled-review-disposition`;
const ATTESTED_AT = "2026-09-04T10:00:00.000Z";
const REVIEWER_ID = "faculty_disposition_001";

function compose(persistence: ApiPersistenceSink = {}) {
  return ApiApplication.create()
    .withContext(undefined, persistence)
    .withCoreMiddleware()
    .withRoutes((app, ctx) => {
      registerAssembledExamReviewRoutes(app, ctx);
      registerAssembledExamDispositionRoutes(app, ctx);
    })
    .build();
}

function bindOwners(composed: ReturnType<typeof compose>, learnerId = "learner_phase_001"): void {
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
      examRunId: EXAM_RUN_ID,
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

function station(input: {
  stationRunId: string;
  scenarioId: string;
  stationOrder: number;
  advanceReason: string;
}): AssembledExamStationEvidenceInput {
  return {
    stationRunId: input.stationRunId,
    scenarioId: input.scenarioId,
    stationOrder: input.stationOrder,
    requiredTraceTags: ["patient_note_submitted"],
    traceEvents: [
      {
        stationRunId: input.stationRunId,
        sequence: 0,
        eventType: "station.started",
        source: "system",
        atSecond: 0,
      },
      {
        stationRunId: input.stationRunId,
        sequence: 9,
        eventType: "note.submitted",
        source: "learner",
        tag: "patient_note_submitted",
        atSecond: 1260,
      },
    ],
    phaseTransitions: canonicalPhaseTransitions({
      stationRunId: input.stationRunId,
      scenarioId: input.scenarioId,
      stationOrder: input.stationOrder,
      startSequence: 10,
      advanceReason: input.advanceReason,
    }),
    patientNote: {
      stationRunId: input.stationRunId,
      submittedAtSecond: 1260,
      text: "Local debrief note.",
    },
    blockers: [],
    advanceReason: input.advanceReason,
    facultyScoreDraft: {
      reviewerId: "faculty_001",
      status: "draft",
      comments: "Station review.",
    },
  };
}

function persistBody(): string {
  return JSON.stringify({
    examRunId: EXAM_RUN_ID,
    learnerId: "learner_phase_001",
    stations: [
      station({
        stationRunId: ED_STATION_RUN_ID,
        scenarioId: "ed_chest_pain_priority_v1",
        stationOrder: 1,
        advanceReason: "patient_note_submitted_advancing",
      }),
      station({
        stationRunId: PEDS_STATION_RUN_ID,
        scenarioId: "peds_asthma_parent_anxiety_v1",
        stationOrder: 2,
        advanceReason: "last_station_note_submitted_exam_complete",
      }),
    ],
  });
}

async function json(response: Response): Promise<Record<string, unknown>> {
  return response.json() as Promise<Record<string, unknown>>;
}

async function persistPacket(composed: ReturnType<typeof compose>): Promise<AssembledExamReviewPacket> {
  bindOwners(composed);
  const created = await composed.app.request(PACKET_PATH, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: persistBody(),
  });
  expect(created.status).toBe(201);
  return created.json() as Promise<AssembledExamReviewPacket>;
}

function dispositionBody(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    examRunId: EXAM_RUN_ID,
    reviewerId: REVIEWER_ID,
    disposition: "hold",
    status: "draft",
    rationale: "Hold for faculty debrief; no score use.",
    attestedAt: ATTESTED_AT,
    ...overrides,
  });
}

describe("assembled-exam faculty disposition API", () => {
  it("exposes the faculty exam-run disposition path constant", () => {
    expect(ASSEMBLED_EXAM_DISPOSITION_PATH).toBe("/exam-runs/:examRunId/assembled-review-disposition");
  });

  it("appends a draft then final decision without mutating the evidence packet", async () => {
    const sinkPackets = new Map<string, AssembledExamReviewPacket>();
    const sinkDispositions: ApiAssembledExamDispositionRecord[] = [];
    const composed = compose({
      saveAssembledExamReviewPacket: (examRunId, packet) => {
        sinkPackets.set(examRunId, packet);
      },
      getAssembledExamReviewPacket: (examRunId) => sinkPackets.get(examRunId),
      saveAssembledExamDisposition: (examRunId, record) => {
        expect(examRunId).toBe(record.examRunId);
        sinkDispositions.push({
          ...record,
          decisions: [...record.decisions],
        });
      },
      getAssembledExamDisposition: (examRunId) =>
        sinkDispositions.filter((record) => record.examRunId === examRunId).at(-1),
    });
    const packet = await persistPacket(composed);
    const digest = assembledExamPacketDigest(packet);

    const draft = await composed.app.request(DISPOSITION_PATH, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: dispositionBody({ packetDigest: digest }),
    });
    expect(draft.status).toBe(201);
    const draftBody = await json(draft);
    expect(draftBody.evidencePacket).toEqual(packet);
    expect(draftBody.decisions).not.toBe(draftBody.evidencePacket);
    expect(draftBody.packetDigest).toBe(digest);
    expect(draftBody.current).toMatchObject({
      reviewerId: REVIEWER_ID,
      disposition: "hold",
      status: "draft",
      rationale: "Hold for faculty debrief; no score use.",
      attestedAt: ATTESTED_AT,
      sequence: 1,
    });
    expect(draftBody.scoringValidityClaimed).toBe(false);
    expect(draftBody.examEquivalenceGate).toBe(false);
    expect(draftBody.notEvidenceFor).toEqual([...assembledExamDispositionNotEvidenceFor]);

    const finalized = await composed.app.request(DISPOSITION_PATH, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: dispositionBody({
        packetDigest: digest,
        status: "final",
        disposition: "local_debrief_ready",
        rationale: "Final local debrief only.",
        attestedAt: "2026-09-04T11:00:00.000Z",
      }),
    });
    expect(finalized.status).toBe(201);
    const finalBody = await json(finalized);
    const decisions = finalBody.decisions as Array<Record<string, unknown>>;
    expect(decisions).toHaveLength(2);
    expect(decisions[0]).toMatchObject({ status: "draft", sequence: 1, rationale: "Hold for faculty debrief; no score use." });
    expect(decisions[1]).toMatchObject({ status: "final", sequence: 2, disposition: "local_debrief_ready" });
    expect(finalBody.evidencePacket).toEqual(packet);
    expect(sinkPackets.get(EXAM_RUN_ID)).toEqual(packet);

    composed.context.assembledExamDispositions.clear();
    composed.context.assembledExamReviewPackets.clear();
    const fetched = await composed.app.request(DISPOSITION_PATH);
    expect(fetched.status).toBe(200);
    const fetchedBody = await json(fetched);
    expect(fetchedBody.evidencePacket).toEqual(packet);
    expect((fetchedBody.decisions as unknown[]).length).toBe(2);
    expect(fetchedBody.current).toMatchObject({ status: "final" });
  });

  it("requires reviewer, digest, disposition, rationale, and timestamp", async () => {
    const composed = compose();
    const packet = await persistPacket(composed);
    const digest = assembledExamPacketDigest(packet);
    const missing = [
      { reviewerId: "" },
      { packetDigest: "" },
      { disposition: "" },
      { rationale: "" },
      { attestedAt: "" },
      { status: "published" },
    ];
    for (const override of missing) {
      const response = await composed.app.request(DISPOSITION_PATH, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: dispositionBody({ packetDigest: digest, ...override }),
      });
      expect(response.status).toBe(400);
      expect(await json(response)).toMatchObject({ error: "invalid_body" });
    }
  });

  it("rejects producer self-review, stale digests, identity mutation, overwrites, and edits after final", async () => {
    const composed = compose();
    const packet = await persistPacket(composed);
    const digest = assembledExamPacketDigest(packet);

    const learner = await composed.app.request(DISPOSITION_PATH, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...authHeader({ subject: "learner_phase_001", role: "learner", learnerId: "learner_phase_001" }),
      },
      body: dispositionBody({ packetDigest: digest, reviewerId: "faculty_other" }),
    });
    expect(learner.status).toBe(403);

    const selfLearner = await composed.app.request(DISPOSITION_PATH, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: dispositionBody({ packetDigest: digest, reviewerId: "learner_phase_001" }),
    });
    expect(selfLearner.status).toBe(409);
    expect(await json(selfLearner)).toMatchObject({ error: "producer_self_review" });

    const selfProducer = await composed.app.request(DISPOSITION_PATH, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: dispositionBody({ packetDigest: digest, reviewerId: "faculty_001" }),
    });
    expect(selfProducer.status).toBe(409);
    expect(await json(selfProducer)).toMatchObject({ error: "producer_self_review" });

    const stale = await composed.app.request(DISPOSITION_PATH, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: dispositionBody({ packetDigest: "not-the-digest" }),
    });
    expect(stale.status).toBe(409);
    expect(await json(stale)).toMatchObject({ error: "stale_packet_digest" });

    const first = await composed.app.request(DISPOSITION_PATH, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: dispositionBody({ packetDigest: digest }),
    });
    expect(first.status).toBe(201);
    const firstBody = await json(first);
    const firstId = (firstBody.current as { decisionId: string }).decisionId;

    const mutatedReviewer = await composed.app.request(DISPOSITION_PATH, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: dispositionBody({ packetDigest: digest, reviewerId: "faculty_disposition_002" }),
    });
    expect(mutatedReviewer.status).toBe(409);
    expect(await json(mutatedReviewer)).toMatchObject({ error: "identity_mutation" });

    const overwrite = await composed.app.request(DISPOSITION_PATH, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: dispositionBody({ packetDigest: digest, decisionId: firstId }),
    });
    expect(overwrite.status).toBe(409);
    expect(await json(overwrite)).toMatchObject({ error: "overwrite_refused" });

    const evidenceOverwrite = await composed.app.request(DISPOSITION_PATH, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: dispositionBody({ packetDigest: digest, evidencePacket: { examRunId: "mutated" } }),
    });
    expect(evidenceOverwrite.status).toBe(409);
    expect(await json(evidenceOverwrite)).toMatchObject({ error: "overwrite_refused" });

    const finalize = await composed.app.request(DISPOSITION_PATH, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: dispositionBody({ packetDigest: digest, status: "final" }),
    });
    expect(finalize.status).toBe(201);

    const afterFinal = await composed.app.request(DISPOSITION_PATH, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: dispositionBody({ packetDigest: digest, status: "draft", rationale: "try again" }),
    });
    expect(afterFinal.status).toBe(409);
    expect(await json(afterFinal)).toMatchObject({ error: "finalized" });

    expect(composed.context.assembledExamReviewPackets.get(EXAM_RUN_ID)).toEqual(packet);
  });

  it("does not publish a disposition when durable save fails", async () => {
    const composed = compose({
      saveAssembledExamDisposition: () => {
        throw new Error("durable_unavailable");
      },
    });
    const packet = await persistPacket(composed);
    const digest = assembledExamPacketDigest(packet);
    const response = await composed.app.request(DISPOSITION_PATH, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: dispositionBody({ packetDigest: digest }),
    });
    expect(response.status).toBe(500);
    expect(await json(response)).toMatchObject({
      error: "durable_save_failed",
      reason: "durable_unavailable",
    });
    expect(composed.context.assembledExamDispositions.size).toBe(0);
  });

  it("returns 404 when the assembled evidence packet is missing", async () => {
    const composed = compose();
    const missing = await composed.app.request(DISPOSITION_PATH);
    expect(missing.status).toBe(404);
  });
});

describe("assembledExamPacketDigest", () => {
  it("is stable for an unchanged assembled evidence packet", () => {
    const packet = buildAssembledExamReviewPacket({
      examRunId: EXAM_RUN_ID,
      learnerId: "learner_phase_001",
      stations: [
        station({
          stationRunId: ED_STATION_RUN_ID,
          scenarioId: "ed_chest_pain_priority_v1",
          stationOrder: 1,
          advanceReason: "patient_note_submitted_advancing",
        }),
      ],
    });
    expect(assembledExamPacketDigest(packet)).toBe(assembledExamPacketDigest(packet));
    expect(assembledExamPacketDigest(packet)).toMatch(/^[a-f0-9]{64}$/);
  });
});
