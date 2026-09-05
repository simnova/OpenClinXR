import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import type { ActorTurnExecution, ActorTurnPlan } from "@openclinxr/shared-schemas";
import {
  ASSEMBLED_EXAM_PHASE_TRANSITION_TYPES,
  assembledExamReviewNotEvidenceFor,
  buildAssembledExamReviewPacket,
  type AssembledExamReviewTraceInput,
  type AssembledExamStationEvidenceInput,
} from "@openclinxr/review-workflow";
import { afterEach, describe, expect, it, vi } from "vitest";
import { assembledExamDerivedBlockers } from "@openclinxr/ui-shared/assembled-exam-replay-timeline";
import {
  actorTurnDurableRef,
  assembledExamReplayProjectionFromReviewPacket,
  assembledExamReviewPacketPath,
  FacultyAdjudicationWorkspace,
  fetchAssembledExamReviewPacket,
  patientNoteDurableRef,
} from "./FacultyAdjudicationWorkspace.js";

const EXAM_RUN_ID = "exam_run_faculty_001";
const ED_STATION_RUN_ID = "run_ed_001";
const PEDS_STATION_RUN_ID = "run_peds_001";
const INCOMPLETE_STATION_RUN_ID = "run_incomplete_001";
const PLAN_ID = "plan_maya_wob_001";
const TURN_ID = "turn_maya_wob_001";

describe("the faculty adjudication workspace preserves assembled evidence", () => {
  afterEach(() => {
    cleanup();
  });

  it("fetches the immutable production packet and renders ordered stations, canonical transitions, notes, actor provenance, blockers, and a non-scoring disposition", async () => {
    const packet = completeAssembledPacket();
    expect(packet.stations[0]?.phaseTransitions.map((event) => event.eventType)).toEqual([
      ...ASSEMBLED_EXAM_PHASE_TRANSITION_TYPES,
    ]);
    expect(assembledExamDerivedBlockers(assembledExamReplayProjectionFromReviewPacket(packet).stations[0]!)).toEqual([]);
    const loadPacket = vi.fn(async () => packet);

    render(
      <FacultyAdjudicationWorkspace examRunId={EXAM_RUN_ID} loadPacket={loadPacket} />,
    );

    expect(loadPacket).toHaveBeenCalledWith(EXAM_RUN_ID);

    const workspace = await screen.findByLabelText("Faculty adjudication workspace");
    expect(workspace).toHaveTextContent(EXAM_RUN_ID);
    expect(workspace).toHaveTextContent("assembled_exam_review_packet_not_exam_equivalence");
    expect(workspace).toHaveTextContent("faculty_adjudication_workspace_not_score_use_or_clinical_validity");
    expect(workspace).toHaveTextContent("examEquivalenceGate false; scoring false; clinical false");
    expect(workspace).toHaveTextContent("does not approve score use, clinical validity, exam equivalence, or Quest readiness");
    expect(workspace).toHaveTextContent("not evidence for exam_equivalence");
    expect(workspace).toHaveTextContent("clinical_validity");
    expect(workspace).toHaveTextContent("scoring_validity");
    expect(packet.notEvidenceFor).toEqual([...assembledExamReviewNotEvidenceFor]);

    const orderedStatus = within(workspace).getByLabelText("Ordered station status");
    expect(orderedStatus).toHaveTextContent("Station 1: ed_chest_pain_priority_v1");
    expect(orderedStatus).toHaveTextContent("Station 2: peds_asthma_parent_anxiety_v1");
    expect(orderedStatus).toHaveTextContent("Station 3: incomplete_station_started_only_v1");
    expect(orderedStatus).toHaveTextContent("complete_encounter_to_note_timeline");
    expect(orderedStatus).toHaveTextContent("summary_only_station_started");

    const timeline = within(workspace).getByLabelText("Assembled exam replay timeline");
    expect(within(timeline).getAllByLabelText(/Assembled station \d /).map((node) => node.getAttribute("aria-label"))).toEqual([
      "Assembled station 1 ed_chest_pain_priority_v1",
      "Assembled station 2 peds_asthma_parent_anxiety_v1",
      "Assembled station 3 incomplete_station_started_only_v1",
    ]);
    const completeEd = within(timeline).getByLabelText("Assembled station 1 ed_chest_pain_priority_v1");
    expect(completeEd).toHaveTextContent("encounter.started at 60s (form 60s)");
    expect(completeEd).toHaveTextContent("encounter.ended at 900s (form 900s)");
    expect(completeEd).toHaveTextContent("note.started at 900s (form 900s)");
    expect(completeEd).toHaveTextContent("note.submitted at 1260s (form 1260s)");
    expect(completeEd).toHaveTextContent("station.advanced at 1260s (form 1260s)");
    expect(completeEd).toHaveTextContent("durable://station-runs/run_ed_001/events/10");
    expect(completeEd).toHaveTextContent("patient_note_submitted_advancing");
    expect(completeEd.textContent).not.toContain("Concern for ACS");
    expect(completeEd.textContent).not.toContain("It feels tight when I breathe");
    expect(completeEd.textContent).not.toContain("Private learner utterance");

    const notes = within(workspace).getByLabelText("Submitted patient notes");
    expect(notes).toHaveTextContent("Concern for ACS. ECG requested.");
    expect(notes).toHaveTextContent("Work of breathing assessed. Parent anxiety noted.");
    expect(notes).toHaveTextContent(patientNoteDurableRef(ED_STATION_RUN_ID, 1260));
    expect(notes).toHaveTextContent("Station 3 patient note missing");

    const provenance = within(workspace).getByLabelText("Actor turn provenance");
    expect(provenance).toHaveTextContent("patient_maya_johnson_v1");
    expect(provenance).toHaveTextContent("plan plan_maya_wob_001");
    expect(provenance).toHaveTextContent("execution truncated");
    expect(provenance).toHaveTextContent("caption It feels tight when I breathe.");
    expect(provenance).toHaveTextContent(actorTurnDurableRef(PEDS_STATION_RUN_ID, PLAN_ID));
    expect(provenance.textContent).not.toContain("<soft>");
    expect(provenance.textContent).not.toContain("[breath]");
    expect(provenance).toHaveTextContent("Station 1 no actor-turn provenance");

    const blockers = within(workspace).getByLabelText("Assembled exam blockers and omissions");
    expect(blockers).toHaveTextContent("missing_phase_transition:encounter.started");
    expect(blockers).toHaveTextContent("missing_patient_note");
    expect(blockers).toHaveTextContent("missing_advance_reason");
    expect(blockers).toHaveTextContent("out_of_order_phase_transition");

    fireEvent.click(within(workspace).getByLabelText("Record disposition hold_for_debrief"));
    const recorded = within(workspace).getByLabelText("Recorded faculty disposition");
    expect(recorded).toHaveTextContent("hold_for_debrief");
    expect(recorded).toHaveTextContent("scoringValidityClaimed false");
    expect(recorded).toHaveTextContent("examEquivalenceGate false");
    expect(recorded).toHaveTextContent("clinicalValidityClaimed false");
    expect(recorded).toHaveTextContent("faculty_adjudication_disposition_not_score_use_or_clinical_validity");

    expect(workspace.textContent).not.toContain("Private learner utterance must stay out of exam packet summaries.");
    expect(workspace.textContent).not.toContain("Quest ready");
    expect(workspace.textContent).not.toContain("score ready");
    expect(workspace.textContent).not.toContain("clinically valid");
    expect(workspace.textContent).not.toContain("<soft>It feels tight when I breathe. [breath]</soft>");
  });

  it("fails closed on empty, wrong-boundary, equivalence-enabled, malformed, and injected cross-exam packets without rendering timeline or disposition", async () => {
    const packet = completeAssembledPacket();
    const cases: Array<{ name: string; raw: unknown }> = [
      { name: "empty object", raw: {} },
      { name: "wrong claim boundary", raw: { ...packet, claimBoundary: "unsafe_exam_equivalence_packet" } },
      { name: "enabled equivalence posture", raw: { ...packet, examEquivalenceGate: true } },
      {
        name: "malformed station",
        raw: {
          ...packet,
          stations: [{ identity: { examRunId: EXAM_RUN_ID } }],
        },
      },
      { name: "injected cross-exam packet", raw: { ...packet, examRunId: "exam_run_other_001" } },
    ];

    for (const testCase of cases) {
      cleanup();
      render(
        <FacultyAdjudicationWorkspace
          examRunId={EXAM_RUN_ID}
          loadPacket={async () => testCase.raw}
        />,
      );
      const workspace = await screen.findByLabelText("Faculty adjudication workspace");
      expect(await screen.findByText("Assembled exam review packet unavailable"), testCase.name).toBeInTheDocument();
      expect(screen.queryByLabelText("Assembled exam replay timeline"), testCase.name).not.toBeInTheDocument();
      expect(screen.queryByLabelText("Faculty review disposition"), testCase.name).not.toBeInTheDocument();
      expect(screen.queryByLabelText("Record disposition hold_for_debrief"), testCase.name).not.toBeInTheDocument();
      expect(workspace.textContent, testCase.name).not.toContain("complete_encounter_to_note_timeline");
    }
  });

  it("GETs the production assembled-review-packet path and refuses a mutated exam identity", async () => {
    const packet = completeAssembledPacket();
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      expect(String(input)).toBe(assembledExamReviewPacketPath(EXAM_RUN_ID));
      return {
        ok: true,
        json: async () => ({ ...packet, examRunId: "exam_run_forged" }),
      } as Response;
    });

    await expect(
      fetchAssembledExamReviewPacket(EXAM_RUN_ID, { baseUrl: "", fetch: fetchMock }),
    ).rejects.toThrow("stale_identity:exam_run_mismatch");
    expect(fetchMock).toHaveBeenCalledOnce();
  });
});

