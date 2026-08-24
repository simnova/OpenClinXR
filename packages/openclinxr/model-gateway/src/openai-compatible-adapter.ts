import { type ProviderHealth } from "@cellix/provider-contracts";
import {
  type ActorCommunicationProfileContext,
  type ActorResponseRequest,
  type ActorResponseResult,
  type GuardrailResult,
  type ModelCapability,
  type ModelProviderAdapter,
} from "./index.js";
import { isHiddenTruthExtractionAttempt } from "./hidden-truth-guardrail.js";

/**
 * OpenAI-compatible chat_completions adapter for the model-gateway seam.
 *
 * One implementation serves every OpenAI-protocol backend switched by `baseUrl`:
 * a local llama-server (`http://127.0.0.1:8080/v1`) or a hosted gateway such as
 * OpenRouter. No vendor-specific behaviour is hardcoded; the api key is optional,
 * because local runtimes need none.
 *
 * Safety posture: the hidden-truth guardrail runs BEFORE any network call — the
 * request is refused locally, exactly like the mock. `hiddenFacts` are never placed
 * in the outbound payload; they exist only for local evaluation surfaces.
 */

export type OpenAiCompatibleProviderOptions = {
  providerId: string;
  baseUrl: string;
  model: string;
  apiKey?: string;
  fetchImpl?: typeof fetch;
};

type ChatCompletionsMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

function chatCompletionsUrl(baseUrl: string): string {
  return `${baseUrl.replace(/\/+$/, "")}/chat/completions`;
}

function buildActorPersonaSystemPrompt(input: ActorResponseRequest): string {
  const lines = [
    `You are ${input.actorDisplayName}, a simulated ${input.actorRole} in a clinical skills training encounter.`,
    `Scenario: ${input.scenarioId} (v${input.scenarioVersion}), conversation turn ${input.conversationTurn}.`,
    `Case details you may speak from: ${input.visibleFacts.join(" ") || "none established yet."}`,
    ...(input.traceContextTags.length > 0 ? [`Current encounter focus: ${input.traceContextTags.join(", ")}.`] : []),
    ...communicationProfileLines(input.actorCommunicationProfile),
    "Respond briefly and naturally, in character.",
    "Do not invent or reveal information beyond what the encounter has established.",
  ];
  return lines.join("\n");
}

function communicationProfileLines(profile?: ActorCommunicationProfileContext): string[] {
  if (!profile) {
    return [];
  }
  return [
    `Communication style: ${profile.styleFamily}/${profile.style} at intensity ${profile.intensity.toFixed(2)}.`,
    `Baseline mood: ${profile.baselineMood.join(", ")}.`,
    `Communicativeness: ${profile.communicativeness}`,
    `Avoid: ${profile.topicsToAvoid.join(", ")}.`,
    `Adverse response: ${profile.adverseResponse}`,
    `De-escalates when: ${profile.deescalationTriggers.join(", ")}.`,
    `Escalates when: ${profile.escalationTriggers.join(", ")}.`,
    `Cultural/language notes: ${profile.culturalLanguageNotes.join(", ")}.`,
  ];
}

function estimateTokens(text: string): number {
  return Math.max(1, Math.ceil(text.length / 5));
}

export class OpenAiCompatibleModelProviderAdapter implements ModelProviderAdapter {
  readonly id: string;
  readonly capabilities: ModelCapability[] = ["actor_response", "scenario_draft", "scenario_review"];

  private readonly baseUrl: string;
  private readonly model: string;
  private readonly apiKey: string | undefined;
  private readonly fetchImpl: typeof fetch;

  constructor(options: OpenAiCompatibleProviderOptions) {
    this.id = options.providerId;
    this.baseUrl = options.baseUrl;
    this.model = options.model;
    this.apiKey = options.apiKey;
    this.fetchImpl = options.fetchImpl ?? fetch.bind(globalThis);
  }

  async health(): Promise<ProviderHealth> {
    const blockers: string[] = [];
    if (!this.baseUrl.trim()) {
      blockers.push("openai_compatible_base_url_missing");
    }
    if (!this.model.trim()) {
      blockers.push("openai_compatible_model_missing");
    }
    if (blockers.length > 0) {
      return { providerId: this.id, status: "not_configured", blockers };
    }
    return { providerId: this.id, status: "ready" };
  }

