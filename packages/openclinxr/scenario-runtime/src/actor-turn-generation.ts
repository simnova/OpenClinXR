import type { EmotionEventKind, EmotionTransition, HistoryTakingCoverageState } from "@openclinxr/conversation-policy";
import type { ActorResponseResult, ModelGateway } from "@openclinxr/model-gateway";
import type { Scenario, TraceEvent } from "@openclinxr/shared-schemas";
import {
  ACTOR_TURN_PLANNED_EVENT_TYPE,
  buildActorTurnPlan,
  classifyLearnerEmotionEvent,
} from "./actor-turn-plan.js";
import { bindPersistedActorTurn } from "./authored-turn-binding.js";
import { actorResponsePolicy, modelActorResponseRequestId } from "./provider-support.js";
import type {
  GenerateActorResponseFromContextInput,
  GenerateActorResponseResult,
  ScenarioRuntimeActorTurn,
  ScenarioRuntimeDurableStore,
  SessionRecord,
} from "./runtime-types.js";
import { durableEventRef } from "./trace.js";

export type ActorTurnTraceAppend = (
  session: SessionRecord,
  input: {
    eventType: string;
    atSecond: number;
    source: string;
    actorId?: string;
    tag?: string;
    payload?: Record<string, unknown>;
  },
) => TraceEvent;

export type ActorTurnGenerationHost = {
  scenario: Scenario;
  modelGateway: ModelGateway;
  durableStore?: ScenarioRuntimeDurableStore;
  appendTrace: ActorTurnTraceAppend;
  applyEmotionEvent: (
    stationRunId: string,
    actorId: string,
    kind: EmotionEventKind,
    opts?: { atSecond?: number; turnIndex?: number },
  ) => EmotionTransition;
  applyHistoryTakingCoverageUpdate: (
    session: SessionRecord,
    input: { atSecond: number; learnerUtterance: string; traceContextTags: string[] },
  ) => HistoryTakingCoverageState;
};

