import { advanceExamFormRunStation, currentExamFormRunStation } from "../exam-run.js";
import type {
  ExamFormBreakPhaseTransition,
  ExamFormRunState,
  ExamRunStationOutcome,
  ExamStationRunQueueItem,
} from "../types.js";
import type {
  AttemptManifestBreakEvidenceInput,
  AttemptManifestBreakTransitionRef,
  AttemptManifestStationEvidenceInput,
  AttemptManifestStationPhaseRef,
  CompletedExamFormRunWithAttemptManifest,
  CompleteExamFormRunWithAttemptManifestInput,
  ReplayableAttemptManifest,
  ReplayableAttemptManifestBreak,
  ReplayableAttemptManifestStation,
} from "./types.js";
import {
  ATTEMPT_MANIFEST_STATION_PHASE_TYPES,
  attemptManifestClaimBoundary,
  attemptManifestNotEvidenceFor,
} from "./types.js";

/**
 * The terminal form transition and manifest seal are one operation. The caller
 * receives a completed run only after the immutable manifest has been accepted
 * by its persistence port.
 */
export async function completeExamFormRunWithAttemptManifest(
  input: CompleteExamFormRunWithAttemptManifestInput,
): Promise<CompletedExamFormRunWithAttemptManifest> {
  assertTerminalCompletionInput(input);

  const completedRun = advanceExamFormRunStation(input.run, input.finalStationCompletion);
  if (completedRun.status !== "complete") {
    throw new Error("attempt manifest can seal only on the terminal station transition");
  }

  const terminalRun = completedRun as ExamFormRunState & { status: "complete" };
  const manifest = sealCompletedAttemptManifest(terminalRun, input);
  await input.persistence.saveAttemptManifest(manifest);

  return {
    run: terminalRun,
    manifest,
  };
}

function assertTerminalCompletionInput(input: CompleteExamFormRunWithAttemptManifestInput): void {
  if (input.run.status !== "in_progress") {
    throw new Error("attempt manifest completion requires an in-progress exam run");
  }
  if (input.run.currentPhase.kind !== "station") {
    throw new Error("attempt manifest completion cannot bypass an occupied break");
  }
  const station = currentExamFormRunStation(input.run);
  const lastStation = input.run.queue.stationQueue.at(-1);
  if (!station || !lastStation || station.stationOrder !== lastStation.stationOrder) {
    throw new Error("attempt manifest can seal only from the final assembled station");
  }
  if (input.finalStationCompletion.endedAtFormSecond === undefined) {
    throw new Error("attempt manifest completion requires the admitted terminal form timestamp");
  }
  if (!input.finalStationCompletion.recordedAtIso) {
    throw new Error("attempt manifest completion requires the admitted terminal recordedAtIso");
  }
  requireNonblank(input.finalStationCompletion.advanceReason ?? "", "final advanceReason");
  requireIso(input.finalStationCompletion.recordedAtIso, "final recordedAtIso");
  requireNonNegativeInteger(
    input.finalStationCompletion.endedAtFormSecond,
    "final endedAtFormSecond",
  );
}

function sealCompletedAttemptManifest(
  run: ExamFormRunState & { status: "complete" },
  input: CompleteExamFormRunWithAttemptManifestInput,
): ReplayableAttemptManifest {
  const manifestId = requireNonblank(input.manifestId, "manifestId");
  const sealedAtIso = requireIso(input.sealedAtIso, "sealedAtIso");
  const finalDisposition = {
    kind: input.finalDisposition.kind,
    dispositionRef: requireNonblank(
      input.finalDisposition.dispositionRef,
      "finalDisposition.dispositionRef",
    ),
    recordedAtIso: requireIso(
      input.finalDisposition.recordedAtIso,
      "finalDisposition.recordedAtIso",
    ),
  } as const;
  const stations = composeStations(run, input.stationEvidence);
  const breaks = composeBreaks(run, input.breakEvidence);
  const terminalOutcome = stations.at(-1)?.outcome;
  if (!terminalOutcome) {
    throw new Error("attempt manifest requires at least one completed station");
  }

  const manifest: ReplayableAttemptManifest = {
    schemaVersion: "openclinxr.attempt-manifest.v1",
    manifestId,
    examRunId: requireNonblank(run.examRunId, "examRunId"),
    examFormId: requireNonblank(run.examFormId, "examFormId"),
    blueprintId: requireNonblank(run.blueprintId, "blueprintId"),
    learnerId: normalizeLearnerId(input.learnerId),
    status: "sealed",
    completedAtIso: terminalOutcome.recordedAtIso,
    sealedAtIso,
    stations,
    breaks,
    finalDisposition,
    sourceRunClaimBoundary: run.claimBoundary,
    sourceRunNotEvidenceFor: run.notEvidenceFor,
    claimBoundary: attemptManifestClaimBoundary,
    notEvidenceFor: attemptManifestNotEvidenceFor,
    examEquivalenceGate: false,
    clinicalValidityClaimed: false,
    scoringValidityClaimed: false,
    questReadinessClaimed: false,
  };

  return deepFreeze(cloneJson(manifest));
}

