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
  /** Full candidate pool considered for assembly (fixtures ∪ approved authored), not only selected stations. */
  consideredScenarioIds: string[];
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

/**
 * Occupied break window derived from blueprint `breakAfterStationOrders`.
 * `phase` is the literal `"break"` so replay cannot treat this as doorway/encounter/note.
 */
export type ExamBreakWindow = {
  afterStationOrder: number;
  startsAtSecond: number;
  endsAtSecond: number;
  durationSeconds: number;
  phase: "break";
};

export type ExamFormTimingOptions = {
  /** Shared occupied duration for every configured break position. 0 / omitted = checkpoint-only. */
  breakDurationSeconds?: number;
  /** Per-position duration keyed by `afterStationOrder`. Overrides `breakDurationSeconds` when present. */
  breakDurationsByAfterStationOrder?: Readonly<Record<number, number>>;
};

export type ExamTimingPlan = {
  blueprintId: string;
  stationWindows: ExamStationTimingWindow[];
  breakCheckpoints: Array<{ afterStationOrder: number; atSecond: number }>;
  breakWindows: ExamBreakWindow[];
  totalStationTimeSeconds: number;
  totalBreakTimeSeconds: number;
  totalFormTimeSeconds: number;
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
  breakWindows: ExamBreakWindow[];
  totalStationTimeSeconds: number;
  totalBreakTimeSeconds: number;
  totalFormTimeSeconds: number;
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
  /** Form-level elapsed seconds (accumulates across stations and breaks; not reset per station). */
  formElapsedSecond: number;
  totalStationTimeSeconds: number;
  formRemainingSecond: number;
  /** Elapsed seconds overlapping station doorway/encounter/note windows only. */
  stationElapsedSecond: number;
  /** Elapsed seconds overlapping break windows only — never encounter or note. */
  breakElapsedSecond: number;
  totalBreakTimeSeconds: number;
  totalFormTimeSeconds: number;
};

export type ExamFormRunStatus = "not_started" | "in_progress" | "complete" | "blocked";

export type ExamFormRunActivePhase =
  | { kind: "station" }
  | { kind: "break"; afterStationOrder: number };

export const EXAM_FORM_BREAK_PHASE_TRANSITION_TYPES = ["break.started", "break.ended"] as const;

export type ExamFormBreakPhaseTransitionType = (typeof EXAM_FORM_BREAK_PHASE_TRANSITION_TYPES)[number];

export type ExamFormBreakPhaseTransition = {
  eventType: ExamFormBreakPhaseTransitionType;
  afterStationOrder: number;
  formAtSecond: number;
  durationSeconds: number;
  /** Literal discriminator — break time is never encounter or note. */
  phase: "break";
  examRunId: string;
  sequence: number;
  recordedAtIso: string;
};

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
  currentPhase: ExamFormRunActivePhase;
  clock: ExamFormRunClock;
  stationOutcomes: ExamRunStationOutcome[];
  breakPhaseTransitions: ExamFormBreakPhaseTransition[];
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
  breakDurationSeconds?: number;
  breakDurationsByAfterStationOrder?: Readonly<Record<number, number>>;
};

export type AdvanceExamFormRunStationInput = {
  phase: ExamRunStationPhase;
  noteSubmitted: boolean;
  advanceReason: string | null;
  endedAtFormSecond?: number;
  recordedAtIso?: string;
};

export type AdvanceExamFormRunBreakInput = {
  endedAtFormSecond?: number;
  recordedAtIso?: string;
  advanceReason?: string | null;
};

/**
 * How the learner run acquired its station QUEUE (#57).
 * offline = deliberate zero-network mode (not a fallback).
 * fixture_fallback = transport failure while baseUrl was configured.
 * api_queue = healthy station-run-queue resolution.
 * Does not describe per-station body provenance — see stationBodySources / bodySource (#88).
 */
export type ExamStationRunQueueScenarioSource = "fixture_offline" | "fixture_fallback" | "api_queue";

/**
 * Where a single station's scenario BODY came from (#88) — not the queue acquisition mode.
 * A real queue may mix api_authored and bank_residual; one set-level label cannot describe that.
 */
export type ExamStationRunQueueScenarioBodySource = "api_authored" | "bank_residual";

export type ExamStationRunQueueStationBodySource = {
  scenarioId: string;
  bodySource: ExamStationRunQueueScenarioBodySource;
};

export type ExamStationRunQueueSnapshot = {
  snapshotId: string;
  createdAt: string;
  reviewerId?: string;
  queue: ExamStationRunQueue;
  /** Present when the learner recorded how the queue was acquired (#57). Not stuffed into reviewerId. */
  scenarioSource?: ExamStationRunQueueScenarioSource;
  /** True only for transport-failure degrade; false for offline and healthy api_queue. */
  fallbackActive?: boolean;
  fallbackReason?: string;
  /** Per-station body provenance for mixed api_queue runs (#88). Not a fourth scenarioSource value. */
  stationBodySources?: ExamStationRunQueueStationBodySource[];
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
  scenarioSource?: ExamStationRunQueueScenarioSource;
  fallbackActive?: boolean;
  fallbackReason?: string;
  stationBodySources?: ExamStationRunQueueStationBodySource[];
};

/**
 * Assemble exam form + station run queue from a blueprint and drive a multi-station run state.
 * Single-station blueprints remain valid (queue length 1).
 */
