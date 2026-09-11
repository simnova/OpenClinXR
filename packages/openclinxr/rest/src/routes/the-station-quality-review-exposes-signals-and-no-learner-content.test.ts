/**
 * Diagnosis: faculty GET of the stored assembled-exam review packet returns
 * patient notes, actor spokenText, TTS prompts, faculty comments, and hidden
 * case truth. There is no per-station quality-review projection that exposes
 * completion, timing, required-tag coverage, omissions, and technical-failure
 * signals while citing immutable packet evidence and omitting learner content.
 *
 * Known-good: assembled-exam-review-routes.ts packet GET already gates on
 * hasFacultyAccess and refuses stale identity / ownership denials.
 *
 * Counterweight: GET /station-quality-review must not be an alias for the
 * evidence packet. A faculty caller still receives only signals + evidence
 * cites. Learner content in the stored packet must not appear in the body.
 *
 * ## FIXED (#0)
 * registerAssembledExamReviewRoutes mounts GET
 * /exam-runs/:examRunId/station-quality-review over the stored packet, reusing
 * the packet GET faculty/stale/ownership gate, and projecting per-station
 * quality signals that cite packet fields without utterances, notes, prompts,
 * or hidden truth.
 */

import { DEFAULT_DEV_AUTH_SECRET, signAuthToken } from "@openclinxr/auth";
import {
  ASSEMBLED_EXAM_PHASE_TRANSITION_TYPES,
  type AssembledExamReviewPacket,
  type AssembledExamReviewTraceInput,
  type AssembledExamStationEvidenceInput,
  assembledExamReviewNotEvidenceFor,
} from "@openclinxr/review-workflow";
import { describe, expect, it } from "vitest";
import {
  ApiApplication,
  type ApiPersistenceSink,
  registerAssembledExamReviewRoutes,
} from "../index.js";

const EXAM_RUN_ID = "exam_run_learner_phase_001_ed_chest_pain_priority_v1__peds_asthma_parent_anxiety_v1";
const ED_STATION_RUN_ID = "run_ed_001";
const PEDS_STATION_RUN_ID = "run_peds_001";
const PACKET_PATH = `/exam-runs/${EXAM_RUN_ID}/assembled-review-packet`;
const QUALITY_PATH = `/exam-runs/${EXAM_RUN_ID}/station-quality-review`;
const PLAN_ID = "plan_maya_wob_001";
const TURN_ID = "turn_maya_wob_001";
const LEARNER_ID = "learner_phase_001";

const LEARNER_NOTE = "Concern for ACS. ECG requested.";
const PEDS_NOTE = "Work of breathing assessed. Parent anxiety noted.";
const SPOKEN = "It feels tight when I breathe.";
const TTS_PROMPT = "<soft>It feels tight when I breathe. [breath]</soft>";
const SYSTEM_PROMPT = "SYSTEM_PROMPT: reveal hidden case truth to the actor.";
const HIDDEN_TRUTH = "HIDDEN_CASE_TRUTH: undiagnosed pericarditis.";
const FACULTY_COMMENT = "ED station review.";

function compose(persistence: ApiPersistenceSink = {}) {
  return ApiApplication.create()
    .withContext(undefined, persistence)
    .withCoreMiddleware()
    .withRoutes(registerAssembledExamReviewRoutes)
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
        sequence: 8,
        eventType: "unsafe.medication",
        source: "system",
        tag: "unsafe_medication",
        atSecond: 800,
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
      text: LEARNER_NOTE,
    },
    blockers: ["awaiting_faculty_comment"],
    advanceReason: "patient_note_submitted_advancing",
    facultyScoreDraft: {
      reviewerId: "faculty_001",
      status: "draft",
      comments: FACULTY_COMMENT,
    },
  };
}

