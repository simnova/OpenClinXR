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

export class InMemoryDurableMultiActorSessionStore implements DurableMultiActorSessionStore {
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
    Object.entries(transforms).map(([actorId, transform]) => [
      actorId,
      {
        ...transform,
        position: { ...transform.position },
      },
    ]),
  );
}

