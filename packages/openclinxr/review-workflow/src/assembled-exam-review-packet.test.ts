import { describe, expect, it } from "vitest";
import type { ActorTurnExecution, ActorTurnPlan } from "@openclinxr/shared-schemas";
import {
  ASSEMBLED_EXAM_PHASE_TRANSITION_TYPES,
  assembledExamReviewNotEvidenceFor,
  buildAssembledExamReviewPacket,
  type AssembledExamReviewTraceInput,
  type AssembledExamStationEvidenceInput,
} from "./assembled-exam-review-packet.js";

const EXAM_RUN_ID = "exam_run_learner_phase_001_ed_chest_pain_priority_v1__peds_asthma_parent_anxiety_v1";
const ED_STATION_RUN_ID = "run_ed_001";
const PEDS_STATION_RUN_ID = "run_peds_001";

const PLAN_ID = "plan_maya_wob_001";
const TURN_ID = "turn_maya_wob_001";

function samplePlan(overrides: Partial<ActorTurnPlan> = {}): ActorTurnPlan {
  return {
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
    ...overrides,
  };
}

function sampleExecution(overrides: Partial<ActorTurnExecution> = {}): ActorTurnExecution {
  return {
    planId: PLAN_ID,
    turnId: TURN_ID,
    interruption: { kind: "truncated" },
    renderedProsodyTags: ["<soft>"],
    droppedProsodyTags: ["[breath]"],
    fallback: { language: false, tts: false },
    ...overrides,
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

function edStation(
  overrides: Partial<AssembledExamStationEvidenceInput> = {},
): AssembledExamStationEvidenceInput {
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
        sequence: 3,
        eventType: "learner.utterance",
        source: "learner",
        actorId: "patient_robert_hayes_v1",
        tag: "history_opqrst",
        atSecond: 120,
        payload: { text: "Private learner utterance must stay out of exam packet summaries." },
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
    blockers: [],
    advanceReason: "patient_note_submitted_advancing",
    facultyScoreDraft: {
      reviewerId: "faculty_001",
      status: "draft",
      comments: "ED station review.",
    },
    ...overrides,
  };
}

function withoutPatientNote(
  station: AssembledExamStationEvidenceInput,
): AssembledExamStationEvidenceInput {
  const { patientNote, ...rest } = station;
  return rest;
}

function pedsStation(
  overrides: Partial<AssembledExamStationEvidenceInput> = {},
): AssembledExamStationEvidenceInput {
  const plan = samplePlan();
  const execution = sampleExecution();
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
        payload: { actorTurnPlan: plan },
      },
      {
        stationRunId: PEDS_STATION_RUN_ID,
        sequence: 5,
        eventType: "actor.turn.executed",
        source: "voice-gateway",
        actorId: "patient_maya_johnson_v1",
        tag: "work_of_breathing_assessment",
        atSecond: 22,
        payload: { actorTurnExecution: execution },
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
    ...overrides,
  };
}

