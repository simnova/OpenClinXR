export const attemptManifestClaimBoundary =
  "sealed_replayable_attempt_manifest_not_exam_equivalence" as const;

export const attemptManifestNotEvidenceFor = [
  "exam_equivalence",
  "clinical_validity",
  "scoring_validity",
  "quest_readiness",
  "learner_readiness",
  "production_deployment",
] as const;

export const sourceExamRunNotEvidenceFor = [
  "exam_equivalence",
  "clinical_validity",
  "scoring_validity",
  "quest_readiness",
  "learner_readiness",
] as const;

export const ATTEMPT_MANIFEST_STATION_PHASE_TYPES = [
  "encounter.started",
  "encounter.ended",
  "note.started",
  "note.submitted",
  "station.advanced",
] as const;

export type AttemptManifestStationPhaseType =
  (typeof ATTEMPT_MANIFEST_STATION_PHASE_TYPES)[number];

export type ReplayableAttemptManifestStationPhaseRef = {
  eventType: AttemptManifestStationPhaseType;
  stationRunId: string;
  sequence: number;
  formAtSecond: number;
  occurredAtIso: string;
  durableEventRef: string;
};

export type ReplayableAttemptManifestStationOutcome = {
  stationOrder: number;
  slotId: string;
  scenarioId: string | null;
  scenarioVersion: number | null;
  phase: "doorway" | "encounter" | "note" | "complete" | "skipped";
  noteSubmitted: boolean;
  startedAtFormSecond: number;
  endedAtFormSecond: number | null;
  advanceReason: string | null;
  recordedAtIso: string;
};

export type ReplayableAttemptManifestStation = {
  stationOrder: number;
  slotId: string;
  stationRunId: string;
  scenarioId: string;
  scenarioVersion: number;
  admittedPhaseRefs: readonly ReplayableAttemptManifestStationPhaseRef[];
  learnerEventTraceRef: string;
  reviewPacketRef: string;
  outcome: ReplayableAttemptManifestStationOutcome;
};

export type ReplayableAttemptManifestBreakTransitionRef = {
  eventType: "break.started" | "break.ended";
  examRunId: string;
  sequence: number;
  formAtSecond: number;
  recordedAtIso: string;
  durableEventRef: string;
};

export type ReplayableAttemptManifestBreak = {
  afterStationOrder: number;
  startsAtFormSecond: number;
  endsAtFormSecond: number;
  durationSeconds: number;
  started: ReplayableAttemptManifestBreakTransitionRef;
  ended: ReplayableAttemptManifestBreakTransitionRef;
};

export type ReplayableAttemptManifest = {
  schemaVersion: "openclinxr.attempt-manifest.v1";
  manifestId: string;
  examRunId: string;
  examFormId: string;
  blueprintId: string;
  learnerId: string | null;
  status: "sealed";
  completedAtIso: string;
  sealedAtIso: string;
  stations: readonly ReplayableAttemptManifestStation[];
  breaks: readonly ReplayableAttemptManifestBreak[];
  finalDisposition: {
    kind: "completed";
    dispositionRef: string;
    recordedAtIso: string;
  };
  sourceRunClaimBoundary: "learner_multi_station_runtime_skeleton_not_exam_equivalence";
  sourceRunNotEvidenceFor: typeof sourceExamRunNotEvidenceFor;
  claimBoundary: typeof attemptManifestClaimBoundary;
  notEvidenceFor: typeof attemptManifestNotEvidenceFor;
  examEquivalenceGate: false;
  clinicalValidityClaimed: false;
  scoringValidityClaimed: false;
  questReadinessClaimed: false;
};

export type AttemptManifestDurableStore = "database_source_of_truth" | "test_local_memory";

export type AttemptManifestPersistencePort = {
  readonly durableStore: AttemptManifestDurableStore;
  saveAttemptManifest(manifest: ReplayableAttemptManifest): Promise<ReplayableAttemptManifest>;
  loadAttemptManifest(manifestId: string): Promise<ReplayableAttemptManifest | null>;
  loadAttemptManifestForExamRun(examRunId: string): Promise<ReplayableAttemptManifest | null>;
};
