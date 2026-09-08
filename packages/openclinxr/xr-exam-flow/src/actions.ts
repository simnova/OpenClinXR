import {
  advanceExamFormRunStation,
  persistExamFormRunQueueSnapshot,
  tickExamFormRunClock,
  type ExamAssemblyPersistenceSink,
  type ExamFormRunState,
} from "@openclinxr/xr-runtime-state";
import { createLearnerExamFormRunState, scenariosFromFixtureSequence } from "@openclinxr/xr-scene";

export function persistFormRunQueueSnapshot(
  formRunState: ExamFormRunState,
  sink: ExamAssemblyPersistenceSink,
  options: { snapshotId: string },
): Promise<unknown> {
  return persistExamFormRunQueueSnapshot(formRunState, sink, options);
}

export function createFormRunState(args: {
  examRunId: string;
  scenarioId: string;
  normalizedSequence: readonly string[];
}): ExamFormRunState | null {
  return createLearnerExamFormRunState(
    args.examRunId,
    scenariosFromFixtureSequence(args.normalizedSequence),
    args.scenarioId,
  );
}

export function advanceFormRunClock(
  formRunState: ExamFormRunState | null,
  formElapsedSecond: number,
): ExamFormRunState | null {
  if (!formRunState) return null;
  return tickExamFormRunClock(formRunState, formElapsedSecond);
}

export function recordStationOutcomeOnFormRun(
  formRunState: ExamFormRunState,
  args: { phase: "encounter" | "note" | "complete"; noteSubmitted: boolean; advanceReason: string | null; formSecond: number },
): ExamFormRunState {
  const ticked = tickExamFormRunClock(formRunState, args.formSecond);
  return advanceExamFormRunStation(ticked, {
    phase: args.phase,
    noteSubmitted: args.noteSubmitted,
    advanceReason: args.advanceReason,
    endedAtFormSecond: args.formSecond,
    recordedAtIso: new Date().toISOString(),
  });
}
