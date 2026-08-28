import type {
  ActorCard,
  ActorPhenotype,
  BodyMechanics,
  ComplianceRegion,
  InteractionEmotion,
  Scenario,
  TouchResponse,
} from "@openclinxr/shared-schemas";
import { validateScenario, type ValidationResult } from "@openclinxr/shared-schemas";

/**
 * Faculty case-authoring surface model layer (pure, React-free).
 *
 * A "draft" is simply a {@link Scenario}: the authored artifact round-trips through
 * the SAME `@openclinxr/shared-schemas` `ScenarioSchema` and exports in the same
 * shape as `@openclinxr/scenario-fixtures` scenario-bank entries. No forked schema.
 *
 * This surface produces case *definitions* that drive the encounter factory
 * (Q1 blueprint input). It is `notEvidenceFor` clinical validity, exam
 * equivalence, scoring validity, or learner readiness.
 */
export type ScenarioDraft = Scenario;

/**
 * Claim boundary surfaced on the authoring UI and never encoded into the exported
 * Scenario JSON (which must stay shape-identical to scenario-bank entries).
 */
export const caseAuthoringClaimBoundary = Object.freeze([
  "clinical_validity",
  "exam_equivalence",
  "scoring",
  "learner_readiness",
] as const);

export const actorRoleOptions = Object.freeze([
  "patient",
  "family",
  "nurse",
  "physician",
  "consultant",
  "interpreter",
  "medical_assistant",
  "respiratory_therapist",
  "system",
] as const);

export const scenarioStatusOptions = Object.freeze(["draft", "approved", "retired"] as const);

export const complianceRegionOptions = Object.freeze([
  "abdomen_ruq",
  "abdomen_rlq",
  "abdomen_luq",
  "abdomen_llq",
  "abdomen_epigastric",
  "abdomen_suprapubic",
  "chest_R",
  "chest_L",
  "neck_anterior",
  "neck_posterior",
] as const);

export const interactionEmotionOptions = Object.freeze([
  "pain",
  "anxious",
  "concerned",
  "reassured",
  "neutral",
] as const);

export const touchResponseKindOptions = Object.freeze([
  "guarding",
  "palpation",
  "passive_rom",
  "positioning",
] as const);

export const habitusOptions = Object.freeze(["average", "obese", "frail"] as const);

/** Deterministic template for a new touch-response row (mirrors TouchResponseSchema). */
export function createTouchResponseDraft(region: ComplianceRegion = "abdomen_rlq"): TouchResponse {
  return {
    region,
    responseKind: "guarding",
    forceThreshold: 0.4,
    emotionEventId: `touch_${region}_v1`,
    emotion: "concerned",
    responseClip: `openclinxr_role_touch_${region}`,
    dialogueLine: "That area is a little tender.",
    traceTag: `clinical_touch_${region}`,
  };
}

/** Deterministic template for a new actor (mirrors ActorCardSchema; optional fields omitted). */
export function createActorDraft(index: number, role: ActorCard["role"] = "patient"): ActorCard {
  return {
    actorId: `actor_${role}_${index}_v1`,
    role,
    displayName: role === "patient" ? "New Patient" : "New Actor",
    demeanor: "",
  };
}

/**
 * A new empty case that already validates against ScenarioSchema so the author
 * starts from a known-good, safe-claim baseline (formative, stage 0 draft).
 */
export function createEmptyScenarioDraft(): Scenario {
  return {
    scenarioId: "new_case_v1",
    version: 1,
    title: "New Encounter Case",
    status: "draft",
    review: {
      clinical: "draft",
      psychometric: "draft",
      legal: "draft",
      simulationQa: "draft",
    },
    clinicalObjectives: [],
    actors: [createActorDraft(1, "patient")],
    requiredTraceTags: ["encounter_opening"],
    eventSchedule: [],
    reviewRubric: [],
    governance: {
      scoreUseLabel: "formative_local_only",
      syntheticCaseDisclosure:
        "Synthetic local training scenario authored for faculty review; formative local practice only.",
      validationStage: "stage_0_synthetic_draft",
      validationLimitations: [
        "Authoring draft only; no learner-outcome, reliability, fairness, or consequence-validity evidence exists.",
      ],
      requiredReviewerRoles: ["clinician", "psychometrician", "legal", "simulation_qa"],
      sourceIds: ["src-local-authoring-draft"],
      safetyCriticalTraceTags: ["encounter_opening"],
      hiddenFactPolicy: {
        learnerView: "redact_hidden_facts",
        disclosureRequiresTrigger: true,
      },
    },
  };
}

/** Editable subset the antd Form binds to. Non-edited Scenario fields are preserved. */
export type ScenarioFormValues = {
  scenarioId: string;
  version: number;
  title: string;
  status: Scenario["status"];
  clinicalObjectives: string[];
  requiredTraceTags: string[];
  actors: ScenarioActorFormValue[];
  eventSchedule: Scenario["eventSchedule"];
};

export type ScenarioActorFormValue = {
  actorId: string;
  role: ActorCard["role"];
  displayName: string;
  demeanor?: string;
  hiddenFacts?: string[];
  habitus?: BodyMechanics["habitus"];
  touchResponses?: TouchResponse[];
  phenotype?: ActorPhenotype;
};

