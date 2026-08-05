import type { ActorCard, Scenario } from "@openclinxr/shared-schemas";
import type {
  MultiActorStateOptionId,
  ActorMemory,
  ActorRuntimeState,
  Vector3,
  ActorInteractionState,
  ActorTransformState,
  ClinicalOrderState,
  TextInteractionSource,
  VoiceTranscriptInteractionSource,
  InteractionTurnSource,
  RouteActorInteractionSourceInput,
  InteractionLogEntry,
  MultiActorClinicalSession,
  InteractionRoutingReason,
  CreateMultiActorClinicalSessionInput,
  RouteActorInteractionInput,
  RouteActorInteractionResult,
  ActorModelContext,
  DurableStorePosture,
  RealtimeCacheStorePosture,
  DurableConversationTurnRecord,
  DurableEmotionalStateTimelineRecord,
  RealtimeSessionCacheTurnRef,
  RealtimeSessionCacheSnapshot,
  DurableMultiActorSessionStore,
  RealtimeSessionCache,
  PersistenceSpikeStores,
  WriteRealtimeCacheSnapshotInput,
  MultiActorPersistencePhase2Strategy,
  RecordClinicalActionInput,
  UpdateActorSpatialStateInput,
  MultiActorStateOption,
  MultiActorStateOptionEvaluation,
} from "./types.js";
import {
  InMemoryDurableMultiActorSessionStore,
  InMemoryRealtimeSessionCache,
  buildRealtimeCacheSnapshot,
  createActorRuntimeState,
  initialActorTransform,
  decideActorRoute,
  withOptionalSource,
  requireActor,
  requireActorTransform,
  roleKeywords,
  relationshipForRole,
  emotionalStateFromDemeanor,
  unique,
  emotionalStateTimelineKey,
  cloneConversationTurn,
  cloneEmotionalStateRecord,
  cloneRealtimeSessionCacheSnapshot,
  cloneActorTransforms,
} from "./internal.js";

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

export function evaluateMultiActorStateOptions(): MultiActorStateOptionEvaluation {
  return {
    generatedAt: "2026-05-05",
    approvedProposal: "proposals/approved/proposal-server-side-multi-actor-state-context.md",
    recommendedFirstImplementation: "custom-domain-state-baseline",
    options: [
      {
        id: "custom-domain-state-baseline",
        packageName: null,
        observedVersion: null,
        licensePosture: "internal_no_new_runtime_dependency",
        productionFit: "high",
        realtimeStateSyncFit: "baseline_only",
        bunHonoAzureFit: "high",
        recommendation: "recommended_first",
        notes: [
          "Fastest way to prove actor routing, memory boundaries, clinical state, and spatial state contracts.",
          "Can move stable APIs into scenario-runtime after spike evidence is reviewed.",
        ],
      },
      {
        id: "colyseus",
        packageName: "colyseus",
        observedVersion: "0.17.10",
        licensePosture: "MIT_package_metadata",
        productionFit: "medium",
        realtimeStateSyncFit: "high",
        bunHonoAzureFit: "low",
        recommendation: "install_backed_followup_candidate",
        notes: [
          "Mature realtime room framework, but heavier than this first baseline.",
          "Best evaluated as a sidecar if rooms, presence, and matchmaking become product requirements.",
        ],
      },
      {
        id: "colyseus-schema",
        packageName: "@colyseus/schema",
        observedVersion: "4.0.21",
        licensePosture: "MIT_package_metadata",
        productionFit: "medium",
        realtimeStateSyncFit: "high",
        bunHonoAzureFit: "medium",
        recommendation: "defer_until_need_is_proven",
        notes: [
          "Likely lighter follow-up if schema/delta synchronization becomes the bottleneck.",
          "Avoid adopting decorator/schema conventions before the domain state is stable.",
        ],
      },
      {
        id: "bitecs",
        packageName: "bitecs",
        observedVersion: "0.4.0",
        licensePosture: "MPL-2.0_package_metadata_license_gated",
        productionFit: "license_gated",
        realtimeStateSyncFit: "medium",
        bunHonoAzureFit: "high",
        recommendation: "defer_until_license_accepted_or_replaced",
        notes: [
          "Technically aligned with ECS thinking, but package metadata is MPL-2.0.",
          "Also solves entity/system modeling, not network replication by itself.",
        ],
      },
    ],
  };
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

