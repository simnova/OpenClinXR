import { edChestPainScenario, scenarioBank } from "@openclinxr/scenario-fixtures";
import type { Scenario } from "@openclinxr/shared-schemas";

export type ExamBlueprint = {
  blueprintId: string;
  title: string;
  stationSlots: ExamStationSlot[];
  timing: ExamBlueprintTiming;
  requiredTraceTags: string[];
  requiredSafetyCriticalTraceTags: string[];
};

export type ExamBlueprintTiming = {
  doorwaySeconds: number;
  encounterSeconds: number;
  noteSeconds: number;
  breakAfterStationOrders: number[];
};

export type ExamStationSlot = {
  slotId: string;
  order: number;
  label: string;
  requiredEnvironmentIds: string[];
  requiredTraceTags: string[];
};

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
  blockedScenarioIds: Array<{ scenarioId: string; reason: "not_approved" | "governance_not_ready" }>;
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

const step2CsStyleTiming: ExamBlueprintTiming = {
  doorwaySeconds: 60,
  encounterSeconds: 900,
  noteSeconds: 600,
  breakAfterStationOrders: [3, 6, 9],
};

export function createDefaultClinicalSkillsBlueprint(): ExamBlueprint {
  return {
    blueprintId: "blueprint_openclinxr_clinical_skills_pilot_v1",
    title: "OpenClinXR Clinical Skills Pilot",
    stationSlots: [
      {
        slotId: "station_001_ed_urgent_recognition",
        order: 1,
        label: "Emergency department urgent recognition and communication",
        requiredEnvironmentIds: ["ed_exam_bay_v1"],
        requiredTraceTags: [...edChestPainScenario.requiredTraceTags],
      },
    ],
    timing: { ...step2CsStyleTiming },
    requiredTraceTags: [...edChestPainScenario.requiredTraceTags],
    requiredSafetyCriticalTraceTags: [...edChestPainScenario.governance.safetyCriticalTraceTags],
  };
}

export function createStep2CsStyleSeedBlueprint(scenarios: readonly Scenario[] = scenarioBank): ExamBlueprint {
  const stationSlots = scenarios.map((scenario, index): ExamStationSlot => ({
    slotId: `station_${String(index + 1).padStart(3, "0")}_${scenario.scenarioId}`,
    order: index + 1,
    label: scenario.title,
    requiredEnvironmentIds: scenario.environment?.environmentId ? [scenario.environment.environmentId] : [],
    requiredTraceTags: [...scenario.requiredTraceTags],
  }));

  return {
    blueprintId: "blueprint_openclinxr_step2cs_style_seed_v1",
    title: "OpenClinXR Step 2 CS-Style 12-Station Seed Form",
    stationSlots,
    timing: { ...step2CsStyleTiming },
    requiredTraceTags: uniqueInOrder(scenarios.flatMap((scenario) => scenario.requiredTraceTags)),
    requiredSafetyCriticalTraceTags: uniqueInOrder(scenarios.flatMap((scenario) => scenario.governance.safetyCriticalTraceTags)),
  };
}

export function evaluateBlueprintScenarioReadiness(blueprint: ExamBlueprint, scenarios: readonly Scenario[]): BlueprintScenarioReadiness {
  const activationEligibleScenarioIds: string[] = [];
  const blockedScenarioIds: BlueprintScenarioReadiness["blockedScenarioIds"] = [];

  for (const scenario of scenarios) {
    if (isActivationEligible(scenario)) {
      activationEligibleScenarioIds.push(scenario.scenarioId);
      continue;
    }

    blockedScenarioIds.push({
      scenarioId: scenario.scenarioId,
      reason: scenario.status !== "approved" ? "not_approved" : "governance_not_ready",
    });
  }

  return {
    blueprintId: blueprint.blueprintId,
    canAssembleReadyForm: activationEligibleScenarioIds.length === blueprint.stationSlots.length && blockedScenarioIds.length === 0,
    stationCount: {
      required: blueprint.stationSlots.length,
      candidate: scenarios.length,
      activationEligible: activationEligibleScenarioIds.length,
    },
    activationEligibleScenarioIds,
    blockedScenarioIds,
    missingScenarioSlotIds: blueprint.stationSlots.slice(scenarios.length).map((slot) => slot.slotId),
  };
}

