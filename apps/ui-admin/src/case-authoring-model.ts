import { ENVIRONMENT_SHELL_DESCRIPTORS } from "@openclinxr/asset-registry";
import type {
  ActorCard,
  ActorPhenotype,
  BodyMechanics,
  ComplianceRegion,
  InteractionEmotion,
  Scenario,
  TouchResponse,
} from "@openclinxr/shared-schemas";
import { type ValidationResult, validateScenario } from "@openclinxr/shared-schemas";

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

/** Closed asset-kind enum for asset-need rows (mirrors AssetKindSchema). */
export const assetTypeOptions = Object.freeze([
  "character",
  "environment",
  "equipment",
  "prop",
  "texture",
  "audio",
] as const);

/** A single asset-need row (mirrors AssetNeedSchema; not exported as a named type upstream). */
export type ScenarioAssetNeed = NonNullable<Scenario["assetNeeds"]>[number];

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

/**
 * Deterministic template for a new asset-need row (mirrors AssetNeedSchema).
 * Incomplete rows (any required field empty after trim) are dropped on merge, so
 * a fresh row only reaches the exported scenario once assetId/description/
 * licenseStatus are filled.
 */
export function createAssetNeedDraft(): ScenarioAssetNeed {
  return {
    assetId: "new_asset_need_v1",
    assetType: "equipment",
    description: "",
    licenseStatus: "",
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
  /** Registered environment shell id picked by faculty; empty keeps the imported environment. */
  environmentId?: string | undefined;
  /** Free-text equipment names authored as a string list (ScenarioSchema minLength-1 strings). */
  equipment: string[];
  /** Authored asset-need rows (assetId, assetType, description, licenseStatus). */
  assetNeeds: ScenarioAssetNeed[];
  /** Authored actor-affect policy (baseline/upper/lower bounds; transitions are preserved, not edited). */
  emotionPolicy?: Scenario["emotionPolicy"];
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
  /** Faculty-authored Satir/custom dialogue profile; merged in preference to the imported actor. */
  communicationProfile?: ActorCard["communicationProfile"];
};

/** Project a Scenario into the flat, form-friendly shape for antd Form initialValues. */
export function scenarioToFormValues(scenario: Scenario): ScenarioFormValues {
  return {
    scenarioId: scenario.scenarioId,
    version: scenario.version,
    title: scenario.title,
    status: scenario.status,
    environmentId: scenario.environment?.environmentId,
    equipment: [...(scenario.equipment ?? [])],
    assetNeeds: (scenario.assetNeeds ?? []).map((need) => ({ ...need })),
    emotionPolicy: scenario.emotionPolicy
      ? { ...scenario.emotionPolicy, transitions: [...scenario.emotionPolicy.transitions] }
      : undefined,
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
      ...(actor.communicationProfile ? { communicationProfile: { ...actor.communicationProfile } } : {}),
    })),
  };
}

function cleanStrings(values: readonly string[] | undefined): string[] {
  return (values ?? []).map((value) => value.trim()).filter((value) => value.length > 0);
}

/**
 * Drop incomplete asset-need rows so the merged scenario stays ScenarioSchema-valid
 * (every AssetNeedSchema field requires a minLength-1 string): strings are trimmed
 * and any row left with an empty assetId, description, or licenseStatus is removed.
 * Fully populated rows pass through unchanged, so imported cases round-trip losslessly.
 */
