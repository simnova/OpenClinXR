import type {
  AttemptManifestPersistencePort,
  ReplayableAttemptManifest,
  ReplayableAttemptManifestBreakTransitionRef,
  ReplayableAttemptManifestStation,
} from "./types.js";
import {
  ATTEMPT_MANIFEST_STATION_PHASE_TYPES,
  attemptManifestClaimBoundary,
  attemptManifestNotEvidenceFor,
  sourceExamRunNotEvidenceFor,
} from "./types.js";

/**
 * In-process persistence adapter for package tests. It models the same
 * append-once contract expected from a durable implementation but never claims
 * to be a database source of truth.
 */
export class LocalTestAttemptManifestStore implements AttemptManifestPersistencePort {
  readonly durableStore = "test_local_memory" as const;
  private readonly byManifestId = new Map<string, ReplayableAttemptManifest>();
  private readonly manifestIdByExamRunId = new Map<string, string>();

  async saveAttemptManifest(
    manifest: ReplayableAttemptManifest,
  ): Promise<ReplayableAttemptManifest> {
    const record = createImmutableAttemptManifest(manifest);
    const existingForId = this.byManifestId.get(record.manifestId);
    if (existingForId) {
      if (stableFingerprint(existingForId) !== stableFingerprint(record)) {
        throw new Error(`attempt manifest identity is immutable for ${record.manifestId}`);
      }
      return immutableClone(existingForId);
    }

    const existingManifestId = this.manifestIdByExamRunId.get(record.examRunId);
    if (existingManifestId && existingManifestId !== record.manifestId) {
      throw new Error(`exam run ${record.examRunId} already has a sealed attempt manifest`);
    }

    this.byManifestId.set(record.manifestId, immutableClone(record));
    this.manifestIdByExamRunId.set(record.examRunId, record.manifestId);
    return immutableClone(record);
  }

  async loadAttemptManifest(manifestId: string): Promise<ReplayableAttemptManifest | null> {
    const found = this.byManifestId.get(requireNonblank(manifestId, "manifestId"));
    return found ? immutableClone(found) : null;
  }

  async loadAttemptManifestForExamRun(examRunId: string): Promise<ReplayableAttemptManifest | null> {
    const manifestId = this.manifestIdByExamRunId.get(requireNonblank(examRunId, "examRunId"));
    if (!manifestId) {
      return null;
    }
    return this.loadAttemptManifest(manifestId);
  }
}

export function createImmutableAttemptManifest(
  input: ReplayableAttemptManifest,
): ReplayableAttemptManifest {
  validateAttemptManifest(input);
  return immutableClone(input);
}

function validateAttemptManifest(manifest: ReplayableAttemptManifest): void {
  if (manifest.schemaVersion !== "openclinxr.attempt-manifest.v1" || manifest.status !== "sealed") {
    throw new Error("attempt manifest must be a sealed openclinxr.attempt-manifest.v1 record");
  }
  requireNonblank(manifest.manifestId, "manifestId");
  requireNonblank(manifest.examRunId, "examRunId");
  requireNonblank(manifest.examFormId, "examFormId");
  requireNonblank(manifest.blueprintId, "blueprintId");
  if (manifest.learnerId !== null) {
    requireNonblank(manifest.learnerId, "learnerId");
  }
  requireIso(manifest.completedAtIso, "completedAtIso");
  requireIso(manifest.sealedAtIso, "sealedAtIso");

  if (manifest.stations.length === 0) {
    throw new Error("attempt manifest requires at least one station");
  }
  validateStations(manifest.stations);
  validateBreaks(manifest.examRunId, manifest.breaks);
  validateDisposition(manifest);
  validateClaimBoundary(manifest);
}

