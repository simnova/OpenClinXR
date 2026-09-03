import {
  classifyEmotionEventDetailed,
  type EmotionEventClassifierVerdict,
  mapEmotionPerformance,
  stripProviderMarkup,
  type EmotionTransition,
} from "@openclinxr/conversation-policy";
import type {
  ActorTurnExecution,
  ActorTurnPlan,
  DialogueEmotion,
  Scenario,
} from "@openclinxr/shared-schemas";

export const ACTOR_TURN_PLAN_CLAIM_SCOPE = "simulated_actor_behavior" as const;
export const ACTOR_TURN_PLAN_NOT_EVIDENCE_FOR = [
  "clinical_affect_inference",
  "empathy_score",
  "licensure",
] as const;

export const ACTOR_TURN_PLANNED_EVENT_TYPE = "actor.turn.planned";
export const ACTOR_TURN_EXECUTED_EVENT_TYPE = "actor.turn.executed";

type ScenarioActor = Scenario["actors"][number];

export type BuildActorTurnPlanInput = {
  event: EmotionEventClassifierVerdict;
  emotionTransition: EmotionTransition;
  spokenText: string;
  actor: ScenarioActor;
  stationRunId: string;
  turnId: string;
  turnIndex: number;
  somaticEmotion: ActorTurnPlan["somaticEmotion"];
  languageProvenance: ActorTurnPlan["languageProvenance"];
};

const DIALOGUE_EMOTIONS = new Set<DialogueEmotion>(["anxious", "concerned", "reassured", "neutral"]);

export function asDialogueEmotion(value: string): DialogueEmotion {
  if (DIALOGUE_EMOTIONS.has(value as DialogueEmotion)) {
    return value as DialogueEmotion;
  }
  return "neutral";
}

export function intensityBucketForProfile(intensity: number | undefined): ActorTurnPlan["intensityBucket"] {
  if (intensity === undefined) {
    return "mid";
  }
  if (intensity <= 0.33) {
    return "low";
  }
  if (intensity <= 0.66) {
    return "mid";
  }
  return "high";
}

export function ageBandForActor(actor: ScenarioActor): ActorTurnPlan["ageBand"] {
  const age = actor.phenotype?.age;
  if (typeof age === "number") {
    if (age < 13) {
      return "child";
    }
    if (age < 18) {
      return "adolescent";
    }
  }
  if (actor.role === "family") {
    return "adult-parent";
  }
  return "adult";
}

export function defaultVoiceIdForActor(actor: ScenarioActor): string {
  return `mock-${actor.displayName.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "")}`;
}

export function eventKindSourceForVerdict(
  verdict: EmotionEventClassifierVerdict,
): ActorTurnPlan["eventKindSource"] {
  if (verdict.source !== "machine_flag") {
    return "classifier";
  }
  if (verdict.kind === "learner_interruption") {
    return "barge_in";
  }
  if (verdict.kind === "actor_silence_timeout") {
    return "timeout";
  }
  return "classifier";
}

export function composeSpokenTextForTts(
  spokenText: string,
  wrapTags: readonly string[],
  inlineTags: readonly string[],
): string {
  const inline = inlineTags[0] ? ` ${inlineTags[0]}` : "";
  const body = `${spokenText}${inline}`.trim();
  const wrap = wrapTags[0];
  if (!wrap) {
    return body;
  }
  const name = wrap.replace(/^<|>$/g, "");
  return `<${name}>${body}</${name}>`;
}

export function freezeActorTurnPlan(plan: ActorTurnPlan): ActorTurnPlan {
  Object.freeze(plan.gestureClipIds);
  Object.freeze(plan.prosody.wrapTags);
  Object.freeze(plan.prosody.inlineTags);
  Object.freeze(plan.prosody.droppedTags);
  Object.freeze(plan.prosody);
  Object.freeze(plan.languageProvenance);
  Object.freeze(plan.notEvidenceFor);
  return Object.freeze(plan);
}

