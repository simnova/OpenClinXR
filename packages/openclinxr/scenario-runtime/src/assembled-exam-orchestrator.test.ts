import type { ExamForm, ExamTimingPlan } from "@openclinxr/exam-assembly";
import { ASSEMBLED_EXAM_PHASE_BY_TYPE } from "@openclinxr/review-workflow";
import { describe, expect, it } from "vitest";
import {
  assembledExamOrchestratorClaimBoundary,
  assembledExamOrchestratorNotEvidenceFor,
  resumeAssembledExam,
  type AssembledExamAdmittedPhaseEvent,
  type AssembledExamLedgerResumeProjection,
  type AssembledExamLedgerStationBinding,
} from "./assembled-exam-orchestrator.js";
import { durableEventRef } from "./trace.js";

const examRunId = "exam_run_orchestrator_001";
const examFormId = "form_orchestrator_001";
const blueprintId = "blueprint_orchestrator_v1";
const stationA = "run_station_a";
const stationB = "run_station_b";
const scenarioA = "ed_chest_pain_priority_v1";
const scenarioB = "peds_asthma_parent_anxiety_v1";

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

function form(overrides: Partial<ExamForm> = {}): ExamForm {
  return {
    examFormId,
    blueprintId,
    title: "Two-station resume form",
    stationRefs: [
      { order: 1, scenarioId: scenarioA, scenarioVersion: 1, title: "ED chest pain" },
      { order: 2, scenarioId: scenarioB, scenarioVersion: 1, title: "Peds asthma" },
    ],
    coverage: coverage(),
    assemblyIssues: [],
    status: "ready_for_review",
    ...overrides,
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
    blueprintId,
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
    totalStationTimeSeconds: 2520,
  };
}

function stations(): AssembledExamLedgerStationBinding[] {
  return [
    {
      stationOrder: 1,
      slotId: "slot_a",
      stationRunId: stationA,
      scenarioId: scenarioA,
      scenarioVersion: 1,
    },
    {
      stationOrder: 2,
      slotId: "slot_b",
      stationRunId: stationB,
      scenarioId: scenarioB,
      scenarioVersion: 1,
    },
  ];
}

function projection(
  events: AssembledExamAdmittedPhaseEvent[] = [],
  overrides: Partial<AssembledExamLedgerResumeProjection> = {},
): AssembledExamLedgerResumeProjection {
  return {
    examRunId,
    formIdentity: { examRunId, examFormId, blueprintId },
    orderedStations: stations(),
    admittedPhaseEvents: events,
    omissions: [
      { kind: "missing_patient_note", stationRunId: stationA, stationOrder: 1, reason: "no patient-note submission admitted" },
    ],
    ...overrides,
  };
}

function event(
  overrides: Partial<AssembledExamAdmittedPhaseEvent> & Pick<AssembledExamAdmittedPhaseEvent, "eventType">,
): AssembledExamAdmittedPhaseEvent {
  const sequence = overrides.sequence ?? 0;
  const stationRunId = overrides.stationRunId ?? stationA;
  const eventType = overrides.eventType;
  return {
    examRunId,
    stationRunId,
    sequence,
    eventType,
    atSecond: overrides.atSecond ?? 60,
    formAtSecond: overrides.formAtSecond ?? 60,
    scenarioId: overrides.scenarioId ?? scenarioA,
    stationOrder: overrides.stationOrder ?? 1,
    durableEventRef: overrides.durableEventRef ?? durableEventRef(stationRunId, sequence),
    phase: ASSEMBLED_EXAM_PHASE_BY_TYPE[eventType],
    ...(overrides.advanceReason ? { advanceReason: overrides.advanceReason } : {}),
  };
}

