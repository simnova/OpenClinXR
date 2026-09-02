import { type ProviderAuditRecord, type ProviderHealth, validateProviderHealth } from "@cellix/provider-contracts";
import { MockModelProviderAdapter } from "./mock-adapter.js";
import { OpenAiCompatibleModelProviderAdapter } from "./openai-compatible-adapter.js";

export type ModelCapability = "actor_response" | "scenario_draft" | "scenario_review";

export type ModelRequestPolicy = {
  requestPolicyId: string;
  promptTemplateId: string;
  safetyPolicyVersion: string;
};

export type ActorResponseClinicalOrderContext = {
  orderId: string;
  traceTag: string;
  label: string;
  actorId: string;
  atSecond: number;
  status: "requested" | "completed" | "cancelled";
};

export type ActorResponseClinicalStateContext = {
  completedTraceTags: string[];
  openOrders: ActorResponseClinicalOrderContext[];
};

export type DialogueSeedRequestFixture = {
  seedId: string;
  actorId: string;
  learnerUtterance: string;
  visibleFacts: readonly string[];
  hiddenFactCanaries: readonly string[];
  expectedTraceTags: readonly string[];
};

export type DialogueSeedScenarioContext = {
  scenarioId: string;
  version: number;
  actors: ReadonlyArray<{
    actorId: string;
    displayName: string;
    role: string;
    communicationProfile?: ActorCommunicationProfileContext;
  }>;
};

export type ActorCommunicationProfileContext = {
  styleFamily: string;
  style: string;
  intensity: number;
  baselineMood: readonly string[];
  communicativeness: string;
  topicsToAvoid: readonly string[];
  adverseResponse: string;
  deescalationTriggers: readonly string[];
  escalationTriggers: readonly string[];
  culturalLanguageNotes: readonly string[];
};

