/**
 * Diagnosis: faculty disposition append/read lives on REST
 * `/exam-runs/:examRunId/assembled-review-disposition`, but `/admin/graphql`
 * does not execute `assembledExamFacultyDisposition` /
 * `appendAssembledExamFacultyDisposition` against that durable store.
 * Typed refusal codes therefore cannot survive GraphQL transport.
 *
 * Known-good: The REST append/read semantics and their refusal codes already
 * pass their own tests.
 *
 * Counterweight: GraphQL append must not mutate the assembled evidence packet
 * and must not accept a learner caller.
 *
 * ## FIXED (#0)
 * createAdminGraphqlRoot runs the same faculty-disposition-service read/append
 * path the REST route uses. Faculty-only GraphQL operations gate the execute
 * route. GraphQL union projection maps REST error codes to typed refusals.
 *
 * NOT TESTED: a production identity provider; a deployed Mongo service.
 */

import { DEFAULT_DEV_AUTH_SECRET, signAuthToken } from "@openclinxr/auth";
import type {
  ASSEMBLED_EXAM_PHASE_TRANSITION_TYPES,
  AssembledExamReviewPacket,
  AssembledExamReviewTraceInput,
  AssembledExamStationEvidenceInput,
} from "@openclinxr/review-workflow";
import { describe, expect, it } from "vitest";
import {
  ApiApplication,
  type ApiAssembledExamDispositionRecord,
  type ApiPersistenceSink,
  registerAdminGraphqlRoutes,
  registerAssembledExamDispositionRoutes,
  registerAssembledExamReviewRoutes,
  routeById,
} from "./index.js";

const EXAM_RUN_ID = "exam_run_learner_phase_001_ed_chest_pain_priority_v1__peds_asthma_parent_anxiety_v1";
const ED_STATION_RUN_ID = "run_ed_001";
const PEDS_STATION_RUN_ID = "run_peds_001";
const PACKET_PATH = `/exam-runs/${EXAM_RUN_ID}/assembled-review-packet`;
const DISPOSITION_PATH = `/exam-runs/${EXAM_RUN_ID}/assembled-review-disposition`;
const GRAPHQL_PATH = routeById("admin-graphql-execute").path;
const ATTESTED_AT = "2026-09-04T10:00:00.000Z";
const REVIEWER_ID = "faculty_disposition_001";
const LEARNER_ID = "learner_phase_001";
const PRODUCER_FACULTY_ID = "faculty_001";

const FACULTY_DISPOSITION_DOCUMENT = `
fragment FacultyDispositionTrailFields on FacultyDispositionTrail {
  examRunId
  packetDigest
  evidencePacket {
    examRunId
    packetDigest
    learnerId
    stationRunIds
    claimBoundary
    notEvidenceFor
    examEquivalenceGate
  }
  decisions {
    decisionId
    examRunId
    reviewerId
    packetDigest
    disposition
    status
    rationale
    attestedAt
    sequence
  }
  current {
    decisionId
    examRunId
    reviewerId
    packetDigest
    disposition
    status
    rationale
    attestedAt
    sequence
  }
  claimBoundary
  notEvidenceFor
  scoringValidityClaimed
  examEquivalenceGate
}
fragment FacultyDispositionRefusalFields on FacultyDispositionRefusal {
  code
  reason
  notEvidenceFor
  scoringValidityClaimed
  examEquivalenceGate
}
query AssembledExamFacultyDisposition($examRunId: ID!) {
  assembledExamFacultyDisposition(examRunId: $examRunId) {
    ...FacultyDispositionTrailFields
  }
}
mutation AppendAssembledExamFacultyDisposition($input: AppendFacultyDispositionInput!) {
  appendAssembledExamFacultyDisposition(input: $input) {
    __typename
    ...FacultyDispositionTrailFields
    ...FacultyDispositionRefusalFields
  }
}
`;

