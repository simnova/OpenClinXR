import { assembleExamForm, type ExamBlueprint, type ExamForm } from "@openclinxr/exam-assembly";
import type { Scenario } from "@openclinxr/shared-schemas";
import type {
  BuildSamplingPlanInput,
  SamplingPlanScenarioRevision,
  SamplingPlanSubstitution,
} from "./sampling-plan-types.js";

type ExamStationSlot = ExamBlueprint["stationSlots"][number];

export type AssembledPlanForm =
  | { status: "assembled"; form: ExamForm }
  | { status: "error"; message: string };

export function assemblePlanForm(
  input: BuildSamplingPlanInput,
  substitutions: readonly SamplingPlanSubstitution[],
): AssembledPlanForm {
  try {
    return {
      status: "assembled",
      form: assembleExamForm({
        examFormId: input.examFormId,
        blueprint: input.blueprintRevision.blueprint,
        scenarios: stationBodiesForAssembly(input, substitutions),
      }),
    };
  } catch (error) {
    return {
      status: "error",
      message: error instanceof Error ? error.message : "assembly_refused",
    };
  }
}

function stationBodiesForAssembly(
  input: BuildSamplingPlanInput,
  substitutions: readonly SamplingPlanSubstitution[],
): Scenario[] {
  const acceptedBySlot = new Map<string, SamplingPlanScenarioRevision>();
  for (const substitution of substitutions) {
    if (substitution.review.status === "accepted") {
      acceptedBySlot.set(substitution.slotId, substitution.toScenario);
    }
  }
  const slots = [...input.blueprintRevision.blueprint.stationSlots].sort(
    (left, right) => left.order - right.order || left.slotId.localeCompare(right.slotId),
  );
  const selectionBySlot = new Map(input.selections.map((selection) => [selection.slotId, selection]));
  const scenarios: Scenario[] = [];
  for (const slot of slots) {
    const selection = selectionBySlot.get(slot.slotId);
    if (!selection) continue;
    const revision = acceptedBySlot.get(slot.slotId) ?? selection.scenario;
    scenarios.push(scenarioFromRevision(revision, slot));
  }
  return scenarios;
}

function scenarioFromRevision(
  revision: SamplingPlanScenarioRevision,
  slot: ExamStationSlot,
): Scenario {
  const environmentId =
    revision.coverage.environment[0] ?? slot.requiredEnvironmentIds[0] ?? "unspecified_environment";
  const safetyTags =
    revision.coverage.safety_critical_event.length > 0
      ? [...revision.coverage.safety_critical_event]
      : ["unspecified_safety_event"];
  const actorRoles = revision.coverage.actor_role.length > 0 ? revision.coverage.actor_role : ["patient"];
  return {
    scenarioId: revision.scenarioId,
    version: revision.scenarioVersion,
    title: revision.title,
    status: revision.status,
    review: {
      clinical: "approved",
      psychometric: "approved",
      legal: "approved",
      simulationQa: "approved",
    },
    clinicalObjectives: ["faculty_reviewable_construct_coverage"],
    actors: actorRoles.map((role, index) => ({
      actorId: `${revision.scenarioId}_${role}_${index}`,
      role: actorRole(role),
      displayName: role,
    })),
    requiredTraceTags:
      slot.requiredTraceTags.length > 0 ? [...slot.requiredTraceTags] : ["unspecified_trace"],
    eventSchedule: [],
    reviewRubric: [
      {
        rubricId: `${revision.scenarioId}_rubric`,
        label: revision.title,
        requiredTraceTags: slot.requiredTraceTags.length > 0 ? [...slot.requiredTraceTags] : ["unspecified_trace"],
      },
    ],
    governance: {
      scoreUseLabel: "formative_local_only",
      syntheticCaseDisclosure: "Synthetic fixture for faculty coverage review.",
      validationStage: "stage_1_expert_reviewed",
      validationLimitations: ["Construct coverage is not validity evidence."],
      requiredReviewerRoles: ["clinician"],
      sourceIds: ["src-blueprint-coverage"],
      safetyCriticalTraceTags: safetyTags,
      hiddenFactPolicy: {
        learnerView: "redact_hidden_facts",
        disclosureRequiresTrigger: true,
      },
    },
    environment: {
      environmentId,
      name: environmentId,
      description: environmentId,
    },
  };
}

function actorRole(value: string): Scenario["actors"][number]["role"] {
  switch (value) {
    case "patient":
    case "family":
    case "nurse":
    case "physician":
    case "consultant":
    case "interpreter":
    case "medical_assistant":
    case "respiratory_therapist":
    case "system":
      return value;
    case "parent":
      return "family";
    default:
      return "system";
  }
}