function stationOneThrough(last: AssembledExamAdmittedPhaseEvent["eventType"]): AssembledExamAdmittedPhaseEvent[] {
  const types = [
    "encounter.started",
    "encounter.ended",
    "note.started",
    "note.submitted",
    "station.advanced",
  ] as const;
  const end = types.indexOf(last);
  return types.slice(0, end + 1).map((eventType, index) =>
    event({
      eventType,
      sequence: index,
      atSecond: 60 + index * 10,
      formAtSecond: 60 + index * 10,
      ...(eventType === "station.advanced" ? { advanceReason: "patient_note_submitted_advancing" } : {}),
    }),
  );
}

describe("assembled exam orchestrator", () => {
  it("resumes station 1 with reconstructed lifecycle when the ledger has no phase events", () => {
    const decision = resumeAssembledExam({
      form: form(),
      timingPlan: timingPlan(),
      projection: projection(),
    });

    expect(decision.action).toBe("resume_station");
    expect(decision.examRunId).toBe(examRunId);
    expect(decision.examEquivalenceGate).toBe(false);
    expect(decision.claimBoundary).toBe(assembledExamOrchestratorClaimBoundary);
    expect(decision.notEvidenceFor).toEqual(assembledExamOrchestratorNotEvidenceFor);
    expect(decision.selectedStation?.stationOrder).toBe(1);
    expect(decision.selectedStation?.scenarioId).toBe(scenarioA);
    expect(decision.selectedStation?.stationRunId).toBe(stationA);
    expect(decision.selectedStation?.lifecycle).toEqual({
      lastAdmittedEventType: null,
      nextExpectedEventType: "encounter.started",
      admittedEventTypes: [],
      durableEventRefs: [],
      noteSubmitted: false,
      phase: "not_started",
    });
    expect(decision.selectedStation?.assembledStation).toEqual({
      examRunId,
      scenarioId: scenarioA,
      stationOrder: 1,
      formTiming: {
        doorway: { startsAtSecond: 0, endsAtSecond: 60 },
        encounter: { startsAtSecond: 60, endsAtSecond: 960 },
        note: { startsAtSecond: 960, endsAtSecond: 1260 },
      },
    });
    expect(decision.omissions).toEqual(projection().omissions);
  });

  it("keeps the current station and refuses advance until note.submitted is admitted", () => {
    const decision = resumeAssembledExam({
      form: form(),
      timingPlan: timingPlan(),
      projection: projection(stationOneThrough("encounter.ended")),
    });

    expect(decision.action).toBe("resume_station");
    expect(decision.selectedStation?.stationOrder).toBe(1);
    expect(decision.selectedStation?.lifecycle.lastAdmittedEventType).toBe("encounter.ended");
    expect(decision.selectedStation?.lifecycle.nextExpectedEventType).toBe("note.started");
    expect(decision.selectedStation?.lifecycle.noteSubmitted).toBe(false);
    expect(decision.durableEventRefs).toEqual([
      durableEventRef(stationA, 0),
      durableEventRef(stationA, 1),
    ]);
  });

  it("emits advance_station only after admitted note.submitted and does not select station 2", () => {
    const decision = resumeAssembledExam({
      form: form(),
      timingPlan: timingPlan(),
      projection: projection(stationOneThrough("note.submitted")),
    });

    expect(decision.action).toBe("advance_station");
    expect(decision.selectedStation?.stationOrder).toBe(1);
    expect(decision.selectedStation?.lifecycle.noteSubmitted).toBe(true);
    expect(decision.selectedStation?.lifecycle.lastAdmittedEventType).toBe("note.submitted");
    expect(decision.selectedStation?.lifecycle.nextExpectedEventType).toBe("station.advanced");
  });

  it("resumes the exact next station after station.advanced is admitted", () => {
    const decision = resumeAssembledExam({
      form: form(),
      timingPlan: timingPlan(),
      projection: projection(stationOneThrough("station.advanced")),
    });

    expect(decision.action).toBe("resume_station");
    expect(decision.selectedStation?.stationOrder).toBe(2);
    expect(decision.selectedStation?.scenarioId).toBe(scenarioB);
    expect(decision.selectedStation?.stationRunId).toBe(stationB);
    expect(decision.selectedStation?.lifecycle.nextExpectedEventType).toBe("encounter.started");
    expect(decision.selectedStation?.assembledStation.formTiming.encounter.startsAtSecond).toBe(1320);
  });

  it("marks the exam complete when every form station has station.advanced", () => {
    const events = [
      ...stationOneThrough("station.advanced"),
      event({
        eventType: "encounter.started",
        stationRunId: stationB,
        scenarioId: scenarioB,
        stationOrder: 2,
        sequence: 0,
        atSecond: 1320,
        formAtSecond: 1320,
      }),
      event({
        eventType: "encounter.ended",
        stationRunId: stationB,
        scenarioId: scenarioB,
        stationOrder: 2,
        sequence: 1,
        atSecond: 1330,
        formAtSecond: 1330,
      }),
      event({
        eventType: "note.started",
        stationRunId: stationB,
        scenarioId: scenarioB,
        stationOrder: 2,
        sequence: 2,
        atSecond: 2220,
        formAtSecond: 2220,
      }),
      event({
        eventType: "note.submitted",
        stationRunId: stationB,
        scenarioId: scenarioB,
        stationOrder: 2,
        sequence: 3,
        atSecond: 2230,
        formAtSecond: 2230,
      }),
      event({
        eventType: "station.advanced",
        stationRunId: stationB,
        scenarioId: scenarioB,
        stationOrder: 2,
        sequence: 4,
        atSecond: 2240,
        formAtSecond: 2240,
        advanceReason: "last_station_note_submitted_exam_complete",
      }),
    ];
    const decision = resumeAssembledExam({
      form: form(),
      timingPlan: timingPlan(),
      projection: projection(events),
    });
    expect(decision.action).toBe("exam_complete");
    expect(decision.selectedStation).toBeNull();
    expect(decision.durableEventRefs).toHaveLength(10);
  });

  it("refuses skipped station identities when a later station has events before the prior advanced", () => {
    expect(() =>
      resumeAssembledExam({
        form: form(),
        timingPlan: timingPlan(),
        projection: projection([
          event({
            eventType: "encounter.started",
            stationRunId: stationB,
            scenarioId: scenarioB,
            stationOrder: 2,
            sequence: 0,
            atSecond: 1320,
            formAtSecond: 1320,
          }),
        ]),
      }),
    ).toThrow(/skipped station identity/);
  });

  it("refuses a requested station that is not the deterministic current station", () => {
    expect(() =>
      resumeAssembledExam({
        form: form(),
        timingPlan: timingPlan(),
        projection: projection(),
        requestedStation: { stationOrder: 2, scenarioId: scenarioB, stationRunId: stationB },
      }),
    ).toThrow(/skipped station identity/);
  });

  it("refuses duplicated form station orders", () => {
    expect(() =>
      resumeAssembledExam({
        form: form({
          stationRefs: [
            { order: 1, scenarioId: scenarioA, scenarioVersion: 1, title: "A" },
            { order: 1, scenarioId: scenarioB, scenarioVersion: 1, title: "B" },
          ],
        }),
        timingPlan: timingPlan(),
        projection: projection(),
      }),
    ).toThrow(/duplicated station identity/);
  });

  it("refuses out-of-form projection scenario/order identities", () => {
    expect(() =>
      resumeAssembledExam({
        form: form(),
        timingPlan: timingPlan(),
        projection: projection([], {
          orderedStations: [
            stations()[0]!,
            { ...stations()[1]!, scenarioId: "clinic_abdominal_pain_interpreter_v1" },
          ],
        }),
      }),
    ).toThrow(/out-of-form station identity/);
  });

  it("refuses duplicated projection stationRunId", () => {
    expect(() =>
      resumeAssembledExam({
        form: form(),
        timingPlan: timingPlan(),
        projection: projection([], {
          orderedStations: [
            stations()[0]!,
            { ...stations()[1]!, stationRunId: stationA },
          ],
        }),
      }),
    ).toThrow(/duplicated station identity/);
  });
});
