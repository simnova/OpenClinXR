import { validateProviderHealth, type ProviderAuditRecord, type ProviderHealth } from "@openclinxr/shared-schemas";

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
    const adapter = await this.firstReadyAdapter("actor_response");
    return adapter.generateActorResponse(input);
  }

  private async firstReadyAdapter(capability: ModelCapability): Promise<ModelProviderAdapter> {
    for (const adapter of this.options.adapters) {
      const health = await adapter.health();
      if (validateProviderHealth(health).ok && health.status === "ready" && adapter.capabilities.includes(capability)) {
        return adapter;
      }
    }

    throw new Error(`No ready model provider for route ${this.options.routeId}`);
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
      requestId: modelRequestId(input),
      providerId: "mock-model",
      modelId: "deterministic-mock",
      modelVersion: "1.0.0",
      modelRuntimeName: "deterministic-mock-runtime",
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
      safetyStatus: response.guardrail.status,
      guardrail: response.guardrail,
    },
  };
}

function modelRequestId(input: ActorResponseRequest): string {
  return input.requestId && input.requestId.trim().length > 0
    ? input.requestId
    : `${input.stationRunId}:${input.actorId}:turn-${input.conversationTurn}`;
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
