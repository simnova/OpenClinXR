/**
 * Exam-run sequence stepping — extracted from apps/ui-xr/src/main.ts (shrink-only SIZE_FREEZE).
 *
 * Pure navigation helpers over the normalised scenario sequence. The composition
 * root keeps the normalised sequence, index, run id and timing in its module
 * state; every function here takes that state as an argument.
 */

import {
  currentExamFormRunStation,
  type ExamFormRunState,
  nextExamFormRunStation,
} from "@openclinxr/exam-assembly";
import { formatStationClock, type LearnerExamFlowPhase } from "@openclinxr/xr-runtime-state";
import { buildExamNavigationUrl, type ExamRunTiming } from "./exam-run-params.js";

export type ExamStationContext = {
  sequence: readonly string[];
  scenarioIndex: number;
  scenarioId: string;
  examRunId: string;
  timing: ExamRunTiming;
};

export function normalizeExamSequence(sequence: readonly string[], scenarioId: string): {
  normalized: readonly string[];
  index: number;
} {
  const normalized = sequence.includes(scenarioId) ? [...sequence] : [scenarioId, ...sequence];
  return { normalized, index: Math.max(0, normalized.indexOf(scenarioId)) };
}

export function nextExamScenarioId(
  formRunState: ExamFormRunState | null,
  context: Pick<ExamStationContext, "sequence" | "scenarioIndex">,
): string | null {
  if (formRunState) {
    const nextFromForm = nextExamFormRunStation(formRunState)?.scenarioId ?? null;
    if (nextFromForm) {
      return nextFromForm;
    }
  }
  return context.sequence[context.scenarioIndex + 1] ?? null;
}

export function buildExamNavigationHref(
  href: string,
  nextScenarioId: string,
  context: ExamStationContext,
): string {
  return buildExamNavigationUrl(href, {
    nextScenarioId,
    sequence: context.sequence,
    examRunId: context.examRunId,
    timing: context.timing,
  });
}

export function formElapsedSecondForCurrentStation(
  formRunState: ExamFormRunState | null,
  elapsedSecond: number,
): number {
  if (!formRunState) {
    return elapsedSecond;
  }
  const station = currentExamFormRunStation(formRunState);
  const stationOffset = station?.timing.doorway.startsAtSecond ?? 0;
  return stationOffset + elapsedSecond;
}

export type ExamRunOutcomeInput = {
  scenarioId: string;
  scenarioIndex: number;
  phase: LearnerExamFlowPhase;
  noteTextLength: number;
  noteSubmitted: boolean;
  lastAdvanceReason: string | null;
  recordedAtIso: string;
  formSecond: number;
};

export type ExamRunStationOutcomeRecord = ExamRunOutcomeInput & {
  stationOrder: number;
  endedAtFormSecond: number | null;
  slotId?: string;
  startedAtFormSecond?: number;
};

export function findFormStationOutcome(
  formRunState: ExamFormRunState | null,
  scenarioIndex: number,
  scenarioId: string,
): ExamFormRunState["stationOutcomes"][number] | undefined {
  const byOrder = formRunState?.stationOutcomes.find(
    (outcome: ExamFormRunState["stationOutcomes"][number]) => outcome.stationOrder === scenarioIndex + 1,
  );
  const byScenario = formRunState?.stationOutcomes.find(
    (outcome: ExamFormRunState["stationOutcomes"][number]) => outcome.scenarioId === scenarioId,
  );
  return byOrder ?? byScenario;
}

export function buildExamRunStationOutcome(
  input: ExamRunOutcomeInput,
  formOutcome: ExamFormRunState["stationOutcomes"][number] | undefined,
): ExamRunStationOutcomeRecord {
  const outcome: ExamRunStationOutcomeRecord = {
    scenarioId: input.scenarioId,
    scenarioIndex: input.scenarioIndex,
    phase: input.phase,
    noteTextLength: input.noteTextLength,
    noteSubmitted: input.noteSubmitted,
    lastAdvanceReason: input.lastAdvanceReason,
    recordedAtIso: formOutcome?.recordedAtIso ?? input.recordedAtIso,
    stationOrder: formOutcome?.stationOrder ?? input.scenarioIndex + 1,
    formSecond: input.formSecond,
    endedAtFormSecond: formOutcome?.endedAtFormSecond ?? input.formSecond,
  };
  if (formOutcome?.slotId !== undefined) {
    outcome.slotId = formOutcome.slotId;
  }
  if (formOutcome?.startedAtFormSecond !== undefined) {
    outcome.startedAtFormSecond = formOutcome.startedAtFormSecond;
  }
  return outcome;
}

export function mergeExamRunStationOutcome<
  TOutcome extends { scenarioId: string; scenarioIndex: number },
>(outcomes: readonly TOutcome[], next: TOutcome): TOutcome[] {
  return [
    ...outcomes.filter(
      (outcome) => outcome.scenarioId !== next.scenarioId || outcome.scenarioIndex !== next.scenarioIndex,
    ),
    next,
  ];
}

export { formatStationClock };
