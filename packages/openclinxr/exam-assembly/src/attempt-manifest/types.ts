import type {
  AdvanceExamFormRunStationInput,
  ExamFormRunState,
  ExamRunStationOutcome,
} from "../types.js";

export const ATTEMPT_MANIFEST_STATION_PHASE_TYPES = [
  "encounter.started",
  "encounter.ended",
  "note.started",
  "note.submitted",
  "station.advanced",
] as const;

export type AttemptManifestStationPhaseType =
  (typeof ATTEMPT_MANIFEST_STATION_PHASE_TYPES)[number];

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

export type AttemptManifestStationPhaseRef = {
  eventType: AttemptManifestStationPhaseType;
  stationRunId: string;
  sequence: number;
  formAtSecond: number;
  occurredAtIso: string;
  durableEventRef: string;
};

export type AttemptManifestStationEvidenceInput = {
  stationOrder: number;
  slotId: string;
  stationRunId: string;
  scenarioId: string;
  scenarioVersion: number;
  admittedPhaseRefs: readonly AttemptManifestStationPhaseRef[];
  learnerEventTraceRef: string;
  reviewPacketRef: string;
};

export type AttemptManifestBreakTransitionRef = {
  eventType: "break.started" | "break.ended";
  examRunId: string;
  sequence: number;
  formAtSecond: number;
  recordedAtIso: string;
  durableEventRef: string;
};

export type AttemptManifestBreakEvidenceInput = {
  afterStationOrder: number;
  started: AttemptManifestBreakTransitionRef;
  ended: AttemptManifestBreakTransitionRef;
};

export type AttemptManifestFinalDisposition = {
  kind: "completed";
  dispositionRef: string;
  recordedAtIso: string;
};

export type ReplayableAttemptManifestStation = Omit<
  AttemptManifestStationEvidenceInput,
  "admittedPhaseRefs"
> & {
  admittedPhaseRefs: readonly AttemptManifestStationPhaseRef[];
  outcome: ExamRunStationOutcome;
};

export type ReplayableAttemptManifestBreak = {
  afterStationOrder: number;
  startsAtFormSecond: number;
  endsAtFormSecond: number;
  durationSeconds: number;
  started: AttemptManifestBreakTransitionRef;
  ended: AttemptManifestBreakTransitionRef;
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
  finalDisposition: AttemptManifestFinalDisposition;
  sourceRunClaimBoundary: ExamFormRunState["claimBoundary"];
  sourceRunNotEvidenceFor: ExamFormRunState["notEvidenceFor"];
  claimBoundary: typeof attemptManifestClaimBoundary;
  notEvidenceFor: typeof attemptManifestNotEvidenceFor;
  examEquivalenceGate: false;
  clinicalValidityClaimed: false;
  scoringValidityClaimed: false;
  questReadinessClaimed: false;
};

export type AttemptManifestPersistenceSink = {
  saveAttemptManifest: (manifest: ReplayableAttemptManifest) => unknown | Promise<unknown>;
};

export type CompleteExamFormRunWithAttemptManifestInput = {
  run: ExamFormRunState;
  finalStationCompletion: AdvanceExamFormRunStationInput;
  manifestId: string;
  learnerId?: string | null;
  stationEvidence: readonly AttemptManifestStationEvidenceInput[];
  breakEvidence: readonly AttemptManifestBreakEvidenceInput[];
  finalDisposition: AttemptManifestFinalDisposition;
  sealedAtIso: string;
  persistence: AttemptManifestPersistenceSink;
};

export type CompletedExamFormRunWithAttemptManifest = {
  run: ExamFormRunState & { status: "complete" };
  manifest: ReplayableAttemptManifest;
};