export function createExamTimingPlan(blueprint: ExamBlueprint): ExamTimingPlan {
  const sortedSlots = [...blueprint.stationSlots].sort((left, right) => left.order - right.order);
  const stationWindows = sortedSlots.map((slot, index): ExamStationTimingWindow => {
    const startsAtSecond = index * stationDurationSeconds(blueprint.timing);
    const doorway = timingWindow(startsAtSecond, blueprint.timing.doorwaySeconds);
    const encounter = timingWindow(doorway.endsAtSecond, blueprint.timing.encounterSeconds);
    const note = timingWindow(encounter.endsAtSecond, blueprint.timing.noteSeconds);

    return {
      stationOrder: slot.order,
      slotId: slot.slotId,
      label: slot.label,
      doorway,
      encounter,
      note,
    };
  });

  const breakCheckpoints = blueprint.timing.breakAfterStationOrders
    .map((afterStationOrder) => {
      const station = stationWindows.find((window) => window.stationOrder === afterStationOrder);
      return station ? { afterStationOrder, atSecond: station.note.endsAtSecond } : undefined;
    })
    .filter((checkpoint): checkpoint is { afterStationOrder: number; atSecond: number } => Boolean(checkpoint));

  return {
    blueprintId: blueprint.blueprintId,
    stationWindows,
    breakCheckpoints,
    totalStationTimeSeconds: stationWindows.at(-1)?.note.endsAtSecond ?? 0,
  };
}

export function createExamStationRunQueue(blueprint: ExamBlueprint, scenarios: readonly Scenario[]): ExamStationRunQueue {
  const timingPlan = createExamTimingPlan(blueprint);
  const scenarioBySlotOrder = new Map(scenarios.map((scenario, index) => [index + 1, scenario]));
  const stationQueue = timingPlan.stationWindows.map((timing): ExamStationRunQueueItem => {
    const scenario = scenarioBySlotOrder.get(timing.stationOrder);
    if (!scenario) {
      return {
        stationOrder: timing.stationOrder,
        slotId: timing.slotId,
        label: timing.label,
        scenarioId: null,
        scenarioVersion: null,
        status: "missing_scenario",
        blockers: ["scenario_missing"],
        timing,
      };
    }

    const status = stationRunQueueStatus(scenario);
    return {
      stationOrder: timing.stationOrder,
      slotId: timing.slotId,
      label: timing.label,
      scenarioId: scenario.scenarioId,
      scenarioVersion: scenario.version,
      status,
      blockers: stationRunQueueBlockers(scenario, status),
      timing,
    };
  });

  return {
    blueprintId: blueprint.blueprintId,
    canStartLearnerExam: stationQueue.every((station) => station.status === "activation_ready"),
    stationQueue,
    breakCheckpoints: timingPlan.breakCheckpoints,
    totalStationTimeSeconds: timingPlan.totalStationTimeSeconds,
    summary: stationRunQueueSummary(stationQueue),
  };
}

export function assembleExamForm(input: AssembleExamFormInput): ExamForm {
  for (const scenario of input.scenarios) {
    if (scenario.status !== "approved") {
      throw new Error(`Cannot assemble unapproved scenario: ${scenario.scenarioId}`);
    }
  }

  const stationRefs = input.scenarios.map((scenario, index) => {
    const slot = input.blueprint.stationSlots[index];
    return {
      order: slot?.order ?? index + 1,
      scenarioId: scenario.scenarioId,
      scenarioVersion: scenario.version,
      title: scenario.title,
    };
  }).sort((left, right) => left.order - right.order);

  const coveredTraceTags = uniqueInOrder(input.scenarios.flatMap((scenario) => scenario.requiredTraceTags));
  const missingTraceTags = input.blueprint.requiredTraceTags.filter((tag) => !coveredTraceTags.includes(tag));
  const requiredEnvironmentIds = uniqueInOrder(input.blueprint.stationSlots.flatMap((slot) => slot.requiredEnvironmentIds));
  const coveredEnvironmentIds = uniqueInOrder(input.scenarios.map((scenario) => scenario.environment?.environmentId).filter((environmentId): environmentId is string => Boolean(environmentId)));
  const missingEnvironmentIds = requiredEnvironmentIds.filter((environmentId) => !coveredEnvironmentIds.includes(environmentId));
  const coveredSafetyCriticalTraceTags = uniqueInOrder(input.scenarios.flatMap((scenario) => scenario.governance.safetyCriticalTraceTags));
  const missingSafetyCriticalTraceTags = input.blueprint.requiredSafetyCriticalTraceTags.filter((tag) => !coveredSafetyCriticalTraceTags.includes(tag));
  const stationCount = {
    required: input.blueprint.stationSlots.length,
    actual: input.scenarios.length,
    ok: input.blueprint.stationSlots.length === input.scenarios.length,
  };
  const assemblyIssues = [
    ...stationCountIssues(stationCount),
    ...missingTraceTags.map((tag) => `missing_trace_coverage:${tag}`),
    ...missingEnvironmentIds.map((environmentId) => `missing_environment_coverage:${environmentId}`),
    ...missingSafetyCriticalTraceTags.map((tag) => `missing_safety_critical_trace_coverage:${tag}`),
  ];

  return {
    examFormId: input.examFormId,
    blueprintId: input.blueprint.blueprintId,
    title: input.blueprint.title,
    stationRefs,
    coverage: {
      requiredTraceTags: [...input.blueprint.requiredTraceTags],
      coveredTraceTags,
      missingTraceTags,
      requiredEnvironmentIds,
      coveredEnvironmentIds,
      missingEnvironmentIds,
      requiredSafetyCriticalTraceTags: [...input.blueprint.requiredSafetyCriticalTraceTags],
      coveredSafetyCriticalTraceTags,
      missingSafetyCriticalTraceTags,
      stationCount,
    },
    assemblyIssues,
    status: examFormStatus({ stationCount, missingTraceTags, missingEnvironmentIds, missingSafetyCriticalTraceTags }),
  };
}

