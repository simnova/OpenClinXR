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

export function createMultiActorClinicalSession(
  input: CreateMultiActorClinicalSessionInput,
): MultiActorClinicalSession {
  return {
    stationRunId: input.stationRunId,
    scenarioId: input.scenario.scenarioId,
    scenarioVersion: input.scenario.version,
    actors: input.scenario.actors.map((actor) => createActorRuntimeState(actor)),
    clinicalState: {
      requiredTraceTags: [...input.scenario.requiredTraceTags],
      completedTraceTags: [],
      orders: [],
      findings: [],
    },
    spatialState: {
      actorTransforms: Object.fromEntries(input.scenario.actors.map((actor, index) => [
        actor.actorId,
        initialActorTransform(actor.actorId, index),
      ])),
      objectTransforms: {},
    },
    interactionLog: [],
    evidence: {
      architecture: "custom-domain-state-baseline",
      dependencyPosture: "no_new_runtime_dependencies",
      readyForProductionAdoption: false,
      notEvidenceFor: [
        "production_realtime_state_sync",
        "production_persistence",
        "llm_actor_quality",
        "quest_spatial_sync",
        "clinical_assessment_validity",
      ],
    },
  };
}

export function routeActorInteraction(
  session: MultiActorClinicalSession,
  input: RouteActorInteractionInput,
): RouteActorInteractionResult {
  const decision = decideActorRoute(session.actors, input.learnerUtterance);
  const updatedActors = session.actors.map((actor) =>
    actor.actorId === decision.actor.actorId
      ? { ...actor, conversationTurn: actor.conversationTurn + 1 }
      : actor
  );
  const currentTransform = requireActorTransform(session, decision.actor.actorId);
  const updatedTransforms = {
    ...session.spatialState.actorTransforms,
    [decision.actor.actorId]: {
      ...currentTransform,
      interactionState: "addressed" as const,
      lastUpdatedAtSecond: input.atSecond,
    },
  };

  return {
    routedActorId: decision.actor.actorId,
    routingReason: decision.reason,
    updatedSession: {
      ...session,
      actors: updatedActors,
      spatialState: {
        ...session.spatialState,
        actorTransforms: updatedTransforms,
      },
      interactionLog: [
        ...session.interactionLog,
        withOptionalSource({
          atSecond: input.atSecond,
          learnerUtterance: input.learnerUtterance,
          routedActorId: decision.actor.actorId,
          routingReason: decision.reason,
          traceContextTags: [...(input.traceContextTags ?? [])],
        }, input.source),
      ],
    },
  };
}

export function buildActorModelContext(
  session: MultiActorClinicalSession,
  actorId: string,
): ActorModelContext {
  const actor = requireActor(session, actorId);
  const privateFactRefs = actor.memory.privateFacts.map((_, index) => `fact:${actor.actorId}:${index}`);

  return {
    actorId: actor.actorId,
    actorRole: actor.role,
    displayName: actor.displayName,
    conversationTurn: actor.conversationTurn,
    visibleMemory: {
      facts: [...actor.memory.visibleFacts],
      emotionalState: actor.memory.emotionalState,
      relationshipToLearner: actor.memory.relationshipToLearner,
    },
    privateMemory: {
      factRefs: privateFactRefs,
      factsForServerModelOnly: [...actor.memory.privateFacts],
    },
    clinicalState: {
      completedTraceTags: [...session.clinicalState.completedTraceTags],
      openOrders: session.clinicalState.orders.filter((order) => order.status === "requested"),
    },
    spatialState: requireActorTransform(session, actorId),
    retrievedMemoryIds: [
      `scenario:${session.scenarioId}:v${session.scenarioVersion}`,
      `actor:${actor.actorId}`,
      ...privateFactRefs,
    ],
  };
}

export function recordClinicalAction(
  session: MultiActorClinicalSession,
  input: RecordClinicalActionInput,
): MultiActorClinicalSession {
  requireActor(session, input.actorId);
  const completedTraceTags = unique([...session.clinicalState.completedTraceTags, input.traceTag]);

  if (input.actionType === "order_requested") {
    const order: ClinicalOrderState = {
      orderId: `order_${session.clinicalState.orders.length + 1}_${input.traceTag}`,
      traceTag: input.traceTag,
      label: input.label,
      actorId: input.actorId,
      atSecond: input.atSecond,
      status: "requested",
    };

    return {
      ...session,
      clinicalState: {
        ...session.clinicalState,
        completedTraceTags,
        orders: [...session.clinicalState.orders, order],
      },
    };
  }

  return {
    ...session,
    clinicalState: {
      ...session.clinicalState,
      completedTraceTags,
      findings: [
        ...session.clinicalState.findings,
        {
          findingId: `finding_${session.clinicalState.findings.length + 1}_${input.traceTag}`,
          actorId: input.actorId,
          label: input.label,
          atSecond: input.atSecond,
        },
      ],
    },
  };
}

