import type { ExamFormRunState, LearnerExamFlowPhase } from "@openclinxr/xr-runtime-state";
import type { formatExamFormRunClock } from "@openclinxr/xr-runtime-state";

export type ExamRunStationOutcome = {
  scenarioId: string;
  scenarioIndex: number;
  phase: LearnerExamFlowPhase;
  noteTextLength: number;
  noteSubmitted: boolean;
  lastAdvanceReason: string | null;
  recordedAtIso: string;
  stationOrder?: number;
  slotId?: string;
  startedAtFormSecond?: number;
  endedAtFormSecond?: number | null;
};

export type OpenClinXrExamFlowEvidence = {
  source: "canonical_assembled_exam_phase_trace" | "local_exam_flow_fallback";
  fallbackActive: boolean;
  fallbackLabel: string | null;
  examRunId: string;
  scenarioId: string;
  scenarioIndex: number;
  totalScenarios: number;
  nextScenarioId: string | null;
  phase: LearnerExamFlowPhase;
  examEquivalenceGate: false;
  encounterDurationSeconds: number;
  noteDurationSeconds: number;
  encounterElapsedSeconds: number;
  noteElapsedSeconds: number;
  encounterRemainingSeconds: number;
  noteRemainingSeconds: number;
  noteTextLength: number;
  noteSubmitted: boolean;
  noteTimeoutElapsed: boolean;
  canAdvanceToNextEncounter: boolean;
  autoAdvanceOnNoteTimeout: boolean;
  lastAdvanceReason: string | null;
  acceleratedByQuery: boolean;
};

export type OpenClinXrExamRunSummaryEvidence = {
  source: "local_exam_run_summary";
  examRunId: string;
  totalScenarios: number;
  stationOutcomes: ExamRunStationOutcome[];
  formElapsedSecond?: number;
  formRemainingSecond?: number;
  examFormRunStatus?: ExamFormRunState["status"];
  examEquivalenceGate?: false;
  notEvidenceFor?: readonly string[];
};

export type OpenClinXrExamFormRunEvidence = {
  source: "exam_assembly_form_run";
  examRunId: string;
  examFormId: string;
  blueprintId: string;
  status: ExamFormRunState["status"];
  currentStationOrder: number | null;
  currentScenarioId: string | null;
  nextScenarioId: string | null;
  scenarioSequence: string[];
  formElapsedSecond: number;
  formRemainingSecond: number;
  totalStationTimeSeconds: number;
  formClockDisplay: ReturnType<typeof formatExamFormRunClock>;
  stationOutcomeCount: number;
  canStartLearnerExam: boolean;
  examEquivalenceGate: false;
  claimBoundary: ExamFormRunState["claimBoundary"];
  notEvidenceFor: ExamFormRunState["notEvidenceFor"];
};
