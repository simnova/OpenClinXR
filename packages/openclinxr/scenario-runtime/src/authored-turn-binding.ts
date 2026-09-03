import {
  affectForAuthoredRecord,
  type AuthoredUtteranceRecord,
  keywordAffectFallbackFromText,
  PEDS_ASTHMA_SCENARIO_ID,
  resolveAuthoredUtteranceRecord,
} from "@openclinxr/scenario-fixtures";
import type { InteractionEmotion } from "@openclinxr/shared-schemas";
import type { ScenarioRuntimeActorTurn } from "./runtime-types.js";

export type AuthoredTurnPayloadBinding = {
  authoredBindingId: string;
  bindingKind: "seed" | "plan";
  speakerActorId: string;
  spokenText: string;
  caption: string;
  affect: AuthoredUtteranceRecord["affect"];
  seedId?: string;
  planId?: string;
};

export function resolvePedsAuthoredTurn(input: {
  scenarioId: string;
  actorId: string;
  learnerUtterance: string;
  traceContextTags: readonly string[];
  actorDemeanor: string;
}): AuthoredUtteranceRecord | undefined {
  if (input.scenarioId !== PEDS_ASTHMA_SCENARIO_ID) {
    return undefined;
  }
  const record = resolveAuthoredUtteranceRecord({
    scenarioId: input.scenarioId,
    actorId: input.actorId,
    learnerUtterance: input.learnerUtterance,
    traceTags: input.traceContextTags,
  });
  if (!record) {
    return undefined;
  }
  const keywordFallback = keywordAffectFallbackFromText(input.actorDemeanor);
  const affect = affectForAuthoredRecord(record.affect, keywordFallback);
  return { ...record, affect };
}

export function bindPersistedActorTurn(input: {
  scenarioId: string;
  actorId: string;
  actorDisplayName: string;
  actorDemeanor: string;
  learnerUtterance: string;
  traceContextTags: string[];
  responseText: string;
  engineEmotion: InteractionEmotion | undefined;
  base: Omit<ScenarioRuntimeActorTurn, "responseText" | "currentEmotion">;
}): {
  turn: ScenarioRuntimeActorTurn;
  responseText: string;
  authoredBinding: AuthoredTurnPayloadBinding | undefined;
} {
  const record = resolvePedsAuthoredTurn({
    scenarioId: input.scenarioId,
    actorId: input.actorId,
    learnerUtterance: input.learnerUtterance,
    traceContextTags: input.traceContextTags,
    actorDemeanor: input.actorDemeanor,
  });

  if (!record) {
    return {
      turn: {
        ...input.base,
        responseText: input.responseText,
        currentEmotion: input.engineEmotion,
      },
      responseText: input.responseText,
      authoredBinding: undefined,
    };
  }

  const spokenLine = `${input.actorDisplayName}: ${record.spokenText}`;
  const authoredBinding: AuthoredTurnPayloadBinding = {
    authoredBindingId: record.authoredBindingId,
    bindingKind: record.bindingKind,
    speakerActorId: record.speakerActorId,
    spokenText: record.spokenText,
    caption: record.caption,
    affect: record.affect,
    ...(record.seedId ? { seedId: record.seedId } : {}),
    ...(record.planId ? { planId: record.planId } : {}),
  };

  return {
    turn: {
      ...input.base,
      responseText: spokenLine,
      currentEmotion: record.affect,
      authoredBindingId: record.authoredBindingId,
      speakerActorId: record.speakerActorId,
      spokenText: record.spokenText,
      caption: record.caption,
      affect: record.affect,
    },
    responseText: spokenLine,
    authoredBinding,
  };
}
