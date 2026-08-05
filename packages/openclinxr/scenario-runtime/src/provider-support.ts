import type { ModelRequestPolicy } from "@openclinxr/model-gateway";
import { type ProviderHealth, validateProviderHealth } from "@openclinxr/shared-schemas";
import type { VoiceRequestPolicy } from "@openclinxr/voice-gateway";
import type {
  DurableStorePersistenceHooks,
  RouteRuntimeActorInteractionInput,
  RouteRuntimeActorInteractionResult,
  ScenarioRuntimeDurableStore,
} from "./runtime-types.js";

/**
 * Provider/request support helpers for the scenario runtime: deterministic request IDs,
 * request policies, provider-health validation, routed-interaction trace payloads, and
 * durable-store forwarding. Pure — no runtime state.
 */

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
  const validation = validateProviderHealth(provider);
  if (!validation.ok) {
    throw new Error(`Invalid provider health for ${providerId}: ${validation.errors.join("; ")}`);
  }
  return provider;
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
