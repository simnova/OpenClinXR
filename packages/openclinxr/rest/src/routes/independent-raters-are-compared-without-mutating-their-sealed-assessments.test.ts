/**
 * Diagnosis: rest can seal one rubric-grounded faculty assessment, but a second
 * rater is refused as identity_mutation. There is no criterion-level comparison,
 * no delayed anchor reveal, and no adjudication trail that leaves both seals
 * intact. Agreement would be easy to mislabel as score validity.
 *
 * Known-good: The sealed faculty assessment, its rubric grounding and its seal
 * id landed today at 53762731.
 *
 * Counterweight: GET /rater-calibration must omit anchors until both raters
 * are sealed. POST /rater-calibration/adjudicate must not rewrite either
 * sealedAssessmentId or observation. Agreement is labeled calibration evidence.
 *
 * ## FIXED (#0)
 * Independent faculty raters each seal their own assessment. Compare is
 * criterion-level. Anchors appear only after both seals. Adjudication appends
 * beside the originals. scoringValidityClaimed stays false.
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
const CALIBRATION_PATH = `/exam-runs/${EXAM_RUN_ID}/rater-calibration`;
const ADJUDICATE_PATH = `${CALIBRATION_PATH}/adjudicate`;
const LEARNER_ID = "learner_phase_001";
const RATER_A = "faculty_rater_alpha";
const RATER_B = "faculty_rater_beta";
const ADJUDICATOR = "faculty_adjudicator_001";
const DRAFT_AT = "2026-09-11T18:00:00.000Z";
const FINAL_AT = "2026-09-11T18:10:00.000Z";
const SEAL_AT_A = "2026-09-11T18:20:00.000Z";
const SEAL_AT_B = "2026-09-11T18:30:00.000Z";
const ADJUDICATE_AT = "2026-09-11T18:40:00.000Z";
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

function bindOwners(composed: ReturnType<typeof compose>): void {
  composed.context.sessionOwners.set(ED_STATION_RUN_ID, LEARNER_ID);
  composed.context.sessionOwners.set(PEDS_STATION_RUN_ID, LEARNER_ID);
}

function authHeader(identity: { subject: string; role: "learner" | "faculty" | "admin"; learnerId?: string }): Record<string, string> {
  return {
    authorization: `Bearer ${signAuthToken({ identity, secret: DEFAULT_DEV_AUTH_SECRET })}`,
  };
}

function facultyHeaders(subject: string): Record<string, string> {
  return authHeader({ subject, role: "faculty" });
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

async function json(response: Response): Promise<Record<string, unknown>> {
  return response.json() as Promise<Record<string, unknown>>;
}

async function persistPacket(composed: ReturnType<typeof compose>): Promise<AssembledExamReviewPacket> {
  bindOwners(composed);
  const created = await composed.app.request(PACKET_PATH, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
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
    }),
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

function assessmentBody(
  packet: AssembledExamReviewPacket,
  raterId: string,
  overrides: Record<string, unknown> = {},
): string {
  return JSON.stringify({
    examRunId: EXAM_RUN_ID,
    raterId,
    packetDigest: packetDigest(packet),
    status: "draft",
    narrativeFeedback: "",
    attestedAt: DRAFT_AT,
    observations: [{
      rubricItemId: "documentation",
      stationRunId: ED_STATION_RUN_ID,
      rating: "met",
      comment: `${raterId} documentation observation.`,
      evidenceCites: [documentationCite(packet)],
    }],
    ...overrides,
  });
}

async function sealRater(
  composed: ReturnType<typeof compose>,
  packet: AssembledExamReviewPacket,
  raterId: string,
  rating: "met" | "partially_met",
  sealedAt: string,
): Promise<Record<string, unknown>> {
  const headers = { "content-type": "application/json", ...facultyHeaders(raterId) };
  const draft = await composed.app.request(ASSESSMENT_PATH, {
    method: "POST",
    headers,
    body: assessmentBody(packet, raterId, {
      observations: [{
        rubricItemId: "documentation",
        stationRunId: ED_STATION_RUN_ID,
        rating,
        comment: `${raterId} documentation observation.`,
        evidenceCites: [documentationCite(packet)],
      }],
    }),
  });
  expect(draft.status).toBe(201);
  const assessmentId = ((await json(draft))["current"] as { assessmentId: string }).assessmentId;
  const finalized = await composed.app.request(ASSESSMENT_PATH, {
    method: "POST",
    headers,
    body: assessmentBody(packet, raterId, {
      status: "final",
      narrativeFeedback: NARRATIVE,
      attestedAt: FINAL_AT,
      assessmentId,
      observations: [{
        rubricItemId: "documentation",
        stationRunId: ED_STATION_RUN_ID,
        rating,
        comment: `${raterId} documentation observation.`,
        evidenceCites: [documentationCite(packet)],
      }],
    }),
  });
  expect(finalized.status).toBe(200);
  const sealed = await composed.app.request(SEAL_PATH, {
    method: "POST",
    headers,
    body: JSON.stringify({ packetDigest: packetDigest(packet), attestedAt: sealedAt, raterId }),
  });
  expect(sealed.status).toBe(200);
  return (await json(sealed))["current"] as Record<string, unknown>;
}

describe("independent raters are compared without mutating their sealed assessments", () => {
  it("compares two sealed raters at criterion level, reveals anchors after both seals, and adjudicates beside the originals", async () => {
    const sinkDispositions: ApiAssembledExamDispositionRecord[] = [];
    const composed = compose({
      saveAssembledExamDisposition: (_examRunId, record) => {
        sinkDispositions.push(record);
      },
      getAssembledExamDisposition: (examRunId) =>
        sinkDispositions.filter((record) => record.examRunId === examRunId).at(-1),
    });
    const packet = await persistPacket(composed);

    const sealedA = await sealRater(composed, packet, RATER_A, "met", SEAL_AT_A);
    expect(sealedA["raterId"]).toBe(RATER_A);
    expect(typeof sealedA["sealedAssessmentId"]).toBe("string");

    const beforeSecond = await composed.app.request(CALIBRATION_PATH, {
      headers: facultyHeaders(RATER_A),
    });
    expect(beforeSecond.status).toBe(409);
    const pending = await json(beforeSecond);
    expect(pending).toMatchObject({
      error: "independent_pair_incomplete",
      agreementKind: "calibration_evidence",
      scoringValidityClaimed: false,
    });
    expect(pending).not.toHaveProperty("anchors");
    expect(JSON.stringify(pending)).not.toContain("Patient note");

    const raterBView = await composed.app.request(ASSESSMENT_PATH, {
      headers: facultyHeaders(RATER_B),
    });
    expect(raterBView.status).toBe(404);
    expect(JSON.stringify(await json(raterBView))).not.toContain(`${RATER_A} documentation observation.`);

    const sealedB = await sealRater(composed, packet, RATER_B, "partially_met", SEAL_AT_B);
    expect(sealedB["raterId"]).toBe(RATER_B);
    expect(sealedB["sealedAssessmentId"]).not.toBe(sealedA["sealedAssessmentId"]);

    const replayA = await composed.app.request(ASSESSMENT_PATH, {
      headers: facultyHeaders(RATER_A),
    });
    expect(replayA.status).toBe(200);
    const replayABody = await json(replayA);
    expect(replayABody["current"]).toEqual(sealedA);
    expect(JSON.stringify(replayABody)).not.toContain(`${RATER_B} documentation observation.`);

    const compared = await composed.app.request(CALIBRATION_PATH, {
      headers: facultyHeaders(ADJUDICATOR),
    });
    expect(compared.status).toBe(200);
    const comparison = await json(compared);
    expect(comparison["agreementKind"]).toBe("calibration_evidence");
    expect(comparison["scoringValidityClaimed"]).toBe(false);
    expect(comparison["examEquivalenceGate"]).toBe(false);
    expect(comparison["claimBoundary"]).toBe("assembled_exam_rater_calibration_not_score_use");
    expect(comparison["notEvidenceFor"]).toEqual(expect.arrayContaining([
      "scoring_validity",
      "credentialing",
      "reliability_coefficient",
    ]));
    expect(comparison["leftSealedAssessmentId"]).toBe(sealedA["sealedAssessmentId"]);
    expect(comparison["rightSealedAssessmentId"]).toBe(sealedB["sealedAssessmentId"]);
    const criteria = comparison["criterionComparisons"] as Array<Record<string, unknown>>;
    expect(criteria).toEqual(expect.arrayContaining([
      expect.objectContaining({
        rubricItemId: "documentation",
        stationRunId: ED_STATION_RUN_ID,
        leftRating: "met",
        rightRating: "partially_met",
        ratingsAgree: false,
      }),
    ]));
    const anchors = comparison["anchors"] as Array<Record<string, unknown>>;
    expect(anchors).toEqual(expect.arrayContaining([
      expect.objectContaining({
        rubricItemId: "documentation",
        stationRunId: ED_STATION_RUN_ID,
        label: "Patient note",
      }),
    ]));

    const originalsBefore = sinkDispositions.at(-1)?.facultyAssessments?.map((entry) => ({
      raterId: entry.raterId,
      sealedAssessmentId: entry.sealedAssessmentId,
      comment: entry.observations[0]?.comment,
      rating: entry.observations[0]?.rating,
    }));

    const adjudicated = await composed.app.request(ADJUDICATE_PATH, {
      method: "POST",
      headers: { "content-type": "application/json", ...facultyHeaders(ADJUDICATOR) },
      body: JSON.stringify({
        packetDigest: packetDigest(packet),
        attestedAt: ADJUDICATE_AT,
        adjudicatorId: ADJUDICATOR,
        leftSealedAssessmentId: sealedA["sealedAssessmentId"],
        rightSealedAssessmentId: sealedB["sealedAssessmentId"],
        criterionResolutions: [{
          rubricItemId: "documentation",
          stationRunId: ED_STATION_RUN_ID,
          resolution: "disagree",
          note: "Formative calibration discussion only.",
        }],
      }),
    });
    expect(adjudicated.status).toBe(201);
    const adjudication = await json(adjudicated);
    expect(adjudication["agreementKind"]).toBe("calibration_evidence");
    expect(adjudication["scoringValidityClaimed"]).toBe(false);
    expect(typeof adjudication["adjudicationId"]).toBe("string");
    expect(adjudication["leftSealedAssessmentId"]).toBe(sealedA["sealedAssessmentId"]);
    expect(adjudication["rightSealedAssessmentId"]).toBe(sealedB["sealedAssessmentId"]);

    const originalsAfter = sinkDispositions.at(-1)?.facultyAssessments?.map((entry) => ({
      raterId: entry.raterId,
      sealedAssessmentId: entry.sealedAssessmentId,
      comment: entry.observations[0]?.comment,
      rating: entry.observations[0]?.rating,
    }));
    expect(originalsAfter).toEqual(originalsBefore);
    expect(sinkDispositions.at(-1)?.raterCalibrations).toHaveLength(1);

    const learnerHeaders = authHeader({ subject: LEARNER_ID, role: "learner", learnerId: LEARNER_ID });
    const learnerCompare = await composed.app.request(CALIBRATION_PATH, { headers: learnerHeaders });
    expect(learnerCompare.status).toBe(403);
    const learnerAdjudicate = await composed.app.request(ADJUDICATE_PATH, {
      method: "POST",
      headers: { "content-type": "application/json", ...learnerHeaders },
      body: JSON.stringify({ packetDigest: packetDigest(packet), attestedAt: ADJUDICATE_AT, adjudicatorId: ADJUDICATOR }),
    });
    expect(learnerAdjudicate.status).toBe(403);
  });

  it("refuses overwrite of sealed assessments through the calibration command", async () => {
    const composed = compose();
    const packet = await persistPacket(composed);
    const sealedA = await sealRater(composed, packet, RATER_A, "met", SEAL_AT_A);
    await sealRater(composed, packet, RATER_B, "met", SEAL_AT_B);

    const overwrite = await composed.app.request(ADJUDICATE_PATH, {
      method: "POST",
      headers: { "content-type": "application/json", ...facultyHeaders(ADJUDICATOR) },
      body: JSON.stringify({
        packetDigest: packetDigest(packet),
        attestedAt: ADJUDICATE_AT,
        adjudicatorId: ADJUDICATOR,
        leftSealedAssessmentId: sealedA["sealedAssessmentId"],
        facultyAssessments: [],
        observations: [{ comment: "try to rewrite sealed packet" }],
      }),
    });
    expect(overwrite.status).toBe(409);
    expect(await json(overwrite)).toMatchObject({ error: "overwrite_refused" });
  });
});