function cleanAssetNeeds(values: readonly ScenarioAssetNeed[] | undefined): ScenarioAssetNeed[] {
  return (values ?? [])
    .map((need) => ({
      assetId: need.assetId.trim(),
      assetType: need.assetType,
      description: need.description.trim(),
      licenseStatus: need.licenseStatus.trim(),
    }))
    .filter(
      (need) =>
        need.assetId.length > 0 && need.description.length > 0 && need.licenseStatus.length > 0,
    );
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
  const formStyle = formActor.communicationProfile?.style;
  if (formStyle && preserved?.communicationProfile) {
    actor.communicationProfile = { ...preserved.communicationProfile, style: formStyle };
  } else if (formStyle) {
    actor.communicationProfile = {
      styleFamily: "satir",
      style: formStyle,
      intensity: 0.5,
      baselineMood: ["neutral"],
      communicativeness: "typical",
      topicsToAvoid: [],
      adverseResponse: "withdraw",
      deescalationTriggers: [],
      escalationTriggers: [],
      culturalLanguageNotes: [],
    };
  } else if (preserved?.communicationProfile) {
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
 * Compose scenario.environment from a faculty-picked registered shell id. The
 * EnvironmentSchema requires name + description; both derive from the shared
 * descriptor table (the same table the runtime and factory resolve) so the
 * authored case stays self-consistent when the room changes. An id outside the
 * registry falls back to the id itself rather than inheriting the previous
 * room's prose.
 */
function authoredEnvironment(
  environmentId: string,
): NonNullable<Scenario["environment"]> {
  const displayName = ENVIRONMENT_SHELL_DESCRIPTORS[environmentId]?.displayName ?? environmentId;
  return { environmentId, name: displayName, description: displayName };
}

/**
 * Merge the edited form subset back onto the full base Scenario, preserving every
 * field the form does not expose (review gates, governance, rubric).
 * An authored environmentId that DIFFERS from the imported one
 * round-trips onto scenario.environment (name/description derived from the
 * registered shell, so the case stays self-consistent when the room changes);
 * the same id or an empty form value keeps the imported base environment, so a
 * cleared Select cannot silently invalidate a case and unchanged round-trips
 * stay lossless. Authored equipment (a free-text string list) round-trips onto
 * scenario.equipment, trimmed with empty rows dropped (ScenarioSchema requires
 * minLength-1 strings). Authored asset needs (a row list) round-trip onto
 * scenario.assetNeeds, trimmed with incomplete rows dropped. Authored emotion
 * policy bounds round-trip onto scenario.emotionPolicy: the form exposes no
 * transition-rule editor, so the imported base's transitions are preserved and
 * a fresh policy starts with an empty rule list (CaseEmotionPolicySchema
 * requires the array); an incomplete policy (any bound missing) is dropped,
 * preserving the imported base like incomplete asset-need rows, so the runtime
 * falls back to DEFAULT_EMOTION_POLICY rather than receiving a broken policy.
 * Guarantees a lossless round-trip of imported cases.
 */
export function mergeFormValuesIntoScenario(base: Scenario, values: ScenarioFormValues): Scenario {
  const environmentId = values.environmentId?.trim() ?? "";
  const merged: Scenario = {
    ...base,
    scenarioId: values.scenarioId.trim(),
    version: values.version,
    title: values.title,
    status: values.status,
    clinicalObjectives: cleanStrings(values.clinicalObjectives),
    requiredTraceTags: cleanStrings(values.requiredTraceTags),
    equipment: cleanStrings(values.equipment),
    assetNeeds: cleanAssetNeeds(values.assetNeeds),
    eventSchedule: (values.eventSchedule ?? []).map((entry) => ({ ...entry })),
    actors: (values.actors ?? []).map((formActor) => actorFromFormValue(base, formActor)),
  };
  if (environmentId.length > 0 && environmentId !== base.environment?.environmentId) {
    merged.environment = authoredEnvironment(environmentId);
  }
  const authoredPolicy = values.emotionPolicy;
  if (authoredPolicy && authoredPolicy.baseline && authoredPolicy.upperBound && authoredPolicy.lowerBound) {
    merged.emotionPolicy = {
      baseline: authoredPolicy.baseline,
      upperBound: authoredPolicy.upperBound,
      lowerBound: authoredPolicy.lowerBound,
      transitions: authoredPolicy.transitions ?? base.emotionPolicy?.transitions ?? [],
    };
  }
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
