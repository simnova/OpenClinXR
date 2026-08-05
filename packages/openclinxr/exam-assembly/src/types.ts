import type {
  Scenario,
  ExamBlueprint as SharedExamBlueprint,
  ExamBlueprintTiming as SharedExamBlueprintTiming,
  ExamStationSlot as SharedExamStationSlot,
} from "@openclinxr/shared-schemas";

export type ExamBlueprint = SharedExamBlueprint;

export type ExamBlueprintTiming = SharedExamBlueprintTiming;

export type ExamStationSlot = SharedExamStationSlot;

export type ExamStationRef = {
  order: number;
  scenarioId: string;
  scenarioVersion: number;
  title: string;
};

export type ExamCoverage = {
  requiredTraceTags: string[];
  coveredTraceTags: string[];
  missingTraceTags: string[];
  requiredEnvironmentIds: string[];
  coveredEnvironmentIds: string[];
  missingEnvironmentIds: string[];
  requiredSafetyCriticalTraceTags: string[];
  coveredSafetyCriticalTraceTags: string[];
  missingSafetyCriticalTraceTags: string[];
  stationCount: {
    required: number;
    actual: number;
    ok: boolean;
  };
};

export type ExamFormStatus = "ready_for_review" | "coverage_incomplete" | "blueprint_incomplete";

export type ExamForm = {
  examFormId: string;
  blueprintId: string;
  title: string;
  stationRefs: ExamStationRef[];
  coverage: ExamCoverage;
  assemblyIssues: string[];
  status: ExamFormStatus;
};

export type AssembleExamFormInput = {
  examFormId: string;
  blueprint: ExamBlueprint;
  scenarios: Scenario[];
};

export type ScenarioVersionDrift = {
  scenarioId: string;
  lockedVersion: number;
  currentVersion: number | null;
};

export type BlueprintScenarioReadiness = {
  blueprintId: string;
  canAssembleReadyForm: boolean;
  stationCount: {
    required: number;
    candidate: number;
    activationEligible: number;
  };
  activationEligibleScenarioIds: string[];
  blockedScenarioIds: Array<{ scenarioId: string; reason: "not_approved" | "governance_not_ready" | "dialogue_seed_not_ready" }>;
  missingScenarioSlotIds: string[];
};

export type ExamTimingWindow = {
  startsAtSecond: number;
  endsAtSecond: number;
  durationSeconds: number;
};

export type ExamStationTimingWindow = {
  stationOrder: number;
  slotId: string;
  label: string;
  doorway: ExamTimingWindow;
  encounter: ExamTimingWindow;
  note: ExamTimingWindow;
};

export type ExamTimingPlan = {
  blueprintId: string;
  stationWindows: ExamStationTimingWindow[];
  breakCheckpoints: Array<{ afterStationOrder: number; atSecond: number }>;
  totalStationTimeSeconds: number;
};

export type ExamStationRunQueueStatus = "activation_ready" | "draft_blocked" | "governance_blocked" | "missing_scenario";

export type ExamStationRunQueueItem = {
  stationOrder: number;
  slotId: string;
  label: string;
  scenarioId: string | null;
  scenarioVersion: number | null;
  status: ExamStationRunQueueStatus;
  blockers: string[];
  timing: ExamStationTimingWindow;
};

export type ExamStationRunQueue = {
  blueprintId: string;
  canStartLearnerExam: boolean;
  stationQueue: ExamStationRunQueueItem[];
  breakCheckpoints: ExamTimingPlan["breakCheckpoints"];
  totalStationTimeSeconds: number;
  summary: {
    activationReady: number;
    draftBlocked: number;
    governanceBlocked: number;
    missingScenario: number;
  };
};


export type ExamRunStationPhase = "doorway" | "encounter" | "note" | "complete" | "skipped";

export type ExamRunStationOutcome = {
  stationOrder: number;
  slotId: string;
  scenarioId: string | null;
  scenarioVersion: number | null;
  phase: ExamRunStationPhase;
  noteSubmitted: boolean;
  startedAtFormSecond: number;
  endedAtFormSecond: number | null;
  advanceReason: string | null;
  recordedAtIso: string;
};

export type ExamFormRunClock = {
  /** Form-level elapsed seconds (accumulates across stations; not reset per station). */
  formElapsedSecond: number;
  totalStationTimeSeconds: number;
  formRemainingSecond: number;
};

export type ExamFormRunStatus = "not_started" | "in_progress" | "complete" | "blocked";

export const examFormRunNotEvidenceFor = [
  "exam_equivalence",
  "clinical_validity",
  "scoring_validity",
  "quest_readiness",
  "learner_readiness",
] as const;

export type ExamFormRunState = {
  examRunId: string;
  examFormId: string;
  blueprintId: string;
  form: ExamForm;
  queue: ExamStationRunQueue;
  status: ExamFormRunStatus;
  /** 0-based index into queue.stationQueue. */
  currentStationIndex: number;
  clock: ExamFormRunClock;
  stationOutcomes: ExamRunStationOutcome[];
  claimBoundary: "learner_multi_station_runtime_skeleton_not_exam_equivalence";
  notEvidenceFor: typeof examFormRunNotEvidenceFor;
  /** Always false — multi-station skeleton is never exam-equivalence evidence. */
  examEquivalenceGate: false;
};

export type CreateExamFormRunInput = {
  examRunId: string;
  examFormId: string;
  blueprint: ExamBlueprint;
  scenarios: Scenario[];
};

export type AdvanceExamFormRunStationInput = {
  phase: ExamRunStationPhase;
  noteSubmitted: boolean;
  advanceReason: string | null;
  endedAtFormSecond?: number;
  recordedAtIso?: string;
};

export type ExamStationRunQueueSnapshot = {
  snapshotId: string;
  createdAt: string;
  reviewerId?: string;
  queue: ExamStationRunQueue;
};

/**
 * Minimal injected persistence surface for station-run-queue snapshots.
 * Matches ApiPersistenceSink.saveStationRunQueueSnapshot shape without coupling to apps/api or mongo.
 */
export type ExamAssemblyPersistenceSink = {
  saveStationRunQueueSnapshot?: (snapshot: ExamStationRunQueueSnapshot) => Promise<void> | void;
};

export type CreateExamStationRunQueueSnapshotInput = {
  snapshotId: string;
  queue: ExamStationRunQueue;
  createdAt?: string;
  reviewerId?: string;
};

/**
 * Assemble exam form + station run queue from a blueprint and drive a multi-station run state.
 * Single-station blueprints remain valid (queue length 1).
 */