export function updateActorSpatialState(
  session: MultiActorClinicalSession,
  input: UpdateActorSpatialStateInput,
): MultiActorClinicalSession {
  requireActor(session, input.actorId);

  return {
    ...session,
    spatialState: {
      ...session.spatialState,
      actorTransforms: {
        ...session.spatialState.actorTransforms,
        [input.actorId]: {
          actorId: input.actorId,
          position: { ...input.position },
          rotationYRadians: input.rotationYRadians,
          interactionState: input.interactionState,
          lastUpdatedAtSecond: input.atSecond,
        },
      },
    },
  };
}

export function createPersistenceSpikeStores(): PersistenceSpikeStores {
  return {
    durable: new InMemoryDurableMultiActorSessionStore(),
    realtime: new InMemoryRealtimeSessionCache(),
  };
}

export function persistLatestInteractionTurn(
  stores: PersistenceSpikeStores,
  session: MultiActorClinicalSession,
): DurableConversationTurnRecord {
  const entry = session.interactionLog.at(-1);
  if (!entry) {
    throw new Error("Cannot persist interaction turn without an interaction log entry");
  }
  const actor = requireActor(session, entry.routedActorId);
  const existingTurns = stores.durable.listConversationTurns(session.stationRunId);
  const sourceKind = entry.source?.kind ?? "text";
  const provenanceRefs = entry.source?.provenanceRefs ?? [];
  const record: DurableConversationTurnRecord = {
    turnId: `turn_${existingTurns.length + 1}_${entry.routedActorId}_${entry.atSecond}`,
    stationRunId: session.stationRunId,
    actorId: entry.routedActorId,
    atSecond: entry.atSecond,
    sourceKind,
    text: entry.source?.kind === "voice_transcript" ? entry.source.finalTranscriptText : entry.learnerUtterance,
    traceContextTags: [...entry.traceContextTags],
    emotionalState: actor.memory.emotionalState,
    routingReason: entry.routingReason,
    rawAudioStored: false,
    provenanceRefs: [...provenanceRefs],
    durableStore: "database_source_of_truth",
  };

  stores.durable.saveConversationTurn(record);
  stores.durable.saveEmotionalStateTimeline({
    stationRunId: session.stationRunId,
    actorId: entry.routedActorId,
    atSecond: entry.atSecond,
    emotionalState: actor.memory.emotionalState,
    sourceTurnId: record.turnId,
    durableStore: "database_source_of_truth",
  });

  return record;
}

export function writeRealtimeCacheSnapshot(
  stores: PersistenceSpikeStores,
  session: MultiActorClinicalSession,
  input: WriteRealtimeCacheSnapshotInput,
): RealtimeSessionCacheSnapshot {
  const snapshot = buildRealtimeCacheSnapshot({
    stores,
    session,
    input,
    rehydratedFromDurableStore: false,
  });
  stores.realtime.write(snapshot);
  return snapshot;
}

export function rehydrateRealtimeCacheFromDurableState(
  stores: PersistenceSpikeStores,
  session: MultiActorClinicalSession,
  input: WriteRealtimeCacheSnapshotInput,
): RealtimeSessionCacheSnapshot {
  const snapshot = buildRealtimeCacheSnapshot({
    stores,
    session,
    input,
    rehydratedFromDurableStore: true,
  });
  stores.realtime.write(snapshot);
  return snapshot;
}

export function evaluateMultiActorPersistencePhase2Strategy(): MultiActorPersistencePhase2Strategy {
  return {
    generatedAt: "2026-05-05",
    approvedProposal: "proposals/approved/proposal-server-side-multi-actor-state-context-persistence-phase2.md",
    recommendation: "custom_domain_state_with_durable_database_and_ephemeral_redis_cache",
    localProfile: {
      realtimeCache: "redka_or_adapter_test_double",
      durableStore: "mongodb_memory_server_or_local_mongodb",
    },
    productionProfile: {
      realtimeCache: "redis",
      durableStore: "mongodb_or_documentdb_compatible",
    },
    responsibilitySplit: {
      realtimeCache: [
        "spatial_actor_transforms",
        "presence",
        "recent_context_window",
        "pubsub_notifications",
        "short_lived_session_leases",
      ],
      durableDatabase: [
        "conversation_history",
        "emotional_state_timeline",
        "clinical_trace_events",
        "orders_and_findings",
        "audit_relevant_interaction_records",
        "review_and_recovery_checkpoints",
      ],
    },
    guardrails: [
      "redis_redka_is_not_the_clinical_source_of_truth",
      "cache_entries_must_be_rehydratable_from_durable_database",
      "raw_voice_audio_is_not_persisted_in_actor_state",
      "high_frequency_spatial_updates_should_be_checkpointed_selectively",
    ],
    notEvidenceFor: [
      "production_persistence_architecture",
      "redis_runtime_performance",
      "redka_package_compatibility",
      "clinical_record_retention_policy",
    ],
  };
}