function compose(persistence: ApiPersistenceSink = {}) {
  return ApiApplication.create()
    .withContext(undefined, persistence)
    .withCoreMiddleware()
    .withRoutes((app, ctx) => {
      registerAssembledExamReviewRoutes(app, ctx);
      registerAssembledExamDispositionRoutes(app, ctx);
      registerAdminGraphqlRoutes(app, ctx);
    })
    .build();
}

function durableSink(): {
  persistence: ApiPersistenceSink;
  packets: Map<string, AssembledExamReviewPacket>;
  dispositions: ApiAssembledExamDispositionRecord[];
} {
  const packets = new Map<string, AssembledExamReviewPacket>();
  const dispositions: ApiAssembledExamDispositionRecord[] = [];
  return {
    packets,
    dispositions,
    persistence: {
      saveAssembledExamReviewPacket: (examRunId, incomingPacket) => {
        packets.set(examRunId, incomingPacket);
      },
      getAssembledExamReviewPacket: (examRunId) => packets.get(examRunId),
      saveAssembledExamDisposition: (examRunId, record) => {
        expect(examRunId).toBe(record.examRunId);
        dispositions.push({
          ...record,
          decisions: [...record.decisions],
        });
      },
      getAssembledExamDisposition: (examRunId) =>
        dispositions.filter((record) => record.examRunId === examRunId).at(-1),
    },
  };
}

function bindOwners(composed: ReturnType<typeof compose>, learnerId = LEARNER_ID): void {
  composed.context.sessionOwners.set(ED_STATION_RUN_ID, learnerId);
  composed.context.sessionOwners.set(PEDS_STATION_RUN_ID, learnerId);
}

function authHeader(identity: { subject: string; role: "learner" | "faculty" | "admin"; learnerId?: string }): Record<string, string> {
  return {
    authorization: `Bearer ${signAuthToken({ identity, secret: DEFAULT_DEV_AUTH_SECRET })}`,
  };
}

function facultyHeaders(): Record<string, string> {
  return {
    "content-type": "application/json",
    ...authHeader({ subject: REVIEWER_ID, role: "faculty" }),
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
      reviewerId: PRODUCER_FACULTY_ID,
      status: "draft",
      comments: "Station review.",
    },
  };
}

function persistBody(): string {
  return JSON.stringify({
    examRunId: EXAM_RUN_ID,
    learnerId: LEARNER_ID,
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
    headers: facultyHeaders(),
    body: persistBody(),
  });
  expect(created.status).toBe(201);
  return created.json() as Promise<AssembledExamReviewPacket>;
}

async function packetDigest(composed: ReturnType<typeof compose>): Promise<string> {
  const listed = await composed.app.request(DISPOSITION_PATH, { headers: facultyHeaders() });
  expect(listed.status).toBe(200);
  const body = await json(listed);
  return String(body["packetDigest"]);
}

function appendInput(digest: string, overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    examRunId: EXAM_RUN_ID,
    reviewerId: REVIEWER_ID,
    packetDigest: digest,
    disposition: "hold",
    status: "draft",
    rationale: "Hold for faculty debrief; no score use.",
    attestedAt: ATTESTED_AT,
    ...overrides,
  };
}

async function graphql(
  composed: ReturnType<typeof compose>,
  input: {
    operationName: string;
    variables: Record<string, unknown>;
    headers?: Record<string, string>;
  },
): Promise<Record<string, unknown>> {
  const response = await composed.app.request(GRAPHQL_PATH, {
    method: "POST",
    headers: input.headers ?? facultyHeaders(),
    body: JSON.stringify({
      query: FACULTY_DISPOSITION_DOCUMENT,
      operationName: input.operationName,
      variables: input.variables,
    }),
  });
  return {
    status: response.status,
    body: await json(response),
  };
}

function appendResult(payload: Record<string, unknown>): Record<string, unknown> {
  const body = payload["body"] as Record<string, unknown>;
  const data = body["data"] as Record<string, unknown> | undefined;
  return (data?.["appendAssembledExamFacultyDisposition"] ?? {}) as Record<string, unknown>;
}

