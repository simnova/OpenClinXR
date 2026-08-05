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


export function cloneSpatialState(
  spatialState: MultiActorClinicalSession["spatialState"],
): MultiActorClinicalSession["spatialState"] {
  return {
    actorTransforms: cloneActorTransforms(spatialState.actorTransforms),
    objectTransforms: cloneActorTransforms(spatialState.objectTransforms),
  };
}

export function cloneActorTransform(transform: ActorTransformState): ActorTransformState {
  assertFiniteActorTransform(transform);
  return {
    ...transform,
    position: { ...transform.position },
  };
}

export function cloneConversationTurn(record: DurableConversationTurnRecord): DurableConversationTurnRecord {
  return {
    ...record,
    traceContextTags: [...record.traceContextTags],
    provenanceRefs: [...record.provenanceRefs],
  };
}

export function cloneEmotionalStateRecord(
  record: DurableEmotionalStateTimelineRecord,
): DurableEmotionalStateTimelineRecord {
  return { ...record };
}

export function cloneClinicalEventRecord(record: DurableClinicalEventRecord): DurableClinicalEventRecord {
  return {
    ...record,
    payload: {
      public: cloneJsonRecord(record.payload.public),
      ...(record.payload.private
        ? {
          private: cloneClinicalEventPrivatePayload(record.payload.private),
        }
        : {}),
    },
    provenanceRefs: [...record.provenanceRefs],
  };
}

export function assertDurableClinicalEventStorePosture(record: DurableClinicalEventRecord): void {
  if (record.durableStore !== "database_source_of_truth") {
    throw new Error("durable clinical-event records must use durableStore database_source_of_truth");
  }
}

export function assertDurableActorTurnStorePosture(record: DurableConversationTurnRecord | DurableEmotionalStateTimelineRecord): void {
  if (record.durableStore !== "database_source_of_truth") {
    throw new Error("durable actor-turn records must use durableStore database_source_of_truth");
  }
}

export const interactionTurnSourceKinds = new Set<InteractionTurnSource["kind"]>(["text", "voice_transcript"]);
export const interactionRoutingReasons = new Set<InteractionRoutingReason>([
  "addressed_actor_name",
  "addressed_role_keyword",
  "single_patient_default",
  "fallback_first_actor",
]);

export function assertValidDurableConversationTurnRecord(record: DurableConversationTurnRecord): void {
  assertDurableActorTurnStorePosture(record);
  assertNonblankDurableActorTurnField(record.turnId, "turnId");
  assertNonblankDurableActorTurnField(record.stationRunId, "stationRunId");
  assertNonblankDurableActorTurnField(record.actorId, "actorId");
  assertNonblankDurableActorTurnField(record.text, "text");
  assertNonblankDurableActorTurnField(record.emotionalState, "emotionalState");
  assertNonblankDurableActorTurnArray(record.traceContextTags, "traceContextTags");
  assertNonblankDurableActorTurnArray(record.provenanceRefs, "provenanceRefs");
  if (!interactionTurnSourceKinds.has(record.sourceKind)) {
    throw new Error("durable actor-turn records require a known sourceKind");
  }
  if (!interactionRoutingReasons.has(record.routingReason)) {
    throw new Error("durable actor-turn records require a known routingReason");
  }
  if (record.rawAudioStored !== false) {
    throw new Error("durable actor-turn records must not persist raw audio");
  }
  if (!Number.isFinite(record.atSecond) || record.atSecond < 0) {
    throw new Error("durable actor-turn records require a nonnegative finite atSecond");
  }
}

export function assertValidDurableEmotionalStateTimelineRecord(record: DurableEmotionalStateTimelineRecord): void {
  assertDurableActorTurnStorePosture(record);
  assertNonblankDurableActorTurnField(record.stationRunId, "stationRunId");
  assertNonblankDurableActorTurnField(record.actorId, "actorId");
  assertNonblankDurableActorTurnField(record.sourceTurnId, "sourceTurnId");
  assertNonblankDurableActorTurnField(record.emotionalState, "emotionalState");
  if (!Number.isFinite(record.atSecond) || record.atSecond < 0) {
    throw new Error("durable actor-turn records require a nonnegative finite atSecond");
  }
}

export function assertNonblankDurableActorTurnField(value: string, fieldName: string): void {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`durable actor-turn records require nonblank ${fieldName}`);
  }
}

export function assertNonblankDurableActorTurnArray(values: readonly string[], fieldName: string): void {
  if (!Array.isArray(values) || values.some((value) => typeof value !== "string" || value.trim().length === 0)) {
    throw new Error(`durable actor-turn records require nonblank ${fieldName}`);
  }
}

export const durableClinicalEventKinds = new Set<DurableClinicalEventKind>([
  "clinical_action_recorded",
  "order_status_changed",
  "finding_recorded",
  "checklist_item_updated",
  "rubric_progress_updated",
  "case_status_changed",
]);

export function assertValidDurableClinicalEventRecord(record: DurableClinicalEventRecord): void {
  assertDurableClinicalEventStorePosture(record);
  assertNonblankDurableClinicalEventField(record.clinicalEventId, "clinicalEventId");
  assertNonblankDurableClinicalEventField(record.stationRunId, "stationRunId");
  assertNonblankDurableClinicalEventField(record.label, "label");
  assertNonblankDurableActorTurnArray(record.provenanceRefs, "provenanceRefs");
  assertDurableClinicalEventProvenanceRefsMatchStationRun(record);
  if (record.actorId !== undefined) {
    assertNonblankDurableClinicalEventField(record.actorId, "actorId");
  }
  if (record.traceTag !== undefined) {
    assertNonblankDurableClinicalEventField(record.traceTag, "traceTag");
  }
  if (record.status !== undefined) {
    assertNonblankDurableClinicalEventField(record.status, "status");
  }
  if (!durableClinicalEventKinds.has(record.eventKind)) {
    throw new Error("durable clinical-event records require a known eventKind");
  }
  if (!Number.isFinite(record.atSecond) || record.atSecond < 0) {
    throw new Error("durable clinical-event records require a nonnegative finite atSecond");
  }
}

