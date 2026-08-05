import type { ActorCard, Scenario } from "@openclinxr/shared-schemas";

export type MultiActorStateOptionId = "custom-domain-state-baseline" | "colyseus" | "colyseus-schema" | "bitecs";

export type ActorMemory = {
  visibleFacts: string[];
  privateFacts: string[];
  relationshipToLearner: string;
  emotionalState: string;
};

export type ActorRuntimeState = {
  actorId: string;
  role: ActorCard["role"];
  displayName: string;
  demeanor: string;
  memory: ActorMemory;
  conversationTurn: number;
};

export type Vector3 = {
  x: number;
  y: number;
  z: number;
};

export type ActorInteractionState =
  | "idle"
  | "addressed"
  | "speaking"
  | "holding_equipment"
  | "performing_task";

export type ActorTransformState = {
  actorId: string;
  position: Vector3;
  rotationYRadians: number;
  interactionState: ActorInteractionState;
  lastUpdatedAtSecond: number;
};

export type ClinicalOrderState = {
  orderId: string;
  traceTag: string;
  label: string;
  actorId: string;
  atSecond: number;
  status: "requested" | "completed" | "cancelled";
};

export type TextInteractionSource = {
  kind: "text";
  provenanceRefs?: string[];
};

export type VoiceTranscriptInteractionSource = {
  kind: "voice_transcript";
  streamId: string;
  transcriptSegmentId: string;
  finalTranscriptText: string;
  provider: string;
  provenanceRefs: string[];
  rawAudioStored: false;
};

export type InteractionTurnSource = TextInteractionSource | VoiceTranscriptInteractionSource;

export type RouteActorInteractionSourceInput =
  | TextInteractionSource
  | (Omit<VoiceTranscriptInteractionSource, "rawAudioStored"> & {
      rawAudioStored?: false;
    });

export type InteractionLogEntry = {
  atSecond: number;
  learnerUtterance: string;
  routedActorId: string;
  routingReason: InteractionRoutingReason;
  traceContextTags: string[];
  source?: InteractionTurnSource;
};

export type MultiActorClinicalSession = {
  stationRunId: string;
  scenarioId: string;
  scenarioVersion: number;
  actors: ActorRuntimeState[];
  clinicalState: {
    requiredTraceTags: string[];
    completedTraceTags: string[];
    orders: ClinicalOrderState[];
    findings: Array<{
      findingId: string;
      actorId: string;
      label: string;
      atSecond: number;
    }>;
  };
  spatialState: {
    actorTransforms: Record<string, ActorTransformState>;
    objectTransforms: Record<string, ActorTransformState>;
  };
  interactionLog: InteractionLogEntry[];
  evidence: {
    architecture: "custom-domain-state-baseline";
    dependencyPosture: "no_new_runtime_dependencies";
    readyForProductionAdoption: false;
    notEvidenceFor: readonly [
      "production_realtime_state_sync",
      "llm_actor_quality",
      "quest_spatial_sync",
      "clinical_assessment_validity",
    ];
  };
};

export type InteractionRoutingReason =
  | "addressed_actor_name"
  | "addressed_role_keyword"
  | "single_patient_default"
  | "fallback_first_actor";

export type CreateMultiActorClinicalSessionInput = {
  scenario: Scenario;
  stationRunId: string;
};

export type RouteActorInteractionInput = {
  atSecond: number;
  learnerUtterance: string;
  traceContextTags?: string[];
  source?: RouteActorInteractionSourceInput;
};

export type RouteActorInteractionResult = {
  routedActorId: string;
  routingReason: InteractionRoutingReason;
  updatedSession: MultiActorClinicalSession;
};

export type ActorModelContext = {
  actorId: string;
  actorRole: ActorCard["role"];
  displayName: string;
  conversationTurn: number;
  visibleMemory: {
    facts: string[];
    emotionalState: string;
    relationshipToLearner: string;
  };
  privateMemory: {
    factRefs: string[];
    factsForServerModelOnly: string[];
  };
  clinicalState: {
    completedTraceTags: string[];
    openOrders: ClinicalOrderState[];
  };
  spatialState: ActorTransformState;
  retrievedMemoryIds: string[];
};