class InMemoryDurableMultiActorSessionStore implements DurableMultiActorSessionStore {
  private readonly conversationTurns = new Map<string, DurableConversationTurnRecord[]>();
  private readonly emotionalStateTimeline = new Map<string, DurableEmotionalStateTimelineRecord[]>();

  saveConversationTurn(record: DurableConversationTurnRecord): void {
    const existing = this.conversationTurns.get(record.stationRunId) ?? [];
    this.conversationTurns.set(record.stationRunId, [...existing, cloneConversationTurn(record)]);
  }

  listConversationTurns(stationRunId: string): DurableConversationTurnRecord[] {
    return [...(this.conversationTurns.get(stationRunId) ?? [])]
      .sort((left, right) => left.atSecond - right.atSecond || left.turnId.localeCompare(right.turnId))
      .map(cloneConversationTurn);
  }

  saveEmotionalStateTimeline(record: DurableEmotionalStateTimelineRecord): void {
    const key = emotionalStateTimelineKey(record.stationRunId, record.actorId);
    const existing = this.emotionalStateTimeline.get(key) ?? [];
    this.emotionalStateTimeline.set(key, [...existing, cloneEmotionalStateRecord(record)]);
  }

  listEmotionalStateTimeline(stationRunId: string, actorId: string): DurableEmotionalStateTimelineRecord[] {
    return [...(this.emotionalStateTimeline.get(emotionalStateTimelineKey(stationRunId, actorId)) ?? [])]
      .sort((left, right) => left.atSecond - right.atSecond || left.sourceTurnId.localeCompare(right.sourceTurnId))
      .map(cloneEmotionalStateRecord);
  }
}

class InMemoryRealtimeSessionCache implements RealtimeSessionCache {
  private readonly snapshots = new Map<string, RealtimeSessionCacheSnapshot>();

  write(snapshot: RealtimeSessionCacheSnapshot): void {
    this.snapshots.set(snapshot.stationRunId, cloneRealtimeSessionCacheSnapshot(snapshot));
  }

  read(stationRunId: string): RealtimeSessionCacheSnapshot | null {
    const snapshot = this.snapshots.get(stationRunId);
    return snapshot ? cloneRealtimeSessionCacheSnapshot(snapshot) : null;
  }

  clear(): void {
    this.snapshots.clear();
  }
}

function buildRealtimeCacheSnapshot(input: {
  stores: PersistenceSpikeStores;
  session: MultiActorClinicalSession;
  input: WriteRealtimeCacheSnapshotInput;
  rehydratedFromDurableStore: boolean;
}): RealtimeSessionCacheSnapshot {
  const durableTurns = input.stores.durable.listConversationTurns(input.session.stationRunId);
  const recentTurns = durableTurns
    .slice(-input.input.recentTurnLimit)
    .map((turn) => ({
      turnId: turn.turnId,
      actorId: turn.actorId,
      atSecond: turn.atSecond,
    }));

  return {
    stationRunId: input.session.stationRunId,
    cacheStore: "redis_redka_ephemeral_cache",
    expiresAtSecond: input.input.currentSecond + input.input.ttlSeconds,
    recentTurns,
    actorTransforms: cloneActorTransforms(input.session.spatialState.actorTransforms),
    rehydratedFromDurableStore: input.rehydratedFromDurableStore,
  };
}

function createActorRuntimeState(actor: ActorCard): ActorRuntimeState {
  return {
    actorId: actor.actorId,
    role: actor.role,
    displayName: actor.displayName,
    demeanor: actor.demeanor ?? "",
    memory: {
      visibleFacts: actor.demeanor ? [`Demeanor: ${actor.demeanor}`] : [],
      privateFacts: [...(actor.hiddenFacts ?? [])],
      relationshipToLearner: relationshipForRole(actor.role),
      emotionalState: emotionalStateFromDemeanor(actor.demeanor ?? ""),
    },
    conversationTurn: 0,
  };
}

function initialActorTransform(actorId: string, index: number): ActorTransformState {
  const positions: Vector3[] = [
    { x: 0, y: 0, z: -1.15 },
    { x: -0.9, y: 0, z: -0.8 },
    { x: 0.9, y: 0, z: -0.8 },
    { x: 0, y: 0, z: -2.0 },
  ];
  return {
    actorId,
    position: positions[index] ?? { x: index * 0.45, y: 0, z: -1.5 },
    rotationYRadians: 0,
    interactionState: "idle",
    lastUpdatedAtSecond: 0,
  };
}

