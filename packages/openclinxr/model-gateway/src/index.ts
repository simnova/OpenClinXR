import { type ProviderHealth, validateProviderHealth } from "@cellix/provider-contracts";
import { cloneActorCommunicationProfile } from "./actor-prompt.js";
import { MockModelProviderAdapter } from "./mock-adapter.js";
import type {
  ActorCommunicationProfileContext,
  ActorResponseClinicalStateContext,
  CreateActorDialogueModelGatewayOptions,
  DialogueSeedActorResponseRequestOptions,
  DialogueSeedRequestFixture,
  DialogueSeedScenarioContext,
  LocalModelProviderOptions,
  ModelGatewayOptions,
  ModelProvenance,
} from "./model-gateway-internal.js";
import { OpenAiCompatibleModelProviderAdapter } from "./openai-compatible-adapter.js";

export type ModelCapability = "actor_response" | "scenario_draft" | "scenario_review";

export type ModelRequestPolicy = {
  requestPolicyId: string;
  promptTemplateId: string;
  safetyPolicyVersion: string;
};

export type ActorResponseRequest = {
  requestId?: string;
  stationRunId: string;
  scenarioId: string;
  scenarioVersion: number;
  actorId: string;
  actorDisplayName: string;
  actorRole: string;
  actorCommunicationProfile?: ActorCommunicationProfileContext;
  conversationTurn: number;
  learnerUtterance: string;
  visibleFacts: string[];
  hiddenFacts: string[];
  retrievedMemoryIds: string[];
  traceContextTags: string[];
  clinicalState: ActorResponseClinicalStateContext;
  policy: ModelRequestPolicy;
};

export type ActorResponseResult = {
  text: string;
  responseKind: "spoken_actor_response" | "blocked_fallback";
  traceTags: string[];
  provenance: ModelProvenance;
};

export interface ModelProviderAdapter {
  readonly id: string;
  readonly capabilities: ModelCapability[];
  health(): Promise<ProviderHealth>;
  generateActorResponse(input: ActorResponseRequest): Promise<ActorResponseResult>;
}

export class ModelGateway {
  constructor(private readonly options: ModelGatewayOptions) {}

  async health(): Promise<ProviderHealth[]> {
    return Promise.all(this.options.adapters.map((adapter) => adapter.health()));
  }

  async generateActorResponse(input: ActorResponseRequest): Promise<ActorResponseResult> {
    const readyAdapters = await this.readyAdapters("actor_response");

    if (readyAdapters.length === 0) {
      throw new Error(`No ready model provider for route ${this.options.routeId}`);
    }

    // Failover walks the ready list in priority order. The distinguishing rule is the
    // throw/result split: a THROW means the provider broke (429, network failure, malformed
    // reply) and the next adapter gets the turn; a RETURNED result — including a guardrail
    // refusal (`blocked_fallback`) — is the provider's answer and is used as-is. Refusals
    // are typed results and are never thrown, so a refusal can never be re-asked of a fresh
    // provider (#631).
    const failures: unknown[] = [];
    for (const adapter of readyAdapters) {
      try {
        return await adapter.generateActorResponse(input);
      } catch (error) {
        failures.push(error);
      }
    }

    // Every ready adapter threw. Surface the primary's failure, the operator's chosen
    // provider and the most informative error for the caller.
    throw failures[0];
  }

  private async readyAdapters(capability: ModelCapability): Promise<ModelProviderAdapter[]> {
    const ready: ModelProviderAdapter[] = [];
    for (const adapter of this.options.adapters) {
      const health = await adapter.health();
      if (validateProviderHealth(health).ok && health.status === "ready" && adapter.capabilities.includes(capability)) {
        ready.push(adapter);
      }
    }
    return ready;
  }
}

export function createDefaultModelGateway(options: ModelGatewayOptions): ModelGateway {
  return new ModelGateway(options);
}

