import type { ModelRequestPolicy } from "@openclinxr/model-gateway";
import { type ProviderHealth, validateProviderHealth } from "@openclinxr/shared-schemas";
import type { VoiceRequestPolicy } from "@openclinxr/voice-gateway";
import type {
  DurableStorePersistenceHooks,
  ProviderHealthSnapshot,
  RouteRuntimeActorInteractionInput,
  RouteRuntimeActorInteractionResult,
  ScenarioRuntimeDurableStore,
} from "./runtime-types.js";

/**
 * Provider/request support helpers for the scenario runtime: deterministic request IDs,
 * request policies, provider-health validation, routed-interaction trace payloads, and
 * durable-store forwarding. Pure — no runtime state.
 */

/** Historical convenience-key → adapter id mapping kept for UI/API consumers. */
const LEGACY_PROVIDER_KEYS = {
  model: "mock-model",
  voice: "mock-voice",
  localModel: "local-model",
  localVoice: "local-voice",
} as const;

export function settleDurableStoreCall(result: void | Promise<void> | undefined): void {
  if (result != null && typeof (result as Promise<void>).then === "function") {
    void (result as Promise<void>).catch(() => {
      // Durable sink failures must not break in-memory runtime paths.
    });
  }
}

export function modelActorResponseRequestId(stationRunId: string, actorId: string, conversationTurn: number): string {
  return `model:${stationRunId}:${actorId}:turn-${conversationTurn}`;
}

export function voiceSynthesisRequestId(stationRunId: string, actorId: string, voiceId: string): string {
  return `voice:${stationRunId}:${actorId}:${voiceId}:synthesis`;
}

export const actorResponsePolicy: ModelRequestPolicy = {
  requestPolicyId: "actor-dialogue-offline-v1",
  promptTemplateId: "mock-actor-response-v1",
  safetyPolicyVersion: "clinical-simulation-safety-v1",
};

export const voiceSynthesisPolicy: VoiceRequestPolicy = {
  requestPolicyId: "voice-offline-v1",
  safetyPolicyVersion: "clinical-simulation-safety-v1",
};

export function requireProviderHealth(health: ProviderHealth[], providerId: string): ProviderHealth {
  const provider = health.find((entry) => entry.providerId === providerId);
  if (!provider) {
    throw new Error(`Missing provider health for ${providerId}`);
  }
  return requireValidProviderHealth(provider);
}

/** Validate a single health entry; throw with provider id context on failure. */
export function requireValidProviderHealth(provider: ProviderHealth): ProviderHealth {
  const validation = validateProviderHealth(provider);
  if (!validation.ok) {
    throw new Error(`Invalid provider health for ${provider.providerId}: ${validation.errors.join("; ")}`);
  }
  return provider;
}

/**
 * Build a snapshot that describes the adapters actually wired on the gateways.
 * Legacy four keys are filled only when those adapter ids are present; `adapters`
 * always lists every validated entry (model gateway first, then voice).
 */
export function buildProviderHealthSnapshot(
  modelHealth: ProviderHealth[],
  voiceHealth: ProviderHealth[],
): ProviderHealthSnapshot {
  const modelAdapters = modelHealth.map((entry) => requireValidProviderHealth(entry));
  const voiceAdapters = voiceHealth.map((entry) => requireValidProviderHealth(entry));
  const adapters = [...modelAdapters, ...voiceAdapters];

  const snapshot: ProviderHealthSnapshot = { adapters };

  const model = modelAdapters.find((entry) => entry.providerId === LEGACY_PROVIDER_KEYS.model);
  const voice = voiceAdapters.find((entry) => entry.providerId === LEGACY_PROVIDER_KEYS.voice);
  const localModel = modelAdapters.find((entry) => entry.providerId === LEGACY_PROVIDER_KEYS.localModel);
  const localVoice = voiceAdapters.find((entry) => entry.providerId === LEGACY_PROVIDER_KEYS.localVoice);

  if (model) {
    snapshot.model = model;
  }
  if (voice) {
    snapshot.voice = voice;
  }
  if (localModel) {
    snapshot.localModel = localModel;
  }
  if (localVoice) {
    snapshot.localVoice = localVoice;
  }

  return snapshot;
}

export function actorInteractionRoutePayload(
  input: RouteRuntimeActorInteractionInput,
  routingReason: RouteRuntimeActorInteractionResult["routingReason"],
): Record<string, unknown> {
  const traceContextTags = [...(input.traceContextTags ?? [])];
  const base = {
    learnerUtterance: input.learnerUtterance,
    routingReason,
    traceContextTags,
  };

  if (input.source?.kind === "voice_transcript") {
    return {
      ...base,
      sourceKind: "voice_transcript",
      streamId: input.source.streamId,
      transcriptSegmentId: input.source.transcriptSegmentId,
      provider: input.source.provider,
      provenanceRefs: [...input.source.provenanceRefs],
      rawAudioStored: false,
    };
  }

  return {
    ...base,
    sourceKind: "text",
    provenanceRefs: [...(input.source?.provenanceRefs ?? [])],
  };
}

/**
 * Forward persistence hooks into a ScenarioRuntimeDurableStore.
 * Optional methods stay undefined when the host omits them.
 */
export function createDurableStoreFromPersistenceHooks(
  hooks: DurableStorePersistenceHooks,
): ScenarioRuntimeDurableStore {
  const store: ScenarioRuntimeDurableStore = {};
  if (hooks.saveReviewPacket) {
    store.saveReviewPacket = (stationRunId, packet) => hooks.saveReviewPacket?.(stationRunId, packet);
  }
  if (hooks.saveActorTurn) {
    store.saveActorTurn = (stationRunId, turn) => hooks.saveActorTurn?.(stationRunId, turn);
  }
  return store;
}
