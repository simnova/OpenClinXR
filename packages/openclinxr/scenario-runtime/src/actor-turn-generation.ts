import type { EmotionEventKind, EmotionTransition, HistoryTakingCoverageState } from "@openclinxr/conversation-policy";
import type { ActorResponseResult, ModelGateway } from "@openclinxr/model-gateway";
import type { ActorTurnPlan, Scenario, TraceEvent } from "@openclinxr/shared-schemas";
import {
  ACTOR_TURN_PLANNED_EVENT_TYPE,
  buildActorTurnPlan,
  classifyLearnerEmotionEvent,
} from "./actor-turn-plan.js";
import { bindPersistedActorTurn } from "./authored-turn-binding.js";
import {
  actorLocalAuthoredTurnIndex,
  actorResponseFromFrozenPlan,
  type DeterministicDialoguePort,
  tryResolveDeterministicActorTurnPlan,
} from "./deterministic-dialogue-runtime.js";
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
  /** Optional capability-gateway local-fixture dialogue. Absent → live model-gateway path. */
  deterministicDialogue?: DeterministicDialoguePort;
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

  const authoredTurn = actorLocalAuthoredTurnIndex(session.frozenActorTurnPlans, input.actorId);
  const deterministicPlan = host.deterministicDialogue
    ? await tryResolveDeterministicActorTurnPlan(host.deterministicDialogue, {
        scenarioId: host.scenario.scenarioId,
        actorId: input.actorId,
        learnerUtterance: input.learnerUtterance,
        turnIndex: authoredTurn,
        stationRunId: session.run.stationRunId,
        ...(host.deterministicDialogue.claimLiveProvider !== undefined
          ? { claimLiveProvider: host.deterministicDialogue.claimLiveProvider }
          : {}),
        ...(host.deterministicDialogue.providerId !== undefined
          ? { providerId: host.deterministicDialogue.providerId }
          : {}),
      })
    : undefined;

  if (deterministicPlan) {
    host.applyEmotionEvent(session.run.stationRunId, input.actorId, deterministicPlan.eventKind, {
      atSecond: input.atSecond,
      turnIndex: input.conversationTurn,
    });
    const response = actorResponseFromFrozenPlan({
      plan: deterministicPlan,
      scenario: host.scenario,
      requestId: modelActorResponseRequestId(session.run.stationRunId, actor.actorId, input.conversationTurn),
      traceContextTags,
      retrievedMemoryIds: input.actorContext.retrievedMemoryIds,
    });
    return finalizeCommittedActorTurn({
      host,
      session,
      input,
      actor,
      learnerEvent,
      historyTakingCoverage,
      primaryTag,
      traceContextTags,
      response,
      committedPlan: deterministicPlan,
      generatedSource: "capability-gateway",
      lockSpokenTextToPlan: true,
    });
  }

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

  const turnId = `turn_${input.conversationTurn}_${input.actorId}_${input.atSecond}`;
  const boundPreview = bindPersistedActorTurn({
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
  const boundResponse = boundPreview.authoredBinding
    ? { ...response, text: boundPreview.responseText }
    : response;
  const spokenText = boundPreview.authoredBinding?.spokenText ?? boundResponse.text;
  const committedPlan = buildActorTurnPlan({
    event: classifierVerdict,
    emotionTransition,
    spokenText,
    actor,
    stationRunId: session.run.stationRunId,
    turnId,
    turnIndex: authoredTurn,
    somaticEmotion: null,
    languageProvenance: {
      fallbackUsed: boundResponse.responseKind === "blocked_fallback",
      providerId: boundResponse.provenance.providerId,
    },
  });
  return finalizeCommittedActorTurn({
    host,
    session,
    input,
    actor,
    learnerEvent,
    historyTakingCoverage,
    primaryTag,
    traceContextTags,
    response: boundResponse,
    committedPlan,
    generatedSource: "model-gateway",
    lockSpokenTextToPlan: false,
  });
}

async function finalizeCommittedActorTurn(args: {
  host: ActorTurnGenerationHost;
  session: SessionRecord;
  input: GenerateActorResponseFromContextInput;
  actor: Scenario["actors"][number];
  learnerEvent: TraceEvent;
  historyTakingCoverage: HistoryTakingCoverageState;
  primaryTag: string | undefined;
  traceContextTags: string[];
  response: ActorResponseResult;
  committedPlan: ActorTurnPlan;
  generatedSource: string;
  lockSpokenTextToPlan: boolean;
}): Promise<GenerateActorResponseResult> {
  const {
    host,
    session,
    input,
    actor,
    learnerEvent,
    historyTakingCoverage,
    primaryTag,
    traceContextTags,
    committedPlan,
    generatedSource,
    lockSpokenTextToPlan,
  } = args;

  session.actorTurnInProgress = null;
  session.lastSpeakerActorId = input.actorId;
  session.frozenActorTurnPlans.set(input.actorId, committedPlan);

  const responseText = lockSpokenTextToPlan ? committedPlan.spokenText : args.response.text;
  const bound = bindPersistedActorTurn({
    scenarioId: host.scenario.scenarioId,
    actorId: input.actorId,
    actorDisplayName: actor.displayName,
    actorDemeanor: actor.demeanor ?? "",
    learnerUtterance: input.learnerUtterance,
    traceContextTags,
    responseText,
    engineEmotion: session.emotionEngines.get(input.actorId)?.currentEmotion,
    base: {
      turnId: committedPlan.turnId,
      stationRunId: session.run.stationRunId,
      actorId: input.actorId,
      atSecond: input.atSecond,
      conversationTurn: input.conversationTurn,
      learnerUtterance: input.learnerUtterance,
      responseKind: args.response.responseKind,
      traceContextTags,
      durableEventRef: durableEventRef(session.run.stationRunId, session.nextSequence + 1),
      learnerEventSequence: learnerEvent.sequence,
      actorResponseEventSequence: session.nextSequence + 1,
    },
  });
  const boundResponse = lockSpokenTextToPlan
    ? { ...args.response, text: committedPlan.spokenText }
    : bound.authoredBinding
      ? { ...args.response, text: bound.responseText }
      : args.response;

  const plannedEvent = host.appendTrace(session, {
    eventType: ACTOR_TURN_PLANNED_EVENT_TYPE,
    atSecond: input.atSecond,
    source: generatedSource === "capability-gateway" ? "capability-gateway" : "conversation-policy",
    actorId: input.actorId,
    ...(primaryTag ? { tag: primaryTag } : {}),
    payload: {
      actorTurnPlan: committedPlan,
      ...(generatedSource === "capability-gateway"
        ? {
            deterministicDialogue: {
              profile: "local-development",
              capabilityId: "model-dialogue",
              providerId: committedPlan.languageProvenance.providerId,
            },
          }
        : {}),
    },
  });
  const generatedDurableRef = durableEventRef(session.run.stationRunId, session.nextSequence);
  const actorResponseEvent = host.appendTrace(session, {
    eventType: "actor.response.generated",
    atSecond: input.atSecond,
    source: generatedSource,
    actorId: input.actorId,
    ...(primaryTag ? { tag: primaryTag } : {}),
    payload: {
      text: boundResponse.text,
      responseKind: boundResponse.responseKind,
      traceTags: boundResponse.traceTags,
      provenance: boundResponse.provenance,
      durableEventRef: generatedDurableRef,
      actorTurnPlan: committedPlan,
      ...(bound.authoredBinding && !lockSpokenTextToPlan ? { authoredBinding: bound.authoredBinding } : {}),
    },
  });
  const spokenText = lockSpokenTextToPlan ? committedPlan.spokenText : bound.turn.spokenText;
  const actorTurn: ScenarioRuntimeActorTurn = {
    ...bound.turn,
    responseText: boundResponse.text,
    ...(spokenText !== undefined ? { spokenText } : {}),
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