describe("the admin GraphQL root executes faculty dispositions against the durable store", () => {
  it("appends then lists ordered decisions on the same durable path REST uses, without mutating evidence", async () => {
    const sink = durableSink();
    const composed = compose(sink.persistence);
    const packet = await persistPacket(composed);
    const digest = await packetDigest(composed);

    const draft = await graphql(composed, {
      operationName: "AppendAssembledExamFacultyDisposition",
      variables: { input: appendInput(digest) },
    });
    expect(draft["status"]).toBe(200);
    const draftTrail = appendResult(draft);
    expect(draftTrail["__typename"]).toBe("FacultyDispositionTrail");
    expect(draftTrail["packetDigest"]).toBe(digest);
    expect(draftTrail["evidencePacket"]).toMatchObject({
      examRunId: EXAM_RUN_ID,
      packetDigest: digest,
      learnerId: LEARNER_ID,
      stationRunIds: [ED_STATION_RUN_ID, PEDS_STATION_RUN_ID],
      examEquivalenceGate: false,
    });
    expect(draftTrail["current"]).toMatchObject({
      reviewerId: REVIEWER_ID,
      disposition: "hold",
      status: "draft",
      sequence: 1,
    });
    expect(draftTrail["scoringValidityClaimed"]).toBe(false);
    expect(JSON.stringify(draftTrail)).not.toContain("hiddenFacts");
    const evidenceSnapshot = structuredClone(draftTrail["evidencePacket"]);

    const finalized = await graphql(composed, {
      operationName: "AppendAssembledExamFacultyDisposition",
      variables: {
        input: appendInput(digest, {
          status: "final",
          disposition: "local_debrief_ready",
          rationale: "Final local debrief only.",
          attestedAt: "2026-09-04T11:00:00.000Z",
        }),
      },
    });
    const finalTrail = appendResult(finalized);
    expect(finalTrail["__typename"]).toBe("FacultyDispositionTrail");
    expect(finalTrail["decisions"]).toHaveLength(2);
    expect((finalTrail["decisions"] as Array<Record<string, unknown>>)[0]).toMatchObject({
      status: "draft",
      sequence: 1,
    });
    expect((finalTrail["decisions"] as Array<Record<string, unknown>>)[1]).toMatchObject({
      status: "final",
      sequence: 2,
      disposition: "local_debrief_ready",
    });
    expect(finalTrail["evidencePacket"]).toEqual(evidenceSnapshot);

    composed.context.assembledExamDispositions.clear();
    composed.context.assembledExamReviewPackets.clear();

    const queried = await graphql(composed, {
      operationName: "AssembledExamFacultyDisposition",
      variables: { examRunId: EXAM_RUN_ID },
    });
    const queriedBody = queried["body"] as Record<string, unknown>;
    const readTrail = (queriedBody["data"] as Record<string, unknown>)["assembledExamFacultyDisposition"] as Record<string, unknown>;
    expect(readTrail["decisions"]).toHaveLength(2);
    expect(readTrail["current"]).toMatchObject({ status: "final" });
    expect(readTrail["evidencePacket"]).toEqual(evidenceSnapshot);

    const rest = await composed.app.request(DISPOSITION_PATH, { headers: facultyHeaders() });
    expect(rest.status).toBe(200);
    const restBody = await json(rest);
    expect(restBody["evidencePacket"]).toEqual(packet);
    expect((restBody["decisions"] as unknown[]).length).toBe(2);
    expect(restBody["current"]).toMatchObject({ status: "final" });
    expect(sink.packets.get(EXAM_RUN_ID)).toEqual(packet);
  });

  it("returns typed GraphQL refusals for producer self-review, stale digest, identity mutation, overwrite, and post-finalization", async () => {
    const sink = durableSink();
    const composed = compose(sink.persistence);
    await persistPacket(composed);
    const digest = await packetDigest(composed);

    const learnerCaller = await graphql(composed, {
      operationName: "AppendAssembledExamFacultyDisposition",
      variables: { input: appendInput(digest) },
      headers: {
        "content-type": "application/json",
        ...authHeader({ subject: LEARNER_ID, role: "learner", learnerId: LEARNER_ID }),
      },
    });
    expect(learnerCaller["status"]).toBe(403);
    expect(learnerCaller["body"]).toMatchObject({ error: "forbidden", reason: "faculty_role_required" });

    const producer = appendResult(await graphql(composed, {
      operationName: "AppendAssembledExamFacultyDisposition",
      variables: { input: appendInput(digest, { reviewerId: LEARNER_ID }) },
    }));
    expect(producer).toMatchObject({
      __typename: "FacultyDispositionProducerSelfReview",
      code: "producer_self_review",
      scoringValidityClaimed: false,
      examEquivalenceGate: false,
    });

    const producerFaculty = appendResult(await graphql(composed, {
      operationName: "AppendAssembledExamFacultyDisposition",
      variables: { input: appendInput(digest, { reviewerId: PRODUCER_FACULTY_ID }) },
    }));
    expect(producerFaculty["__typename"]).toBe("FacultyDispositionProducerSelfReview");

    const stale = appendResult(await graphql(composed, {
      operationName: "AppendAssembledExamFacultyDisposition",
      variables: { input: appendInput("not-the-digest") },
    }));
    expect(stale).toMatchObject({
      __typename: "FacultyDispositionStaleDigest",
      code: "stale_packet_digest",
    });

    const first = appendResult(await graphql(composed, {
      operationName: "AppendAssembledExamFacultyDisposition",
      variables: { input: appendInput(digest) },
    }));
    expect(first["__typename"]).toBe("FacultyDispositionTrail");
    const firstId = (first["current"] as { decisionId: string }).decisionId;

    const mutatedReviewer = appendResult(await graphql(composed, {
      operationName: "AppendAssembledExamFacultyDisposition",
      variables: { input: appendInput(digest, { reviewerId: "faculty_disposition_002" }) },
    }));
    expect(mutatedReviewer).toMatchObject({
      __typename: "FacultyDispositionIdentityMutation",
      code: "identity_mutation",
    });

    const overwriteId = appendResult(await graphql(composed, {
      operationName: "AppendAssembledExamFacultyDisposition",
      variables: { input: appendInput(digest, { decisionId: firstId }) },
    }));
    expect(overwriteId).toMatchObject({
      __typename: "FacultyDispositionOverwriteRefused",
      code: "overwrite_refused",
    });

    const overwriteEvidence = appendResult(await graphql(composed, {
      operationName: "AppendAssembledExamFacultyDisposition",
      variables: { input: appendInput(digest, { evidencePacket: { examRunId: "mutated" } }) },
    }));
    expect(overwriteEvidence["__typename"]).toBe("FacultyDispositionOverwriteRefused");

    const finalize = appendResult(await graphql(composed, {
      operationName: "AppendAssembledExamFacultyDisposition",
      variables: {
        input: appendInput(digest, {
          status: "final",
          disposition: "local_debrief_ready",
          rationale: "Close the trail.",
        }),
      },
    }));
    expect(finalize["current"]).toMatchObject({ status: "final" });

    const afterFinal = appendResult(await graphql(composed, {
      operationName: "AppendAssembledExamFacultyDisposition",
      variables: { input: appendInput(digest, { status: "draft", rationale: "try again" }) },
    }));
    expect(afterFinal).toMatchObject({
      __typename: "FacultyDispositionPostFinalization",
      code: "finalized",
      scoringValidityClaimed: false,
      examEquivalenceGate: false,
    });

    const reread = await graphql(composed, {
      operationName: "AssembledExamFacultyDisposition",
      variables: { examRunId: EXAM_RUN_ID },
    });
    const remaining = ((reread["body"] as Record<string, unknown>)["data"] as Record<string, unknown>)[
      "assembledExamFacultyDisposition"
    ] as { decisions: unknown[]; evidencePacket: { examRunId: string } };
    expect(remaining.decisions).toHaveLength(2);
    expect(remaining.evidencePacket.examRunId).toBe(EXAM_RUN_ID);
  });
});
