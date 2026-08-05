import type { Scenario } from "@openclinxr/shared-schemas";

export type LearnerScenarioView = Omit<Scenario, "actors"> & {
  actors: Array<Omit<Scenario["actors"][number], "hiddenFacts">>;
};

type DraftScenarioInput = {
  scenarioId: string;
  title: string;
  clinicalObjectives: string[];
  actors: Scenario["actors"];
  requiredTraceTags: string[];
  eventSchedule: Scenario["eventSchedule"];
  reviewRubric: Scenario["reviewRubric"];
  requiredReviewerRoles: string[];
  safetyCriticalTraceTags: string[];
  environment: NonNullable<Scenario["environment"]>;
  equipment: string[];
  assetNeeds: NonNullable<Scenario["assetNeeds"]>;
  syntheticCaseDisclosure: string;
};

export function draftScenario(input: DraftScenarioInput): Scenario {
  return {
    scenarioId: input.scenarioId,
    version: 1,
    title: input.title,
    status: "draft",
    review: {
      clinical: "draft",
      psychometric: "draft",
      legal: "draft",
      simulationQa: "draft",
    },
    clinicalObjectives: input.clinicalObjectives,
    actors: input.actors,
    requiredTraceTags: input.requiredTraceTags,
    eventSchedule: input.eventSchedule,
    reviewRubric: input.reviewRubric,
    governance: {
      scoreUseLabel: "formative_local_only",
      syntheticCaseDisclosure: input.syntheticCaseDisclosure,
      validationStage: "stage_0_synthetic_draft",
      validationLimitations: ["Requires specialty clinician, psychometric, legal, and simulation QA review before learner use."],
      requiredReviewerRoles: input.requiredReviewerRoles,
      sourceIds: ["src-openclinxr-sample-case-bank-v1"],
      safetyCriticalTraceTags: input.safetyCriticalTraceTags,
      hiddenFactPolicy: {
        learnerView: "redact_hidden_facts",
        disclosureRequiresTrigger: true,
      },
    },
    environment: input.environment,
    equipment: input.equipment,
    assetNeeds: input.assetNeeds,
  };
}

export function satirProfile(
  style: NonNullable<Scenario["actors"][number]["communicationProfile"]>["style"],
  intensity: number,
  baselineMood: string[],
  communicativeness: string,
  topicsToAvoid: string[],
  adverseResponse: string,
  deescalationTriggers: string[],
  escalationTriggers: string[],
  culturalLanguageNotes: string[],
): NonNullable<Scenario["actors"][number]["communicationProfile"]> {
  return {
    styleFamily: "satir",
    style,
    intensity,
    baselineMood,
    communicativeness,
    topicsToAvoid,
    adverseResponse,
    deescalationTriggers,
    escalationTriggers,
    culturalLanguageNotes,
  };
}

export function actor(
  actorId: string,
  role: Scenario["actors"][number]["role"],
  displayName: string,
  demeanor: string,
  hiddenFacts: string[],
  communicationProfile?: Scenario["actors"][number]["communicationProfile"],
): Scenario["actors"][number] {
  return communicationProfile
    ? { actorId, role, displayName, demeanor, communicationProfile, hiddenFacts }
    : { actorId, role, displayName, demeanor, hiddenFacts };
}

export function rubric(rubricId: string, label: string, requiredTraceTags: string[]): Scenario["reviewRubric"][number] {
  return { rubricId, label, requiredTraceTags };
}

export function event(eventId: string, atSecond: number, actorId: string, tag: string): Scenario["eventSchedule"][number] {
  return { eventId, atSecond, actorId, tag };
}

export function asset(
  assetId: string,
  assetType: NonNullable<Scenario["assetNeeds"]>[number]["assetType"],
  description: string,
): NonNullable<Scenario["assetNeeds"]>[number] {
  return { assetId, assetType, description, licenseStatus: "placeholder-approved" };
}
