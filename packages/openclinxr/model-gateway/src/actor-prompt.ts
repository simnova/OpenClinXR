import type { ActorResponseRequest } from "./index.js";
import type {
  ActorCommunicationProfileContext,
  ActorCommunicationPromptContext,
  ActorResponseProviderPromptInput,
} from "./model-gateway-internal.js";

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

export function cloneActorCommunicationProfile(profile: ActorCommunicationProfileContext): ActorCommunicationProfileContext {
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