const defaultOfflineActorDialoguePolicy: ModelRequestPolicy = {
  requestPolicyId: "actor-dialogue-offline-v1",
  promptTemplateId: "mock-actor-response-v1",
  safetyPolicyVersion: "clinical-simulation-safety-v1",
};

export function buildActorResponseRequestsForDialogueSeeds(
  scenario: DialogueSeedScenarioContext,
  seeds: readonly DialogueSeedRequestFixture[],
  options: DialogueSeedActorResponseRequestOptions = {},
): ActorResponseRequest[] {
  const stationRunId = options.stationRunId ?? `seed_${scenario.scenarioId}_dialogue_suite`;
  const actorById = new Map(scenario.actors.map((actor) => [actor.actorId, actor]));

  return seeds.map((seed, index) => {
    const actor = actorById.get(seed.actorId);

    if (!actor) {
      throw new Error(`Dialogue seed ${seed.seedId} references unknown actor ${seed.actorId}`);
    }

    return {
      requestId: `${stationRunId}:${seed.actorId}:${seed.seedId}`,
      stationRunId,
      scenarioId: scenario.scenarioId,
      scenarioVersion: scenario.version,
      actorId: seed.actorId,
      actorDisplayName: actor.displayName,
      actorRole: actor.role,
      ...(actor.communicationProfile ? { actorCommunicationProfile: cloneActorCommunicationProfile(actor.communicationProfile) } : {}),
      conversationTurn: index + 1,
      learnerUtterance: seed.learnerUtterance,
      visibleFacts: [...seed.visibleFacts],
      hiddenFacts: [...seed.hiddenFactCanaries],
      retrievedMemoryIds: [...(options.retrievedMemoryIds ?? [`scenario:${scenario.scenarioId}:v${scenario.version}`, `dialogue-seed:${seed.seedId}`])],
      traceContextTags: [...seed.expectedTraceTags],
      clinicalState: options.clinicalState ?? {
        completedTraceTags: [],
        openOrders: [],
      },
      policy: options.policy ?? defaultOfflineActorDialoguePolicy,
    };
  });
}

export class LocalModelProviderAdapter implements ModelProviderAdapter {
  readonly capabilities: ModelCapability[] = ["actor_response", "scenario_draft", "scenario_review"];

  constructor(private readonly options: LocalModelProviderOptions) {}

  get id(): string {
    return this.options.providerId;
  }

  async health(): Promise<ProviderHealth> {
    return {
      providerId: this.id,
      status: "not_configured",
      blockers: [...(this.options.blockers ?? ["local_model_runtime_not_configured"])],
    };
  }

  async generateActorResponse(): Promise<ActorResponseResult> {
    throw new Error(`Local model provider ${this.id} is not configured`);
  }
}

const DEFAULT_OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1";
const DEFAULT_OPENROUTER_MODEL = "stealth/ox-alpha";
/** Cheapest live actor rung (OpenRouter contributor terms: prompts/outputs may train Meta models — synthetic SP only). */
const DEFAULT_MUSE_MODEL = "meta/muse-spark-1.3-contributor";
const DEFAULT_LOCAL_LLAMA_MODEL = "qwen3-8b";
const DEFAULT_DEEPSEEK_BASE_URL = "https://api.deepseek.com";
const DEFAULT_DEEPSEEK_MODEL = "deepseek-v4-flash";

/**
 * Compose the actor-dialogue gateway the runtime uses by default: Muse Spark contributor
 * (OpenRouter) first when an OpenRouter key is configured — the cheapest rung, $0.10/$0.20
 * per 1M verified 2026-09-02 against the live OpenRouter /models — then DeepSeek Flash
 * (thinking disabled), ox (OpenRouter, retired but kept), local llama-server, mock last.
 * Priority is list order — the gateway walks the ready adapters in order and fails
 * over to the next when one throws, so a rate-limited primary falls through to the mock
 * instead of reaching the learner. Muse's live HTTP 403 (18+ attestation pending) THROWS
 * and falls through to DeepSeek rather than crashing the learner.
 *
 * Reachability is decided from CONFIG ONLY — no network call at import or health
 * time: the OpenRouter rungs are present when an API key is configured, the local rung when
 * a base URL is configured. With neither configured the offline pair (mock + a
 * `not_configured` local stub) answers from the mock, so a dev boot with no model
 * configured returns an utterance and never throws.
 */