describe("assembled exam review packet", () => {
  it("groups notes, transitions, actor-turn provenance, and blockers by station identity", () => {
    const packet = buildAssembledExamReviewPacket({
      examRunId: EXAM_RUN_ID,
      learnerId: "learner_phase_001",
      stations: [pedsStation(), edStation()],
    });

    expect(packet.examRunId).toBe(EXAM_RUN_ID);
    expect(packet.stations.map((station) => station.identity.stationOrder)).toEqual([1, 2]);
    expect(packet.stations.map((station) => station.identity.stationRunId)).toEqual([
      ED_STATION_RUN_ID,
      PEDS_STATION_RUN_ID,
    ]);
    expect(packet.stations.map((station) => station.identity.scenarioId)).toEqual([
      "ed_chest_pain_priority_v1",
      "peds_asthma_parent_anxiety_v1",
    ]);
    expect(packet.stations[0]?.reviewPacket.stationRunId).toBe(ED_STATION_RUN_ID);
    expect(packet.stations[1]?.reviewPacket.stationRunId).toBe(PEDS_STATION_RUN_ID);
    expect(packet.stations[0]?.reviewPacket.patientNote?.text).toContain("ACS");
    expect(packet.stations[1]?.reviewPacket.patientNote?.text).toContain("Work of breathing");
    expect(packet.stations[0]?.reviewPacket.patientNote?.stationRunId).toBe(ED_STATION_RUN_ID);
    expect(packet.stations[1]?.reviewPacket.patientNote?.stationRunId).toBe(PEDS_STATION_RUN_ID);
    expect(packet.stations[0]?.advanceReason).toBe("patient_note_submitted_advancing");
    expect(packet.stations[1]?.advanceReason).toBe("last_station_note_submitted_exam_complete");
    expect(packet.stations[0]?.phaseTransitions.map((event) => event.eventType)).toEqual([
      ...ASSEMBLED_EXAM_PHASE_TRANSITION_TYPES,
    ]);
    expect(packet.stations[1]?.reviewPacket.actorTurnReplays).toHaveLength(1);
    const replay = packet.stations[1]?.reviewPacket.actorTurnReplays[0];
    expect(replay?.plan).not.toBe(replay?.execution);
    expect(replay?.plan.spokenText).toBe("It feels tight when I breathe.");
    expect(replay?.execution?.interruption.kind).toBe("truncated");
    expect(packet.stations[0]?.omissions).toEqual([]);
    expect(packet.stations[1]?.omissions).toEqual([]);
    expect(packet.examEquivalenceGate).toBe(false);
    expect(packet.claimBoundary).toBe("assembled_exam_review_packet_not_exam_equivalence");
    expect(packet.notEvidenceFor).toEqual(assembledExamReviewNotEvidenceFor);
    expect(packet.notEvidenceFor).toContain("exam_equivalence");
    expect(packet.notEvidenceFor).toContain("clinical_validity");
  });

  it("keeps exam timeline station-bound instead of flattening authored identities", () => {
    const packet = buildAssembledExamReviewPacket({
      examRunId: EXAM_RUN_ID,
      learnerId: "learner_phase_001",
      stations: [edStation(), pedsStation()],
    });

    expect(packet.examTimeline.every((entry) => entry.examRunId === EXAM_RUN_ID)).toBe(true);
    expect(packet.examTimeline.some((entry) => entry.stationRunId === ED_STATION_RUN_ID)).toBe(true);
    expect(packet.examTimeline.some((entry) => entry.stationRunId === PEDS_STATION_RUN_ID)).toBe(true);
    const edAdvanced = packet.examTimeline.find(
      (entry) => entry.eventType === "station.advanced" && entry.stationRunId === ED_STATION_RUN_ID,
    );
    const pedsAdvanced = packet.examTimeline.find(
      (entry) => entry.eventType === "station.advanced" && entry.stationRunId === PEDS_STATION_RUN_ID,
    );
    expect(edAdvanced?.scenarioId).toBe("ed_chest_pain_priority_v1");
    expect(pedsAdvanced?.scenarioId).toBe("peds_asthma_parent_anxiety_v1");
    expect(edAdvanced?.kind).toBe("phase_transition");
    expect(edAdvanced?.summary).toContain("advanceReason patient_note_submitted_advancing");
    expect(packet.examTimeline.find((entry) => entry.eventType === "learner.utterance")?.summary).not.toContain(
      "Private learner utterance",
    );
  });

  it("COUNTERWEIGHT: per-station packet still reconstructs the known-good ED timeline", () => {
    const packet = buildAssembledExamReviewPacket({
      examRunId: EXAM_RUN_ID,
      stations: [edStation()],
    });
    const stationPacket = packet.stations[0]?.reviewPacket;
    expect(stationPacket?.timeline.map((entry) => entry.sequence)).toEqual([0, 3, 7, 9]);
    expect(stationPacket?.timeline[1]?.summary).toContain("payload text withheld");
    expect(stationPacket?.lateTraceTags).toEqual(["ecg_request"]);
    expect(stationPacket?.observedTraceTags).toEqual(["ecg_request", "patient_note_submitted"]);
  });

  it("rejects cross-run evidence", () => {
    expect(() =>
      buildAssembledExamReviewPacket({
        examRunId: EXAM_RUN_ID,
        stations: [
          edStation({
            traceEvents: [
              {
                stationRunId: "run_other_exam",
                sequence: 0,
                eventType: "station.started",
                source: "system",
                atSecond: 0,
              },
            ],
          }),
        ],
      }),
    ).toThrow(/rejects cross-run evidence/);

    expect(() =>
      buildAssembledExamReviewPacket({
        examRunId: EXAM_RUN_ID,
        stations: [
          edStation({
            patientNote: {
              stationRunId: PEDS_STATION_RUN_ID,
              submittedAtSecond: 1260,
              text: "Wrong station note.",
            },
          }),
        ],
      }),
    ).toThrow(/rejects cross-run evidence/);
  });

  it("rejects duplicate-sequence evidence", () => {
    expect(() =>
      buildAssembledExamReviewPacket({
        examRunId: EXAM_RUN_ID,
        stations: [
          edStation({
            traceEvents: [
              {
                stationRunId: ED_STATION_RUN_ID,
                sequence: 3,
                eventType: "station.started",
                source: "system",
                atSecond: 0,
              },
              {
                stationRunId: ED_STATION_RUN_ID,
                sequence: 3,
                eventType: "note.submitted",
                source: "learner",
                atSecond: 10,
              },
            ],
          }),
        ],
      }),
    ).toThrow(/rejects duplicate-sequence evidence/);
  });

  it("rejects out-of-order phase transitions", () => {
    const transitions = canonicalPhaseTransitions({
      stationRunId: ED_STATION_RUN_ID,
      scenarioId: "ed_chest_pain_priority_v1",
      stationOrder: 1,
      startSequence: 10,
      advanceReason: "patient_note_submitted_advancing",
    });
    const noteStarted = transitions[2];
    const noteSubmitted = transitions[3];
    if (!noteStarted || !noteSubmitted) {
      throw new Error("fixture missing phase transitions");
    }
    const swapped = [...transitions];
    swapped[2] = {
      ...noteSubmitted,
      sequence: 12,
      atSecond: 900,
      payload: {
        ...noteSubmitted.payload,
        formAtSecond: 900,
        durableEventRef: durableEventRef(ED_STATION_RUN_ID, 12),
      },
    };
    swapped[3] = {
      ...noteStarted,
      sequence: 13,
      atSecond: 1260,
      payload: {
        ...noteStarted.payload,
        formAtSecond: 1260,
        durableEventRef: durableEventRef(ED_STATION_RUN_ID, 13),
      },
    };

    expect(() =>
      buildAssembledExamReviewPacket({
        examRunId: EXAM_RUN_ID,
        stations: [edStation({ phaseTransitions: swapped })],
      }),
    ).toThrow(/rejects out-of-order evidence/);

    const decreasingTime = canonicalPhaseTransitions({
      stationRunId: ED_STATION_RUN_ID,
      scenarioId: "ed_chest_pain_priority_v1",
      stationOrder: 1,
      startSequence: 10,
      advanceReason: "patient_note_submitted_advancing",
    }).map((event, index) => (index === 1 ? { ...event, atSecond: 10 } : event));

    expect(() =>
      buildAssembledExamReviewPacket({
        examRunId: EXAM_RUN_ID,
        stations: [edStation({ phaseTransitions: decreasingTime })],
      }),
    ).toThrow(/rejects out-of-order evidence/);
  });

  it("exposes explicit omissions without inventing missing station evidence", () => {
    const packet = buildAssembledExamReviewPacket({
      examRunId: EXAM_RUN_ID,
      stations: [
        edStation({
          requiredTraceTags: ["ecg_request", "team_communication", "patient_note_submitted"],
          advanceReason: null,
          phaseTransitions: canonicalPhaseTransitions({
            stationRunId: ED_STATION_RUN_ID,
            scenarioId: "ed_chest_pain_priority_v1",
            stationOrder: 1,
            startSequence: 10,
            advanceReason: "patient_note_submitted_advancing",
          }).filter((event) => event.eventType !== "station.advanced"),
          blockers: ["missing_station_advanced_trace"],
        }),
        withoutPatientNote(pedsStation({
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
              atSecond: 20,
              payload: { actorTurnPlan: samplePlan() },
            },
          ],
          phaseTransitions: canonicalPhaseTransitions({
            stationRunId: PEDS_STATION_RUN_ID,
            scenarioId: "peds_asthma_parent_anxiety_v1",
            stationOrder: 2,
            startSequence: 10,
            advanceReason: "last_station_note_submitted_exam_complete",
          }).filter((event) => event.eventType !== "note.submitted"),
        })),
      ],
    });

    expect(packet.stations[0]?.blockers).toEqual(["missing_station_advanced_trace"]);
    expect(packet.stations[0]?.omissions).toEqual(
      expect.arrayContaining([
        "missing_phase_transition:station.advanced",
        "missing_advance_reason",
        "missing_required_trace_tag:team_communication",
      ]),
    );
    expect(packet.stations[0]?.omissions).not.toContain("missing_patient_note");
    expect(packet.stations[1]?.omissions).toEqual(
      expect.arrayContaining([
        "missing_patient_note",
        "missing_actor_turn_execution:plan_maya_wob_001",
      ]),
    );
    expect(packet.omissions).toEqual(
      expect.arrayContaining([
        "missing_phase_transition:station.advanced",
        "missing_advance_reason",
        "missing_required_trace_tag:team_communication",
        "missing_patient_note",
        "missing_actor_turn_execution:plan_maya_wob_001",
      ]),
    );
    expect(packet.stations[1]?.reviewPacket.actorTurnReplays[0]?.execution).toBeNull();
  });

  it("COUNTERWEIGHT: ordinary traceEvents stay ReviewTraceInput-compatible without stationRunId", () => {
    const packet = buildAssembledExamReviewPacket({
      examRunId: EXAM_RUN_ID,
      stations: [
        edStation({
          traceEvents: [
            { sequence: 0, eventType: "station.started", source: "system", atSecond: 0 },
            { sequence: 7, eventType: "learner.order", source: "learner", tag: "ecg_request", atSecond: 500 },
            { sequence: 9, eventType: "note.submitted", source: "learner", tag: "patient_note_submitted", atSecond: 1260 },
          ],
        }),
      ],
    });
    expect(packet.stations[0]?.reviewPacket.timeline.map((entry) => entry.sequence)).toEqual([0, 7, 9]);
    expect(packet.stations[0]?.phaseTransitions).toHaveLength(5);
  });

  it("rejects malformed phase-transition provenance", () => {
    expect(() =>
      buildAssembledExamReviewPacket({
        examRunId: EXAM_RUN_ID,
        stations: [edStation({
          phaseTransitions: canonicalPhaseTransitions({
            stationRunId: ED_STATION_RUN_ID,
            scenarioId: "ed_chest_pain_priority_v1",
            stationOrder: 1,
            startSequence: 10,
            advanceReason: "patient_note_submitted_advancing",
          }).map((event, index) => {
            if (index !== 0) {
              return event;
            }
            const { stationRunId, ...rest } = event;
            return rest;
          }),
        })],
      }),
    ).toThrow(/rejects malformed phase-transition provenance/);

    expect(() =>
      buildAssembledExamReviewPacket({
        examRunId: EXAM_RUN_ID,
        stations: [edStation({
          phaseTransitions: patchPhasePayload(0, { examRunId: undefined }),
        })],
      }),
    ).toThrow(/rejects malformed phase-transition provenance/);

    expect(() =>
      buildAssembledExamReviewPacket({
        examRunId: EXAM_RUN_ID,
        stations: [edStation({
          phaseTransitions: patchPhasePayload(0, { examRunId: "exam_run_someone_else" }),
        })],
      }),
    ).toThrow(/rejects malformed phase-transition provenance/);

    expect(() =>
      buildAssembledExamReviewPacket({
        examRunId: EXAM_RUN_ID,
        stations: [edStation({
          phaseTransitions: patchPhasePayload(0, { scenarioId: "peds_asthma_parent_anxiety_v1" }),
        })],
      }),
    ).toThrow(/rejects malformed phase-transition provenance/);

    expect(() =>
      buildAssembledExamReviewPacket({
        examRunId: EXAM_RUN_ID,
        stations: [edStation({
          phaseTransitions: patchPhasePayload(0, { stationOrder: 2 }),
        })],
      }),
    ).toThrow(/rejects malformed phase-transition provenance/);

    expect(() =>
      buildAssembledExamReviewPacket({
        examRunId: EXAM_RUN_ID,
        stations: [edStation({
          phaseTransitions: patchPhasePayload(0, { phase: "note" }),
        })],
      }),
    ).toThrow(/rejects malformed phase-transition provenance/);

    expect(() =>
      buildAssembledExamReviewPacket({
        examRunId: EXAM_RUN_ID,
        stations: [edStation({
          phaseTransitions: patchPhasePayload(0, { durableEventRef: "durable://station-runs/run_ed_001/events/99" }),
        })],
      }),
    ).toThrow(/rejects malformed phase-transition provenance/);

    expect(() =>
      buildAssembledExamReviewPacket({
        examRunId: EXAM_RUN_ID,
        stations: [edStation({
          phaseTransitions: patchPhasePayload(0, { durableEventRef: undefined }),
        })],
      }),
    ).toThrow(/rejects malformed phase-transition provenance/);
  });

  it("rejects malformed phase-transition numerics", () => {
    expect(() =>
      buildAssembledExamReviewPacket({
        examRunId: EXAM_RUN_ID,
        stations: [edStation({
          phaseTransitions: canonicalPhaseTransitions({
            stationRunId: ED_STATION_RUN_ID,
            scenarioId: "ed_chest_pain_priority_v1",
            stationOrder: 1,
            startSequence: 10,
            advanceReason: "patient_note_submitted_advancing",
          }).map((event, index) => (index === 0 ? { ...event, sequence: 10.5 } : event)),
        })],
      }),
    ).toThrow(/rejects malformed phase-transition numerics/);

    expect(() =>
      buildAssembledExamReviewPacket({
        examRunId: EXAM_RUN_ID,
        stations: [edStation({
          phaseTransitions: canonicalPhaseTransitions({
            stationRunId: ED_STATION_RUN_ID,
            scenarioId: "ed_chest_pain_priority_v1",
            stationOrder: 1,
            startSequence: 10,
            advanceReason: "patient_note_submitted_advancing",
          }).map((event, index) => (index === 1 ? { ...event, atSecond: -1 } : event)),
        })],
      }),
    ).toThrow(/rejects malformed phase-transition numerics/);

    expect(() =>
      buildAssembledExamReviewPacket({
        examRunId: EXAM_RUN_ID,
        stations: [edStation({
          phaseTransitions: patchPhasePayload(2, { formAtSecond: Number.NaN }),
        })],
      }),
    ).toThrow(/rejects malformed phase-transition numerics/);
  });

  it("rejects unknown or duplicate phase-transition types", () => {
    expect(() =>
      buildAssembledExamReviewPacket({
        examRunId: EXAM_RUN_ID,
        stations: [edStation({
          phaseTransitions: canonicalPhaseTransitions({
            stationRunId: ED_STATION_RUN_ID,
            scenarioId: "ed_chest_pain_priority_v1",
            stationOrder: 1,
            startSequence: 10,
            advanceReason: "patient_note_submitted_advancing",
          }).map((event, index) => (index === 0 ? { ...event, eventType: "station.skipped" } : event)),
        })],
      }),
    ).toThrow(/rejects unknown phase-transition type/);

    const duplicated = canonicalPhaseTransitions({
      stationRunId: ED_STATION_RUN_ID,
      scenarioId: "ed_chest_pain_priority_v1",
      stationOrder: 1,
      startSequence: 10,
      advanceReason: "patient_note_submitted_advancing",
    });
    const first = duplicated[0];
    const second = duplicated[1];
    if (!first || !second) {
      throw new Error("fixture missing phase transitions");
    }
    duplicated[1] = {
      ...first,
      sequence: 11,
      atSecond: 90,
      payload: {
        ...first.payload,
        formAtSecond: 90,
        durableEventRef: durableEventRef(ED_STATION_RUN_ID, 11),
      },
    };

    expect(() =>
      buildAssembledExamReviewPacket({
        examRunId: EXAM_RUN_ID,
        stations: [edStation({ phaseTransitions: duplicated })],
      }),
    ).toThrow(/rejects duplicate phase-transition type/);
  });

  it("rejects station.advanceReason that disagrees with station.advanced payload", () => {
    expect(() =>
      buildAssembledExamReviewPacket({
        examRunId: EXAM_RUN_ID,
        stations: [edStation({ advanceReason: "last_station_note_submitted_exam_complete" })],
      }),
    ).toThrow(/rejects advance-reason mismatch/);
  });

  it("requires positive unique integer stationOrder", () => {
    expect(() =>
      buildAssembledExamReviewPacket({
        examRunId: EXAM_RUN_ID,
        stations: [edStation({ stationOrder: 0 })],
      }),
    ).toThrow(/requires positive unique integer stationOrder/);

    expect(() =>
      buildAssembledExamReviewPacket({
        examRunId: EXAM_RUN_ID,
        stations: [edStation({ stationOrder: 1.5 })],
      }),
    ).toThrow(/requires positive unique integer stationOrder/);

    expect(() =>
      buildAssembledExamReviewPacket({
        examRunId: EXAM_RUN_ID,
        stations: [edStation(), pedsStation({ stationOrder: 1 })],
      }),
    ).toThrow(/requires positive unique integer stationOrder/);
  });
});

function patchPhasePayload(
  index: number,
  payloadPatch: Record<string, unknown>,
): AssembledExamReviewTraceInput[] {
  return canonicalPhaseTransitions({
    stationRunId: ED_STATION_RUN_ID,
    scenarioId: "ed_chest_pain_priority_v1",
    stationOrder: 1,
    startSequence: 10,
    advanceReason: "patient_note_submitted_advancing",
  }).map((event, eventIndex) => {
    if (eventIndex !== index) {
      return event;
    }
    const nextPayload = { ...event.payload };
    for (const [key, value] of Object.entries(payloadPatch)) {
      if (value === undefined) {
        delete nextPayload[key];
      } else {
        nextPayload[key] = value;
      }
    }
    return { ...event, payload: nextPayload };
  });
}