function completeAssembledPacket() {
  return buildAssembledExamReviewPacket({
    examRunId: EXAM_RUN_ID,
    learnerId: "learner_faculty_001",
    stations: [edStation(), pedsStation(), incompleteStation()],
  });
}

function samplePlan(): ActorTurnPlan {
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
  };
}

function sampleExecution(): ActorTurnExecution {
  return {
    planId: PLAN_ID,
    turnId: TURN_ID,
    interruption: { kind: "truncated" },
    renderedProsodyTags: ["<soft>"],
    droppedProsodyTags: ["[breath]"],
    fallback: { language: false, tts: false },
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
  };
}

function pedsStation(): AssembledExamStationEvidenceInput {
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
  };
}

function incompleteStation(): AssembledExamStationEvidenceInput {
  return {
    stationRunId: INCOMPLETE_STATION_RUN_ID,
    scenarioId: "incomplete_station_started_only_v1",
    stationOrder: 3,
    requiredTraceTags: [],
    traceEvents: [
      {
        stationRunId: INCOMPLETE_STATION_RUN_ID,
        sequence: 0,
        eventType: "station.started",
        source: "system",
        atSecond: 0,
      },
    ],
    phaseTransitions: [],
    blockers: ["out_of_order_phase_transition"],
    advanceReason: null,
    facultyScoreDraft: {
      reviewerId: "faculty_001",
      status: "draft",
      comments: "",
    },
  };
}