export async function generateActorResponseFromContext(
  host: ActorTurnGenerationHost,
  session: SessionRecord,
  input: GenerateActorResponseFromContextInput,
): Promise<GenerateActorResponseResult> {
  const actor = host.scenario.actors.find((candidate) => candidate.actorId === input.actorId);
  if (!actor) {
    throw new Error(`Actor not found: ${input.actorId}`);
  }

  const traceContextTags = [...(input.traceContextTags ?? [])];
  const primaryTag = traceContextTags[0];
  const learnerEvent = host.appendTrace(session, {
    eventType: "learner.utterance",
    atSecond: input.atSecond,
    source: "learner",
    actorId: input.actorId,
    ...(primaryTag ? { tag: primaryTag } : {}),
    payload: {
      text: input.learnerUtterance,
      traceContextTags,
      durableEventRef: durableEventRef(session.run.stationRunId, session.nextSequence),
    },
  });

  const historyTakingCoverage = host.applyHistoryTakingCoverageUpdate(session, {
    atSecond: input.atSecond,
    learnerUtterance: input.learnerUtterance,
    traceContextTags,
  });

  session.actorTurnInProgress = {
    actorId: input.actorId,
    conversationTurn: input.conversationTurn,
    startedAtSecond: input.atSecond,
    learnerUtterance: input.learnerUtterance,
    stationRunId: session.run.stationRunId,
  };

  const classifierVerdict = classifyLearnerEmotionEvent({
    text: input.learnerUtterance,
    traceTags: traceContextTags,
    actorRole: actor.role,
  });
  const emotionTransition = host.applyEmotionEvent(
    session.run.stationRunId,
    input.actorId,
    classifierVerdict.kind,
    {
      atSecond: input.atSecond,
      turnIndex: input.conversationTurn,
    },
  );

  let response: ActorResponseResult;
  try {
    response = await host.modelGateway.generateActorResponse({
      requestId: modelActorResponseRequestId(session.run.stationRunId, actor.actorId, input.conversationTurn),
      stationRunId: session.run.stationRunId,
      scenarioId: host.scenario.scenarioId,
      scenarioVersion: host.scenario.version,
      actorId: actor.actorId,
      actorDisplayName: actor.displayName,
      actorRole: actor.role,
      conversationTurn: input.conversationTurn,
      learnerUtterance: input.learnerUtterance,
      visibleFacts: input.actorContext.visibleMemory.facts,
      hiddenFacts: [],
      retrievedMemoryIds: input.actorContext.retrievedMemoryIds,
      traceContextTags,
      clinicalState: {
        completedTraceTags: [...input.actorContext.clinicalState.completedTraceTags],
        openOrders: input.actorContext.clinicalState.openOrders.map((order) => ({ ...order })),
      },
      policy: actorResponsePolicy,
    });
  } catch {
    session.actorTurnInProgress = null;
    host.appendTrace(session, {
      eventType: "actor.response.failed",
      atSecond: input.atSecond,
      source: "model-gateway",
      actorId: input.actorId,
      ...(primaryTag ? { tag: primaryTag } : {}),
      payload: {
        errorCode: "model_provider_error",
        traceContextTags,
        durableEventRef: durableEventRef(session.run.stationRunId, session.nextSequence),
      },
    });
    throw new Error("Actor response generation failed");
  }

  session.actorTurnInProgress = null;
  session.lastSpeakerActorId = input.actorId;

  const turnId = `turn_${input.conversationTurn}_${input.actorId}_${input.atSecond}`;
  const bound = bindPersistedActorTurn({
    scenarioId: host.scenario.scenarioId,
    actorId: input.actorId,
    actorDisplayName: actor.displayName,
    actorDemeanor: actor.demeanor ?? "",
    learnerUtterance: input.learnerUtterance,
    traceContextTags,
    responseText: response.text,
    engineEmotion: session.emotionEngines.get(input.actorId)?.currentEmotion,
    base: {
      turnId,
      stationRunId: session.run.stationRunId,
      actorId: input.actorId,
      atSecond: input.atSecond,
      conversationTurn: input.conversationTurn,
      learnerUtterance: input.learnerUtterance,
      responseKind: response.responseKind,
      traceContextTags,
      durableEventRef: durableEventRef(session.run.stationRunId, session.nextSequence + 1),
      learnerEventSequence: learnerEvent.sequence,
      actorResponseEventSequence: session.nextSequence + 1,
    },
  });
  const boundResponse = bound.authoredBinding
    ? { ...response, text: bound.responseText }
    : response;
  const spokenText = bound.authoredBinding?.spokenText ?? boundResponse.text;
  const committedPlan = buildActorTurnPlan({
    event: classifierVerdict,
    emotionTransition,
    spokenText,
    actor,
    stationRunId: session.run.stationRunId,
    turnId,
    turnIndex: Math.max(0, input.conversationTurn - 1),
    somaticEmotion: null,
    languageProvenance: {
      fallbackUsed: boundResponse.responseKind === "blocked_fallback",
      providerId: boundResponse.provenance.providerId,
    },
  });
  session.frozenActorTurnPlans.set(input.actorId, committedPlan);
  const plannedEvent = host.appendTrace(session, {
    eventType: ACTOR_TURN_PLANNED_EVENT_TYPE,
    atSecond: input.atSecond,
    source: "conversation-policy",
    actorId: input.actorId,
    ...(primaryTag ? { tag: primaryTag } : {}),
    payload: { actorTurnPlan: committedPlan },
  });
  const generatedDurableRef = durableEventRef(session.run.stationRunId, session.nextSequence);
  const actorResponseEvent = host.appendTrace(session, {
    eventType: "actor.response.generated",
    atSecond: input.atSecond,
    source: "model-gateway",
    actorId: input.actorId,
    ...(primaryTag ? { tag: primaryTag } : {}),
    payload: {
      text: boundResponse.text,
      responseKind: boundResponse.responseKind,
      traceTags: boundResponse.traceTags,
      provenance: boundResponse.provenance,
      durableEventRef: generatedDurableRef,
      actorTurnPlan: committedPlan,
      ...(bound.authoredBinding ? { authoredBinding: bound.authoredBinding } : {}),
    },
  });
  const actorTurn: ScenarioRuntimeActorTurn = {
    ...bound.turn,
    actorResponseEventSequence: actorResponseEvent.sequence,
    durableEventRef: generatedDurableRef,
    actorTurnPlan: committedPlan,
  };
  await host.durableStore?.saveActorTurn?.(session.run.stationRunId, actorTurn);

  return {
    conversationTurn: input.conversationTurn,
    response: boundResponse,
    learnerEvent,
    actorResponseEvent,
    historyTakingCoverage,
    actorTurnPlan: committedPlan,
    plannedEvent,
  };
}
