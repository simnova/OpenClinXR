import { createScenarioPlaceholderManifests, InMemoryAssetRegistry } from "@openclinxr/asset-registry";
import { createDefaultConversationPolicy } from "@openclinxr/conversation-policy";
import {
  createDefaultModelGateway,
  LocalModelProviderAdapter,
  MockModelProviderAdapter,
} from "@openclinxr/model-gateway";
import { edChestPainScenario } from "@openclinxr/scenario-fixtures";
import { InMemoryTraceLedger } from "@cellix/trace-ledger";
import {
  createDefaultVoiceGateway,
  LocalVoiceProviderAdapter,
  MockVoiceProviderAdapter,
} from "@openclinxr/voice-gateway";
import { createDurableStoreFromPersistenceHooks } from "./provider-support.js";
import { ScenarioRuntime } from "./scenario-runtime.js";
import type {
  CreateDefaultScenarioRuntimeOptions,
  DurableStorePersistenceHooks,
} from "./runtime-types.js";

/**
 * Create a default ScenarioRuntime with in-memory providers.
 *
 * When `options?.scenario` is set it overrides the default ED chest pain fixture.
 * Asset placeholder manifests are built for whichever scenario is selected.
 */
export function createDefaultScenarioRuntime(
  options?: CreateDefaultScenarioRuntimeOptions,
): ScenarioRuntime {
  const scenario = options?.scenario ?? edChestPainScenario;
  const assetRegistry = new InMemoryAssetRegistry();
  for (const manifest of createScenarioPlaceholderManifests(scenario)) {
    assetRegistry.upsert(manifest);
  }

  return new ScenarioRuntime({
    scenario,
    ledger: new InMemoryTraceLedger(),
    assetRegistry,
    modelGateway: createDefaultModelGateway({
      routeId: "actor-dialogue-offline-v1",
      adapters: [new MockModelProviderAdapter(), new LocalModelProviderAdapter({ providerId: "local-model" })],
    }),
    voiceGateway: createDefaultVoiceGateway({
      routeId: "voice-offline-v1",
      adapters: [new MockVoiceProviderAdapter(), new LocalVoiceProviderAdapter({ providerId: "local-voice" })],
    }),
    conversationPolicy: options?.conversationPolicy ?? createDefaultConversationPolicy(),
    ...(options?.durableStore ? { durableStore: options.durableStore } : {}),
  });
}

/**
 * Convenience: createDefaultScenarioRuntime with ApiPersistenceSink-shaped hooks
 * forwarded via createDurableStoreFromPersistenceHooks.
 * apps/api bootstrap residual is a one-liner over this (or createDefaultScenarioRuntime + hooks).
 */
export function createScenarioRuntimeWithPersistenceHooks(
  hooks: DurableStorePersistenceHooks,
): ScenarioRuntime {
  return createDefaultScenarioRuntime({
    durableStore: createDurableStoreFromPersistenceHooks(hooks),
  });
}