/** Project a Scenario into the flat, form-friendly shape for antd Form initialValues. */
export function scenarioToFormValues(scenario: Scenario): ScenarioFormValues {
  return {
    scenarioId: scenario.scenarioId,
    version: scenario.version,
    title: scenario.title,
    status: scenario.status,
    clinicalObjectives: [...scenario.clinicalObjectives],
    requiredTraceTags: [...scenario.requiredTraceTags],
    eventSchedule: scenario.eventSchedule.map((entry) => ({ ...entry })),
    actors: scenario.actors.map((actor) => ({
      actorId: actor.actorId,
      role: actor.role,
      displayName: actor.displayName,
      demeanor: actor.demeanor ?? "",
      hiddenFacts: actor.hiddenFacts ? [...actor.hiddenFacts] : [],
      habitus: actor.bodyMechanics?.habitus,
      touchResponses: actor.bodyMechanics?.touchResponses?.map((response) => ({ ...response })) ?? [],
      ...(actor.phenotype ? { phenotype: { ...actor.phenotype } } : {}),
    })),
  };
}

function cleanStrings(values: readonly string[] | undefined): string[] {
  return (values ?? []).map((value) => value.trim()).filter((value) => value.length > 0);
}

/**
 * Drop form-produced empty phenotype values (cleared Selects -> undefined,
 * cleared Inputs -> ""). Empty arrays are preserved so authored lists
 * (accessoryMarkers, garmentLayers) round-trip losslessly. An all-cleared
 * phenotype is omitted entirely, matching ActorPhenotypeSchema absence
 * semantics: the factory refuses rather than silently defaulting.
 */
function cleanPhenotype(phenotype: ActorPhenotype | undefined): ActorPhenotype | undefined {
  if (phenotype === undefined) {
    return undefined;
  }
  const cleaned: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(phenotype)) {
    if (value === undefined || value === null) {
      continue;
    }
    if (typeof value === "string") {
      if (value.trim().length > 0) {
        cleaned[key] = value.trim();
      }
    } else {
      cleaned[key] = value;
    }
  }
  return Object.keys(cleaned).length > 0 ? (cleaned as ActorPhenotype) : undefined;
}

function actorFromFormValue(base: Scenario, formActor: ScenarioActorFormValue): ActorCard {
  // Preserve the richer communicationProfile (and any future optional fields) from the
  // imported actor by id so round-trips stay lossless while the form owns identity,
  // demeanor, hidden facts, and body-mechanics touch responses.
  const preserved = base.actors.find((actor) => actor.actorId === formActor.actorId);
  const hiddenFacts = cleanStrings(formActor.hiddenFacts);
  const touchResponses = (formActor.touchResponses ?? []).map((response) => ({ ...response }));
  const demeanor = formActor.demeanor?.trim() ?? "";

  const actor: ActorCard = {
    actorId: formActor.actorId,
    role: formActor.role,
    displayName: formActor.displayName,
  };
  if (demeanor.length > 0) {
    actor.demeanor = demeanor;
  }
  if (hiddenFacts.length > 0) {
    actor.hiddenFacts = hiddenFacts;
  }
  if (preserved?.communicationProfile) {
    actor.communicationProfile = preserved.communicationProfile;
  }
  if (touchResponses.length > 0 || formActor.habitus !== undefined) {
    const bodyMechanics: BodyMechanics = { touchResponses };
    if (formActor.habitus !== undefined) {
      bodyMechanics.habitus = formActor.habitus;
    }
    actor.bodyMechanics = bodyMechanics;
  }
  // When no touch responses or habitus are authored, bodyMechanics is left absent
  // (optional in ActorCardSchema), so cases without touch interactions stay valid.
  const phenotype = cleanPhenotype(formActor.phenotype);
  if (phenotype) {
    actor.phenotype = phenotype;
  }
  return actor;
}

/**
 * Merge the edited form subset back onto the full base Scenario, preserving every
 * field the form does not expose (review gates, governance, rubric, environment,
 * equipment, asset needs). Guarantees a lossless round-trip of imported cases.
 */
export function mergeFormValuesIntoScenario(base: Scenario, values: ScenarioFormValues): Scenario {
  const merged: Scenario = {
    ...base,
    scenarioId: values.scenarioId.trim(),
    version: values.version,
    title: values.title,
    status: values.status,
    clinicalObjectives: cleanStrings(values.clinicalObjectives),
    requiredTraceTags: cleanStrings(values.requiredTraceTags),
    eventSchedule: (values.eventSchedule ?? []).map((entry) => ({ ...entry })),
    actors: (values.actors ?? []).map((formActor) => actorFromFormValue(base, formActor)),
  };
  return merged;
}

export function validateScenarioDraft(scenario: unknown): ValidationResult {
  return validateScenario(scenario);
}

/** Serialize an authored case as scenario-bank-shaped JSON (2-space indent). */
export function exportScenarioJson(scenario: Scenario): string {
  return `${JSON.stringify(scenario, null, 2)}\n`;
}

export type ParseScenarioResult =
  | { ok: true; scenario: Scenario }
  | { ok: false; errors: string[] };

/** Parse + validate pasted/imported JSON into a Scenario draft. */
export function parseScenarioJson(raw: string): ParseScenarioResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    return { ok: false, errors: [`Invalid JSON: ${error instanceof Error ? error.message : "parse error"}`] };
  }
  const result = validateScenario(parsed);
  if (!result.ok) {
    return { ok: false, errors: result.errors };
  }
  return { ok: true, scenario: parsed as Scenario };
}

/** Distinct trace tags contributed by all authored touch responses (for author feedback). */
export function collectTouchResponseTraceTags(scenario: Scenario): string[] {
  const tags = new Set<string>();
  for (const actor of scenario.actors) {
    for (const response of actor.bodyMechanics?.touchResponses ?? []) {
      tags.add(response.traceTag);
    }
  }
  return [...tags];
}

export function toInteractionEmotion(value: string): InteractionEmotion {
  return interactionEmotionOptions.includes(value as InteractionEmotion)
    ? (value as InteractionEmotion)
    : "neutral";
}