  async generateActorResponse(input: ActorResponseRequest): Promise<ActorResponseResult> {
    // Guardrail runs BEFORE the network call — a blocked turn never reaches the wire.
    if (isHiddenTruthExtractionAttempt(input.learnerUtterance)) {
      return this.localRefusal(input, "hidden_truth_extraction_attempt");
    }

    const startedAtMs = Date.now();
    const messages: ChatCompletionsMessage[] = [
      { role: "system", content: buildActorPersonaSystemPrompt(input) },
      { role: "user", content: input.learnerUtterance },
    ];

    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (this.apiKey && this.apiKey.trim().length > 0) {
      headers["Authorization"] = `Bearer ${this.apiKey}`;
    }

    const response = await this.fetchImpl(chatCompletionsUrl(this.baseUrl), {
      method: "POST",
      headers,
      body: JSON.stringify({ model: this.model, messages }),
      signal: AbortSignal.timeout(30_000),
    });

    if (!response.ok) {
      throw new Error(
        `OpenAI-compatible provider ${this.id} request failed with status ${response.status}`,
      );
    }

    const payload: unknown = await response.json();
    const completionText = extractAssistantContent(payload);
    if (!completionText) {
      throw new Error(`OpenAI-compatible provider ${this.id} returned a malformed chat_completions response`);
    }

    return this.spokenResponse(input, completionText, Date.now() - startedAtMs, payload);
  }

  private localRefusal(input: ActorResponseRequest, reason: string): ActorResponseResult {
    const guardrail: GuardrailResult = { status: "blocked", reason };
    return {
      text: `${input.actorDisplayName}: I can only respond as this simulated patient from information that has been appropriately elicited.`,
      responseKind: "blocked_fallback",
      traceTags: [...input.traceContextTags],
      provenance: this.provenance(input, guardrail, 0, {
        promptTokens: estimateTokens(input.learnerUtterance),
        completionTokens: 0,
        totalTokens: estimateTokens(input.learnerUtterance),
      }),
    };
  }

  private spokenResponse(
    input: ActorResponseRequest,
    text: string,
    latencyMs: number,
    payload: unknown,
  ): ActorResponseResult {
    const guardrail: GuardrailResult = { status: "pass", reason: "hidden_truth_guardrail_passed_locally" };
    const usage = extractTokenUsage(payload);
    const tokenUsage = usage ?? {
      promptTokens: estimateTokens(buildActorPersonaSystemPrompt(input) + input.learnerUtterance),
      completionTokens: estimateTokens(text),
      totalTokens: estimateTokens(buildActorPersonaSystemPrompt(input) + input.learnerUtterance) + estimateTokens(text),
    };
    return {
      text,
      responseKind: "spoken_actor_response",
      traceTags: [...input.traceContextTags],
      provenance: this.provenance(input, guardrail, latencyMs, tokenUsage),
    };
  }

  private provenance(
    input: ActorResponseRequest,
    guardrail: GuardrailResult,
    latencyMs: number,
    tokenUsage: { promptTokens: number; completionTokens: number; totalTokens: number },
  ): ActorResponseResult["provenance"] {
    return {
      requestId: modelRequestId(input),
      providerId: this.id,
      modelId: this.model,
      modelVersion: "provider-reported-unversioned",
      modelRuntimeName: "openai-chat-completions",
      requestPolicyId: input.policy.requestPolicyId,
      promptTemplateId: input.policy.promptTemplateId,
      scenarioId: input.scenarioId,
      scenarioVersion: input.scenarioVersion,
      actorId: input.actorId,
      retrievedMemoryIds: [...input.retrievedMemoryIds],
      safetyPolicyVersion: input.policy.safetyPolicyVersion,
      latencyMs,
      tokenUsage,
      costEstimateUsd: 0,
      safetyStatus: guardrail.status,
      guardrail,
    };
  }
}

function modelRequestId(input: ActorResponseRequest): string {
  return input.requestId && input.requestId.trim().length > 0
    ? input.requestId
    : `${input.stationRunId}:${input.actorId}:turn-${input.conversationTurn}`;
}

function extractAssistantContent(payload: unknown): string | undefined {
  const choices = (payload as { choices?: Array<{ message?: { content?: unknown } }> } | null)?.choices;
  const content = choices?.[0]?.message?.content;
  return typeof content === "string" && content.trim().length > 0 ? content : undefined;
}

function extractTokenUsage(payload: unknown): { promptTokens: number; completionTokens: number; totalTokens: number } | undefined {
  const usage = (payload as { usage?: { prompt_tokens?: unknown; completion_tokens?: unknown; total_tokens?: unknown } } | null)?.usage;
  const { prompt_tokens: p, completion_tokens: c, total_tokens: t } = usage ?? {};
  if (typeof p === "number" && typeof c === "number" && typeof t === "number") {
    return { promptTokens: p, completionTokens: c, totalTokens: t };
  }
  return undefined;
}
