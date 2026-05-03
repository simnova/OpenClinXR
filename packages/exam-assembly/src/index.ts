import { edChestPainScenario } from "@openclinxr/scenario-fixtures";
import type { Scenario } from "@openclinxr/shared-schemas";

export type ExamBlueprint = {
  blueprintId: string;
  title: string;
  stationSlots: ExamStationSlot[];
  requiredTraceTags: string[];
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
};

export type ExamFormStatus = "ready_for_review" | "coverage_incomplete";

export type ExamForm = {
  examFormId: string;
  blueprintId: string;
  title: string;
  stationRefs: ExamStationRef[];
  coverage: ExamCoverage;
  status: ExamFormStatus;
};

export type AssembleExamFormInput = {
  examFormId: string;
  blueprint: ExamBlueprint;
  scenarios: Scenario[];
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

  return {
    examFormId: input.examFormId,
    blueprintId: input.blueprint.blueprintId,
    title: input.blueprint.title,
    stationRefs,
    coverage: {
      requiredTraceTags: [...input.blueprint.requiredTraceTags],
      coveredTraceTags,
      missingTraceTags,
    },
    status: missingTraceTags.length === 0 ? "ready_for_review" : "coverage_incomplete",
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
