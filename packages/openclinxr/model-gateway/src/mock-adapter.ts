import type { ProviderHealth } from "@cellix/provider-contracts";
import { isHiddenTruthExtractionAttempt } from "./hidden-truth-guardrail.js";
import type {
  ActorResponseRequest,
  ActorResponseResult,
  GuardrailResult,
  ModelCapability,
  ModelProviderAdapter,
} from "./index.js";

/**
 * Deterministic offline actor-dialogue adapter. Answers from the request's visible facts and
 * refuses hidden-truth extraction locally — the safety rail the gateway's wired rungs share.
 */
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
