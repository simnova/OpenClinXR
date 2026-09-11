/**
 * Diagnosis: faculty can finalize an assembled-exam disposition, but rest has no
 * explicit release to the learner. A learner GET of the disposition/review packet
 * would carry facultyScoreDraft, actorTurnReplays, causalChain, and faculty
 * comments. There is no immutable release identity, no completeness/policy gate,
 * and no supersession/withdrawal trail.
 *
 * Known-good: assembled-exam-disposition-routes.ts already gates POST/GET on
 * hasFacultyAccess and refuses stale packetDigest / overwrite / post-final edits.
 *
 * Counterweight: GET /feedback-release must be the learner projection even for
 * faculty — it must not be an alias for the evidence packet. A second POST
 * supersedes rather than mutating the prior releaseId. Withdrawal hides the
 * projection; it does not delete the trail.
 *
 * ## FIXED (#0)
 * registerAssembledExamDispositionRoutes mounts POST/GET
 * /exam-runs/:examRunId/feedback-release and POST
 * /exam-runs/:examRunId/feedback-release/withdraw. Release checks completeness
 * and policy blockers, returns an immutable releaseId, records supersession and
 * withdrawal on the disposition aggregate, and serves a projection that omits
 * hidden case truth, private actor state, prompts, and faculty annotations.
 */

import { createHash } from "node:crypto";
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
  registerAssembledExamDispositionRoutes,
  registerAssembledExamReviewRoutes,
} from "../index.js";

function packetDigest(packet: AssembledExamReviewPacket): string {
  return createHash("sha256").update(JSON.stringify(packet)).digest("hex");
}

const EXAM_RUN_ID = "exam_run_learner_phase_001_ed_chest_pain_priority_v1__peds_asthma_parent_anxiety_v1";
const ED_STATION_RUN_ID = "run_ed_001";
const PEDS_STATION_RUN_ID = "run_peds_001";
const PACKET_PATH = `/exam-runs/${EXAM_RUN_ID}/assembled-review-packet`;
const DISPOSITION_PATH = `/exam-runs/${EXAM_RUN_ID}/assembled-review-disposition`;
const RELEASE_PATH = `/exam-runs/${EXAM_RUN_ID}/feedback-release`;
const WITHDRAW_PATH = `/exam-runs/${EXAM_RUN_ID}/feedback-release/withdraw`;
const ATTESTED_AT = "2026-09-04T10:00:00.000Z";
const RELEASED_AT = "2026-09-11T12:00:00.000Z";
const REVIEWER_ID = "faculty_disposition_001";
const LEARNER_ID = "learner_phase_001";
const FACULTY_COMMENT = "Station review.";

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

function bindOwners(composed: ReturnType<typeof compose>, learnerId = LEARNER_ID): void {
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
  blockers?: readonly string[];
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
    blockers: [...(input.blockers ?? [])],
    advanceReason: input.advanceReason,
    facultyScoreDraft: {
      reviewerId: "faculty_001",
      status: "draft",
      comments: FACULTY_COMMENT,
    },
  };
}

function persistBody(blockers: readonly string[] = []): string {
  return JSON.stringify({
    examRunId: EXAM_RUN_ID,
    learnerId: LEARNER_ID,
    stations: [
      station({
        stationRunId: ED_STATION_RUN_ID,
        scenarioId: "ed_chest_pain_priority_v1",
        stationOrder: 1,
        advanceReason: "patient_note_submitted_advancing",
        blockers,
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

async function persistPacket(
  composed: ReturnType<typeof compose>,
  blockers: readonly string[] = [],
): Promise<AssembledExamReviewPacket> {
  bindOwners(composed);
  const created = await composed.app.request(PACKET_PATH, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: persistBody(blockers),
  });
  expect(created.status).toBe(201);
  return created.json() as Promise<AssembledExamReviewPacket>;
}

async function finalizeDisposition(
  composed: ReturnType<typeof compose>,
  digest: string,
  overrides: Record<string, unknown> = {},
): Promise<Response> {
  const draft = await composed.app.request(DISPOSITION_PATH, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      examRunId: EXAM_RUN_ID,
      reviewerId: REVIEWER_ID,
      packetDigest: digest,
      disposition: "hold",
      status: "draft",
      rationale: "Hold for faculty debrief; no score use.",
      attestedAt: ATTESTED_AT,
    }),
  });
  expect(draft.status).toBe(201);
  return composed.app.request(DISPOSITION_PATH, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      examRunId: EXAM_RUN_ID,
      reviewerId: REVIEWER_ID,
      packetDigest: digest,
      disposition: "local_debrief_ready",
      status: "final",
      rationale: "Final local debrief only.",
      attestedAt: "2026-09-04T11:00:00.000Z",
      ...overrides,
    }),
  });
}