export type DialogueSeedActorResponseRequestOptions = {
  stationRunId?: string;
  policy?: ModelRequestPolicy;
  retrievedMemoryIds?: readonly string[];
  clinicalState?: ActorResponseClinicalStateContext;
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

export type ActorCommunicationPromptContext = {
  actorId: string;
  style: string;
  context: string;
};

export type ActorResponseProviderPromptInput = {
  requestId?: string;
  stationRunId: string;
  scenarioId: string;
  scenarioVersion: number;
  actorId: string;
  actorDisplayName: string;
  actorRole: string;
  conversationTurn: number;
  learnerUtterance: string;
  visibleFacts: string[];
  retrievedMemoryIds: string[];
  traceContextTags: string[];
  clinicalState: ActorResponseClinicalStateContext;
  communicationContext?: ActorCommunicationPromptContext;
  policy: ModelRequestPolicy;
};

export type TokenUsage = {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
};

export type GuardrailResult = {
  status: "pass" | "blocked";
  reason: string;
};

export type ModelProvenance = ProviderAuditRecord & {
  requestPolicyId: string;
  promptTemplateId: string;
  scenarioId: string;
  scenarioVersion: number;
  actorId?: string;
  actorCardVersion?: string;
  retrievedMemoryIds: string[];
  safetyPolicyVersion: string;
  latencyMs: number;
  tokenUsage: TokenUsage;
  costEstimateUsd: number;
  safetyStatus: GuardrailResult["status"];
  guardrail: GuardrailResult;
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

export type ModelGatewayOptions = {
  adapters: ModelProviderAdapter[];
  routeId: string;
};

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

export const defaultOfflineActorDialoguePolicy: ModelRequestPolicy = {
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

export function buildActorCommunicationProfilePromptContext(
  input: Pick<ActorResponseRequest, "actorId" | "actorDisplayName" | "actorRole" | "actorCommunicationProfile">,
): ActorCommunicationPromptContext | undefined {
  const profile = input.actorCommunicationProfile;
  if (!profile) {
    return undefined;
  }

  const context = [
    `${input.actorDisplayName} is a simulated ${input.actorRole} actor.`,
    `Communication style: ${profile.styleFamily}/${profile.style} at intensity ${profile.intensity.toFixed(2)}.`,
    `Baseline mood: ${profile.baselineMood.join(", ")}.`,
    `Communicativeness: ${profile.communicativeness}`,
    `Avoid: ${profile.topicsToAvoid.join(", ")}.`,
    `Adverse response: ${profile.adverseResponse}`,
    `De-escalates when: ${profile.deescalationTriggers.join(", ")}.`,
    `Escalates when: ${profile.escalationTriggers.join(", ")}.`,
    `Cultural/language notes: ${profile.culturalLanguageNotes.join(", ")}.`,
    "Do not reveal hidden facts unless the learner has appropriately elicited them through visible scenario context.",
  ].join(" ");

  return {
    actorId: input.actorId,
    style: profile.style,
    context,
  };
}

export function buildActorResponseProviderPromptInput(input: ActorResponseRequest): ActorResponseProviderPromptInput {
  const communicationContext = buildActorCommunicationProfilePromptContext(input);
  return {
    ...(input.requestId ? { requestId: input.requestId } : {}),
    stationRunId: input.stationRunId,
    scenarioId: input.scenarioId,
    scenarioVersion: input.scenarioVersion,
    actorId: input.actorId,
    actorDisplayName: input.actorDisplayName,
    actorRole: input.actorRole,
    conversationTurn: input.conversationTurn,
    learnerUtterance: input.learnerUtterance,
    visibleFacts: [...input.visibleFacts],
    retrievedMemoryIds: [...input.retrievedMemoryIds],
    traceContextTags: [...input.traceContextTags],
    clinicalState: {
      completedTraceTags: [...input.clinicalState.completedTraceTags],
      openOrders: input.clinicalState.openOrders.map((order) => ({ ...order })),
    },
    ...(communicationContext ? { communicationContext } : {}),
    policy: { ...input.policy },
  };
}

function cloneActorCommunicationProfile(profile: ActorCommunicationProfileContext): ActorCommunicationProfileContext {
  return {
    styleFamily: profile.styleFamily,
    style: profile.style,
    intensity: profile.intensity,
    baselineMood: [...profile.baselineMood],
    communicativeness: profile.communicativeness,
    topicsToAvoid: [...profile.topicsToAvoid],
    adverseResponse: profile.adverseResponse,
    deescalationTriggers: [...profile.deescalationTriggers],
    escalationTriggers: [...profile.escalationTriggers],
    culturalLanguageNotes: [...profile.culturalLanguageNotes],
  };
}

export type LocalModelProviderOptions = {
  providerId: string;
  blockers?: string[];
};

export type LocalModelProviderStubOptions = {
  blockers?: string[];
};

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

export function createMlxModelProviderAdapter(options: LocalModelProviderStubOptions = {}): LocalModelProviderAdapter {
  return new LocalModelProviderAdapter({
    providerId: "local-mlx",
    blockers: options.blockers ?? ["mlx_model_runtime_not_configured"],
  });
}

export function createLlamaCppModelProviderAdapter(options: LocalModelProviderStubOptions = {}): LocalModelProviderAdapter {
  return new LocalModelProviderAdapter({
    providerId: "local-llama-cpp",
    blockers: options.blockers ?? ["llama_cpp_model_runtime_not_configured"],
  });
}

export function createOllamaModelProviderAdapter(options: LocalModelProviderStubOptions = {}): LocalModelProviderAdapter {
  return new LocalModelProviderAdapter({
    providerId: "local-ollama",
    blockers: options.blockers ?? ["ollama_model_runtime_not_configured"],
  });
}

const DEFAULT_OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1";
const DEFAULT_OPENROUTER_MODEL = "stealth/ox-alpha";
const DEFAULT_LOCAL_LLAMA_MODEL = "qwen3-8b";
const DEFAULT_DEEPSEEK_BASE_URL = "https://api.deepseek.com";
const DEFAULT_DEEPSEEK_MODEL = "deepseek-v4-flash";

export type CreateActorDialogueModelGatewayOptions = {
  /** Route label for the composed gateway (health/error surface). */
  routeId?: string;
  /** DeepSeek key for actor dialogue. Defaults to `DEEPSEEK_API_KEY`; when absent the rung is omitted. */
  deepseekApiKey?: string;
  deepseekBaseUrl?: string;
  deepseekModel?: string;
  /** OpenRouter key for the ox rung. Defaults to `OPENROUTER_API_KEY`; when absent the rung is omitted. */
  openRouterApiKey?: string;
  openRouterBaseUrl?: string;
  openRouterModel?: string;
  /** Base URL of a local OpenAI-compatible server (llama-server). Defaults to `OPENCLINXR_LOCAL_LLAMA_BASE_URL`; when absent the rung is omitted. */
  localBaseUrl?: string;
  localModel?: string;
};

/**
 * Compose the actor-dialogue gateway the runtime uses by default: DeepSeek Flash
 * first (thinking disabled), ox (OpenRouter) second, local llama-server third, mock last.
 * Priority is list order — the gateway walks the ready adapters in order and fails
 * over to the next when one throws, so a rate-limited primary falls through to the mock
 * instead of reaching the learner.
 *
 * Reachability is decided from CONFIG ONLY — no network call at import or health
 * time: the ox rung is present when an API key is configured, the local rung when
 * a base URL is configured. With neither configured the offline pair (mock + a
 * `not_configured` local stub) answers from the mock, so a dev boot with no model
 * configured returns an utterance and never throws.
 */
export function createActorDialogueModelGateway(
  options: CreateActorDialogueModelGatewayOptions = {},
): ModelGateway {
  const adapters: ModelProviderAdapter[] = [];

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

  const openRouterApiKey = options.openRouterApiKey ?? process.env["OPENROUTER_API_KEY"];
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
export type { OpenAiCompatibleProviderOptions } from "./openai-compatible-adapter.js";
export { OpenAiCompatibleModelProviderAdapter } from "./openai-compatible-adapter.js";