function validateStations(stations: readonly ReplayableAttemptManifestStation[]): void {
  const stationOrders = new Set<number>();
  const stationRunIds = new Set<string>();
  let priorOrder = 0;
  for (const station of stations) {
    requirePositiveInteger(station.stationOrder, "stationOrder");
    if (station.stationOrder <= priorOrder || stationOrders.has(station.stationOrder)) {
      throw new Error("attempt manifest station order must be unique and increasing");
    }
    priorOrder = station.stationOrder;
    stationOrders.add(station.stationOrder);
    requireNonblank(station.slotId, "slotId");
    requireNonblank(station.stationRunId, "stationRunId");
    requireNonblank(station.scenarioId, "scenarioId");
    requirePositiveInteger(station.scenarioVersion, "scenarioVersion");
    if (stationRunIds.has(station.stationRunId)) {
      throw new Error(`attempt manifest stationRunId is duplicated: ${station.stationRunId}`);
    }
    stationRunIds.add(station.stationRunId);
    requireNonblank(station.learnerEventTraceRef, "learnerEventTraceRef");
    requireNonblank(station.reviewPacketRef, "reviewPacketRef");
    validateStationOutcome(station);
    validateStationPhaseRefs(station);
  }
}

function validateStationOutcome(station: ReplayableAttemptManifestStation): void {
  const outcome = station.outcome;
  if (
    outcome.stationOrder !== station.stationOrder
    || outcome.slotId !== station.slotId
    || outcome.scenarioId !== station.scenarioId
    || outcome.scenarioVersion !== station.scenarioVersion
    || outcome.endedAtFormSecond === null
    || outcome.phase !== "complete"
    || outcome.noteSubmitted !== true
  ) {
    throw new Error(`attempt manifest station ${station.stationOrder} outcome identity mismatch`);
  }
  requireNonblank(outcome.advanceReason ?? "", "outcome.advanceReason");
  requireNonNegativeInteger(outcome.startedAtFormSecond, "outcome.startedAtFormSecond");
  requireNonNegativeInteger(outcome.endedAtFormSecond, "outcome.endedAtFormSecond");
  requireIso(outcome.recordedAtIso, "outcome.recordedAtIso");
}

function validateStationPhaseRefs(station: ReplayableAttemptManifestStation): void {
  if (station.admittedPhaseRefs.length !== ATTEMPT_MANIFEST_STATION_PHASE_TYPES.length) {
    throw new Error(
      `attempt manifest station ${station.stationOrder} requires every admitted phase reference`,
    );
  }
  let priorSequence = -1;
  let priorFormAtSecond = -1;
  for (const [index, ref] of station.admittedPhaseRefs.entries()) {
    if (
      ref.eventType !== ATTEMPT_MANIFEST_STATION_PHASE_TYPES[index]
      || ref.stationRunId !== station.stationRunId
    ) {
      throw new Error(`attempt manifest station ${station.stationOrder} phase identity mismatch`);
    }
    requireNonNegativeInteger(ref.sequence, "phase.sequence");
    requireNonNegativeInteger(ref.formAtSecond, "phase.formAtSecond");
    if (ref.sequence <= priorSequence || ref.formAtSecond < priorFormAtSecond) {
      throw new Error(`attempt manifest station ${station.stationOrder} phase history is out of order`);
    }
    priorSequence = ref.sequence;
    priorFormAtSecond = ref.formAtSecond;
    requireIso(ref.occurredAtIso, "phase.occurredAtIso");
    if (
      ref.durableEventRef
        !== `durable://station-runs/${station.stationRunId}/events/${ref.sequence}`
    ) {
      throw new Error(`attempt manifest station ${station.stationOrder} phase durable identity mismatch`);
    }
  }
  const terminal = station.admittedPhaseRefs.at(-1);
  if (!terminal) {
    throw new Error(`attempt manifest station ${station.stationOrder} terminal history is missing`);
  }
  if (
    terminal.formAtSecond !== station.outcome.endedAtFormSecond
    || terminal.occurredAtIso !== station.outcome.recordedAtIso
  ) {
    throw new Error(`attempt manifest station ${station.stationOrder} terminal history mismatch`);
  }
}

