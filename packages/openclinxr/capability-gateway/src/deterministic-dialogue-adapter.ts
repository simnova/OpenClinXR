import type { ProviderHealth } from "@cellix/provider-contracts";
import type {
  CapabilityProviderBinding,
  RuntimeCapabilityAdapter,
  RuntimeCapabilityRequest,
} from "./types.js";

export const AUTHORED_LOCAL_FIXTURE_PROVIDER_ID = "authored-local-fixture" as const;
export const HIDDEN_TRUTH_REFUSAL_SPOKEN_TEXT =
  "I can only respond as this simulated actor from information that has been appropriately elicited.";
export const ACTOR_TURN_PLAN_CLAIM_SCOPE = "simulated_actor_behavior" as const;
export const ACTOR_TURN_PLAN_NOT_EVIDENCE_FOR = [
  "clinical_affect_inference",
  "empathy_score",
  "licensure",
  "clinical_validity",
  "exam_equivalence",
  "live_provider_readiness",
] as const;

export type DialogueSafetyExpectation = "responds_from_visible_facts" | "blocks_hidden_truth_probe";
export type DialogueEmotion = "anxious" | "concerned" | "reassured" | "neutral";
export type ActorTurnIntensityBucket = "low" | "mid" | "high";
export type ActorTurnAgeBand = "child" | "adolescent" | "adult" | "adult-parent";
export type ActorTurnEventKind =
  | "learner_empathetic"
  | "learner_dismissive"
  | "learner_interruption"
  | "actor_silence_timeout"
  | "learner_acknowledgement"
  | "learner_clinical_question"
  | "learner_personal_question"
  | "learner_unclassified";

export type AuthoredDialogueActor = {
  actorId: string;
  displayName: string;
  role: string;
  age?: number;
  communicationIntensity?: number;
};

export type AuthoredDialogueSeed = {
  seedId: string;
  actorId: string;
  turnIndex: number;
  learnerUtterance: string;
  visibleFacts: readonly string[];
  hiddenFactCanaries: readonly string[];
  safetyExpectation: DialogueSafetyExpectation;
  spokenText?: string;
  affect?: DialogueEmotion;
};

export type AuthoredDialogueScenario = {
  scenarioId: string;
  version: number;
  actors: readonly AuthoredDialogueActor[];
  seeds: readonly AuthoredDialogueSeed[];
};

export type AuthoredDialogueCatalog = {
  scenarios: readonly AuthoredDialogueScenario[];
};

export type DeterministicDialogueRequestPayload = {
  scenarioId: string;
  actorId: string;
  learnerUtterance: string;
  turnIndex: number;
  stationRunId?: string;
  claimLiveProvider?: boolean;
  providerId?: string;
};

export type FrozenActorTurnPlan = {
  planId: string;
  planVersion: number;
  turnId: string;
  stationRunId: string;
  actorId: string;
  respondingActorId: string;
  turnIndex: number;
  spokenText: string;
  spokenTextForTts: string;
  dialogueEmotionFrom: DialogueEmotion;
  dialogueEmotionTo: DialogueEmotion;
  somaticEmotion: null;
  eventKind: ActorTurnEventKind;
  eventKindSource: "classifier" | "touch" | "timeout" | "barge_in";
  intensityBucket: ActorTurnIntensityBucket;
  ageBand: ActorTurnAgeBand;
  performancePlanId: string;
  facePresetId: string;
  posePresetId: string;
  gestureClipIds: string[];
  prosody: {
    wrapTags: string[];
    inlineTags: string[];
    speed: number;
    droppedTags: string[];
  };
  voiceId: string;
  languageProvenance: {
    fallbackUsed: boolean;
    providerId: typeof AUTHORED_LOCAL_FIXTURE_PROVIDER_ID;
  };
  claimScope: typeof ACTOR_TURN_PLAN_CLAIM_SCOPE;
  notEvidenceFor: string[];
};

export class DeterministicDialogueAdapter
  implements RuntimeCapabilityAdapter<DeterministicDialogueRequestPayload, FrozenActorTurnPlan>
{
  constructor(
    readonly binding: CapabilityProviderBinding,
    private readonly catalog: AuthoredDialogueCatalog,
  ) {}

  async health(): Promise<ProviderHealth> {
    return {
      providerId: this.binding.providerId,
      status: "ready",
    };
  }

  async execute(
    request: RuntimeCapabilityRequest<DeterministicDialogueRequestPayload>,
  ): Promise<FrozenActorTurnPlan> {
    if (request.capabilityId !== "model-dialogue") {
      throw new Error(`unsupported_capability:${request.capabilityId}`);
    }
    if (request.profile !== this.binding.profile) {
      throw new Error(`unsupported_profile:${request.profile}`);
    }
    return resolveDeterministicActorTurnPlan(request.payload, this.catalog);
  }
}

export function createDeterministicDialogueAdapter(
  binding: CapabilityProviderBinding,
  catalog: AuthoredDialogueCatalog,
): DeterministicDialogueAdapter {
  return new DeterministicDialogueAdapter(binding, catalog);
}

