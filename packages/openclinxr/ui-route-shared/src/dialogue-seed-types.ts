export const AUTHORED_LOCAL_FIXTURE_PROVIDER_ID = "authored-local-fixture" as const;
export const ACTOR_TURN_PLAN_CLAIM_SCOPE = "simulated_actor_behavior" as const;
export const DIALOGUE_SEED_AUTHORING_PREVIEW_PATH = "/internal/authored-dialogue-catalogs/preview";
export const DIALOGUE_SEED_AUTHORING_CLAIM_BOUNDARY =
  "authored_dialogue_catalog_preview_not_live_provider" as const;
export const REQUIRED_NOT_EVIDENCE_FOR = [
  "live_provider_readiness",
  "clinical_validity",
  "exam_equivalence",
] as const;

export type DialogueSafetyExpectation = "responds_from_visible_facts" | "blocks_hidden_truth_probe";
export type DialogueEmotion = "anxious" | "concerned" | "reassured" | "neutral";

export type DialogueSeedActor = {
  actorId: string;
  displayName: string;
  role: string;
  age?: number;
  communicationIntensity?: number;
  hiddenFacts?: readonly string[];
};

export type AuthoredDialogueSeedDraft = {
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

export type DialogueSeedDisclosurePolicy = {
  learnerView: string;
  disclosureRequiresTrigger: boolean;
};

export type FrozenActorTurnPlanPreview = {
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
  eventKind: string;
  eventKindSource: string;
  intensityBucket: "low" | "mid" | "high";
  ageBand: "child" | "adolescent" | "adult" | "adult-parent";
  performancePlanId: string;
  facePresetId: string;
  posePresetId: string;
  gestureClipIds: string[];
  prosody: { wrapTags: string[]; inlineTags: string[]; speed: number; droppedTags: string[] };
  voiceId: string;
  languageProvenance: { fallbackUsed: boolean; providerId: typeof AUTHORED_LOCAL_FIXTURE_PROVIDER_ID };
  claimScope: typeof ACTOR_TURN_PLAN_CLAIM_SCOPE;
  notEvidenceFor: string[];
};

export type DialogueSeedFailureCode =
  | "ambiguous_dialogue_seed"
  | "hidden_fact_leakage"
  | "unknown_actor"
  | "no_matching_dialogue_seed"
  | "fabricated_provider_claim"
  | "unknown_scenario"
  | "forbidden"
  | "invalid_body";

export type DialogueSeedFailure = {
  code: DialogueSeedFailureCode;
  seedId?: string;
  detail: string;
};

export type DialogueSeedPublicationGate = {
  canPublish: boolean;
  liveProviderEnabled: false;
  failures: DialogueSeedFailure[];
  previews: FrozenActorTurnPlanPreview[];
};
