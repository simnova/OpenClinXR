import type { ExamForm, ExamTimingPlan } from "@openclinxr/exam-assembly";
import { describe, expect, it } from "vitest";
import {
  resumeAssembledExam,
  type AssembledExamLedgerResumeProjection,
} from "../index.js";

const examRunId = "exam_run_reconnect_001";
const examFormId = "form_reconnect_001";
const blueprintId = "blueprint_reconnect_v1";
const stationA = "run_station_reconnect_a";
const stationB = "run_station_reconnect_b";
const scenarioA = "ed_chest_pain_priority_v1";
const scenarioB = "peds_asthma_parent_anxiety_v1";
const actorId = "patient_robert_hayes_v1";

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

function form(): ExamForm {
  return {
    examFormId,
    blueprintId,
    title: "Two-station reconnect form",
    stationRefs: [
      { order: 1, scenarioId: scenarioA, scenarioVersion: 1, title: "ED chest pain" },
      { order: 2, scenarioId: scenarioB, scenarioVersion: 1, title: "Peds asthma" },
    ],
    coverage: coverage(),
    assemblyIssues: [],
    status: "ready_for_review",
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
    breakWindows: [],
    totalBreakTimeSeconds: 0,
    totalStationTimeSeconds: 2520,
    totalFormTimeSeconds: 2520,
  };
}

function projection(): AssembledExamLedgerResumeProjection {
  return {
    examRunId,
    formIdentity: { examRunId, examFormId, blueprintId },
    orderedStations: [
      { stationOrder: 1, slotId: "slot_a", stationRunId: stationA, scenarioId: scenarioA, scenarioVersion: 1 },
      { stationOrder: 2, slotId: "slot_b", stationRunId: stationB, scenarioId: scenarioB, scenarioVersion: 1 },
    ],
    admittedPhaseEvents: [],
    omissions: [],
  };
}

function interruptedTurn() {
  return {
    stationRunId: stationA,
    actorId,
    conversationTurn: 1,
    startedAtSecond: 120,
    learnerUtterance: "When did the pressure start?",
    turnId: "turn_1_patient_robert_hayes_v1_120",
    planId: "plan_turn_1_patient_robert_hayes_v1_120",
    bargeIn: {
      atSecond: 125,
      atMs: 125000,
      learnerUtterance: "Sorry, one more thing",
    },
    emittedDurableEventRefs: [`durable://station-runs/${stationA}/events/7`],
  };
}

describe("a reconnect restores the interrupted actor turn exactly once", () => {
  it("restores canonical clock position, cancelled modalities, and already-emitted refs on the current station", () => {
    const decision = resumeAssembledExam({
      form: form(),
      timingPlan: timingPlan(),
      projection: projection(),
      interruptedActorTurns: [interruptedTurn()],
    });

    expect(decision.selectedStation?.stationOrder).toBe(1);
    expect(decision.selectedStation?.stationRunId).toBe(stationA);
    const restored = decision.restoredActorTurn;
    expect(restored?.actorId).toBe(actorId);
    expect(restored?.conversationTurn).toBe(1);
    expect(restored?.startedAtSecond).toBe(120);
    expect(restored?.clockMs).toBe(125000);
    expect(restored?.bargeInOutcome).toBe("actor_turn_interrupted");
    expect(restored?.turnId).toBe("turn_1_patient_robert_hayes_v1_120");
    expect(restored?.planId).toBe("plan_turn_1_patient_robert_hayes_v1_120");
    expect(restored?.interruptionId).toBe(
      `${stationA}:turn_1_patient_robert_hayes_v1_120:125000:learner_barge_in`,
    );
    expect(restored?.cancelledModalities).toEqual(["audio", "viseme", "gaze", "posture", "affect"]);
    expect(restored?.alreadyEmittedDurableEventRefs).toEqual([
      `durable://station-runs/${stationA}/events/7`,
    ]);
  });

  it("reports the same restoration on a second reconnect so no turn event is emitted twice", () => {
    const input = {
      form: form(),
      timingPlan: timingPlan(),
      projection: projection(),
      interruptedActorTurns: [interruptedTurn()],
    };
    const first = resumeAssembledExam(input);
    const second = resumeAssembledExam(input);

    expect(second.restoredActorTurn).toEqual(first.restoredActorTurn);
    expect(second.durableEventRefs).toEqual(first.durableEventRefs);
    expect(second.durableEventRefs).not.toContain(`durable://station-runs/${stationA}/events/7`);
  });

  it("leaves restoredActorTurn null when the ledger carries no interrupted turn", () => {
    const decision = resumeAssembledExam({
      form: form(),
      timingPlan: timingPlan(),
      projection: projection(),
    });

    expect(decision.action).toBe("resume_station");
    expect(decision.restoredActorTurn).toBeNull();
  });

  it("derives the canonical clock from atSecond when the barge-in carries no atMs", () => {
    const { bargeIn, ...turn } = interruptedTurn();
    const decision = resumeAssembledExam({
      form: form(),
      timingPlan: timingPlan(),
      projection: projection(),
      interruptedActorTurns: [{ ...turn, bargeIn: { atSecond: bargeIn.atSecond } }],
    });

    expect(decision.restoredActorTurn?.clockMs).toBe(125000);
  });

  it("refuses an interrupted turn recorded for a station that is not current", () => {
    expect(() =>
      resumeAssembledExam({
        form: form(),
        timingPlan: timingPlan(),
        projection: projection(),
        interruptedActorTurns: [{ ...interruptedTurn(), stationRunId: stationB }],
      }),
    ).toThrow(/skipped station identity/);
  });

  it("refuses duplicated interrupted turns for one station run", () => {
    expect(() =>
      resumeAssembledExam({
        form: form(),
        timingPlan: timingPlan(),
        projection: projection(),
        interruptedActorTurns: [interruptedTurn(), interruptedTurn()],
      }),
    ).toThrow(/duplicated station identity/);
  });

  it("restores a plain disconnect with no barge-in outcome and no cancelled modalities", () => {
    const { bargeIn, ...turn } = interruptedTurn();
    void bargeIn;
    const decision = resumeAssembledExam({
      form: form(),
      timingPlan: timingPlan(),
      projection: projection(),
      interruptedActorTurns: [turn],
    });

    expect(decision.restoredActorTurn?.clockMs).toBe(120000);
    expect(decision.restoredActorTurn?.bargeInOutcome).toBeNull();
    expect(decision.restoredActorTurn?.interruptionId).toBeNull();
    expect(decision.restoredActorTurn?.cancelledModalities).toEqual([]);
  });

  it("dedupes already-emitted durable event refs preserving first-seen order", () => {
    const ref = `durable://station-runs/${stationA}/events/7`;
    const decision = resumeAssembledExam({
      form: form(),
      timingPlan: timingPlan(),
      projection: projection(),
      interruptedActorTurns: [{ ...interruptedTurn(), emittedDurableEventRefs: [ref, ref] }],
    });

    expect(decision.restoredActorTurn?.alreadyEmittedDurableEventRefs).toEqual([ref]);
  });
});
