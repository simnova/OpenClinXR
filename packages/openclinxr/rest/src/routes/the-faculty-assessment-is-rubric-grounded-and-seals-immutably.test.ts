/**
 * Diagnosis: faculty can persist a station-level FacultyScoreDraft and an
 * assembled-exam disposition, but rest has no criterion-level assessment
 * against the stored review packet. Observations need not cite a rubric item
 * or packet evidence, draft-to-final has no rater identity/timestamps, and
 * nothing seals as an immutable assessment packet.
 *
 * Known-good: The disposition record already carries an append-only release
 * trail and a packet digest.
 *
 * Counterweight: POST /faculty-assessment must refuse observations that omit a
 * rubric item or packet evidence cite, refuse cites that do not resolve in the
 * stored packet, and refuse mutation of a sealed final. GET is not an alias
 * for the evidence packet or the disposition trail.
 *
 * ## FIXED (#0)
 * registerAssembledExamDispositionRoutes mounts POST/GET
 * /exam-runs/:examRunId/faculty-assessment. Draft observations must cite a
 * scenario-bank rubric item and packet evidence; final adds rater identity
 * and timestamps and seals the assessment immutably on the disposition
 * aggregate.
 *
 * ## FIXED (#1)
 * Each observation carries a closed-set rating (not_observed / not_met /
 * partially_met / met). Ungrounded rubricId or evidence id is 422 and names
 * the offender; 409 stays for state conflicts. Finalize and seal are separate
 * POSTs; seal returns a content+digest sha256 id and is idempotent.
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
const ASSESSMENT_PATH = `/exam-runs/${EXAM_RUN_ID}/faculty-assessment`;
const SEAL_PATH = `${ASSESSMENT_PATH}/seal`;
const UNKNOWN_EXAM_PATH = "/exam-runs/exam_run_does_not_exist/faculty-assessment";
const DRAFT_AT = "2026-09-11T15:00:00.000Z";
const FINAL_AT = "2026-09-11T16:00:00.000Z";
const SEAL_AT = "2026-09-11T17:00:00.000Z";
const RATER_ID = "faculty_disposition_001";
const LEARNER_ID = "learner_phase_001";
const NARRATIVE = "Local formative documentation observation only.";

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
    headers: { "content-type": "application/json" },
    body: persistBody(),
  });
  expect(created.status).toBe(201);
  return created.json() as Promise<AssembledExamReviewPacket>;
}

function documentationCite(packet: AssembledExamReviewPacket): Record<string, unknown> {
  const slice = packet.stations[0];
  const entry = slice?.reviewPacket.timeline.find((item) => item.tag === "patient_note_submitted");
  expect(entry).toBeDefined();
  return {
    packetField: "stations[0].reviewPacket.timeline",
    stationRunId: ED_STATION_RUN_ID,
    sequence: entry?.sequence,
    tag: "patient_note_submitted",
    eventType: entry?.eventType,
  };
}

function documentationObservation(packet: AssembledExamReviewPacket, overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    rubricItemId: "documentation",
    stationRunId: ED_STATION_RUN_ID,
    rating: "met",
    comment: "Patient note submitted; documentation criterion observed.",
    evidenceCites: [documentationCite(packet)],
    ...overrides,
  };
}

function assessmentBody(
  packet: AssembledExamReviewPacket,
  overrides: Record<string, unknown> = {},
): string {
  return JSON.stringify({
    examRunId: EXAM_RUN_ID,
    raterId: RATER_ID,
    packetDigest: packetDigest(packet),
    status: "draft",
    narrativeFeedback: "",
    attestedAt: DRAFT_AT,
    observations: [documentationObservation(packet)],
    ...overrides,
  });
}

describe("faculty assessment is rubric-grounded and seals immutably", () => {
  it("records criterion observations, moves draft to final, and seals the packet", async () => {
    const sinkDispositions: ApiAssembledExamDispositionRecord[] = [];
    const composed = compose({
      saveAssembledExamDisposition: (_examRunId, record) => {
        sinkDispositions.push(record);
      },
      getAssembledExamDisposition: (examRunId) =>
        sinkDispositions.filter((record) => record.examRunId === examRunId).at(-1),
    });
    const packet = await persistPacket(composed);

    const draft = await composed.app.request(ASSESSMENT_PATH, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: assessmentBody(packet),
    });
    expect(draft.status).toBe(201);
    const draftBody = await json(draft);
    const currentDraft = draftBody["current"] as Record<string, unknown>;
    expect(currentDraft["status"]).toBe("draft");
    expect(currentDraft["raterId"]).toBe(RATER_ID);
    expect(currentDraft["createdAt"]).toBe(DRAFT_AT);
    expect(currentDraft["updatedAt"]).toBe(DRAFT_AT);
    expect(currentDraft["finalizedAt"]).toBeNull();
    expect(currentDraft["sealedAt"]).toBeNull();
    expect(currentDraft["scoringValidityClaimed"]).toBe(false);
    expect(currentDraft["examEquivalenceGate"]).toBe(false);
    expect(currentDraft["claimBoundary"]).toBe("assembled_exam_faculty_assessment_not_score_use");
    const observations = currentDraft["observations"] as Array<Record<string, unknown>>;
    expect(observations).toHaveLength(1);
    expect(observations[0]).toMatchObject({
      rubricItemId: "documentation",
      stationRunId: ED_STATION_RUN_ID,
      rating: "met",
    });
    const cites = observations[0]?.["evidenceCites"] as Array<Record<string, unknown>>;
    expect(cites[0]).toMatchObject({
      tag: "patient_note_submitted",
      stationRunId: ED_STATION_RUN_ID,
    });
    expect(JSON.stringify(draftBody)).not.toContain("Local debrief note.");

    const sealDraft = await composed.app.request(SEAL_PATH, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ packetDigest: packetDigest(packet), attestedAt: SEAL_AT, raterId: RATER_ID }),
    });
    expect(sealDraft.status).toBe(409);

    const finalized = await composed.app.request(ASSESSMENT_PATH, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: assessmentBody(packet, {
        status: "final",
        narrativeFeedback: NARRATIVE,
        attestedAt: FINAL_AT,
        assessmentId: currentDraft["assessmentId"],
      }),
    });
    expect(finalized.status).toBe(200);
    const finalBody = await json(finalized);
    const currentFinal = finalBody["current"] as Record<string, unknown>;
    expect(currentFinal["assessmentId"]).toBe(currentDraft["assessmentId"]);
    expect(currentFinal["status"]).toBe("final");
    expect(currentFinal["raterId"]).toBe(RATER_ID);
    expect(currentFinal["createdAt"]).toBe(DRAFT_AT);
    expect(currentFinal["updatedAt"]).toBe(FINAL_AT);
    expect(currentFinal["finalizedAt"]).toBe(FINAL_AT);
    expect(currentFinal["sealedAt"]).toBeNull();
    expect(currentFinal["sealedAssessmentId"]).toBeNull();
    expect(currentFinal["narrativeFeedback"]).toBe(NARRATIVE);
    expect(currentFinal["packetDigest"]).toBe(packetDigest(packet));
    const transitions = currentFinal["transitions"] as Array<Record<string, unknown>>;
    expect(transitions).toEqual(expect.arrayContaining([
      expect.objectContaining({ status: "final", raterId: RATER_ID, at: FINAL_AT }),
    ]));

    const sealedResponse = await composed.app.request(SEAL_PATH, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ packetDigest: packetDigest(packet), attestedAt: SEAL_AT, raterId: RATER_ID }),
    });
    expect(sealedResponse.status).toBe(200);
    const sealed = (await json(sealedResponse))["current"] as Record<string, unknown>;
    expect(typeof sealed["sealedAssessmentId"]).toBe("string");
    expect(String(sealed["sealedAssessmentId"]).length).toBe(64);
    expect(sealed["sealedAt"]).toBe(SEAL_AT);
    expect(sealed["claimBoundary"]).toBe("assembled_exam_faculty_assessment_not_score_use");
    expect(sealed["notEvidenceFor"]).toEqual(expect.arrayContaining(["scoring_validity", "exam_equivalence"]));
    expect(sealed["scoringValidityClaimed"]).toBe(false);

    const sealedAgain = await composed.app.request(SEAL_PATH, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ packetDigest: packetDigest(packet), attestedAt: SEAL_AT, raterId: RATER_ID }),
    });
    expect(sealedAgain.status).toBe(200);
    expect(((await json(sealedAgain))["current"] as Record<string, unknown>)["sealedAssessmentId"])
      .toBe(sealed["sealedAssessmentId"]);

    const fetched = await composed.app.request(ASSESSMENT_PATH);
    expect(fetched.status).toBe(200);
    const fetchedBody = await json(fetched);
    expect(fetchedBody["current"]).toEqual(sealed);
    expect(sinkDispositions.at(-1)?.facultyAssessments?.[0]?.status).toBe("final");
    expect(sinkDispositions.at(-1)?.facultyAssessments?.[0]?.sealedAssessmentId).toBe(sealed["sealedAssessmentId"]);
  });

  it("refuses ungrounded rubric items, missing evidence, and cites absent from the packet", async () => {
    const composed = compose();
    const packet = await persistPacket(composed);

    const unknownRubric = await composed.app.request(ASSESSMENT_PATH, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: assessmentBody(packet, {
        observations: [documentationObservation(packet, { rubricItemId: "not_a_rubric_item" })],
      }),
    });
    expect(unknownRubric.status).toBe(422);
    expect(await json(unknownRubric)).toMatchObject({
      error: "rubric_ungrounded",
      rubricId: "not_a_rubric_item",
    });

    const missingEvidence = await composed.app.request(ASSESSMENT_PATH, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: assessmentBody(packet, {
        observations: [documentationObservation(packet, { evidenceCites: [] })],
      }),
    });
    expect(missingEvidence.status).toBe(409);
    expect(await json(missingEvidence)).toMatchObject({ error: "observation_missing_evidence" });

    const absentCite = await composed.app.request(ASSESSMENT_PATH, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: assessmentBody(packet, {
        observations: [documentationObservation(packet, {
          evidenceCites: [{
            packetField: "stations[0].reviewPacket.timeline",
            stationRunId: ED_STATION_RUN_ID,
            sequence: 999,
            tag: "patient_note_submitted",
          }],
        })],
      }),
    });
    expect(absentCite.status).toBe(422);
    expect(await json(absentCite)).toMatchObject({
      error: "evidence_not_in_packet",
      evidenceId: "999",
    });

    const missing = await composed.app.request(ASSESSMENT_PATH);
    expect(missing.status).toBe(404);

    const invalidRating = await composed.app.request(ASSESSMENT_PATH, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: assessmentBody(packet, {
        observations: [documentationObservation(packet, { rating: "excellent" })],
      }),
    });
    expect(invalidRating.status).toBe(400);
    expect(await json(invalidRating)).toMatchObject({ error: "invalid_body", reason: "rating_invalid" });

    const notObserved = await composed.app.request(ASSESSMENT_PATH, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: assessmentBody(packet, {
        observations: [documentationObservation(packet, { rating: "not_observed" })],
      }),
    });
    expect(notObserved.status).toBe(201);
    expect((((await json(notObserved))["current"] as Record<string, unknown>)["observations"] as Array<Record<string, unknown>>)[0]?.["rating"])
      .toBe("not_observed");
  });

  it("refuses mutation after seal and learner writes", async () => {
    const composed = compose();
    const packet = await persistPacket(composed);
    const draft = await composed.app.request(ASSESSMENT_PATH, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: assessmentBody(packet),
    });
    expect(draft.status).toBe(201);
    const assessmentId = ((await json(draft))["current"] as { assessmentId: string }).assessmentId;
    const finalized = await composed.app.request(ASSESSMENT_PATH, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: assessmentBody(packet, {
        status: "final",
        narrativeFeedback: NARRATIVE,
        attestedAt: FINAL_AT,
        assessmentId,
      }),
    });
    expect(finalized.status).toBe(200);
    const currentFinal = (await json(finalized))["current"] as Record<string, unknown>;

    const mutatedFinal = await composed.app.request(ASSESSMENT_PATH, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: assessmentBody(packet, {
        status: "draft",
        assessmentId,
        observations: [documentationObservation(packet, { comment: "try to rewrite final packet" })],
      }),
    });
    expect(mutatedFinal.status).toBe(409);
    expect(await json(mutatedFinal)).toMatchObject({ error: "finalized" });

    const sealedResponse = await composed.app.request(SEAL_PATH, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ packetDigest: packetDigest(packet), attestedAt: SEAL_AT, raterId: RATER_ID }),
    });
    expect(sealedResponse.status).toBe(200);
    const sealed = (await json(sealedResponse))["current"] as Record<string, unknown>;
    expect(sealed["assessmentId"]).toBe(currentFinal["assessmentId"]);

    const mutatedSealed = await composed.app.request(ASSESSMENT_PATH, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: assessmentBody(packet, {
        status: "draft",
        assessmentId,
        observations: [documentationObservation(packet, { comment: "try to rewrite sealed packet" })],
      }),
    });
    expect(mutatedSealed.status).toBe(409);
    expect(await json(mutatedSealed)).toMatchObject({ error: "sealed" });

    const replay = await composed.app.request(ASSESSMENT_PATH);
    expect(replay.status).toBe(200);
    expect((await json(replay))["current"]).toEqual(sealed);

    const learnerHeaders = authHeader({ subject: LEARNER_ID, role: "learner", learnerId: LEARNER_ID });
    const learnerWrite = await composed.app.request(ASSESSMENT_PATH, {
      method: "POST",
      headers: { "content-type": "application/json", ...learnerHeaders },
      body: assessmentBody(packet),
    });
    expect(learnerWrite.status).toBe(403);
    const learnerRead = await composed.app.request(ASSESSMENT_PATH, { headers: learnerHeaders });
    expect(learnerRead.status).toBe(403);
    const learnerSeal = await composed.app.request(SEAL_PATH, {
      method: "POST",
      headers: { "content-type": "application/json", ...learnerHeaders },
      body: JSON.stringify({ packetDigest: packetDigest(packet), attestedAt: SEAL_AT }),
    });
    expect(learnerSeal.status).toBe(403);

    const unknownGet = await composed.app.request(UNKNOWN_EXAM_PATH);
    expect(unknownGet.status).toBe(404);
    const unknownPost = await composed.app.request(UNKNOWN_EXAM_PATH, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: assessmentBody(packet),
    });
    expect(unknownPost.status).toBe(404);

    const stale = await compose();
    const stalePacket = await persistPacket(stale);
    const stalePost = await stale.app.request(ASSESSMENT_PATH, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: assessmentBody(stalePacket, { packetDigest: "not-the-digest" }),
    });
    expect(stalePost.status).toBe(409);
    expect(await json(stalePost)).toMatchObject({ error: "stale_packet_digest" });
  });

  it("does not publish an assessment when durable save fails", async () => {
    const composed = compose({
      saveAssembledExamDisposition: () => {
        throw new Error("durable_unavailable");
      },
    });
    const packet = await persistPacket(composed);
    const failed = await composed.app.request(ASSESSMENT_PATH, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: assessmentBody(packet),
    });
    expect(failed.status).toBe(500);
    expect(await json(failed)).toMatchObject({ error: "durable_save_failed" });
    const missing = await composed.app.request(ASSESSMENT_PATH);
    expect(missing.status).toBe(404);
  });
});
