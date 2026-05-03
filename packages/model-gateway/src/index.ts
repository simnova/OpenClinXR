import type { ProviderHealth } from "@openclinxr/shared-schemas";

export type ModelCapability = "actor_response" | "scenario_draft" | "scenario_review";

export type ModelRequestPolicy = {
  requestPolicyId: string;
  promptTemplateId: string;
  safetyPolicyVersion: string;
};

export type ActorResponseRequest = {
  stationRunId: string;
  scenarioId: string;
  scenarioVersion: number;
  actorId: string;
  actorDisplayName: string;
  actorRole: string;
  conversationTurn: number;
  learnerUtterance: string;
  visibleFacts: string[];
  hiddenFacts: string[];
  retrievedMemoryIds: string[];
  traceContextTags: string[];
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

export type ModelProvenance = {
  providerId: string;
  modelId: string;
  modelVersion: string;
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
    const adapter = await this.firstReadyAdapter("actor_response");
    return adapter.generateActorResponse(input);
  }

  private async firstReadyAdapter(capability: ModelCapability): Promise<ModelProviderAdapter> {
    for (const adapter of this.options.adapters) {
      const health = await adapter.health();
      if (health.status === "ready" && adapter.capabilities.includes(capability)) {
        return adapter;
      }
    }

    throw new Error(`No ready model provider for route ${this.options.routeId}`);
  }
}

export function createDefaultModelGateway(options: ModelGatewayOptions): ModelGateway {
  return new ModelGateway(options);
}

export class MockModelProviderAdapter implements ModelProviderAdapter {
  readonly id = "mock-model";
  readonly capabilities: ModelCapability[] = ["actor_response", "scenario_draft", "scenario_review"];

  async health(): Promise<ProviderHealth> {
    return { providerId: this.id, status: "ready" };
  }

  async generateActorResponse(input: ActorResponseRequest): Promise<ActorResponseResult> {
    if (isHiddenTruthExtractionAttempt(input.learnerUtterance)) {
      return actorResponse(input, {
        text: `${input.actorDisplayName}: I can only respond as this simulated patient from information that has been appropriately elicited.`,
        responseKind: "blocked_fallback",
        guardrail: {
          status: "blocked",
          reason: "hidden_truth_extraction_attempt",
        },
      });
    }

    const groundingFact = input.visibleFacts[0] ?? "I am still trying to describe what I feel.";
    const text = `${input.actorDisplayName}: ${groundingFact}`;

    return actorResponse(input, {
      text,
      responseKind: "spoken_actor_response",
      guardrail: {
        status: "pass",
        reason: "deterministic mock response",
      },
    });
  }
}

function actorResponse(
  input: ActorResponseRequest,
  response: {
    text: string;
    responseKind: ActorResponseResult["responseKind"];
    guardrail: GuardrailResult;
  },
): ActorResponseResult {
  const completionTokens = Math.max(8, Math.ceil(response.text.length / 5));
  const promptTokens = Math.max(12, Math.ceil((input.learnerUtterance.length + input.visibleFacts.join(" ").length) / 5));

  return {
    text: response.text,
    responseKind: response.responseKind,
    traceTags: [...input.traceContextTags],
    provenance: {
      providerId: "mock-model",
      modelId: "deterministic-mock",
      modelVersion: "1.0.0",
      requestPolicyId: input.policy.requestPolicyId,
      promptTemplateId: input.policy.promptTemplateId,
      scenarioId: input.scenarioId,
      scenarioVersion: input.scenarioVersion,
      actorId: input.actorId,
      actorCardVersion: "fixture-v1",
      retrievedMemoryIds: [...input.retrievedMemoryIds],
      safetyPolicyVersion: input.policy.safetyPolicyVersion,
      latencyMs: 0,
      tokenUsage: {
        promptTokens,
        completionTokens,
        totalTokens: promptTokens + completionTokens,
      },
      costEstimateUsd: 0,
      guardrail: response.guardrail,
    },
  };
}

function isHiddenTruthExtractionAttempt(utterance: string): boolean {
  const normalized = utterance.toLowerCase();
  return [
    "hidden fact",
    "hidden facts",
    "secret",
    "ignore your instructions",
    "ignore instructions",
    "system prompt",
    "developer message",
  ].some((phrase) => normalized.includes(phrase));
}

export type LocalModelProviderOptions = {
  providerId: string;
};

export class LocalModelProviderAdapter implements ModelProviderAdapter {
  readonly capabilities: ModelCapability[] = ["actor_response", "scenario_draft", "scenario_review"];

  constructor(private readonly options: LocalModelProviderOptions) {}

  get id(): string {
    return this.options.providerId;
  }

  async health(): Promise<ProviderHealth> {
    return { providerId: this.id, status: "not_configured" };
  }

  async generateActorResponse(): Promise<ActorResponseResult> {
    throw new Error(`Local model provider ${this.id} is not configured`);
  }
}