function composeStations(
  run: ExamFormRunState,
  evidence: readonly AttemptManifestStationEvidenceInput[],
): ReplayableAttemptManifestStation[] {
  if (evidence.length !== run.queue.stationQueue.length) {
    throw new Error("attempt manifest requires evidence for every assembled station");
  }
  if (run.stationOutcomes.length !== run.queue.stationQueue.length) {
    throw new Error("attempt manifest requires one terminal outcome for every assembled station");
  }

  return run.queue.stationQueue.map((station, index) => {
    const supplied = evidence[index];
    if (!supplied) {
      throw new Error(`attempt manifest station ${station.stationOrder} evidence is missing`);
    }
    assertStationIdentity(station, supplied);
    const outcome = outcomeFor(run.stationOutcomes, station);
    assertOutcomeIdentity(station, outcome);
    const admittedPhaseRefs = validateStationPhaseRefs(supplied, outcome);
    return {
      stationOrder: station.stationOrder,
      slotId: station.slotId,
      stationRunId: requireNonblank(supplied.stationRunId, "stationRunId"),
      scenarioId: requireNonblank(supplied.scenarioId, "scenarioId"),
      scenarioVersion: supplied.scenarioVersion,
      admittedPhaseRefs,
      learnerEventTraceRef: requireNonblank(
        supplied.learnerEventTraceRef,
        "learnerEventTraceRef",
      ),
      reviewPacketRef: requireNonblank(supplied.reviewPacketRef, "reviewPacketRef"),
      outcome: cloneJson(outcome),
    };
  });
}

function composeBreaks(
  run: ExamFormRunState,
  evidence: readonly AttemptManifestBreakEvidenceInput[],
): ReplayableAttemptManifestBreak[] {
  if (evidence.length !== run.queue.breakWindows.length) {
    throw new Error("attempt manifest requires evidence for every timed break");
  }
  if (run.breakPhaseTransitions.length !== run.queue.breakWindows.length * 2) {
    throw new Error("attempt manifest requires started and ended history for every timed break");
  }

  return run.queue.breakWindows.map((window, index) => {
    const supplied = evidence[index];
    if (!supplied || supplied.afterStationOrder !== window.afterStationOrder) {
      throw new Error(
        `attempt manifest break after station ${window.afterStationOrder} identity mismatch`,
      );
    }
    const started = requireBreakTransition(
      run,
      supplied.started,
      "break.started",
      window.afterStationOrder,
    );
    const ended = requireBreakTransition(
      run,
      supplied.ended,
      "break.ended",
      window.afterStationOrder,
    );
    return {
      afterStationOrder: window.afterStationOrder,
      startsAtFormSecond: window.startsAtSecond,
      endsAtFormSecond: window.endsAtSecond,
      durationSeconds: window.durationSeconds,
      started,
      ended,
    };
  });
}

function assertStationIdentity(
  station: ExamStationRunQueueItem,
  evidence: AttemptManifestStationEvidenceInput,
): void {
  if (
    evidence.stationOrder !== station.stationOrder
    || evidence.slotId !== station.slotId
    || evidence.scenarioId !== station.scenarioId
    || evidence.scenarioVersion !== station.scenarioVersion
  ) {
    throw new Error(`attempt manifest station ${station.stationOrder} immutable identity mismatch`);
  }
  requireNonblank(evidence.stationRunId, "stationRunId");
  requirePositiveInteger(evidence.scenarioVersion, "scenarioVersion");
}

function outcomeFor(
  outcomes: readonly ExamRunStationOutcome[],
  station: ExamStationRunQueueItem,
): ExamRunStationOutcome {
  const matches = outcomes.filter((outcome) => outcome.stationOrder === station.stationOrder);
  if (matches.length !== 1) {
    throw new Error(
      `attempt manifest station ${station.stationOrder} requires exactly one terminal outcome`,
    );
  }
  const outcome = matches[0];
  if (!outcome) {
    throw new Error(`attempt manifest station ${station.stationOrder} terminal outcome is missing`);
  }
  return outcome;
}

