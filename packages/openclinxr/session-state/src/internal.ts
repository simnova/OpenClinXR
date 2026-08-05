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
} from "./durable-records.js";
export * from "./durable-records.js";

export function projectDurableClinicalEventForReview(
  record: DurableClinicalEventRecord,
): DurableClinicalEventReviewProjection {
  assertValidDurableClinicalEventRecord(record);
  return {
    clinicalEventId: record.clinicalEventId,
    stationRunId: record.stationRunId,
    atSecond: record.atSecond,
    eventKind: record.eventKind,
    label: record.label,
    payload: redactReviewPayload(record.payload.public),
    provenanceRefs: [...record.provenanceRefs],
    privatePayloadRedacted: Boolean(record.payload.private) || reviewPayloadRequiresRedaction(record.payload.public),
    durableStore: record.durableStore,
    ...(record.actorId ? { actorId: record.actorId } : {}),
    ...(record.traceTag ? { traceTag: record.traceTag } : {}),
    ...(record.status ? { status: record.status } : {}),
  };
}

export const durableClinicalEventKindList: DurableClinicalEventKind[] = [
  "clinical_action_recorded",
  "order_status_changed",
  "finding_recorded",
  "checklist_item_updated",
  "rubric_progress_updated",
  "case_status_changed",
];

export function summarizeDurableClinicalEventReviewProjections(
  projections: readonly DurableClinicalEventReviewProjection[],
): DurableClinicalEventReviewProjectionSummary {
  const stationRunIds = uniqueProjectionValues(projections.map((projection) => projection.stationRunId));
  const durableStores = uniqueProjectionValues(projections.map((projection) => projection.durableStore));
  const stationRunId = stationRunIds.length === 1 ? (stationRunIds[0] ?? null) : null;
  const durableStore = durableStores.length === 0 ? null : durableStores.length === 1 ? (durableStores[0] ?? null) : "mixed";

  return {
    stationRunId,
    eventCount: projections.length,
    redactedEventCount: projections.filter((projection) => projection.privatePayloadRedacted).length,
    clinicalEventKinds: countClinicalEventKinds(projections),
    traceTags: uniqueProjectionValues(projections.map((projection) => projection.traceTag).filter((tag): tag is string => Boolean(tag))),
    statusCounts: countProjectionStatuses(projections),
    latestAtSecond: projections.length === 0 ? null : Math.max(...projections.map((projection) => projection.atSecond)),
    durableStore,
    safeForFacultyReview: projections.every((projection) =>
      projection.durableStore === "database_source_of_truth"
      && projectionPayloadIsReviewSafe(projection)
    ),
  };
}

export class InMemoryDurableMultiActorSessionStore implements DurableMultiActorSessionStore {
  private readonly conversationTurns = new Map<string, DurableConversationTurnRecord[]>();
  private readonly emotionalStateTimeline = new Map<string, DurableEmotionalStateTimelineRecord[]>();
  private readonly clinicalEvents = new Map<string, DurableClinicalEventRecord[]>();

  saveConversationTurn(record: DurableConversationTurnRecord): void {
    assertValidDurableConversationTurnRecord(record);
    const existing = this.conversationTurns.get(record.stationRunId) ?? [];
    this.conversationTurns.set(record.stationRunId, [...existing, cloneConversationTurn(record)]);
  }

  listConversationTurns(stationRunId: string): DurableConversationTurnRecord[] {
    return [...(this.conversationTurns.get(stationRunId) ?? [])]
      .sort((left, right) => left.atSecond - right.atSecond || left.turnId.localeCompare(right.turnId))
      .map(cloneConversationTurn);
  }

  saveEmotionalStateTimeline(record: DurableEmotionalStateTimelineRecord): void {
    assertValidDurableEmotionalStateTimelineRecord(record);
    const key = emotionalStateTimelineKey(record.stationRunId, record.actorId);
    const existing = this.emotionalStateTimeline.get(key) ?? [];
    this.emotionalStateTimeline.set(key, [...existing, cloneEmotionalStateRecord(record)]);
  }

  listEmotionalStateTimeline(stationRunId: string, actorId: string): DurableEmotionalStateTimelineRecord[] {
    return [...(this.emotionalStateTimeline.get(emotionalStateTimelineKey(stationRunId, actorId)) ?? [])]
      .sort((left, right) => left.atSecond - right.atSecond || left.sourceTurnId.localeCompare(right.sourceTurnId))
      .map(cloneEmotionalStateRecord);
  }