export function resolveDeterministicActorTurnPlan(
  payload: DeterministicDialogueRequestPayload,
  catalog: AuthoredDialogueCatalog,
): FrozenActorTurnPlan {
  rejectFabricatedProviderClaim(payload);

  const scenario = catalog.scenarios.find((entry) => entry.scenarioId === payload.scenarioId);
  if (!scenario) {
    throw new Error(`unknown_scenario:${payload.scenarioId}`);
  }

  const actor = scenario.actors.find((entry) => entry.actorId === payload.actorId);
  if (!actor) {
    throw new Error(`unknown_actor:${payload.actorId}`);
  }

  const matches = scenario.seeds.filter((seed) =>
    seed.actorId === payload.actorId
    && seed.turnIndex === payload.turnIndex
    && seed.learnerUtterance === payload.learnerUtterance
  );
  if (matches.length === 0) {
    throw new Error(`no_matching_dialogue_seed:${payload.scenarioId}:${payload.actorId}:${payload.turnIndex}`);
  }
  if (matches.length > 1) {
    throw new Error(`ambiguous_dialogue_seed:${payload.scenarioId}:${payload.actorId}:${payload.turnIndex}`);
  }

  const seed = matches[0];
  if (!seed) {
    throw new Error(`no_matching_dialogue_seed:${payload.scenarioId}:${payload.actorId}:${payload.turnIndex}`);
  }

  const { spokenText, fallbackUsed } = composeSpokenText(seed);
  rejectHiddenFactLeakage(spokenText, seed.hiddenFactCanaries);

  const affect = seed.affect ?? "neutral";
  const stationRunId = payload.stationRunId ?? `deterministic-replay:${scenario.scenarioId}`;
  const turnId = `${scenario.scenarioId}:${actor.actorId}:${seed.seedId}:turn-${seed.turnIndex}`;
  const plan: FrozenActorTurnPlan = {
    planId: `plan_${turnId}`,
    planVersion: 1,
    turnId,
    stationRunId,
    actorId: actor.actorId,
    respondingActorId: actor.actorId,
    turnIndex: seed.turnIndex,
    spokenText,
    spokenTextForTts: spokenText,
    dialogueEmotionFrom: "neutral",
    dialogueEmotionTo: affect,
    somaticEmotion: null,
    eventKind: seed.safetyExpectation === "blocks_hidden_truth_probe"
      ? "learner_unclassified"
      : "learner_clinical_question",
    eventKindSource: "classifier",
    intensityBucket: intensityBucketFor(actor.communicationIntensity),
    ageBand: ageBandFor(actor),
    performancePlanId: `fixture:${actor.actorId}:${affect}`,
    facePresetId: `fixture-face:${affect}`,
    posePresetId: `fixture-pose:${affect}`,
    gestureClipIds: [],
    prosody: {
      wrapTags: [],
      inlineTags: [],
      speed: 1,
      droppedTags: [],
    },
    voiceId: `fixture-${actor.actorId}`,
    languageProvenance: {
      fallbackUsed,
      providerId: AUTHORED_LOCAL_FIXTURE_PROVIDER_ID,
    },
    claimScope: ACTOR_TURN_PLAN_CLAIM_SCOPE,
    notEvidenceFor: [...ACTOR_TURN_PLAN_NOT_EVIDENCE_FOR],
  };

  return freezeActorTurnPlan(plan);
}

function composeSpokenText(seed: AuthoredDialogueSeed): { spokenText: string; fallbackUsed: boolean } {
  if (seed.safetyExpectation === "blocks_hidden_truth_probe") {
    return { spokenText: HIDDEN_TRUTH_REFUSAL_SPOKEN_TEXT, fallbackUsed: false };
  }
  const authored = seed.spokenText?.trim();
  if (authored) {
    return { spokenText: authored, fallbackUsed: false };
  }
  return { spokenText: seed.visibleFacts[0] ?? "", fallbackUsed: true };
}

function rejectFabricatedProviderClaim(payload: DeterministicDialogueRequestPayload): void {
  if (payload.claimLiveProvider === true) {
    throw new Error("fabricated_provider_claim:live_provider");
  }
  if (payload.providerId !== undefined && payload.providerId !== AUTHORED_LOCAL_FIXTURE_PROVIDER_ID) {
    throw new Error(`fabricated_provider_claim:${payload.providerId}`);
  }
}

function rejectHiddenFactLeakage(spokenText: string, canaries: readonly string[]): void {
  const haystack = spokenText.toLowerCase();
  for (const canary of canaries) {
    const needle = canary.trim().toLowerCase();
    if (needle.length > 0 && haystack.includes(needle)) {
      throw new Error("hidden_fact_leakage");
    }
  }
}

function intensityBucketFor(intensity: number | undefined): ActorTurnIntensityBucket {
  if (intensity === undefined) {
    return "mid";
  }
  if (intensity <= 0.33) {
    return "low";
  }
  if (intensity <= 0.66) {
    return "mid";
  }
  return "high";
}

function ageBandFor(actor: AuthoredDialogueActor): ActorTurnAgeBand {
  if (typeof actor.age === "number") {
    if (actor.age < 13) {
      return "child";
    }
    if (actor.age < 18) {
      return "adolescent";
    }
  }
  if (actor.role === "family") {
    return "adult-parent";
  }
  return "adult";
}

function freezeActorTurnPlan(plan: FrozenActorTurnPlan): FrozenActorTurnPlan {
  Object.freeze(plan.gestureClipIds);
  Object.freeze(plan.prosody.wrapTags);
  Object.freeze(plan.prosody.inlineTags);
  Object.freeze(plan.prosody.droppedTags);
  Object.freeze(plan.prosody);
  Object.freeze(plan.languageProvenance);
  Object.freeze(plan.notEvidenceFor);
  return Object.freeze(plan);
}
