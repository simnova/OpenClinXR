import { edChestPainScenario } from "@openclinxr/scenario-fixtures";
import type { Scenario } from "@openclinxr/shared-schemas";

export type ExamBlueprint = {
  blueprintId: string;
  title: string;
  stationSlots: ExamStationSlot[];
  requiredTraceTags: string[];
  requiredSafetyCriticalTraceTags: string[];
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
    requiredTraceTags: [...edChestPainScenario.requiredTraceTags],
    requiredSafetyCriticalTraceTags: [...edChestPainScenario.governance.safetyCriticalTraceTags],
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