export type DurableStorePosture = "database_source_of_truth";
export type RealtimeCacheStorePosture = "redis_redka_ephemeral_cache";

export type DurableConversationTurnRecord = {
  turnId: string;
  stationRunId: string;
  actorId: string;
  atSecond: number;
  sourceKind: InteractionTurnSource["kind"];
  text: string;
  traceContextTags: string[];
  emotionalState: string;
  routingReason: InteractionRoutingReason;
  rawAudioStored: false;
  provenanceRefs: string[];
  durableStore: DurableStorePosture;
};

export type DurableEmotionalStateTimelineRecord = {
  stationRunId: string;
  actorId: string;
  atSecond: number;
  emotionalState: string;
  sourceTurnId: string;
  durableStore: DurableStorePosture;
};

export type RealtimeSessionCacheTurnRef = {
  turnId: string;
  actorId: string;
  atSecond: number;
};

export type RealtimeSessionCacheSnapshot = {
  stationRunId: string;
  cacheStore: RealtimeCacheStorePosture;
  expiresAtSecond: number;
  recentTurns: RealtimeSessionCacheTurnRef[];
  actorTransforms: Record<string, ActorTransformState>;
  rehydratedFromDurableStore: boolean;
};

export type DurableMultiActorSessionStore = {
  saveConversationTurn(record: DurableConversationTurnRecord): void;
  listConversationTurns(stationRunId: string): DurableConversationTurnRecord[];
  saveEmotionalStateTimeline(record: DurableEmotionalStateTimelineRecord): void;
  listEmotionalStateTimeline(stationRunId: string, actorId: string): DurableEmotionalStateTimelineRecord[];
};

export type RealtimeSessionCache = {
  write(snapshot: RealtimeSessionCacheSnapshot): void;
  read(stationRunId: string): RealtimeSessionCacheSnapshot | null;
  clear(): void;
};

export type PersistenceSpikeStores = {
  durable: DurableMultiActorSessionStore;
  realtime: RealtimeSessionCache;
};

export type WriteRealtimeCacheSnapshotInput = {
  currentSecond: number;
  ttlSeconds: number;
  recentTurnLimit: number;
};

export type MultiActorPersistencePhase2Strategy = {
  generatedAt: "2026-05-05";
  approvedProposal: "proposals/approved/proposal-server-side-multi-actor-state-context-persistence-phase2.md";
  recommendation: "custom_domain_state_with_durable_database_and_ephemeral_redis_cache";
  localProfile: {
    realtimeCache: "redka_or_adapter_test_double";
    durableStore: "mongodb_memory_server_or_local_mongodb";
  };
  productionProfile: {
    realtimeCache: "redis";
    durableStore: "mongodb_or_documentdb_compatible";
  };
  responsibilitySplit: {
    realtimeCache: string[];
    durableDatabase: string[];
  };
  guardrails: string[];
  notEvidenceFor: readonly [
    "production_persistence_architecture",
    "redis_runtime_performance",
    "redka_package_compatibility",
    "clinical_record_retention_policy",
  ];
};

export type RecordClinicalActionInput = {
  atSecond: number;
  actorId: string;
  traceTag: string;
  actionType: "order_requested" | "finding_observed";
  label: string;
};

export type UpdateActorSpatialStateInput = {
  atSecond: number;
  actorId: string;
  position: Vector3;
  rotationYRadians: number;
  interactionState: ActorInteractionState;
};

export type MultiActorStateOption = {
  id: MultiActorStateOptionId;
  packageName: string | null;
  observedVersion: string | null;
  licensePosture: string;
  productionFit: "high" | "medium" | "low" | "license_gated";
  realtimeStateSyncFit: "high" | "medium" | "baseline_only";
  bunHonoAzureFit: "high" | "medium" | "low";
  recommendation:
    | "recommended_first"
    | "install_backed_followup_candidate"
    | "defer_until_need_is_proven"
    | "defer_until_license_accepted_or_replaced";
  notes: string[];
};

export type MultiActorStateOptionEvaluation = {
  generatedAt: "2026-05-05";
  approvedProposal: "proposals/approved/proposal-server-side-multi-actor-state-context.md";
  recommendedFirstImplementation: "custom-domain-state-baseline";
  options: MultiActorStateOption[];
};

