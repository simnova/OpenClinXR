import {
  AUTHORED_LOCAL_FIXTURE_PROVIDER_ID,
  buildOpenClinXrCapabilityRoutingMatrix,
  createDeterministicDialogueAdapter,
  type AuthoredDialogueCatalog,
  type AuthoredDialogueSeed,
  type DeterministicDialogueRequestPayload,
} from "@openclinxr/capability-gateway";
import type { ActorResponseResult } from "@openclinxr/model-gateway";
import type { DialogueFixtureSeed } from "@openclinxr/scenario-fixtures";
import type { ActorTurnPlan, Scenario, TraceEvent } from "@openclinxr/shared-schemas";
import { ACTOR_TURN_PLANNED_EVENT_TYPE, freezeActorTurnPlan } from "./actor-turn-plan.js";
import { actorResponsePolicy } from "./provider-support.js";

export type DeterministicDialoguePort = {
  resolvePlan: (
    payload: DeterministicDialogueRequestPayload,
  ) => Promise<ActorTurnPlan> | ActorTurnPlan;
  claimLiveProvider?: boolean;
  providerId?: string;
};

/**
 * Next authored seed index for one actor.
 * Uses that actor's last frozen plan, not the global conversationTurn clock.
 */
export function actorLocalAuthoredTurnIndex(
  frozenActorTurnPlans: ReadonlyMap<string, Pick<ActorTurnPlan, "turnIndex">>,
  actorId: string,
): number {
  const last = frozenActorTurnPlans.get(actorId);
  return last ? last.turnIndex + 1 : 0;
}

/** @deprecated Use actorLocalAuthoredTurnIndex; global conversationTurn-minus-one is incorrect under interleaved actors. */
export function authoredTurnIndex(
  frozenActorTurnPlans: ReadonlyMap<string, Pick<ActorTurnPlan, "turnIndex">>,
  actorId: string,
): number {
  return actorLocalAuthoredTurnIndex(frozenActorTurnPlans, actorId);
}

export function isMissingAuthoredDialogueSeed(error: unknown): boolean {
  return error instanceof Error && error.message.startsWith("no_matching_dialogue_seed:");
}

export function localDevelopmentModelDialogueBinding() {
  const binding = buildOpenClinXrCapabilityRoutingMatrix().bindings.find(
    (entry) => entry.profile === "local-development" && entry.capabilityId === "model-dialogue",
  );
  if (!binding) {
    throw new Error("Missing local-development model-dialogue binding");
  }
  return binding;
}

export function authoredDialogueCatalogFromScenario(
  scenario: Scenario,
  seeds: readonly DialogueFixtureSeed[],
): AuthoredDialogueCatalog {
  const nextTurnIndex = new Map<string, number>();
  const catalogSeeds: AuthoredDialogueSeed[] = seeds.map((seed) => {
    const turnIndex = nextTurnIndex.get(seed.actorId) ?? 0;
    nextTurnIndex.set(seed.actorId, turnIndex + 1);
    return {
      seedId: seed.seedId,
      actorId: seed.actorId,
      turnIndex,
      learnerUtterance: seed.learnerUtterance,
      visibleFacts: seed.visibleFacts,
      hiddenFactCanaries: seed.hiddenFactCanaries,
      safetyExpectation: seed.safetyExpectation,
      ...(seed.spokenText ? { spokenText: seed.spokenText } : {}),
      ...(seed.affect ? { affect: seed.affect } : {}),
    };
  });

  return {
    scenarios: [
      {
        scenarioId: scenario.scenarioId,
        version: scenario.version,
        actors: scenario.actors.map((actor) => ({
          actorId: actor.actorId,
          displayName: actor.displayName,
          role: actor.role,
          ...(typeof actor.phenotype?.age === "number" ? { age: actor.phenotype.age } : {}),
          ...(typeof actor.communicationProfile?.intensity === "number"
            ? { communicationIntensity: actor.communicationProfile.intensity }
            : {}),
        })),
        seeds: catalogSeeds,
      },
    ],
  };
}

