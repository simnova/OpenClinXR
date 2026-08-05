import type { ActorCard, Scenario } from "@openclinxr/shared-schemas";

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

export type SessionStateEvidenceBoundary = {
  architecture: "custom-domain-state-baseline";
  dependencyPosture: "no_new_runtime_dependencies";
  readyForProductionAdoption: false;
  notEvidenceFor: readonly [
    "production_realtime_state_sync",
    "production_persistence",
    "llm_actor_quality",
    "quest_spatial_sync",
    "clinical_assessment_validity",
  ];
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
  evidence: SessionStateEvidenceBoundary;
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

export type DurableClinicalEventKind =
  | "clinical_action_recorded"
  | "order_status_changed"
  | "finding_recorded"
  | "checklist_item_updated"
  | "rubric_progress_updated"
  | "case_status_changed";

export type DurableClinicalEventPayload = {
  public: Record<string, unknown>;
  private?: {
    hiddenFactRefs?: string[];
    serverOnlyNotes?: string[];
    [key: string]: unknown;
  };
};

export type DurableClinicalEventRecord = {
  clinicalEventId: string;
  stationRunId: string;
  actorId?: string;
  atSecond: number;
  eventKind: DurableClinicalEventKind;
  traceTag?: string;
  label: string;
  status?: string;
  payload: DurableClinicalEventPayload;
  provenanceRefs: string[];
  durableStore: DurableStorePosture;
};

export type DurableClinicalEventReviewProjection = {
  clinicalEventId: string;
  stationRunId: string;
  actorId?: string;
  atSecond: number;
  eventKind: DurableClinicalEventKind;
  traceTag?: string;
  label: string;
  status?: string;
  payload: Record<string, unknown>;
  provenanceRefs: string[];
  privatePayloadRedacted: boolean;
  durableStore: DurableStorePosture;
};

export type DurableClinicalEventReviewProjectionSummary = {
  stationRunId: string | null;
  eventCount: number;
  redactedEventCount: number;
  clinicalEventKinds: Record<DurableClinicalEventKind, number>;
  traceTags: string[];
  statusCounts: Record<string, number>;
  latestAtSecond: number | null;
  durableStore: DurableStorePosture | "mixed" | null;
  safeForFacultyReview: boolean;
};

export type SessionStateWebSocketMessageDirection = "client_to_server" | "server_to_client";
export type SessionStateWebSocketMessageTransport = "websocket_design_contract";
export type SessionStateWebSocketMessageType =
  | "session.snapshot.request"
  | "session.snapshot"
  | "actor.interaction.route"
  | "actor.interaction.routed"
  | "clinical.event.appended"
  | "spatial.actor.transform"
  | "session.resync.required";

export type SessionStateWebSocketEvidenceBoundary = {
  runtimeSyncImplemented: false;
  readyForProductionAdoption: false;
  notEvidenceFor: readonly [
    "apps_api_websocket_route",
    "production_realtime_state_sync",
    "redis_redka_adapter",
    "quest_network_performance",
    "clinical_assessment_validity",
  ];
};

export type SessionStateWebSocketMessageBase<TType extends SessionStateWebSocketMessageType> = {
  type: TType;
  schemaVersion: 1;
  transport: SessionStateWebSocketMessageTransport;
  direction: SessionStateWebSocketMessageDirection;
  messageId: string;
  stationRunId: string;
  sequence: number;
  atSecond: number;
  sentAt: string;
};

export type SessionStateSnapshotActor = {
  actorId: string;
  role: ActorCard["role"];
  displayName: string;
  conversationTurn: number;
  visibleMemory: {
    facts: string[];
    emotionalState: string;
    relationshipToLearner: string;
  };
};

export type SessionStateSnapshotMessage = SessionStateWebSocketMessageBase<"session.snapshot"> & {
  direction: "server_to_client";
  scenario: {
    scenarioId: string;
    scenarioVersion: number;
  };
  actors: SessionStateSnapshotActor[];
  clinical: MultiActorClinicalSession["clinicalState"];
  spatial: MultiActorClinicalSession["spatialState"];
  evidence: SessionStateWebSocketEvidenceBoundary;
};

export type ActorInteractionRouteMessage = SessionStateWebSocketMessageBase<"actor.interaction.route"> & {
  direction: "client_to_server";
  payload: RouteActorInteractionInput;
};

export type ActorInteractionRoutedMessage = SessionStateWebSocketMessageBase<"actor.interaction.routed"> & {
  direction: "server_to_client";
  routedActorId: string;
  routingReason: InteractionRoutingReason;
  traceContextTags: string[];
  conversationTurn: number;
};

export type ClinicalEventAppendedMessage = SessionStateWebSocketMessageBase<"clinical.event.appended"> & {
  direction: "server_to_client";
  event: DurableClinicalEventReviewProjection;
};

export type SpatialActorTransformMessage = SessionStateWebSocketMessageBase<"spatial.actor.transform"> & {
  actorId: string;
  transform: ActorTransformState;
};

export type SessionStateWebSocketMessage =
  | SessionStateSnapshotMessage
  | ActorInteractionRouteMessage
  | ActorInteractionRoutedMessage
  | ClinicalEventAppendedMessage
  | SpatialActorTransformMessage;

export type SessionStateWebSocketMessageDesignPosture = {
  generatedAt: "2026-05-05";
  approvedProposal: "proposals/approved/proposal-multi-actor-runtime-promotion.md";
  transportPosture: "websocket_design_contract_only";
  runtimeImplemented: false;
  apiWiringIncluded: false;
  redisRedkaIncluded: false;
  databasePersistenceIncluded: false;
  messageFamilies: readonly SessionStateWebSocketMessageType[];
  guardrails: string[];
  notEvidenceFor: SessionStateWebSocketEvidenceBoundary["notEvidenceFor"];
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
  saveClinicalEvent(record: DurableClinicalEventRecord): void;
  listClinicalEvents(stationRunId: string): DurableClinicalEventRecord[];
  listClinicalEventReviewProjections(stationRunId: string): DurableClinicalEventReviewProjection[];
};

export type AsyncDurableMultiActorSessionStore = {
  ensureIndexes?: () => Promise<void>;
  saveConversationTurn(record: DurableConversationTurnRecord): Promise<void>;
  listConversationTurns(stationRunId: string): Promise<DurableConversationTurnRecord[]>;
  saveEmotionalStateTimeline(record: DurableEmotionalStateTimelineRecord): Promise<void>;
  listEmotionalStateTimeline(
    stationRunId: string,
    actorId: string,
  ): Promise<DurableEmotionalStateTimelineRecord[]>;
  saveClinicalEvent(record: DurableClinicalEventRecord): Promise<void>;
  listClinicalEvents(stationRunId: string): Promise<DurableClinicalEventRecord[]>;
  listClinicalEventReviewProjections(stationRunId: string): Promise<DurableClinicalEventReviewProjection[]>;
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

