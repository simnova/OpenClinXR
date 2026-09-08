import type {
  ExamAssemblyPersistenceSink,
  ExamFormRunState,
  LearnerCanonicalPhaseTraceStore,
  ManualEvidenceCopyDisposition,
} from "@openclinxr/xr-runtime-state";
import {
  advanceExamFormRunStation,
  applyLearnerExamFlowIntent,
  createLearnerCanonicalPhaseTraceStore,
  persistExamFormRunQueueSnapshot,
  restoreLearnerCanonicalPhaseTraceFromJson,
  tickExamFormRunClock,
  viewLearnerCanonicalExamPhase,
} from "@openclinxr/xr-runtime-state";
import { recordStationOutcome } from "./evidence.js";
import type { ExamRunStationOutcome } from "./types.js";

export type ExamFlowIntentKind =
  | "end_encounter"
  | "submit_note"
  | "encounter_timer_elapsed"
  | "note_timer_elapsed";

export type ExamFlowRuntimeAccessors = {
  getElapsedSecond: () => number;
  getFormElapsedSecond: () => number;
  getNoteText: () => string;
  getFormRunState: () => ExamFormRunState | null;
  setFormRunState: (next: ExamFormRunState | null) => void;
  getPersistenceSink: () => ExamAssemblyPersistenceSink | undefined;
  getNextScenarioId: () => string | null;
  navigateToScenario: (nextScenarioId: string) => void;
  syncRemotePhase: (input: { atSecond: number; noteText: string; kind: ExamFlowIntentKind }) => void;
  persistPhaseTrace: (store: LearnerCanonicalPhaseTraceStore) => void;
  readPhaseTraceJson: () => string | null;
  persistOutcomes: (outcomes: ExamRunStationOutcome[]) => void;
  readOutcomes: () => ExamRunStationOutcome[];
  updateFormEvidence: () => void;
};

export type ExamFlowIdentity = {
  examRunId: string;
  stationRunId: string;
  scenarioId: string;
  stationOrder: number;
  encounterSeconds: number;
  noteSeconds: number;
  autoAdvanceOnNoteTimeout: boolean;
};

export function createExamFlowStore(
  identity: ExamFlowIdentity,
  accessors: ExamFlowRuntimeAccessors,
): {
  getPhaseStore: () => LearnerCanonicalPhaseTraceStore;
  getRefusalReason: () => string | null;
  getNoteTimeoutHandled: () => boolean;
  getCopyDisposition: () => ManualEvidenceCopyDisposition;
  setCopyDisposition: (next: ManualEvidenceCopyDisposition) => void;
  applyIntent: (kind: ExamFlowIntentKind) => void;
  advanceForElapsedTime: () => void;
  advanceNoteForElapsedTime: () => void;
} {
  let phaseStore = restoreLearnerCanonicalPhaseTraceFromJson(
    createLearnerCanonicalPhaseTraceStore({
      examRunId: identity.examRunId,
      stationRunId: identity.stationRunId,
      scenarioId: identity.scenarioId,
      stationOrder: identity.stationOrder,
    }),
    accessors.readPhaseTraceJson(),
  );
  let refusalReason: string | null = null;
  let noteTimeoutHandled = false;
  let copyDisposition: ManualEvidenceCopyDisposition = "not_copied";

  function recordOutcome(): void {
    const formRunState = accessors.getFormRunState();
    const formSecond = accessors.getFormElapsedSecond();
    const phaseView = viewLearnerCanonicalExamPhase(phaseStore);
    if (formRunState) {
      const ticked = tickExamFormRunClock(formRunState, formSecond);
      const advanced = advanceExamFormRunStation(ticked, {
        phase: phaseView.phase,
        noteSubmitted: phaseView.noteSubmitted,
        advanceReason: refusalReason ?? phaseView.lastAdvanceReason,
        endedAtFormSecond: formSecond,
        recordedAtIso: new Date().toISOString(),
      });
      accessors.setFormRunState(advanced);
      accessors.updateFormEvidence();
      const sink = accessors.getPersistenceSink();
      if (sink) {
        void persistExamFormRunQueueSnapshot(advanced, sink, {
          snapshotId: `queue_snapshot_${identity.examRunId}_station_${identity.stationOrder}`,
          reviewerId: "ui_xr_learner_runtime",
        }).catch(() => undefined);
      }
    }
    const next = recordStationOutcome({
      scenarioId: identity.scenarioId,
      scenarioIndex: identity.stationOrder - 1,
      formRunState: accessors.getFormRunState(),
      phaseView: viewLearnerCanonicalExamPhase(phaseStore),
      refusalReason,
      noteTextLength: accessors.getNoteText().trim().length,
      formSecond: accessors.getFormElapsedSecond(),
      outcomes: accessors.readOutcomes(),
    });
    accessors.persistOutcomes(next);
    accessors.updateFormEvidence();
  }

  function applyIntent(kind: ExamFlowIntentKind): void {
    const applied = applyLearnerExamFlowIntent(phaseStore, {
      kind,
      atSecond: accessors.getElapsedSecond(),
      formAtSecond: accessors.getFormElapsedSecond(),
      noteTextLength: accessors.getNoteText().trim().length,
      nextScenarioId: accessors.getNextScenarioId(),
      autoAdvanceOnNoteTimeout: identity.autoAdvanceOnNoteTimeout,
    });
    phaseStore = applied.store;
    refusalReason = applied.refusalReason;
    accessors.persistPhaseTrace(phaseStore);
    if (applied.admitted && applied.view.noteSubmitted) recordOutcome();
    accessors.updateFormEvidence();
    accessors.syncRemotePhase({
      atSecond: accessors.getFormElapsedSecond(),
      noteText: accessors.getNoteText(),
      kind,
    });
    if (applied.navigateToScenarioId) accessors.navigateToScenario(applied.navigateToScenarioId);
  }

  function advanceForElapsedTime(): void {
    const phaseView = viewLearnerCanonicalExamPhase(phaseStore);
    if (phaseView.phase !== "encounter" || phaseView.encounterEndedAtSecond !== null) return;
    if (accessors.getElapsedSecond() < identity.encounterSeconds) return;
    applyIntent("encounter_timer_elapsed");
  }

  function advanceNoteForElapsedTime(): void {
    const phaseView = viewLearnerCanonicalExamPhase(phaseStore);
    if (phaseView.phase !== "note" || phaseView.noteStartedAtSecond === null || noteTimeoutHandled) return;
    if (accessors.getElapsedSecond() - phaseView.noteStartedAtSecond < identity.noteSeconds) return;
    noteTimeoutHandled = true;
    applyIntent("note_timer_elapsed");
  }

  return {
    getPhaseStore: () => phaseStore,
    getRefusalReason: () => refusalReason,
    getNoteTimeoutHandled: () => noteTimeoutHandled,
    getCopyDisposition: () => copyDisposition,
    setCopyDisposition: (next) => {
      copyDisposition = next;
    },
    applyIntent,
    advanceForElapsedTime,
    advanceNoteForElapsedTime,
  };
}
