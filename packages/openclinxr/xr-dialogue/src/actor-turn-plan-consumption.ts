/**
 * Live UI-XR consumption of immutable ActorTurnPlan + append-only ActorTurnExecution.
 *
 * DVA-7 / DVA-8 seam. Join is planId+turnId. FACE follows plan.dialogueEmotionTo.
 * Captions follow plan.spokenText (never spokenTextForTts). Barge-in is
 * execution.interruption.kind and must not mutate the plan. Dropped-tag review
 * log is plan.prosody.droppedTags ∪ execution.droppedProsodyTags.
 *
 * DVA-6 execution schema has no timing / provider / audio / viseme fields —
 * report those gaps instead of inventing them.
 *
 * claimScope: simulated_actor_behavior.
 * notEvidenceFor: clinical affect inference, empathy scoring, licensure, Quest.
 */

import type { ActorTurnExecution, ActorTurnPlan, DialogueEmotion } from "@openclinxr/shared-schemas";

export const LIVE_ACTOR_TURN_CONSUMPTION_SEAM = "consumeLiveActorTurn";

export type UiXrExpressionEmotion = "neutral" | "anxious" | "concerned" | "reassured" | "pain";
export type UiXrExpressionWeights = {
  mouthOpen: number;
  browConcern: number;
  cheekTension: number;
};

export type ActorTurnJoinKey = `${string}::${string}`;

export type ActorTurnSchemaGap = {
  field: string;
  reason: "absent_from_dva6_execution_schema" | "execution_join_mismatch" | "plan_missing" | "dialogue_emotion_to_unrepresentable";
};

export type ActorTurnVisualGap = {
  surface: "lip_sync" | "audible_tts" | "face_preset_mesh";
  reason: string;
};

export type LiveActorTurnConsumption = {
  seam: typeof LIVE_ACTOR_TURN_CONSUMPTION_SEAM;
  joinKey: ActorTurnJoinKey;
  plan: ActorTurnPlan;
  execution: ActorTurnExecution | null;
  executionApplied: boolean;
  faceEmotion: DialogueEmotion;
  faceWeights: UiXrExpressionWeights;
  faceSource: "plan.dialogueEmotionTo";
  caption: string;
  captionSource: "plan.spokenText";
  bargeInKind: ActorTurnExecution["interruption"]["kind"];
  bargeInSource: "execution.interruption.kind";
  droppedTagLog: readonly string[];
  schemaGaps: readonly ActorTurnSchemaGap[];
  visualGaps: readonly ActorTurnVisualGap[];
  claimScope: "simulated_actor_behavior";
  notEvidenceFor: readonly string[];
};

const DIALOGUE_EMOTIONS = new Set<DialogueEmotion>(["anxious", "concerned", "reassured", "neutral"]);
const INTERRUPTION_KINDS = new Set<ActorTurnExecution["interruption"]["kind"]>([
  "none",
  "truncated",
  "replaced",
]);

/** known-good: apps/ui-xr/src/main.ts:8870 weight table, extracted so the live path can import it. */
const EXPRESSION_WEIGHTS: Record<UiXrExpressionEmotion, UiXrExpressionWeights> = {
  neutral: { mouthOpen: 0.04, browConcern: 0.08, cheekTension: 0.08 },
  anxious: { mouthOpen: 0.18, browConcern: 0.62, cheekTension: 0.48 },
  concerned: { mouthOpen: 0.12, browConcern: 0.72, cheekTension: 0.36 },
  reassured: { mouthOpen: 0.08, browConcern: 0.18, cheekTension: 0.18 },
  pain: { mouthOpen: 0.34, browConcern: 0.86, cheekTension: 0.72 },
};

export const DVA6_EXECUTION_SCHEMA_GAPS: readonly ActorTurnSchemaGap[] = [
  { field: "audioStartedAtMs", reason: "absent_from_dva6_execution_schema" },
  { field: "ttsProviderId", reason: "absent_from_dva6_execution_schema" },
  { field: "audioUri", reason: "absent_from_dva6_execution_schema" },
  { field: "visemeTimeline", reason: "absent_from_dva6_execution_schema" },
];

const byJoin = new Map<ActorTurnJoinKey, { plan: ActorTurnPlan; execution: ActorTurnExecution | null }>();
const joinByTraceTag = new Map<string, ActorTurnJoinKey>();

export function actorTurnJoinKey(planId: string, turnId: string): ActorTurnJoinKey {
  return `${planId}::${turnId}`;
}

export function expressionWeightsForEmotion(emotion: UiXrExpressionEmotion): UiXrExpressionWeights {
  return EXPRESSION_WEIGHTS[emotion];
}

/**
 * Fixture-only keyword heuristic. Live UI-XR must not call this.
 * Speak-fixture / unit tests may still assert what the old path would have picked.
 */
