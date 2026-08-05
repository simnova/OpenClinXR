import type { ActorCard, Scenario } from "@openclinxr/shared-schemas";
import type {
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
  SessionStateEvidenceBoundary,
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
  DurableClinicalEventKind,
  DurableClinicalEventPayload,
  DurableClinicalEventRecord,
  DurableClinicalEventReviewProjection,
  DurableClinicalEventReviewProjectionSummary,
  SessionStateWebSocketMessageDirection,
  SessionStateWebSocketMessageTransport,
  SessionStateWebSocketMessageType,
  SessionStateWebSocketEvidenceBoundary,
  SessionStateWebSocketMessageBase,
  SessionStateSnapshotActor,
  SessionStateSnapshotMessage,
  ActorInteractionRouteMessage,
  ActorInteractionRoutedMessage,
  ClinicalEventAppendedMessage,
  SpatialActorTransformMessage,
  SessionStateWebSocketMessage,
  SessionStateWebSocketMessageDesignPosture,
  RealtimeSessionCacheTurnRef,
  RealtimeSessionCacheSnapshot,
  DurableMultiActorSessionStore,
  AsyncDurableMultiActorSessionStore,
  RealtimeSessionCache,
  PersistenceSpikeStores,
  WriteRealtimeCacheSnapshotInput,
  MultiActorPersistencePhase2Strategy,
  RecordClinicalActionInput,
  UpdateActorSpatialStateInput,
} from "./types.js";
import {
  projectDurableClinicalEventForReview,
  durableClinicalEventKindList,
  summarizeDurableClinicalEventReviewProjections,
  InMemoryDurableMultiActorSessionStore,
  countClinicalEventKinds,
  countProjectionStatuses,
  projectionPayloadIsReviewSafe,
  uniqueProjectionValues,
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
  baseWebSocketMessage,
  routeActorInteractionPayload,
  sessionStateWebSocketEvidenceBoundary,
  cloneClinicalState,
  cloneSpatialState,
  cloneActorTransform,
  cloneConversationTurn,
  cloneEmotionalStateRecord,
  cloneClinicalEventRecord,
  assertDurableClinicalEventStorePosture,
  assertDurableActorTurnStorePosture,
  interactionTurnSourceKinds,
  interactionRoutingReasons,
  assertValidDurableConversationTurnRecord,
  assertValidDurableEmotionalStateTimelineRecord,
  assertNonblankDurableActorTurnField,
  assertNonblankDurableActorTurnArray,
  durableClinicalEventKinds,
  assertValidDurableClinicalEventRecord,
  assertNonblankDurableClinicalEventField,
  assertDurableClinicalEventProvenanceRefsMatchStationRun,
  cloneClinicalEventPrivatePayload,
  cloneJsonRecord,
  redactReviewPayload,
  redactReviewPayloadValue,
  reviewPayloadRequiresRedaction,
  isPrivateReviewPayloadKey,
  cloneRealtimeSessionCacheSnapshot,
  cloneActorTransforms,
  assertFiniteActorTransform,
} from "./internal.js";

export function createSessionStateSnapshotMessage(
  session: MultiActorClinicalSession,
  input: {
    messageId: string;
    sequence: number;
    atSecond: number;
    sentAt: string;
  },
): SessionStateSnapshotMessage {
  return {
    ...baseWebSocketMessage("session.snapshot", {
      direction: "server_to_client",
      messageId: input.messageId,
      stationRunId: session.stationRunId,
      sequence: input.sequence,
      atSecond: input.atSecond,
      sentAt: input.sentAt,
    }),
    scenario: {
      scenarioId: session.scenarioId,
      scenarioVersion: session.scenarioVersion,
    },
    actors: session.actors.map((actor) => ({
      actorId: actor.actorId,
      role: actor.role,
      displayName: actor.displayName,
      conversationTurn: actor.conversationTurn,
      visibleMemory: {
        facts: [...actor.memory.visibleFacts],
        emotionalState: actor.memory.emotionalState,
        relationshipToLearner: actor.memory.relationshipToLearner,
      },
    })),
    clinical: cloneClinicalState(session.clinicalState),
    spatial: cloneSpatialState(session.spatialState),
    evidence: sessionStateWebSocketEvidenceBoundary(),
  };
}