export function createActorDialogueModelGateway(
  options: CreateActorDialogueModelGatewayOptions = {},
): ModelGateway {
  const adapters: ModelProviderAdapter[] = [];

  // Muse Spark contributor (OpenRouter) is the cheapest actor-dialogue rung — verified
  // 2026-09-02 via live GET https://openrouter.ai/api/v1/models: $0.10 / $0.20 per 1M tokens
  // (cache read $0.002/M, 1,048,576 ctx) vs DeepSeek V4 Flash DIRECT official off-peak
  // $0.22 / $0.66 (api-docs.deepseek.com/quick_start/pricing 2026-08-28; the marketing
  // $0.14/$0.28 is stale). OpenRouter's OWN deepseek flash is $0.079/$0.159 — cheaper still,
  // but the operator asked Muse vs Flash DIRECT; do not route actor dialogue through OpenRouter
  // DeepSeek. Contributor terms: prompts/outputs may train Meta models — synthetic SP lines
  // only; hidden facts never leave the host regardless. LIVE 2026-09-02: contributor AND
  // standard Muse both HTTP 403 until the operator confirms 18+ at
  // https://openrouter.ai/settings/preferences — the 403 THROWS, so the gateway fails over
  // to DeepSeek below instead of crashing the learner.
  const openRouterApiKey = options.openRouterApiKey ?? process.env["OPENROUTER_API_KEY"];
  if (openRouterApiKey && openRouterApiKey.trim().length > 0) {
    adapters.push(
      new OpenAiCompatibleModelProviderAdapter({
        providerId: "muse-spark-contributor",
        baseUrl: options.openRouterBaseUrl ?? DEFAULT_OPENROUTER_BASE_URL,
        model: options.museSparkModel ?? DEFAULT_MUSE_MODEL,
        apiKey: openRouterApiKey,
      }),
    );
  }

  const deepseekApiKey = options.deepseekApiKey ?? process.env["DEEPSEEK_API_KEY"];
  if (deepseekApiKey && deepseekApiKey.trim().length > 0) {
    adapters.push(
      new OpenAiCompatibleModelProviderAdapter({
        providerId: "deepseek-actor-dialogue",
        baseUrl: options.deepseekBaseUrl ?? DEFAULT_DEEPSEEK_BASE_URL,
        model: options.deepseekModel ?? DEFAULT_DEEPSEEK_MODEL,
        apiKey: deepseekApiKey,
      }),
    );
  }

  if (openRouterApiKey && openRouterApiKey.trim().length > 0) {
    adapters.push(
      new OpenAiCompatibleModelProviderAdapter({
        providerId: "ox-alpha",
        baseUrl: options.openRouterBaseUrl ?? DEFAULT_OPENROUTER_BASE_URL,
        model: options.openRouterModel ?? DEFAULT_OPENROUTER_MODEL,
        apiKey: openRouterApiKey,
      }),
    );
  }

  const localBaseUrl = options.localBaseUrl ?? process.env["OPENCLINXR_LOCAL_LLAMA_BASE_URL"];
  if (localBaseUrl && localBaseUrl.trim().length > 0) {
    adapters.push(
      new OpenAiCompatibleModelProviderAdapter({
        providerId: "local-llama",
        baseUrl: localBaseUrl,
        model: options.localModel ?? DEFAULT_LOCAL_LLAMA_MODEL,
      }),
    );
  }

  adapters.push(new MockModelProviderAdapter());
  adapters.push(new LocalModelProviderAdapter({ providerId: "local-model" }));

  return createDefaultModelGateway({
    routeId: options.routeId ?? "actor-dialogue-runtime-v1",
    adapters,
  });
}

export { MockModelProviderAdapter } from "./mock-adapter.js";