export function emotionForDialogueText(text: string): UiXrExpressionEmotion {
  const spoken = text.toLowerCase();
  if (/pain|crushing|tight|pressure|hurts|can't breathe|short of breath/u.test(spoken)) return "pain";
  if (/worried|scared|urgent|anxious|need to know|what does this mean|could be his heart/u.test(spoken)) {
    return "anxious";
  }
  if (/concern|include us|please|help|support/u.test(spoken)) return "concerned";
  if (/thank|better|reassur|understand|okay/u.test(spoken)) return "reassured";
  return "neutral";
}

export function consumeLiveActorTurn(
  plan: ActorTurnPlan,
  execution: ActorTurnExecution | null,
): LiveActorTurnConsumption {
  const joinKey = actorTurnJoinKey(plan.planId, plan.turnId);
  const schemaGaps: ActorTurnSchemaGap[] = [...DVA6_EXECUTION_SCHEMA_GAPS];
  const executionMatches = Boolean(
    execution && execution.planId === plan.planId && execution.turnId === plan.turnId,
  );
  if (execution && !executionMatches) {
    schemaGaps.push({ field: "execution.join", reason: "execution_join_mismatch" });
  }
  const appliedExecution = executionMatches ? execution : null;
  const faceEmotion = liveFaceEmotionFromPlan(plan);
  if (!DIALOGUE_EMOTIONS.has(plan.dialogueEmotionTo as DialogueEmotion)) {
    schemaGaps.push({ field: "dialogueEmotionTo", reason: "dialogue_emotion_to_unrepresentable" });
  }
  return {
    seam: LIVE_ACTOR_TURN_CONSUMPTION_SEAM,
    joinKey,
    plan,
    execution: appliedExecution,
    executionApplied: appliedExecution !== null,
    faceEmotion,
    faceWeights: expressionWeightsForEmotion(faceEmotion),
    faceSource: "plan.dialogueEmotionTo",
    caption: plan.spokenText,
    captionSource: "plan.spokenText",
    bargeInKind: appliedExecution?.interruption.kind ?? "none",
    bargeInSource: "execution.interruption.kind",
    droppedTagLog: liveDroppedTagLog(plan, appliedExecution),
    schemaGaps,
    visualGaps: [
      { surface: "lip_sync", reason: "execution_has_no_viseme_timeline" },
      { surface: "audible_tts", reason: "execution_has_no_audio_uri" },
      {
        surface: "face_preset_mesh",
        reason: "live_weights_follow_dialogueEmotionTo_not_facePresetId",
      },
    ],
    claimScope: "simulated_actor_behavior",
    notEvidenceFor: [...plan.notEvidenceFor],
  };
}

export function liveFaceEmotionFromPlan(plan: ActorTurnPlan): DialogueEmotion {
  return DIALOGUE_EMOTIONS.has(plan.dialogueEmotionTo) ? plan.dialogueEmotionTo : "neutral";
}

export function liveCaptionFromPlan(plan: ActorTurnPlan): string {
  return plan.spokenText;
}

export function liveDroppedTagLog(
  plan: ActorTurnPlan,
  execution: ActorTurnExecution | null | undefined,
): readonly string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const tag of [...plan.prosody.droppedTags, ...(execution?.droppedProsodyTags ?? [])]) {
    if (seen.has(tag)) continue;
    seen.add(tag);
    out.push(tag);
  }
  return out;
}

export function liveActorTurnFromPayload(
  payload: Record<string, unknown> | undefined,
): { plan: ActorTurnPlan; execution: ActorTurnExecution | null } | undefined {
  if (!payload) {
    return undefined;
  }
  const plan = parseActorTurnPlan(payload["actorTurnPlan"]);
  if (!plan) {
    return undefined;
  }
  const execution = parseActorTurnExecution(payload["actorTurnExecution"]);
  return { plan, execution: execution ?? null };
}

export function registerLiveActorTurn(
  plan: ActorTurnPlan,
  execution: ActorTurnExecution | null,
  traceTag?: string,
): LiveActorTurnConsumption {
  const consumed = consumeLiveActorTurn(plan, execution);
  byJoin.set(consumed.joinKey, { plan, execution: consumed.execution });
  if (traceTag) {
    joinByTraceTag.set(traceTag, consumed.joinKey);
  }
  return consumed;
}

export function resolveLiveActorTurnForTrace(traceTag: string): LiveActorTurnConsumption | undefined {
  const joinKey = joinByTraceTag.get(traceTag);
  if (!joinKey) {
    return undefined;
  }
  const stored = byJoin.get(joinKey);
  if (!stored) {
    return undefined;
  }
  return consumeLiveActorTurn(stored.plan, stored.execution);
}

export function resetLiveActorTurnRegistry(): void {
  byJoin.clear();
  joinByTraceTag.clear();
}

function parseActorTurnPlan(value: unknown): ActorTurnPlan | undefined {
  if (!isRecord(value)) {
    return undefined;
  }
  if (
    !isNonEmptyString(value["planId"])
    || !isNonEmptyString(value["turnId"])
    || typeof value["spokenText"] !== "string"
    || typeof value["spokenTextForTts"] !== "string"
    || !DIALOGUE_EMOTIONS.has(value["dialogueEmotionTo"] as DialogueEmotion)
    || !isRecord(value["prosody"])
    || !Array.isArray(value["prosody"]["droppedTags"])
    || !Array.isArray(value["notEvidenceFor"])
  ) {
    return undefined;
  }
  return value as ActorTurnPlan;
}

function parseActorTurnExecution(value: unknown): ActorTurnExecution | undefined {
  if (!isRecord(value)) {
    return undefined;
  }
  const interruption = value["interruption"];
  if (
    !isNonEmptyString(value["planId"])
    || !isNonEmptyString(value["turnId"])
    || !isRecord(interruption)
    || !INTERRUPTION_KINDS.has(interruption["kind"] as ActorTurnExecution["interruption"]["kind"])
    || !Array.isArray(value["droppedProsodyTags"])
  ) {
    return undefined;
  }
  return value as ActorTurnExecution;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}