function releaseBody(digest: string, overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    examRunId: EXAM_RUN_ID,
    packetDigest: digest,
    releasedBy: REVIEWER_ID,
    releasedAt: RELEASED_AT,
    ...overrides,
  });
}

const LEARNER_UNSAFE = [
  "facultyScoreDraft",
  "actorTurnReplays",
  "causalChain",
  "spokenTextForTts",
  "hiddenFacts",
  FACULTY_COMMENT,
  "Hold for faculty debrief",
];

describe("faculty feedback release is explicit, immutable, and learner-safe", () => {
  it("releases a finalized local_debrief_ready disposition with an immutable identity", async () => {
    const sinkDispositions: ApiAssembledExamDispositionRecord[] = [];
    const composed = compose({
      saveAssembledExamDisposition: (_examRunId, record) => {
        sinkDispositions.push(record);
      },
      getAssembledExamDisposition: (examRunId) =>
        sinkDispositions.filter((record) => record.examRunId === examRunId).at(-1),
    });
    const packet = await persistPacket(composed);
    const digest = packetDigest(packet);
    const finalized = await finalizeDisposition(composed, digest);
    expect(finalized.status).toBe(201);

    const released = await composed.app.request(RELEASE_PATH, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: releaseBody(digest),
    });
    expect(released.status).toBe(201);
    const receipt = await json(released);
    expect(receipt["releaseId"]).toEqual(expect.stringMatching(/^feedback_release:/));
    expect(receipt["status"]).toBe("active");
    expect(receipt["packetDigest"]).toBe(digest);
    expect(receipt["supersedesReleaseId"]).toBeNull();
    expect(receipt["scoringValidityClaimed"]).toBe(false);
    expect(receipt["examEquivalenceGate"]).toBe(false);
    expect(receipt["claimBoundary"]).toBe("assembled_exam_feedback_release_not_score_use");
    expect(JSON.stringify(receipt)).not.toContain("facultyScoreDraft");
    expect(JSON.stringify(receipt)).not.toContain(FACULTY_COMMENT);

    const firstId = receipt["releaseId"] as string;
    const replay = await composed.app.request(RELEASE_PATH, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: releaseBody(digest, { releaseId: firstId }),
    });
    expect(replay.status).toBe(409);
    expect(await json(replay)).toMatchObject({ error: "overwrite_refused" });
  });

  it("serves the learner a projection with no hidden case truth or faculty annotations", async () => {
    const composed = compose();
    const packet = await persistPacket(composed);
    const digest = packetDigest(packet);
    expect(JSON.stringify(packet)).toContain("facultyScoreDraft");
    expect(JSON.stringify(packet)).toContain(FACULTY_COMMENT);

    expect((await finalizeDisposition(composed, digest)).status).toBe(201);
    const released = await composed.app.request(RELEASE_PATH, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: releaseBody(digest),
    });
    expect(released.status).toBe(201);
    const receipt = await json(released);

    const learnerGet = await composed.app.request(RELEASE_PATH, {
      headers: authHeader({ subject: LEARNER_ID, role: "learner", learnerId: LEARNER_ID }),
    });
    expect(learnerGet.status).toBe(200);
    const projection = await json(learnerGet);
    expect(projection["releaseId"]).toBe(receipt["releaseId"]);
    expect(projection["learnerId"]).toBe(LEARNER_ID);
    expect(projection["disposition"]).toBe("local_debrief_ready");
    expect(projection["stations"]).toEqual([
      {
        stationOrder: 1,
        scenarioId: "ed_chest_pain_priority_v1",
        patientNoteSubmitted: true,
        patientNote: { submittedAtSecond: 1260, text: "Local debrief note." },
      },
      {
        stationOrder: 2,
        scenarioId: "peds_asthma_parent_anxiety_v1",
        patientNoteSubmitted: true,
        patientNote: { submittedAtSecond: 1260, text: "Local debrief note." },
      },
    ]);
    const serialized = JSON.stringify(projection);
    for (const token of LEARNER_UNSAFE) {
      expect(serialized).not.toContain(token);
    }

    const facultyGet = await composed.app.request(RELEASE_PATH);
    expect(facultyGet.status).toBe(200);
    expect(JSON.stringify(await json(facultyGet))).not.toContain("facultyScoreDraft");

    const stranger = await composed.app.request(RELEASE_PATH, {
      headers: authHeader({ subject: "other_learner", role: "learner", learnerId: "other_learner" }),
    });
    expect(stranger.status).toBe(403);
  });

  it("refuses incomplete packets and non-releasable dispositions", async () => {
    const blocked = compose();
    const blockedPacket = await persistPacket(blocked, ["missing_debrief_artifact"]);
    const blockedDigest = packetDigest(blockedPacket);
    expect((await finalizeDisposition(blocked, blockedDigest)).status).toBe(201);
    const incomplete = await blocked.app.request(RELEASE_PATH, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: releaseBody(blockedDigest),
    });
    expect(incomplete.status).toBe(409);
    expect(await json(incomplete)).toMatchObject({ error: "completeness_incomplete" });

    const holdOnly = compose();
    const holdPacket = await persistPacket(holdOnly);
    const holdDigest = packetDigest(holdPacket);
    const draft = await holdOnly.app.request(DISPOSITION_PATH, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        examRunId: EXAM_RUN_ID,
        reviewerId: REVIEWER_ID,
        packetDigest: holdDigest,
        disposition: "hold",
        status: "final",
        rationale: "Keep on hold.",
        attestedAt: ATTESTED_AT,
      }),
    });
    expect(draft.status).toBe(201);
    const policy = await holdOnly.app.request(RELEASE_PATH, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: releaseBody(holdDigest),
    });
    expect(policy.status).toBe(409);
    expect(await json(policy)).toMatchObject({ error: "policy_blocker", reason: "disposition_not_releasable" });

    const learnerPost = await holdOnly.app.request(RELEASE_PATH, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...authHeader({ subject: LEARNER_ID, role: "learner", learnerId: LEARNER_ID }),
      },
      body: releaseBody(holdDigest),
    });
    expect(learnerPost.status).toBe(403);
  });

  it("records supersession and withdrawal without mutating prior release identities", async () => {
    const composed = compose();
    const packet = await persistPacket(composed);
    const digest = packetDigest(packet);
    expect((await finalizeDisposition(composed, digest)).status).toBe(201);

    const first = await composed.app.request(RELEASE_PATH, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: releaseBody(digest),
    });
    expect(first.status).toBe(201);
    const firstId = (await json(first))["releaseId"] as string;

    const second = await composed.app.request(RELEASE_PATH, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: releaseBody(digest, { releasedAt: "2026-09-11T13:00:00.000Z" }),
    });
    expect(second.status).toBe(201);
    const secondReceipt = await json(second);
    expect(secondReceipt["releaseId"]).not.toBe(firstId);
    expect(secondReceipt["supersedesReleaseId"]).toBe(firstId);
    expect(secondReceipt["status"]).toBe("active");

    const learnerSeesSecond = await composed.app.request(RELEASE_PATH, {
      headers: authHeader({ subject: LEARNER_ID, role: "learner", learnerId: LEARNER_ID }),
    });
    expect(learnerSeesSecond.status).toBe(200);
    expect((await json(learnerSeesSecond))["releaseId"]).toBe(secondReceipt["releaseId"]);

    const withdrawn = await composed.app.request(WITHDRAW_PATH, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        releaseId: secondReceipt["releaseId"],
        withdrawnAt: "2026-09-11T14:00:00.000Z",
      }),
    });
    expect(withdrawn.status).toBe(200);
    expect(await json(withdrawn)).toMatchObject({
      releaseId: secondReceipt["releaseId"],
      status: "withdrawn",
    });

    const hidden = await composed.app.request(RELEASE_PATH, {
      headers: authHeader({ subject: LEARNER_ID, role: "learner", learnerId: LEARNER_ID }),
    });
    expect(hidden.status).toBe(404);
  });

  it("does not publish a release when durable save fails", async () => {
    let saves = 0;
    const composed = compose({
      saveAssembledExamDisposition: () => {
        saves += 1;
        if (saves > 2) {
          throw new Error("durable_unavailable");
        }
      },
    });
    const packet = await persistPacket(composed);
    const digest = packetDigest(packet);
    expect((await finalizeDisposition(composed, digest)).status).toBe(201);
    const failed = await composed.app.request(RELEASE_PATH, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: releaseBody(digest),
    });
    expect(failed.status).toBe(500);
    expect(await json(failed)).toMatchObject({ error: "durable_save_failed" });
    const missing = await composed.app.request(RELEASE_PATH, {
      headers: authHeader({ subject: LEARNER_ID, role: "learner", learnerId: LEARNER_ID }),
    });
    expect(missing.status).toBe(404);
  });
});
