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

export type LearnerDebriefReleaseStatus = "active" | "superseded" | "withdrawn";

export type LearnerDebriefRelease = {
  releaseId: string;
  examRunId: string;
  releasedAt: string;
  status: LearnerDebriefReleaseStatus;
};

export type LearnerDebriefObservationCite = {
  sequence?: number;
  eventType?: string;
  tag?: string;
  atFormSecond?: number;
};

export type LearnerDebriefObservationInput = {
  observationId: string;
  rubricItemId: string;
  scenarioId: string;
  scenarioIndex: number;
  formativeText: string;
  evidenceCites: readonly LearnerDebriefObservationCite[];
};

export function buildExamRunSummaryEvidence(args: {
  examRunId: string;
  totalScenarios: number;
  outcomes: ExamRunStationOutcome[];
  formRunState: ExamFormRunState | null;
  learnerDebrief?: {
    release: LearnerDebriefRelease;
    observations: readonly LearnerDebriefObservationInput[];
  };
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
  if (args.learnerDebrief) {
    const { release } = args.learnerDebrief;
    if (release.status !== "active" || release.examRunId !== args.examRunId) {
      evidence.learnerDebriefRefusal = {
        reason: release.examRunId !== args.examRunId
          ? "feedback_release_exam_run_mismatch"
          : "feedback_release_not_active",
        status: release.status,
        releaseId: release.releaseId,
      };
    } else {
      const ordered = [...args.outcomes].sort(
        (left, right) => (left.stationOrder ?? left.scenarioIndex + 1) - (right.stationOrder ?? right.scenarioIndex + 1),
      );
      const unalignedObservationIds: string[] = [];
      evidence.learnerDebrief = {
        source: "released_feedback_learner_debrief",
        releaseId: release.releaseId,
        examRunId: args.examRunId,
        releasedAt: release.releasedAt,
        stations: ordered.map((outcome) => ({
          stationOrder: outcome.stationOrder ?? outcome.scenarioIndex + 1,
          scenarioId: outcome.scenarioId,
          ...(outcome.startedAtFormSecond === undefined ? {} : { startedAtFormSecond: outcome.startedAtFormSecond }),
          ...(outcome.endedAtFormSecond === undefined ? {} : { endedAtFormSecond: outcome.endedAtFormSecond }),
          noteSubmitted: outcome.noteSubmitted,
          observations: (args.learnerDebrief?.observations ?? [])
            .filter((observation) =>
              observation.scenarioId === outcome.scenarioId && observation.scenarioIndex === outcome.scenarioIndex,
            )
            .map((observation) => {
              const evidenceMoments = observation.evidenceCites
                .filter((cite) => citeResolvesToOutcome(cite, outcome))
                .map((cite) => ({
                  ...(cite.sequence === undefined ? {} : { sequence: cite.sequence }),
                  ...(cite.eventType === undefined ? {} : { eventType: cite.eventType }),
                  ...(cite.tag === undefined ? {} : { tag: cite.tag }),
                  ...(cite.atFormSecond === undefined ? {} : { atFormSecond: cite.atFormSecond }),
                }));
              if (evidenceMoments.length !== observation.evidenceCites.length) {
                unalignedObservationIds.push(observation.observationId);
              }
              return {
                observationId: observation.observationId,
                rubricItemId: observation.rubricItemId,
                formativeText: observation.formativeText,
                evidenceMoments,
              };
            }),
        })),
        unalignedObservationIds,
        claimBoundary: "learner_debrief_formative_not_score_use",
        notEvidenceFor: [
          "exam_equivalence",
          "clinical_validity",
          "scoring_validity",
          "automated_scoring",
          "credentialing",
          "production_deployment",
          "faculty_only_annotation",
          "observation_rating",
        ],
        scoringValidityClaimed: false,
        examEquivalenceGate: false,
      };
    }
  }
  return evidence;
}

function citeResolvesToOutcome(
  cite: LearnerDebriefObservationCite,
  outcome: ExamRunStationOutcome,
): boolean {
  if (cite.atFormSecond === undefined) return true;
  const start = outcome.startedAtFormSecond;
  const end = outcome.endedAtFormSecond;
  if (start === undefined) return false;
  if (cite.atFormSecond < start) return false;
  if (end === null || end === undefined) return true;
  return cite.atFormSecond <= end;
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
