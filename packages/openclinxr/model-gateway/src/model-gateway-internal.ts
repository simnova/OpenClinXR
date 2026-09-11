import type { ProviderAuditRecord } from "@cellix/provider-contracts";
import type { ModelProviderAdapter, ModelRequestPolicy } from "./index.js";

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

export type ModelGatewayOptions = {
  adapters: ModelProviderAdapter[];
  routeId: string;
};

export type LocalModelProviderOptions = {
  providerId: string;
  blockers?: string[];
};

export type LocalModelProviderStubOptions = {
  blockers?: string[];
};

export type CreateActorDialogueModelGatewayOptions = {
  /** Route label for the composed gateway (health/error surface). */
  routeId?: string;
  /** DeepSeek key for actor dialogue. Defaults to `DEEPSEEK_API_KEY`; when absent the rung is omitted. */
  deepseekApiKey?: string;
  deepseekBaseUrl?: string;
  deepseekModel?: string;
  /** OpenRouter key for the Muse contributor + ox rungs. Defaults to `OPENROUTER_API_KEY`; when absent both are omitted. */
  openRouterApiKey?: string;
  openRouterBaseUrl?: string;
  openRouterModel?: string;
  /** Muse Spark contributor model id (OpenRouter). Defaults to `meta/muse-spark-1.3-contributor`; the rung is present whenever an OpenRouter key is. */
  museSparkModel?: string;
  /** Base URL of a local OpenAI-compatible server (llama-server). Defaults to `OPENCLINXR_LOCAL_LLAMA_BASE_URL`; when absent the rung is omitted. */
  localBaseUrl?: string;
  localModel?: string;
};