export function evaluateScenarioVersionDrift(form: ExamForm, currentScenarios: readonly Scenario[]): ScenarioVersionDrift[] {
  const currentVersionByScenarioId = new Map(currentScenarios.map((scenario) => [scenario.scenarioId, scenario.version]));
  return form.stationRefs
    .map((stationRef) => ({
      scenarioId: stationRef.scenarioId,
      lockedVersion: stationRef.scenarioVersion,
      currentVersion: currentVersionByScenarioId.get(stationRef.scenarioId) ?? null,
    }))
    .filter((drift) => drift.currentVersion !== drift.lockedVersion);
}

function stationCountIssues(stationCount: ExamCoverage["stationCount"]): string[] {
  if (stationCount.ok) {
    return [];
  }
  if (stationCount.actual < stationCount.required) {
    return [`missing_station_slots:${stationCount.required - stationCount.actual}`];
  }
  return [`extra_station_scenarios:${stationCount.actual - stationCount.required}`];
}

function examFormStatus(input: {
  stationCount: ExamCoverage["stationCount"];
  missingTraceTags: string[];
  missingEnvironmentIds: string[];
  missingSafetyCriticalTraceTags: string[];
}): ExamFormStatus {
  if (!input.stationCount.ok || input.missingEnvironmentIds.length > 0 || input.missingSafetyCriticalTraceTags.length > 0) {
    return "blueprint_incomplete";
  }
  if (input.missingTraceTags.length > 0) {
    return "coverage_incomplete";
  }
  return "ready_for_review";
}

function isActivationEligible(scenario: Scenario): boolean {
  return scenario.status === "approved"
    && Object.values(scenario.review).every((state) => state === "approved")
    && scenario.governance.validationStage !== "stage_0_synthetic_draft"
    && scenario.governance.scoreUseLabel !== "validated_summative";
}

function stationRunQueueStatus(scenario: Scenario): ExamStationRunQueueStatus {
  if (isActivationEligible(scenario)) {
    return "activation_ready";
  }
  if (scenario.status !== "approved") {
    return "draft_blocked";
  }
  return "governance_blocked";
}

function stationRunQueueBlockers(scenario: Scenario, status: ExamStationRunQueueStatus): string[] {
  if (status === "activation_ready") {
    return [];
  }
  if (status === "draft_blocked") {
    return ["scenario_not_approved"];
  }

  const blockers: string[] = [];
  for (const [reviewRole, reviewStatus] of Object.entries(scenario.review)) {
    if (reviewStatus !== "approved") {
      blockers.push(`${reviewRole}_review_${reviewStatus}`);
    }
  }
  if (scenario.governance.validationStage === "stage_0_synthetic_draft") {
    blockers.push("synthetic_draft_validation_stage");
  }
  if (scenario.governance.scoreUseLabel === "validated_summative") {
    blockers.push("summative_score_use_not_allowed_for_seed_queue");
  }

  return blockers.length > 0 ? blockers : ["governance_not_ready"];
}

function stationRunQueueSummary(stationQueue: readonly ExamStationRunQueueItem[]): ExamStationRunQueue["summary"] {
  return {
    activationReady: stationQueue.filter((station) => station.status === "activation_ready").length,
    draftBlocked: stationQueue.filter((station) => station.status === "draft_blocked").length,
    governanceBlocked: stationQueue.filter((station) => station.status === "governance_blocked").length,
    missingScenario: stationQueue.filter((station) => station.status === "missing_scenario").length,
  };
}

function stationDurationSeconds(timing: ExamBlueprintTiming): number {
  return timing.doorwaySeconds + timing.encounterSeconds + timing.noteSeconds;
}

function timingWindow(startsAtSecond: number, durationSeconds: number): ExamTimingWindow {
  return {
    startsAtSecond,
    endsAtSecond: startsAtSecond + durationSeconds,
    durationSeconds,
  };
}

function uniqueInOrder(values: string[]): string[] {
  const seen = new Set<string>();
  const unique: string[] = [];
  for (const value of values) {
    if (!seen.has(value)) {
      unique.push(value);
      seen.add(value);
    }
  }
  return unique;
}