export function assertNonblankDurableClinicalEventField(value: string, fieldName: string): void {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`durable clinical-event records require nonblank ${fieldName}`);
  }
}

export function assertDurableClinicalEventProvenanceRefsMatchStationRun(record: DurableClinicalEventRecord): void {
  const malformedTraceRef = record.provenanceRefs.find((ref) => {
    if (!ref.startsWith("trace:")) {
      return false;
    }
    const [, stationRunId, sequenceOrTimestamp] = ref.split(":");
    return !stationRunId || stationRunId.trim().length === 0 || !sequenceOrTimestamp || sequenceOrTimestamp.trim().length === 0;
  });
  if (malformedTraceRef) {
    throw new Error(`durable clinical-event provenanceRefs trace ref ${malformedTraceRef} must include stationRunId and sequence`);
  }
  const mismatchedTraceRef = record.provenanceRefs.find((ref) => {
    const [scheme, stationRunId] = ref.split(":");
    return scheme === "trace" && stationRunId !== record.stationRunId;
  });
  if (mismatchedTraceRef) {
    throw new Error(
      `durable clinical-event provenanceRefs trace ref ${mismatchedTraceRef} must match stationRunId ${record.stationRunId}`,
    );
  }
}

export function cloneClinicalEventPrivatePayload(
  payload: NonNullable<DurableClinicalEventRecord["payload"]["private"]>,
): NonNullable<DurableClinicalEventRecord["payload"]["private"]> {
  return {
    ...(cloneJsonRecord(payload) as NonNullable<DurableClinicalEventRecord["payload"]["private"]>),
    hiddenFactRefs: [...(payload.hiddenFactRefs ?? [])],
    serverOnlyNotes: [...(payload.serverOnlyNotes ?? [])],
  };
}

export function cloneJsonRecord(record: Record<string, unknown>): Record<string, unknown> {
  return JSON.parse(JSON.stringify(record)) as Record<string, unknown>;
}

export function redactReviewPayload(record: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(record)
      .filter(([key]) => !isPrivateReviewPayloadKey(key))
      .map(([key, value]) => [key, redactReviewPayloadValue(value)])
      .filter((entry): entry is [string, unknown] => entry[1] !== undefined),
  );
}

export function redactReviewPayloadValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value
      .map(redactReviewPayloadValue)
      .filter((item) => item !== undefined);
  }
  if (typeof value === "object" && value !== null) {
    return redactReviewPayload(value as Record<string, unknown>);
  }
  return value;
}

export function reviewPayloadRequiresRedaction(record: Record<string, unknown>): boolean {
  return Object.entries(record).some(([key, value]) =>
    isPrivateReviewPayloadKey(key)
    || (Array.isArray(value)
      ? value.some((item) => typeof item === "object" && item !== null && reviewPayloadRequiresRedaction(item as Record<string, unknown>))
      : typeof value === "object" && value !== null && reviewPayloadRequiresRedaction(value as Record<string, unknown>))
  );
}

export function isPrivateReviewPayloadKey(key: string): boolean {
  return /(?:hidden|private|serverOnly|server_only|internal|secret|confidential)/i.test(key);
}

export function cloneRealtimeSessionCacheSnapshot(snapshot: RealtimeSessionCacheSnapshot): RealtimeSessionCacheSnapshot {
  return {
    ...snapshot,
    recentTurns: snapshot.recentTurns.map((turn) => ({ ...turn })),
    actorTransforms: cloneActorTransforms(snapshot.actorTransforms),
  };
}

export function cloneActorTransforms(
  transforms: Record<string, ActorTransformState>,
): Record<string, ActorTransformState> {
  return Object.fromEntries(
    Object.entries(transforms).map(([actorId, transform]) => {
      assertFiniteActorTransform(transform);
      return [
        actorId,
        {
          ...transform,
          position: { ...transform.position },
        },
      ];
    }),
  );
}

export function assertFiniteActorTransform(transform: ActorTransformState): void {
  const values = [
    transform.position.x,
    transform.position.y,
    transform.position.z,
    transform.rotationYRadians,
    transform.lastUpdatedAtSecond,
  ];
  if (values.some((value) => !Number.isFinite(value))) {
    throw new Error(`Spatial transform contains non-finite numeric values for actor ${transform.actorId}`);
  }
}

export function sessionStateWebSocketEvidenceBoundary(): SessionStateWebSocketEvidenceBoundary {
  return {
    runtimeSyncImplemented: false,
    readyForProductionAdoption: false,
    notEvidenceFor: [
      "apps_api_websocket_route",
      "production_realtime_state_sync",
      "redis_redka_adapter",
      "quest_network_performance",
      "clinical_assessment_validity",
    ],
  };
}

export function cloneClinicalState(
  clinicalState: MultiActorClinicalSession["clinicalState"],
): MultiActorClinicalSession["clinicalState"] {
  return {
    requiredTraceTags: [...clinicalState.requiredTraceTags],
    completedTraceTags: [...clinicalState.completedTraceTags],
    orders: clinicalState.orders.map((order) => ({ ...order })),
    findings: clinicalState.findings.map((finding) => ({ ...finding })),
  };
}


