import { describe, expect, it } from "vitest";
import {
  buildExamFlowEvidence,
  buildExamFormRunEvidence,
  buildExamRunSummaryEvidence,
  createExamFlowStore,
  createFormRunState,
  readExamRunSummaryOutcomes,
  recordStationOutcome,
} from "./index.js";

function stubAccessors() {
  const persistPhase: Array<unknown> = [];
  const persistOutcomes: Array<unknown> = [];
  let formRunState = createFormRunState({
    examRunId: "local_test",
    scenarioId: "ed_chest_pain_priority_v1",
    normalizedSequence: ["ed_chest_pain_priority_v1"],
  });
  const syncCalls: Array<{ atSecond: number; noteText: string; kind: string }> = [];
  const navigated: string[] = [];
  return {
    store: {
      getElapsedSecond: () => 0,
      getFormElapsedSecond: () => 0,
      getNoteText: () => "",
      getFormRunState: () => formRunState,
      setFormRunState: (next: typeof formRunState) => {
        formRunState = next;
      },
      getPersistenceSink: () => undefined,
      getNextScenarioId: () => null,
      navigateToScenario: (next: string) => {
        navigated.push(next);
      },
      syncRemotePhase: (input: { atSecond: number; noteText: string; kind: string }) => {
        syncCalls.push(input);
      },
      persistPhaseTrace: (value: unknown) => {
        persistPhase.push(value);
      },
      persistOutcomes: (value: Parameters<Parameters<typeof createExamFlowStore>[1]["persistOutcomes"]>[0]) => {
        persistOutcomes.push(value);
      },
      readOutcomes: () => [],
      updateFormEvidence: () => {},
      readPhaseTraceJson: () => null,
      persistPhase,
      persistOutcomesList: persistOutcomes,
      syncCalls,
      navigated,
    },
  };
}

describe("exam flow store", () => {
  it("applies end_encounter and transitions encounter to note", () => {
    const { store } = stubAccessors();
    const flow = createExamFlowStore(
      {
        examRunId: "local_test",
        stationRunId: "station_run_local_test_ed_chest_pain_priority_v1_1",
        scenarioId: "ed_chest_pain_priority_v1",
        stationOrder: 1,
        encounterSeconds: 900,
        noteSeconds: 600,
        autoAdvanceOnNoteTimeout: true,
      },
      store,
    );
    expect(recordStationOutcome).toBeDefined();
    expect(buildExamFormRunEvidence).toBeDefined();
    expect(buildExamRunSummaryEvidence).toBeDefined();
    expect(readExamRunSummaryOutcomes).toBeDefined();
    flow.applyIntent("end_encounter");
    expect(store.persistPhase).toHaveLength(1);
    expect(store.syncCalls).toHaveLength(1);
  });

  it("builds flow evidence with the phase transition visible", () => {
    const formRunState = createFormRunState({
      examRunId: "local_test",
      scenarioId: "ed_chest_pain_priority_v1",
      normalizedSequence: ["ed_chest_pain_priority_v1"],
    });
    const evidence = buildExamFlowEvidence({
      phaseView: {
        source: "local_exam_flow_fallback",
        fallbackActive: true,
        fallbackLabel: "local-only fallback",
        examRunId: "local_test",
        scenarioId: "ed_chest_pain_priority_v1",
        stationOrder: 1,
        phase: "note",
        lastAdvanceReason: "encounter_ended_note_phase_started",
        lastAdmittedSequence: 1,
        admittedCount: 2,
        encounterEndedAtSecond: 10,
        noteStartedAtSecond: 10,
        noteSubmitted: false,
        examEquivalenceGate: false,
        claimBoundary: "learner_ui_xr_canonical_phase_trace_not_exam_equivalence",
        notEvidenceFor: ["exam_equivalence", "clinical_validity", "scoring_validity", "quest_readiness"],
      },
      examRunId: "local_test",
      scenarioId: "ed_chest_pain_priority_v1",
      scenarioIndex: 0,
      totalScenarios: 1,
      encounterSeconds: 900,
      noteSeconds: 600,
      autoAdvanceOnNoteTimeout: true,
      nextScenarioId: null,
      refusalReason: null,
      elapsedSecond: 20,
      noteTextLength: 5,
    });
    expect(evidence.phase).toBe("note");
    expect(evidence.canAdvanceToNextEncounter).toBe(true);
    expect(formRunState).not.toBeNull();
  });
});