function decideActorRoute(
  actors: ActorRuntimeState[],
  learnerUtterance: string,
): { actor: ActorRuntimeState; reason: InteractionRoutingReason } {
  const normalized = learnerUtterance.toLowerCase();
  const namedActor = actors.find((actor) => {
    const firstName = actor.displayName.toLowerCase().split(" ")[0];
    return firstName ? normalized.includes(firstName) : false;
  });
  if (namedActor) {
    return { actor: namedActor, reason: "addressed_actor_name" };
  }

  const roleActor = actors.find((actor) => roleKeywords(actor.role).some((keyword) => normalized.includes(keyword)));
  if (roleActor) {
    return { actor: roleActor, reason: "addressed_role_keyword" };
  }

  const patient = actors.find((actor) => actor.role === "patient");
  if (patient) {
    return { actor: patient, reason: "single_patient_default" };
  }

  const fallback = actors[0];
  if (!fallback) {
    throw new Error("Cannot route interaction without actors");
  }
  return { actor: fallback, reason: "fallback_first_actor" };
}

function withOptionalSource(
  entry: Omit<InteractionLogEntry, "source">,
  source: RouteActorInteractionSourceInput | undefined,
): InteractionLogEntry {
  if (!source) {
    return entry;
  }

  if (source.kind === "voice_transcript") {
    return {
      ...entry,
      source: {
        ...source,
        provenanceRefs: [...source.provenanceRefs],
        rawAudioStored: false,
      },
    };
  }

  return {
    ...entry,
    source: {
      ...source,
      provenanceRefs: [...(source.provenanceRefs ?? [])],
    },
  };
}

function requireActor(session: MultiActorClinicalSession, actorId: string): ActorRuntimeState {
  const actor = session.actors.find((candidate) => candidate.actorId === actorId);
  if (!actor) {
    throw new Error(`Actor not found: ${actorId}`);
  }
  return actor;
}

function requireActorTransform(
  session: MultiActorClinicalSession,
  actorId: string,
): ActorTransformState {
  const transform = session.spatialState.actorTransforms[actorId];
  if (!transform) {
    throw new Error(`Actor transform not found: ${actorId}`);
  }
  return transform;
}

function roleKeywords(role: ActorCard["role"]): string[] {
  switch (role) {
    case "family":
      return ["family", "spouse", "wife", "husband", "partner"];
    case "physician":
      return ["doctor", "physician", "attending"];
    case "nurse":
      return ["nurse", "rn"];
    case "patient":
      return ["patient"];
    default:
      return [role.replace(/_/g, " ")];
  }
}

function relationshipForRole(role: ActorCard["role"]): string {
  switch (role) {
    case "patient":
      return "primary patient in the encounter";
    case "family":
      return "family member advocating for the patient";
    case "nurse":
      return "clinical teammate supporting the learner";
    case "physician":
      return "supervising physician or consultant";
    default:
      return "scenario participant";
  }
}

function emotionalStateFromDemeanor(demeanor: string): string {
  const normalized = demeanor.toLowerCase();
  if (normalized.includes("worried") || normalized.includes("anxious")) {
    return "anxious";
  }
  if (normalized.includes("urgent") || normalized.includes("escalating")) {
    return "urgent";
  }
  if (normalized.includes("focused")) {
    return "focused";
  }
  return "neutral";
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}

function emotionalStateTimelineKey(stationRunId: string, actorId: string): string {
  return `${stationRunId}:${actorId}`;
}

function cloneConversationTurn(record: DurableConversationTurnRecord): DurableConversationTurnRecord {
  return {
    ...record,
    traceContextTags: [...record.traceContextTags],
    provenanceRefs: [...record.provenanceRefs],
  };
}

function cloneEmotionalStateRecord(
  record: DurableEmotionalStateTimelineRecord,
): DurableEmotionalStateTimelineRecord {
  return { ...record };
}

function cloneRealtimeSessionCacheSnapshot(snapshot: RealtimeSessionCacheSnapshot): RealtimeSessionCacheSnapshot {
  return {
    ...snapshot,
    recentTurns: snapshot.recentTurns.map((turn) => ({ ...turn })),
    actorTransforms: cloneActorTransforms(snapshot.actorTransforms),
  };
}

function cloneActorTransforms(
  transforms: Record<string, ActorTransformState>,
): Record<string, ActorTransformState> {
  return Object.fromEntries(
    Object.entries(transforms).map(([actorId, transform]) => [
      actorId,
      {
        ...transform,
        position: { ...transform.position },
      },
    ]),
  );
}