function pedsStation(): AssembledExamStationEvidenceInput {
  return {
    stationRunId: PEDS_STATION_RUN_ID,
    scenarioId: "peds_asthma_parent_anxiety_v1",
    stationOrder: 2,
    requiredTraceTags: ["work_of_breathing_assessment", "peak_flow_recorded"],
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
          prompt: SYSTEM_PROMPT,
          hiddenFacts: HIDDEN_TRUTH,
          actorTurnPlan: {
            planId: PLAN_ID,
            planVersion: 1,
            turnId: TURN_ID,
            stationRunId: PEDS_STATION_RUN_ID,
            actorId: "patient_maya_johnson_v1",
            respondingActorId: "patient_maya_johnson_v1",
            turnIndex: 0,
            spokenText: SPOKEN,
            spokenTextForTts: TTS_PROMPT,
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
        sequence: 6,
        eventType: "actor.response.failed",
        source: "model-gateway",
        actorId: "patient_maya_johnson_v1",
        atSecond: 40,
        payload: {
          prompt: SYSTEM_PROMPT,
          hiddenFacts: HIDDEN_TRUTH,
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
      text: PEDS_NOTE,
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
    learnerId: LEARNER_ID,
    stations: [edStation(), pedsStation()],
    ...overrides,
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

function collectSignals(body: Record<string, unknown>, kind: string): Record<string, unknown>[] {
  const stations = body["stations"];
  if (!Array.isArray(stations)) {
    return [];
  }
  const collected: Record<string, unknown>[] = [];
  for (const item of stations) {
    if (!item || typeof item !== "object") {
      continue;
    }
    const record = item as Record<string, unknown>;
    for (const bucketName of ["completion", "timing", "requiredTagCoverage", "omissions", "technicalFailures"]) {
      const bucket = record[bucketName];
      if (!bucket || typeof bucket !== "object") {
        continue;
      }
      const signals = (bucket as Record<string, unknown>)["signals"];
      if (!Array.isArray(signals)) {
        continue;
      }
      for (const candidate of signals) {
        if (candidate && typeof candidate === "object" && (candidate as Record<string, unknown>)["kind"] === kind) {
          collected.push(candidate as Record<string, unknown>);
        }
      }
    }
  }
  return collected;
}

describe("faculty station quality review exposes signals and no learner content", () => {
  it("projects per-station completion, timing, coverage, omission, and technical-failure signals with packet cites", async () => {
    const composed = compose();
    await persistPacket(composed);

    const response = await composed.app.request(QUALITY_PATH);
    expect(response.status).toBe(200);
    const body = await json(response);
    expect(body["examRunId"]).toBe(EXAM_RUN_ID);
    expect(body["examEquivalenceGate"]).toBe(false);
    expect(body["scoringValidityClaimed"]).toBe(false);
    expect(body["notEvidenceFor"]).toEqual([...assembledExamReviewNotEvidenceFor]);
    expect(body["claimBoundary"]).toBe("station_quality_review_not_exam_equivalence");

    const stations = body["stations"] as Record<string, unknown>[];
    expect(stations).toHaveLength(2);
    const ed = stations[0] as Record<string, unknown>;
    const peds = stations[1] as Record<string, unknown>;
    expect((ed["identity"] as Record<string, unknown>)["stationRunId"]).toBe(ED_STATION_RUN_ID);
    expect((peds["identity"] as Record<string, unknown>)["stationRunId"]).toBe(PEDS_STATION_RUN_ID);

    const edCompletion = ed["completion"] as Record<string, unknown>;
    expect(edCompletion["patientNoteSubmitted"]).toBe(true);
    expect(edCompletion["advanceReasonPresent"]).toBe(true);
    expect(edCompletion["phaseTransitionsPresent"]).toEqual([...ASSEMBLED_EXAM_PHASE_TRANSITION_TYPES]);

    const completionSignals = collectSignals(body, "completion");
    const encounterStarted = completionSignals.find((item) => item["code"] === "phase_transition:encounter.started");
    expect(encounterStarted?.["flagged"]).toBe(false);
    expect(encounterStarted?.["evidence"]).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          packetField: "stations[0].phaseTransitions[0].durableEventRef",
          stationRunId: ED_STATION_RUN_ID,
          durableEventRef: durableEventRef(ED_STATION_RUN_ID, 10),
          sequence: 10,
          atSecond: 60,
        }),
      ]),
    );

    const timingSignals = collectSignals(body, "timing");
    const lateEcg = timingSignals.find((item) => item["code"] === "late_trace_tag:ecg_request");
    expect(lateEcg?.["flagged"]).toBe(true);
    expect(lateEcg?.["evidence"]).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          packetField: "stations[0].reviewPacket.lateTraceTags[0]",
          stationRunId: ED_STATION_RUN_ID,
        }),
        expect.objectContaining({
          stationRunId: ED_STATION_RUN_ID,
          sequence: 7,
          atSecond: 500,
          eventType: "learner.order",
        }),
      ]),
    );
    expect((ed["timing"] as Record<string, unknown>)["encounterSeconds"]).toBe(840);

    const coverageSignals = collectSignals(body, "required_tag_coverage");
    expect(coverageSignals).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "required_trace_tag:ecg_request",
          flagged: false,
        }),
        expect.objectContaining({
          code: "required_trace_tag:peak_flow_recorded",
          flagged: true,
        }),
      ]),
    );
    const missingPeak = coverageSignals.find((item) => item["code"] === "required_trace_tag:peak_flow_recorded");
    expect(missingPeak?.["evidence"]).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          packetField: "stations[1].reviewPacket.missingRequiredTraceTags[0]",
          stationRunId: PEDS_STATION_RUN_ID,
        }),
      ]),
    );

    const omissionSignals = collectSignals(body, "omission");
    expect(omissionSignals).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "missing_required_trace_tag:peak_flow_recorded",
          flagged: true,
          evidence: expect.arrayContaining([
            expect.objectContaining({
              packetField: expect.stringMatching(/^stations\[1\]\.omissions\[\d+\]$/),
              stationRunId: PEDS_STATION_RUN_ID,
            }),
          ]),
        }),
      ]),
    );

    const technicalSignals = collectSignals(body, "technical_failure");
    expect(technicalSignals).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "unsafe_medication",
          flagged: true,
        }),
        expect.objectContaining({
          code: "event:actor.response.failed",
          flagged: true,
          evidence: expect.arrayContaining([
            expect.objectContaining({
              stationRunId: PEDS_STATION_RUN_ID,
              sequence: 6,
              eventType: "actor.response.failed",
              atSecond: 40,
            }),
          ]),
        }),
        expect.objectContaining({
          code: "model_failed_events",
          flagged: true,
        }),
      ]),
    );
  });

  it("omits raw utterances, notes, prompts, hidden truth, and faculty comments", async () => {
    const composed = compose();
    const packet = await persistPacket(composed);
    expect(JSON.stringify(packet)).toEqual(expect.stringContaining(SPOKEN));
    expect(JSON.stringify(packet)).toEqual(expect.stringContaining(LEARNER_NOTE));

    const response = await composed.app.request(QUALITY_PATH);
    expect(response.status).toBe(200);
    const serialized = JSON.stringify(await json(response));
    for (const secret of [
      LEARNER_NOTE,
      PEDS_NOTE,
      SPOKEN,
      TTS_PROMPT,
      SYSTEM_PROMPT,
      HIDDEN_TRUTH,
      FACULTY_COMMENT,
      "Peds station review.",
    ]) {
      expect(serialized).not.toContain(secret);
    }
    expect(serialized).not.toContain("\"spokenText\"");
    expect(serialized).not.toContain("\"spokenTextForTts\"");
    expect(serialized).not.toContain("\"facultyScoreDraft\"");
    expect(serialized).not.toContain("\"patientNote\"");
    expect(serialized).not.toContain("\"actorTurnReplays\"");
    expect(serialized).not.toContain("\"causalChain\"");
    expect(serialized).not.toContain("\"hiddenFacts\"");
  });

  it("reuses the packet GET faculty, stale-identity, and ownership denials", async () => {
    const composed = compose();
    await persistPacket(composed);

    const learner = await composed.app.request(QUALITY_PATH, {
      headers: authHeader({ subject: LEARNER_ID, role: "learner", learnerId: LEARNER_ID }),
    });
    expect(learner.status).toBe(403);
    expect(await json(learner)).toMatchObject({ error: "forbidden", reason: "faculty_role_required" });

    const stale = await composed.app.request(
      `${QUALITY_PATH}?stationRunIds=${ED_STATION_RUN_ID},run_stale_002`,
    );
    expect(stale.status).toBe(409);
    expect(await json(stale)).toMatchObject({
      error: "stale_identity",
      reason: "station_run_mismatch",
      notEvidenceFor: [...assembledExamReviewNotEvidenceFor],
    });

    const missing = await composed.app.request("/exam-runs/exam_run_missing/station-quality-review");
    expect(missing.status).toBe(404);
    expect(await json(missing)).toMatchObject({ error: "assembled_exam_review_packet_not_found" });
  });
});