export function createDeterministicDialoguePort(
  catalog: AuthoredDialogueCatalog,
): DeterministicDialoguePort {
  const adapter = createDeterministicDialogueAdapter(localDevelopmentModelDialogueBinding(), catalog);
  return {
    resolvePlan: async (payload) => {
      const plan = await adapter.execute({
        profile: "local-development",
        capabilityId: "model-dialogue",
        payload,
      });
      return asRuntimeActorTurnPlan(plan);
    },
  };
}

export async function tryResolveDeterministicActorTurnPlan(
  port: DeterministicDialoguePort,
  payload: DeterministicDialogueRequestPayload,
): Promise<ActorTurnPlan | undefined> {
  try {
    return await port.resolvePlan(payload);
  } catch (error) {
    if (isMissingAuthoredDialogueSeed(error)) {
      return undefined;
    }
    throw error;
  }
}

export function recoverFrozenActorTurnPlanFromReplay(
  events: readonly TraceEvent[],
  actorId: string,
): ActorTurnPlan | undefined {
  const planned = [...events]
    .reverse()
    .find((event) => event.eventType === ACTOR_TURN_PLANNED_EVENT_TYPE && event.actorId === actorId);
  const plan = planned?.payload["actorTurnPlan"];
  if (!plan || typeof plan !== "object") {
    return undefined;
  }
  return plan as ActorTurnPlan;
}

export function actorResponseFromFrozenPlan(input: {
  plan: ActorTurnPlan;
  scenario: Scenario;
  requestId: string;
  traceContextTags: readonly string[];
  retrievedMemoryIds: readonly string[];
}): ActorResponseResult {
  const providerId = input.plan.languageProvenance.providerId ?? AUTHORED_LOCAL_FIXTURE_PROVIDER_ID;
  if (providerId !== AUTHORED_LOCAL_FIXTURE_PROVIDER_ID) {
    throw new Error(`fabricated_provider_claim:${providerId}`);
  }
  return {
    text: input.plan.spokenText,
    responseKind: input.plan.languageProvenance.fallbackUsed ? "blocked_fallback" : "spoken_actor_response",
    traceTags: [...input.traceContextTags],
    provenance: {
      requestId: input.requestId,
      providerId: AUTHORED_LOCAL_FIXTURE_PROVIDER_ID,
      modelId: "authored-local-fixture",
      modelVersion: "catalog-v1",
      modelRuntimeName: "deterministic-dialogue-runtime",
      requestPolicyId: actorResponsePolicy.requestPolicyId,
      promptTemplateId: actorResponsePolicy.promptTemplateId,
      scenarioId: input.scenario.scenarioId,
      scenarioVersion: input.scenario.version,
      actorId: input.plan.actorId,
      actorCardVersion: "fixture-v1",
      retrievedMemoryIds: [...input.retrievedMemoryIds],
      safetyPolicyVersion: actorResponsePolicy.safetyPolicyVersion,
      latencyMs: 0,
      tokenUsage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
      costEstimateUsd: 0,
      safetyStatus: "pass",
      guardrail: {
        status: "pass",
        reason: "deterministic local-fixture dialogue; not a live provider",
      },
    },
  };
}

function asRuntimeActorTurnPlan(plan: ActorTurnPlan): ActorTurnPlan {
  return freezeActorTurnPlan({
    ...plan,
    gestureClipIds: [...plan.gestureClipIds],
    prosody: {
      wrapTags: [...plan.prosody.wrapTags],
      inlineTags: [...plan.prosody.inlineTags],
      speed: plan.prosody.speed,
      droppedTags: [...plan.prosody.droppedTags],
    },
    languageProvenance: { ...plan.languageProvenance },
    notEvidenceFor: [...plan.notEvidenceFor],
  });
}