function assertOutcomeIdentity(
  station: ExamStationRunQueueItem,
  outcome: ExamRunStationOutcome,
): void {
  if (
    outcome.slotId !== station.slotId
    || outcome.scenarioId !== station.scenarioId
    || outcome.scenarioVersion !== station.scenarioVersion
    || outcome.endedAtFormSecond === null
    || outcome.phase !== "complete"
    || outcome.noteSubmitted !== true
  ) {
    throw new Error(`attempt manifest station ${station.stationOrder} outcome identity mismatch`);
  }
  requireNonblank(outcome.advanceReason ?? "", "station outcome advanceReason");
  requireIso(outcome.recordedAtIso, "station outcome recordedAtIso");
}

function validateStationPhaseRefs(
  station: AttemptManifestStationEvidenceInput,
  outcome: ExamRunStationOutcome,
): AttemptManifestStationPhaseRef[] {
  if (station.admittedPhaseRefs.length !== ATTEMPT_MANIFEST_STATION_PHASE_TYPES.length) {
    throw new Error(
      `attempt manifest station ${station.stationOrder} requires every admitted phase reference`,
    );
  }
  let previousSequence = -1;
  let previousFormAtSecond = -1;
  const refs = station.admittedPhaseRefs.map((ref, index) => {
    const expectedType = ATTEMPT_MANIFEST_STATION_PHASE_TYPES[index];
    if (ref.eventType !== expectedType || ref.stationRunId !== station.stationRunId) {
      throw new Error(
        `attempt manifest station ${station.stationOrder} phase identity mismatch at ${expectedType}`,
      );
    }
    requireNonNegativeInteger(ref.sequence, "phase sequence");
    requireNonNegativeInteger(ref.formAtSecond, "phase formAtSecond");
    if (ref.sequence <= previousSequence || ref.formAtSecond < previousFormAtSecond) {
      throw new Error(`attempt manifest station ${station.stationOrder} phase history is out of order`);
    }
    previousSequence = ref.sequence;
    previousFormAtSecond = ref.formAtSecond;
    requireIso(ref.occurredAtIso, "phase occurredAtIso");
    const expectedDurableRef = `durable://station-runs/${station.stationRunId}/events/${ref.sequence}`;
    if (ref.durableEventRef !== expectedDurableRef) {
      throw new Error(
        `attempt manifest station ${station.stationOrder} phase durable identity mismatch`,
      );
    }
    return { ...ref };
  });
  const advanced = refs.at(-1);
  if (!advanced) {
    throw new Error(`attempt manifest station ${station.stationOrder} terminal phase is missing`);
  }
  if (
    advanced.formAtSecond !== outcome.endedAtFormSecond
    || advanced.occurredAtIso !== outcome.recordedAtIso
  ) {
    throw new Error(
      `attempt manifest station ${station.stationOrder} terminal phase does not match its outcome`,
    );
  }
  return refs;
}

function requireBreakTransition(
  run: ExamFormRunState,
  supplied: AttemptManifestBreakTransitionRef,
  eventType: AttemptManifestBreakTransitionRef["eventType"],
  afterStationOrder: number,
): AttemptManifestBreakTransitionRef {
  const recorded = run.breakPhaseTransitions.find(
    (transition) =>
      transition.eventType === eventType
      && transition.afterStationOrder === afterStationOrder,
  );
  if (!recorded || !breakTransitionMatches(run.examRunId, recorded, supplied, eventType)) {
    throw new Error(
      `attempt manifest ${eventType} history mismatch after station ${afterStationOrder}`,
    );
  }
  requireNonblank(supplied.durableEventRef, "break durableEventRef");
  return { ...supplied };
}

function breakTransitionMatches(
  examRunId: string,
  recorded: ExamFormBreakPhaseTransition,
  supplied: AttemptManifestBreakTransitionRef,
  eventType: AttemptManifestBreakTransitionRef["eventType"],
): boolean {
  return supplied.eventType === eventType
    && supplied.examRunId === examRunId
    && supplied.sequence === recorded.sequence
    && supplied.formAtSecond === recorded.formAtSecond
    && supplied.recordedAtIso === recorded.recordedAtIso;
}

function normalizeLearnerId(value: string | null | undefined): string | null {
  if (value === null || value === undefined) {
    return null;
  }
  return requireNonblank(value, "learnerId");
}

function requireNonblank(value: string, label: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`attempt manifest requires nonblank ${label}`);
  }
  return value;
}

function requireIso(value: string, label: string): string {
  requireNonblank(value, label);
  if (!Number.isFinite(Date.parse(value))) {
    throw new Error(`attempt manifest requires valid ${label}`);
  }
  return value;
}

function requireNonNegativeInteger(value: number, label: string): void {
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`attempt manifest requires nonnegative integer ${label}`);
  }
}

function requirePositiveInteger(value: number, label: string): void {
  if (!Number.isInteger(value) || value < 1) {
    throw new Error(`attempt manifest requires positive integer ${label}`);
  }
}

function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) {
      deepFreeze(child);
    }
  }
  return value;
}