export function createActorInteractionRouteMessage(input: {
  messageId: string;
  sequence: number;
  stationRunId: string;
  atSecond: number;
  sentAt: string;
  learnerUtterance: string;
  traceContextTags?: string[];
  source?: RouteActorInteractionSourceInput;
}): ActorInteractionRouteMessage {
  return {
    ...baseWebSocketMessage("actor.interaction.route", {
      direction: "client_to_server",
      messageId: input.messageId,
      stationRunId: input.stationRunId,
      sequence: input.sequence,
      atSecond: input.atSecond,
      sentAt: input.sentAt,
    }),
    payload: routeActorInteractionPayload({
      atSecond: input.atSecond,
      learnerUtterance: input.learnerUtterance,
      traceContextTags: [...(input.traceContextTags ?? [])],
    }, input.source) as RouteActorInteractionInput,
  };
}

export function createActorInteractionRoutedMessage(
  session: MultiActorClinicalSession,
  input: {
    messageId: string;
    sequence: number;
    atSecond: number;
    sentAt: string;
    routedActorId: string;
    routingReason: InteractionRoutingReason;
    traceContextTags?: string[];
  },
): ActorInteractionRoutedMessage {
  const actor = requireActor(session, input.routedActorId);
  return {
    ...baseWebSocketMessage("actor.interaction.routed", {
      direction: "server_to_client",
      messageId: input.messageId,
      stationRunId: session.stationRunId,
      sequence: input.sequence,
      atSecond: input.atSecond,
      sentAt: input.sentAt,
    }),
    routedActorId: actor.actorId,
    routingReason: input.routingReason,
    traceContextTags: [...(input.traceContextTags ?? [])],
    conversationTurn: actor.conversationTurn,
  };
}

export function createSessionStateClinicalEventMessage(
  record: DurableClinicalEventRecord,
  input: {
    messageId: string;
    sequence: number;
    sentAt: string;
  },
): ClinicalEventAppendedMessage {
  return {
    ...baseWebSocketMessage("clinical.event.appended", {
      direction: "server_to_client",
      messageId: input.messageId,
      stationRunId: record.stationRunId,
      sequence: input.sequence,
      atSecond: record.atSecond,
      sentAt: input.sentAt,
    }),
    event: projectDurableClinicalEventForReview(record),
  };
}

export function createSpatialActorTransformMessage(
  transform: ActorTransformState,
  input: {
    messageId: string;
    sequence: number;
    stationRunId: string;
    sentAt: string;
    direction: SessionStateWebSocketMessageDirection;
  },
): SpatialActorTransformMessage {
  return {
    ...baseWebSocketMessage("spatial.actor.transform", {
      direction: input.direction,
      messageId: input.messageId,
      stationRunId: input.stationRunId,
      sequence: input.sequence,
      atSecond: transform.lastUpdatedAtSecond,
      sentAt: input.sentAt,
    }),
    actorId: transform.actorId,
    transform: cloneActorTransform(transform),
  };
}

export function evaluateSessionStateWebSocketMessageDesign(): SessionStateWebSocketMessageDesignPosture {
  return {
    generatedAt: "2026-05-05",
    approvedProposal: "proposals/approved/proposal-multi-actor-runtime-promotion.md",
    transportPosture: "websocket_design_contract_only",
    runtimeImplemented: false,
    apiWiringIncluded: false,
    redisRedkaIncluded: false,
    databasePersistenceIncluded: false,
    messageFamilies: [
      "session.snapshot.request",
      "session.snapshot",
      "actor.interaction.route",
      "actor.interaction.routed",
      "clinical.event.appended",
      "spatial.actor.transform",
      "session.resync.required",
    ],
    guardrails: [
      "messages_are_serializable_domain_contracts_only",
      "server_authoritative_for_actor_routing_and_clinical_state",
      "clinical_event_messages_use_review_projection_redaction",
      "raw_audio_is_not_carried_in_session_state_messages",
      "api_runtime_wiring_requires_separate_slice",
    ],
    notEvidenceFor: sessionStateWebSocketEvidenceBoundary().notEvidenceFor,
  };
}