export function freezeActorTurnExecution(execution: ActorTurnExecution): ActorTurnExecution {
  Object.freeze(execution.interruption);
  Object.freeze(execution.renderedProsodyTags);
  Object.freeze(execution.droppedProsodyTags);
  Object.freeze(execution.fallback);
  return Object.freeze(execution);
}

/**
 * Classifier-owned eventKind + mapper-owned performance + model-owned language.
 * DeepSeek / model text never writes eventKind, face, pose, gesture, or tags.
 */
export function buildActorTurnPlan(input: BuildActorTurnPlanInput): ActorTurnPlan {
  const stripped = stripProviderMarkup(input.spokenText);
  const spokenText = stripped.cleanText;
  const profile = input.actor.communicationProfile;
  const intensityBucket = intensityBucketForProfile(profile?.intensity);
  const ageBand = ageBandForActor(input.actor);
  const dialogueEmotionTo = asDialogueEmotion(input.emotionTransition.to);
  const performance = mapEmotionPerformance({
    dialogueEmotion: dialogueEmotionTo,
    somaticEmotion: input.somaticEmotion,
    intensityBucket,
    ageBand,
    actorRole: input.actor.role,
    ...(profile?.styleFamily ? { styleFamily: profile.styleFamily } : {}),
    ...(profile?.style ? { style: profile.style } : {}),
  });
  const spokenTextForTts = composeSpokenTextForTts(
    spokenText,
    performance.prosody.wrapTags,
    performance.prosody.inlineTags,
  );
  const droppedTags = [...performance.prosody.droppedTags, ...stripped.droppedTags];

  return freezeActorTurnPlan({
    planId: `plan_${input.turnId}`,
    planVersion: 1,
    turnId: input.turnId,
    stationRunId: input.stationRunId,
    actorId: input.actor.actorId,
    respondingActorId: input.actor.actorId,
    turnIndex: input.turnIndex,
    spokenText,
    spokenTextForTts,
    dialogueEmotionFrom: asDialogueEmotion(input.emotionTransition.from),
    dialogueEmotionTo,
    somaticEmotion: input.somaticEmotion,
    eventKind: input.event.kind,
    eventKindSource: eventKindSourceForVerdict(input.event),
    intensityBucket,
    ageBand,
    performancePlanId: performance.performancePlanId,
    facePresetId: performance.facePresetId,
    posePresetId: performance.posePresetId,
    gestureClipIds: [...performance.gestureClipIds],
    prosody: {
      wrapTags: [...performance.prosody.wrapTags],
      inlineTags: [...performance.prosody.inlineTags],
      speed: performance.prosody.speed,
      droppedTags,
    },
    voiceId: defaultVoiceIdForActor(input.actor),
    languageProvenance: { ...input.languageProvenance },
    claimScope: ACTOR_TURN_PLAN_CLAIM_SCOPE,
    notEvidenceFor: [...ACTOR_TURN_PLAN_NOT_EVIDENCE_FOR],
  });
}

export function classifyLearnerEmotionEvent(input: {
  text: string;
  traceTags?: readonly string[];
  actorRole?: string;
  bargeIn?: boolean;
  silenceTimeout?: boolean;
}): EmotionEventClassifierVerdict {
  return classifyEmotionEventDetailed({
    text: input.text,
    ...(input.traceTags ? { traceTags: input.traceTags } : {}),
    ...(input.actorRole ? { actorRole: input.actorRole } : {}),
    ...(input.bargeIn !== undefined ? { bargeIn: input.bargeIn } : {}),
    ...(input.silenceTimeout !== undefined ? { silenceTimeout: input.silenceTimeout } : {}),
  });
}

export function executionFromFrozenPlan(
  plan: ActorTurnPlan,
  interruptionKind: ActorTurnExecution["interruption"]["kind"] = "none",
): ActorTurnExecution {
  return freezeActorTurnExecution({
    planId: plan.planId,
    turnId: plan.turnId,
    interruption: { kind: interruptionKind },
    renderedProsodyTags: [...plan.prosody.wrapTags, ...plan.prosody.inlineTags],
    droppedProsodyTags: [...plan.prosody.droppedTags],
    fallback: {
      language: plan.languageProvenance.fallbackUsed,
      tts: false,
    },
  });
}
