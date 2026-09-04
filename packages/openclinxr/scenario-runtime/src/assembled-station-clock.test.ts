import type { ExamForm, ExamTimingPlan } from "@openclinxr/exam-assembly";
import { ASSEMBLED_EXAM_PHASE_BY_TYPE } from "@openclinxr/review-workflow";
import { describe, expect, it } from "vitest";
import { applyAssembledStationTimeouts } from "./assembled-exam-orchestrator.js";
import {
  LAST_STATION_TIMEOUT_ADVANCE_REASON,
  STATION_TIMEOUT_ADVANCE_REASON,
  observeAssembledStationClock,
  type AssembledStationClockAdmittedEvent,
} from "./assembled-station-clock.js";
import type { AssembledStationFormTiming as FormTiming } from "./runtime-types.js";
import { durableEventRef } from "./trace.js";

const formTiming: FormTiming = {
  doorway: { startsAtSecond: 0, endsAtSecond: 60 },
  encounter: { startsAtSecond: 60, endsAtSecond: 960 },
  note: { startsAtSecond: 960, endsAtSecond: 1260 },
};

function started(atSecond = 60): AssembledStationClockAdmittedEvent {
  return { eventType: "encounter.started", formAtSecond: atSecond };
}

describe("assembled station clock", () => {
  it("starts encounter remaining from the persisted encounter.started timestamp after a process restart", () => {
    const admitted = [started(60)];
    const beforeRestart = observeAssembledStationClock({
      formTiming,
      admittedEvents: admitted,
      nowFormSecond: 160,
    });
    expect(beforeRestart.encounterDeadlineFormSecond).toBe(960);
    expect(beforeRestart.remainingEncounterSeconds).toBe(800);
    expect(beforeRestart.dueTimeoutTransitions).toEqual([]);

    const afterRestart = observeAssembledStationClock({
      formTiming,
      admittedEvents: admitted,
      nowFormSecond: 160,
      lastObservedFormSecond: beforeRestart.lastObservedFormSecond,
    });
    expect(afterRestart.remainingEncounterSeconds).toBe(800);
    expect(afterRestart.noteDeadlineFormSecond).toBe(0);
    expect(afterRestart.remainingNoteSeconds).toBe(0);
  });

  it("anchors a delayed encounter.started to start + authored duration, including after restart", () => {
    const admitted = [started(100)];
    const live = observeAssembledStationClock({
      formTiming,
      admittedEvents: admitted,
      nowFormSecond: 160,
    });
    expect(live.encounterDeadlineFormSecond).toBe(1000);
    expect(live.remainingEncounterSeconds).toBe(840);
    expect(live.dueTimeoutTransitions).toEqual([]);

    const stillOpenAtPlannedEnd = observeAssembledStationClock({
      formTiming,
      admittedEvents: admitted,
      nowFormSecond: 960,
      lastObservedFormSecond: 160,
    });
    expect(stillOpenAtPlannedEnd.remainingEncounterSeconds).toBe(40);
    expect(stillOpenAtPlannedEnd.dueTimeoutTransitions).toEqual([]);

    const resumed = observeAssembledStationClock({
      formTiming,
      admittedEvents: admitted,
      nowFormSecond: 160,
      lastObservedFormSecond: 160,
    });
    expect(resumed.remainingEncounterSeconds).toBe(840);
    expect(resumed.encounterDeadlineFormSecond).toBe(1000);
  });

  it("anchors a delayed note.started to start + authored duration after restart", () => {
    const admitted: AssembledStationClockAdmittedEvent[] = [
      started(60),
      { eventType: "encounter.ended", formAtSecond: 960 },
      { eventType: "note.started", formAtSecond: 980 },
    ];
    const live = observeAssembledStationClock({
      formTiming,
      admittedEvents: admitted,
      nowFormSecond: 1080,
    });
    expect(live.noteDeadlineFormSecond).toBe(1280);
    expect(live.remainingNoteSeconds).toBe(200);

    const atPlannedNoteEnd = observeAssembledStationClock({
      formTiming,
      admittedEvents: admitted,
      nowFormSecond: 1260,
      lastObservedFormSecond: 1080,
    });
    expect(atPlannedNoteEnd.remainingNoteSeconds).toBe(20);
    expect(atPlannedNoteEnd.dueTimeoutTransitions).toEqual([]);

    const resumed = observeAssembledStationClock({
      formTiming,
      admittedEvents: admitted,
      nowFormSecond: 1080,
      lastObservedFormSecond: 1080,
    });
    expect(resumed.remainingNoteSeconds).toBe(200);
  });

  it("starts the note deadline from persisted note.started and reconstructs remaining after restart", () => {
    const admitted: AssembledStationClockAdmittedEvent[] = [
      started(60),
      { eventType: "encounter.ended", formAtSecond: 960 },
      { eventType: "note.started", formAtSecond: 960 },
    ];
    const live = observeAssembledStationClock({
      formTiming,
      admittedEvents: admitted,
      nowFormSecond: 1060,
    });
    expect(live.remainingNoteSeconds).toBe(200);
    expect(live.remainingEncounterSeconds).toBe(0);

    const resumed = observeAssembledStationClock({
      formTiming,
      admittedEvents: admitted,
      nowFormSecond: 1060,
      lastObservedFormSecond: live.lastObservedFormSecond,
    });
    expect(resumed.remainingNoteSeconds).toBe(200);
    expect(resumed.dueTimeoutTransitions).toEqual([]);
  });

  it("rejects clock rollback against lastObservedFormSecond and against admitted event timestamps", () => {
    expect(() =>
      observeAssembledStationClock({
        formTiming,
        admittedEvents: [started(60)],
        nowFormSecond: 150,
        lastObservedFormSecond: 160,
      }),
    ).toThrow(/clock rollback/);

    expect(() =>
      observeAssembledStationClock({
        formTiming,
        admittedEvents: [started(60)],
        nowFormSecond: 50,
      }),
    ).toThrow(/clock rollback/);
  });

  it("emits timeout-driven encounter.ended and note.started exactly once at the encounter deadline", () => {
    const first = observeAssembledStationClock({
      formTiming,
      admittedEvents: [started(60)],
      nowFormSecond: 960,
    });
    expect(first.dueTimeoutTransitions.map((transition) => transition.eventType)).toEqual([
      "encounter.ended",
      "note.started",
    ]);
    expect(first.dueTimeoutTransitions.every((transition) => transition.source === "timeout")).toBe(true);
    expect(first.remainingEncounterSeconds).toBe(0);

    const second = observeAssembledStationClock({
      formTiming,
      admittedEvents: [
        started(60),
        { eventType: "encounter.ended", formAtSecond: 960 },
        { eventType: "note.started", formAtSecond: 960 },
      ],
      nowFormSecond: 960,
      lastObservedFormSecond: 960,
    });
    expect(second.dueTimeoutTransitions).toEqual([]);
  });

  it("catch-up after restart past the note window emits each remaining timeout transition exactly once", () => {
    const snapshot = observeAssembledStationClock({
      formTiming,
      admittedEvents: [started(60)],
      nowFormSecond: 2000,
      lastObservedFormSecond: 160,
    });
    expect(snapshot.dueTimeoutTransitions.map((transition) => [transition.eventType, transition.formAtSecond, transition.source])).toEqual([
      ["encounter.ended", 960, "timeout"],
      ["note.started", 960, "timeout"],
      ["note.submitted", 1260, "timeout"],
      ["station.advanced", 1260, "timeout"],
    ]);
    expect(snapshot.dueTimeoutTransitions[3]?.advanceReason).toBe(STATION_TIMEOUT_ADVANCE_REASON);
    expect(new Set(snapshot.dueTimeoutTransitions.map((transition) => transition.eventType)).size).toBe(4);
  });

  it("catch-up after a delayed encounter.started uses generated note.started as the note-submission anchor", () => {
    const snapshot = observeAssembledStationClock({
      formTiming,
      admittedEvents: [started(100)],
      nowFormSecond: 2000,
      lastObservedFormSecond: 160,
    });
    expect(snapshot.dueTimeoutTransitions.map((transition) => [transition.eventType, transition.formAtSecond])).toEqual([
      ["encounter.ended", 1000],
      ["note.started", 1000],
      ["note.submitted", 1300],
      ["station.advanced", 1300],
    ]);
    expect(snapshot.noteDeadlineFormSecond).toBe(1300);
    expect(snapshot.remainingNoteSeconds).toBe(0);
  });

  it("uses the last-station timeout advance reason when the timed-out station is last", () => {
    const snapshot = observeAssembledStationClock({
      formTiming,
      admittedEvents: [
        started(60),
        { eventType: "encounter.ended", formAtSecond: 960 },
        { eventType: "note.started", formAtSecond: 960 },
      ],
      nowFormSecond: 1260,
      isLastStation: true,
    });
    expect(snapshot.dueTimeoutTransitions.map((transition) => transition.eventType)).toEqual([
      "note.submitted",
      "station.advanced",
    ]);
    expect(snapshot.dueTimeoutTransitions[1]?.advanceReason).toBe(LAST_STATION_TIMEOUT_ADVANCE_REASON);
  });

  it("converges a manual note.submitted racing the timeout onto one sequence and keeps the explicit advance reason", () => {
    const snapshot = observeAssembledStationClock({
      formTiming,
      admittedEvents: [
        started(60),
        { eventType: "encounter.ended", formAtSecond: 960 },
        { eventType: "note.started", formAtSecond: 960 },
      ],
      nowFormSecond: 1260,
      manualCompletion: {
        eventType: "note.submitted",
        formAtSecond: 1260,
        advanceReason: "patient_note_submitted_advancing",
      },
    });

    expect(snapshot.dueTimeoutTransitions.map((transition) => transition.eventType)).toEqual([
      "note.submitted",
      "station.advanced",
    ]);
    expect(snapshot.dueTimeoutTransitions[0]?.source).toBe("manual");
    expect(snapshot.dueTimeoutTransitions[1]?.source).toBe("timeout");
    expect(snapshot.dueTimeoutTransitions[1]?.advanceReason).toBe("patient_note_submitted_advancing");
  });

  it("fails closed on malformed admitted timestamps and out-of-order events", () => {
    expect(() =>
      observeAssembledStationClock({
        formTiming,
        admittedEvents: [{ eventType: "encounter.started", formAtSecond: 60.5 }],
        nowFormSecond: 160,
      }),
    ).toThrow(/non-negative integer/);

    expect(() =>
      observeAssembledStationClock({
        formTiming,
        admittedEvents: [{ eventType: "encounter.started", formAtSecond: -1 }],
        nowFormSecond: 160,
      }),
    ).toThrow(/non-negative integer/);

    expect(() =>
      observeAssembledStationClock({
        formTiming,
        admittedEvents: [
          started(60),
          { eventType: "note.started", formAtSecond: 960 },
        ],
        nowFormSecond: 960,
      }),
    ).toThrow(/out-of-order/);
  });

  it("fails closed on foreign or skip-ahead manualCompletion", () => {
    expect(() =>
      observeAssembledStationClock({
        formTiming,
        admittedEvents: [started(60)],
        nowFormSecond: 200,
        manualCompletion: {
          eventType: "note.submitted",
          formAtSecond: 200,
          advanceReason: "patient_note_submitted_advancing",
        },
      }),
    ).toThrow(/foreign manual completion/);

    expect(() =>
      observeAssembledStationClock({
        formTiming,
        admittedEvents: [started(60)],
        nowFormSecond: 200,
        manualCompletion: {
          eventType: "encounter.started",
          formAtSecond: 200,
        },
      }),
    ).toThrow(/foreign manual completion/);

    expect(() =>
      observeAssembledStationClock({
        formTiming,
        admittedEvents: [],
        nowFormSecond: 200,
        manualCompletion: {
          eventType: "encounter.ended",
          formAtSecond: 200,
        },
      }),
    ).toThrow(/foreign manual completion/);

    expect(() =>
      observeAssembledStationClock({
        formTiming,
        admittedEvents: [started(60)],
        nowFormSecond: 200,
        manualCompletion: {
          eventType: "encounter.ended",
          formAtSecond: 199,
        },
      }),
    ).toThrow(/nowFormSecond/);
  });

  it("does not start timeouts until encounter.started is persisted", () => {
    const snapshot = observeAssembledStationClock({
      formTiming,
      admittedEvents: [],
      nowFormSecond: 2000,
    });
    expect(snapshot.dueTimeoutTransitions).toEqual([]);
    expect(snapshot.remainingEncounterSeconds).toBe(0);
    expect(snapshot.remainingNoteSeconds).toBe(0);
  });

  it("wires remaining time and exactly-once timeouts through the assembled exam orchestrator", () => {
    const examRunId = "exam_run_clock_001";
    const examFormId = "form_clock_001";
    const blueprintId = "blueprint_clock_v1";
    const coverage: ExamForm["coverage"] = {
      requiredTraceTags: [],
      coveredTraceTags: [],
      missingTraceTags: [],
      requiredEnvironmentIds: [],
      coveredEnvironmentIds: [],
      missingEnvironmentIds: [],
      requiredSafetyCriticalTraceTags: [],
      coveredSafetyCriticalTraceTags: [],
      missingSafetyCriticalTraceTags: [],
      stationCount: { required: 1, actual: 1, ok: true },
    };
    const form: ExamForm = {
      examFormId,
      blueprintId,
      title: "Clock station",
      stationRefs: [{ order: 1, scenarioId: "ed_chest_pain_priority_v1", scenarioVersion: 1, title: "ED" }],
      coverage,
      assemblyIssues: [],
      status: "ready_for_review",
    };
    const windowAt = (startsAtSecond: number, durationSeconds: number) => ({
      startsAtSecond,
      endsAtSecond: startsAtSecond + durationSeconds,
      durationSeconds,
    });
    const timingPlan: ExamTimingPlan = {
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
      ],
      breakCheckpoints: [],
      totalStationTimeSeconds: 1260,
    };
    const projection = {
      examRunId,
      formIdentity: { examRunId, examFormId, blueprintId },
      orderedStations: [
        {
          stationOrder: 1,
          slotId: "slot_a",
          stationRunId: "run_clock_a",
          scenarioId: "ed_chest_pain_priority_v1",
          scenarioVersion: 1,
        },
      ],
      admittedPhaseEvents: [
        {
          examRunId,
          stationRunId: "run_clock_a",
          sequence: 0,
          eventType: "encounter.started" as const,
          atSecond: 60,
          formAtSecond: 60,
          scenarioId: "ed_chest_pain_priority_v1",
          stationOrder: 1,
          durableEventRef: durableEventRef("run_clock_a", 0),
          phase: ASSEMBLED_EXAM_PHASE_BY_TYPE["encounter.started"],
        },
      ],
      omissions: [],
    };

    const mid = applyAssembledStationTimeouts({
      form,
      timingPlan,
      projection,
      nowFormSecond: 160,
    });
    expect(mid.decision.action).toBe("resume_station");
    expect(mid.clock.remainingEncounterSeconds).toBe(800);
    expect(mid.timeoutTransitions).toEqual([]);

    const catchUp = applyAssembledStationTimeouts({
      form,
      timingPlan,
      projection,
      nowFormSecond: 2000,
      lastObservedFormSecond: 160,
    });
    expect(catchUp.timeoutTransitions.map((transition) => transition.eventType)).toEqual([
      "encounter.ended",
      "note.started",
      "note.submitted",
      "station.advanced",
    ]);
    expect(catchUp.timeoutTransitions[3]?.advanceReason).toBe(LAST_STATION_TIMEOUT_ADVANCE_REASON);

    const delayedStart = projection.admittedPhaseEvents[0];
    expect(delayedStart).toBeDefined();
    if (!delayedStart) {
      return;
    }
    const delayedProjection = {
      ...projection,
      admittedPhaseEvents: [
        {
          ...delayedStart,
          atSecond: 100,
          formAtSecond: 100,
        },
      ],
    };
    const delayed = applyAssembledStationTimeouts({
      form,
      timingPlan,
      projection: delayedProjection,
      nowFormSecond: 960,
      lastObservedFormSecond: 160,
    });
    expect(delayed.clock.encounterDeadlineFormSecond).toBe(1000);
    expect(delayed.clock.remainingEncounterSeconds).toBe(40);
    expect(delayed.timeoutTransitions).toEqual([]);

    const delayedCatchUp = applyAssembledStationTimeouts({
      form,
      timingPlan,
      projection: delayedProjection,
      nowFormSecond: 2000,
      lastObservedFormSecond: 960,
    });
    expect(delayedCatchUp.timeoutTransitions.map((transition) => [transition.eventType, transition.formAtSecond])).toEqual([
      ["encounter.ended", 1000],
      ["note.started", 1000],
      ["note.submitted", 1300],
      ["station.advanced", 1300],
    ]);
  });
});