  saveClinicalEvent(record: DurableClinicalEventRecord): void {
    assertValidDurableClinicalEventRecord(record);
    const existing = this.clinicalEvents.get(record.stationRunId) ?? [];
    if (existing.some((event) => event.clinicalEventId === record.clinicalEventId)) {
      return;
    }
    this.clinicalEvents.set(record.stationRunId, [...existing, cloneClinicalEventRecord(record)]);
  }

  listClinicalEvents(stationRunId: string): DurableClinicalEventRecord[] {
    return [...(this.clinicalEvents.get(stationRunId) ?? [])]
      .sort((left, right) => left.atSecond - right.atSecond || left.clinicalEventId.localeCompare(right.clinicalEventId))
      .map(cloneClinicalEventRecord);
  }

  listClinicalEventReviewProjections(stationRunId: string): DurableClinicalEventReviewProjection[] {
    return this.listClinicalEvents(stationRunId).map(projectDurableClinicalEventForReview);
  }
}

export function countClinicalEventKinds(
  projections: readonly DurableClinicalEventReviewProjection[],
): Record<DurableClinicalEventKind, number> {
  const counts = Object.fromEntries(durableClinicalEventKindList.map((kind) => [kind, 0])) as Record<DurableClinicalEventKind, number>;
  for (const projection of projections) {
    counts[projection.eventKind] += 1;
  }
  return counts;
}

export function countProjectionStatuses(projections: readonly DurableClinicalEventReviewProjection[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const projection of projections) {
    if (!projection.status) {
      continue;
    }
    counts[projection.status] = (counts[projection.status] ?? 0) + 1;
  }
  return counts;
}

export function projectionPayloadIsReviewSafe(projection: DurableClinicalEventReviewProjection): boolean {
  const payloadJson = JSON.stringify(projection.payload);
  return !payloadJson.includes("hiddenFactRefs")
    && !payloadJson.includes("serverOnlyNotes")
    && !payloadJson.includes("hiddenClinicalTruth");
}

export function uniqueProjectionValues<T extends string>(values: readonly T[]): T[] {
  return [...new Set(values)];
}

export class InMemoryRealtimeSessionCache implements RealtimeSessionCache {
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

export function buildRealtimeCacheSnapshot(input: {
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

export function createActorRuntimeState(actor: ActorCard): ActorRuntimeState {
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

export function initialActorTransform(actorId: string, index: number): ActorTransformState {
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

export function decideActorRoute(
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

export function withOptionalSource(
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

export function requireActor(session: MultiActorClinicalSession, actorId: string): ActorRuntimeState {
  const actor = session.actors.find((candidate) => candidate.actorId === actorId);
  if (!actor) {
    throw new Error(`Actor not found: ${actorId}`);
  }
  return actor;
}

export function requireActorTransform(
  session: MultiActorClinicalSession,
  actorId: string,
): ActorTransformState {
  const transform = session.spatialState.actorTransforms[actorId];
  if (!transform) {
    throw new Error(`Actor transform not found: ${actorId}`);
  }
  return transform;
}

export function roleKeywords(role: ActorCard["role"]): string[] {
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

export function relationshipForRole(role: ActorCard["role"]): string {
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

export function emotionalStateFromDemeanor(demeanor: string): string {
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

export function unique(values: string[]): string[] {
  return [...new Set(values)];
}

export function emotionalStateTimelineKey(stationRunId: string, actorId: string): string {
  return `${stationRunId}:${actorId}`;
}

export function baseWebSocketMessage<
  TType extends SessionStateWebSocketMessageType,
  TDirection extends SessionStateWebSocketMessageDirection,
>(
  type: TType,
  input: {
    direction: TDirection;
    messageId: string;
    stationRunId: string;
    sequence: number;
    atSecond: number;
    sentAt: string;
  },
): SessionStateWebSocketMessageBase<TType> & { direction: TDirection } {
  return {
    type,
    schemaVersion: 1,
    transport: "websocket_design_contract",
    direction: input.direction,
    messageId: input.messageId,
    stationRunId: input.stationRunId,
    sequence: input.sequence,
    atSecond: input.atSecond,
    sentAt: input.sentAt,
  };
}

export function routeActorInteractionPayload(
  input: Omit<RouteActorInteractionInput, "source">,
  source: RouteActorInteractionSourceInput | undefined,
): RouteActorInteractionInput {
  if (!source) {
    return input;
  }

  if (source.kind === "voice_transcript") {
    return {
      ...input,
      source: {
        ...source,
        provenanceRefs: [...source.provenanceRefs],
        rawAudioStored: false,
      },
    };
  }

  return {
    ...input,
    source: {
      ...source,
      provenanceRefs: [...(source.provenanceRefs ?? [])],
    },
  };
}
