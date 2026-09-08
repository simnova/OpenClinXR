import type { ExamFormRunState, LearnerCanonicalExamPhaseView } from "@openclinxr/xr-runtime-state";
import {
  currentExamFormRunStation,
  examFormRunScenarioSequence,
  formatExamFormRunClock,
  nextExamFormRunStation,
} from "@openclinxr/xr-runtime-state";
import {
  buildExamRunStationOutcome,
  findFormStationOutcome,
  mergeExamRunStationOutcome,
} from "@openclinxr/xr-runtime-wiring";
import type {
  ExamRunStationOutcome,
  OpenClinXrExamFlowEvidence,
  OpenClinXrExamFormRunEvidence,
  OpenClinXrExamRunSummaryEvidence,
} from "./types.js";

export function readExamRunSummaryOutcomes(
  getItem: (key: string) => string | null,
  key: string,
): ExamRunStationOutcome[] {
  try {
    const parsed = JSON.parse(getItem(key) ?? "[]") as ExamRunStationOutcome[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function buildExamFormRunEvidence(
  formRunState: ExamFormRunState | null,
): OpenClinXrExamFormRunEvidence | null {
  if (!formRunState) return null;
  const current = currentExamFormRunStation(formRunState);
  const next = nextExamFormRunStation(formRunState);
  return {
    source: "exam_assembly_form_run",
    examRunId: formRunState.examRunId,
    examFormId: formRunState.examFormId,
    blueprintId: formRunState.blueprintId,
    status: formRunState.status,
    currentStationOrder: current?.stationOrder ?? null,
    currentScenarioId: current?.scenarioId ?? null,
    nextScenarioId: next?.scenarioId ?? null,
    scenarioSequence: examFormRunScenarioSequence(formRunState),
    formElapsedSecond: formRunState.clock.formElapsedSecond,
    formRemainingSecond: formRunState.clock.formRemainingSecond,
    totalStationTimeSeconds: formRunState.clock.totalStationTimeSeconds,
    formClockDisplay: formatExamFormRunClock(formRunState),
    stationOutcomeCount: formRunState.stationOutcomes.length,
    canStartLearnerExam: formRunState.queue.canStartLearnerExam,
    examEquivalenceGate: false,
    claimBoundary: formRunState.claimBoundary,
    notEvidenceFor: formRunState.notEvidenceFor,
  };
}

export function buildExamRunSummaryEvidence(args: {
  examRunId: string;
  totalScenarios: number;
  outcomes: ExamRunStationOutcome[];
  formRunState: ExamFormRunState | null;
}): OpenClinXrExamRunSummaryEvidence {
  const formClock = args.formRunState ? formatExamFormRunClock(args.formRunState) : null;
  const evidence: OpenClinXrExamRunSummaryEvidence = {
    source: "local_exam_run_summary",
    examRunId: args.examRunId,
    totalScenarios: args.totalScenarios,
    stationOutcomes: args.outcomes,
    examEquivalenceGate: false,
  };
  if (formClock) {
    evidence.formElapsedSecond = formClock.formElapsedSecond;
    evidence.formRemainingSecond = formClock.formRemainingSecond;
  }
  if (args.formRunState) {
    evidence.examFormRunStatus = args.formRunState.status;
    evidence.notEvidenceFor = args.formRunState.notEvidenceFor;
  }
  return evidence;
}

export function buildExamFlowEvidence(args: {
  phaseView: LearnerCanonicalExamPhaseView;
  examRunId: string;
  scenarioId: string;
  scenarioIndex: number;
  totalScenarios: number;
  encounterSeconds: number;
  noteSeconds: number;
  autoAdvanceOnNoteTimeout: boolean;
  nextScenarioId: string | null;
  refusalReason: string | null;
  elapsedSecond: number;
  noteTextLength: number;
}): OpenClinXrExamFlowEvidence {
  const noteElapsedSeconds =
    args.phaseView.noteStartedAtSecond === null
      ? 0
      : Math.max(0, args.elapsedSecond - args.phaseView.noteStartedAtSecond);
  const encounterElapsedSeconds =
    args.phaseView.encounterEndedAtSecond === null
      ? args.elapsedSecond
      : Math.max(0, args.phaseView.encounterEndedAtSecond);
  return {
    source: args.phaseView.source,
    fallbackActive: args.phaseView.fallbackActive,
    fallbackLabel: args.phaseView.fallbackLabel,
    examRunId: args.examRunId,
    scenarioId: args.scenarioId,
    scenarioIndex: args.scenarioIndex,
    totalScenarios: args.totalScenarios,
    nextScenarioId: args.nextScenarioId,
    phase: args.phaseView.phase,
    examEquivalenceGate: false,
    encounterDurationSeconds: args.encounterSeconds,
    noteDurationSeconds: args.noteSeconds,
    encounterElapsedSeconds,
    noteElapsedSeconds,
    encounterRemainingSeconds: Math.max(0, args.encounterSeconds - encounterElapsedSeconds),
    noteRemainingSeconds: Math.max(0, args.noteSeconds - noteElapsedSeconds),
    noteTextLength: args.noteTextLength,
    noteSubmitted: args.phaseView.noteSubmitted,
    noteTimeoutElapsed: args.phaseView.phase === "note" && noteElapsedSeconds >= args.noteSeconds,
    canAdvanceToNextEncounter: args.phaseView.phase === "note" && args.noteTextLength > 0,
    autoAdvanceOnNoteTimeout: args.autoAdvanceOnNoteTimeout,
    lastAdvanceReason: args.refusalReason ?? args.phaseView.lastAdvanceReason,
    acceleratedByQuery: args.encounterSeconds !== 900 || args.noteSeconds !== 600,
  };
}

export function recordStationOutcome(args: {
  scenarioId: string;
  scenarioIndex: number;
  formRunState: ExamFormRunState | null;
  phaseView: LearnerCanonicalExamPhaseView;
  refusalReason: string | null;
  noteTextLength: number;
  formSecond: number;
  outcomes: ExamRunStationOutcome[];
}): ExamRunStationOutcome[] {
  const formOutcome = findFormStationOutcome(args.formRunState, args.scenarioIndex, args.scenarioId);
  const nextOutcome: ExamRunStationOutcome = buildExamRunStationOutcome(
    {
      scenarioId: args.scenarioId,
      scenarioIndex: args.scenarioIndex,
      phase: args.phaseView.phase,
      noteTextLength: args.noteTextLength,
      noteSubmitted: args.phaseView.noteSubmitted,
      lastAdvanceReason: args.refusalReason ?? args.phaseView.lastAdvanceReason,
      recordedAtIso: new Date().toISOString(),
      formSecond: args.formSecond,
    },
    formOutcome,
  );
  return mergeExamRunStationOutcome(args.outcomes, nextOutcome);
}