function validateBreaks(
  examRunId: string,
  breaks: ReplayableAttemptManifest["breaks"],
): void {
  const afterOrders = new Set<number>();
  for (const entry of breaks) {
    requirePositiveInteger(entry.afterStationOrder, "break.afterStationOrder");
    requireNonNegativeInteger(entry.startsAtFormSecond, "break.startsAtFormSecond");
    requireNonNegativeInteger(entry.endsAtFormSecond, "break.endsAtFormSecond");
    requirePositiveInteger(entry.durationSeconds, "break.durationSeconds");
    if (
      entry.endsAtFormSecond - entry.startsAtFormSecond !== entry.durationSeconds
      || afterOrders.has(entry.afterStationOrder)
    ) {
      throw new Error(`attempt manifest break after station ${entry.afterStationOrder} is invalid`);
    }
    afterOrders.add(entry.afterStationOrder);
    validateBreakTransition(examRunId, entry.started, "break.started");
    validateBreakTransition(examRunId, entry.ended, "break.ended");
    if (
      entry.started.sequence >= entry.ended.sequence
      || entry.started.formAtSecond > entry.ended.formAtSecond
    ) {
      throw new Error(`attempt manifest break after station ${entry.afterStationOrder} is out of order`);
    }
  }
}

function validateBreakTransition(
  examRunId: string,
  transition: ReplayableAttemptManifestBreakTransitionRef,
  eventType: ReplayableAttemptManifestBreakTransitionRef["eventType"],
): void {
  if (transition.examRunId !== examRunId || transition.eventType !== eventType) {
    throw new Error(`attempt manifest ${eventType} identity mismatch`);
  }
  requireNonNegativeInteger(transition.sequence, "break transition sequence");
  requireNonNegativeInteger(transition.formAtSecond, "break transition formAtSecond");
  requireIso(transition.recordedAtIso, "break transition recordedAtIso");
  requireNonblank(transition.durableEventRef, "break transition durableEventRef");
}

function validateDisposition(manifest: ReplayableAttemptManifest): void {
  if (manifest.finalDisposition.kind !== "completed") {
    throw new Error("attempt manifest final disposition must be completed");
  }
  requireNonblank(manifest.finalDisposition.dispositionRef, "finalDisposition.dispositionRef");
  requireIso(manifest.finalDisposition.recordedAtIso, "finalDisposition.recordedAtIso");
}

function validateClaimBoundary(manifest: ReplayableAttemptManifest): void {
  if (
    manifest.sourceRunClaimBoundary
      !== "learner_multi_station_runtime_skeleton_not_exam_equivalence"
    || stableFingerprint(manifest.sourceRunNotEvidenceFor)
      !== stableFingerprint(sourceExamRunNotEvidenceFor)
    || manifest.claimBoundary !== attemptManifestClaimBoundary
    || stableFingerprint(manifest.notEvidenceFor) !== stableFingerprint(attemptManifestNotEvidenceFor)
    || manifest.examEquivalenceGate !== false
    || manifest.clinicalValidityClaimed !== false
    || manifest.scoringValidityClaimed !== false
    || manifest.questReadinessClaimed !== false
  ) {
    throw new Error("attempt manifest claim boundary cannot be widened");
  }
}

function requireNonblank(value: string, label: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`attempt manifest requires nonblank ${label}`);
  }
  return value;
}

function requireIso(value: string, label: string): void {
  requireNonblank(value, label);
  if (!Number.isFinite(Date.parse(value))) {
    throw new Error(`attempt manifest requires valid ${label}`);
  }
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

function immutableClone<T>(value: T): T {
  return deepFreeze(JSON.parse(JSON.stringify(value)) as T);
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

function stableFingerprint(value: unknown): string {
  return JSON.stringify(canonicalize(value));
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(canonicalize);
  }
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return Object.fromEntries(
      Object.keys(record)
        .sort()
        .map((key) => [key, canonicalize(record[key])]),
    );
  }
  return value;
}
