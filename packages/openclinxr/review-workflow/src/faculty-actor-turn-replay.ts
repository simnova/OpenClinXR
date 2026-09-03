import type { ActorTurnExecution, ActorTurnPlan } from "@openclinxr/shared-schemas";

/**
 * Faculty replay of one actor turn. Plan is committed intent; execution is what
 * rendered. They stay distinct records — barge-in must not rewrite the plan.
 *
 * Payload contract for DVA-6 / DVA-7:
 *   payload.actorTurnPlan: ActorTurnPlan
 *   payload.actorTurnExecution: ActorTurnExecution
 *   join key: planId + turnId
 *   captions: plan.spokenText (never spokenTextForTts)
 *   dropped-tag log: plan.prosody.droppedTags ∪ execution.droppedProsodyTags
 *   prosodyNeutralized: signed artifact missing/expired, or explicit flag
 */
export type FacultyActorTurnReplay = {
  turnId: string;
  planId: string;
  plan: ActorTurnPlan;
  execution: ActorTurnExecution | null;
  droppedTagLog: readonly string[];
  caption: string;
  prosodyNeutralized: boolean;
  claimScope: "simulated_actor_behavior";
  notEvidenceFor: readonly string[];
};

const DIALOGUE_EMOTIONS = new Set(["anxious", "concerned", "reassured", "neutral"]);
const EVENT_KINDS = new Set([
  "learner_empathetic",
  "learner_dismissive",
  "learner_interruption",
  "actor_silence_timeout",
  "learner_acknowledgement",
  "learner_clinical_question",
  "learner_personal_question",
  "learner_unclassified",
]);
const EVENT_KIND_SOURCES = new Set(["classifier", "touch", "timeout", "barge_in"]);
const INTENSITY = new Set(["low", "mid", "high"]);
const AGE_BANDS = new Set(["child", "adolescent", "adult", "adult-parent"]);
const INTERRUPTION_KINDS = new Set(["none", "truncated", "replaced"]);

export function actorTurnPlanFromPayload(
  payload: Record<string, unknown> | undefined,
): ActorTurnPlan | undefined {
  return parseActorTurnPlan(payload?.["actorTurnPlan"]);
}

export function actorTurnExecutionFromPayload(
  payload: Record<string, unknown> | undefined,
): ActorTurnExecution | undefined {
  return parseActorTurnExecution(payload?.["actorTurnExecution"]);
}

export function extractFacultyActorTurnReplays(
  events: readonly { payload?: Record<string, unknown> }[],
): FacultyActorTurnReplay[] {
  const plans = new Map<string, ActorTurnPlan>();
  const executions = new Map<string, ActorTurnExecution>();
  const neutralized = new Set<string>();

  for (const event of events) {
    const plan = actorTurnPlanFromPayload(event.payload);
    if (plan) {
      plans.set(replayKey(plan.planId, plan.turnId), plan);
    }
    const execution = actorTurnExecutionFromPayload(event.payload);
    if (execution) {
      executions.set(replayKey(execution.planId, execution.turnId), execution);
    }
    const key = neutralizationKey(event.payload, plan, execution);
    if (key && isProsodyNeutralized(event.payload)) {
      neutralized.add(key);
    }
  }

  return [...plans.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, plan]) => {
      const execution = executions.get(key) ?? null;
      const { caption, extraDropped } = captionFromPlan(plan);
      const droppedTagLog = uniquePreserve([
        ...plan.prosody.droppedTags,
        ...(execution?.droppedProsodyTags ?? []),
        ...extraDropped,
      ]);
      return {
        turnId: plan.turnId,
        planId: plan.planId,
        plan,
        execution,
        droppedTagLog,
        caption,
        prosodyNeutralized: neutralized.has(key),
        claimScope: "simulated_actor_behavior",
        notEvidenceFor: [...plan.notEvidenceFor],
      };
    });
}

export function facultyCaptionForPlan(plan: ActorTurnPlan): string {
  return captionFromPlan(plan).caption;
}

export function facultyDroppedTagLog(
  plan: ActorTurnPlan,
  execution: ActorTurnExecution | null | undefined,
): readonly string[] {
  const extraDropped = captionFromPlan(plan).extraDropped;
  return uniquePreserve([
    ...plan.prosody.droppedTags,
    ...(execution?.droppedProsodyTags ?? []),
    ...extraDropped,
  ]);
}

export function prosodyNeutralizedFromPayload(
  payload: Record<string, unknown> | undefined,
): boolean {
  return isProsodyNeutralized(payload);
}

export function summarizeActorTurnPlan(plan: ActorTurnPlan, caption: string, droppedTagLog: readonly string[]): string {
  return [
    `ActorTurnPlan ${plan.planId}`,
    `turn ${plan.turnId}`,
    `caption ${caption}`,
    droppedTagLog.length > 0 ? `dropped-tag log ${droppedTagLog.join(",")}` : "dropped-tag log none",
    `claimScope ${plan.claimScope}`,
  ].join("; ");
}

export function summarizeActorTurnExecution(
  execution: ActorTurnExecution,
  prosodyNeutralized: boolean,
): string {
  return [
    `ActorTurnExecution ${execution.planId}`,
    `turn ${execution.turnId}`,
    `interruption ${execution.interruption.kind}`,
    execution.droppedProsodyTags.length > 0
      ? `dropped-tag log ${execution.droppedProsodyTags.join(",")}`
      : "dropped-tag log none",
    prosodyNeutralized ? "prosody neutralized" : "prosody rendered",
  ].join("; ");
}

function parseActorTurnPlan(value: unknown): ActorTurnPlan | undefined {
  if (!isRecord(value)) {
    return undefined;
  }
  if (!isNonEmptyString(value["planId"])
    || !isPositiveInt(value["planVersion"])
    || !isNonEmptyString(value["turnId"])
    || !isNonEmptyString(value["stationRunId"])
    || !isNonEmptyString(value["actorId"])
    || !isNonEmptyString(value["respondingActorId"])
    || !isNonNegativeInt(value["turnIndex"])
    || typeof value["spokenText"] !== "string"
    || typeof value["spokenTextForTts"] !== "string"
    || !isMember(value["dialogueEmotionFrom"], DIALOGUE_EMOTIONS)
    || !isMember(value["dialogueEmotionTo"], DIALOGUE_EMOTIONS)
    || !isSomatic(value["somaticEmotion"])
    || !isMember(value["eventKind"], EVENT_KINDS)
    || !isMember(value["eventKindSource"], EVENT_KIND_SOURCES)
    || !isMember(value["intensityBucket"], INTENSITY)
    || !isMember(value["ageBand"], AGE_BANDS)
    || !isNonEmptyString(value["performancePlanId"])
    || !isNonEmptyString(value["facePresetId"])
    || !isNonEmptyString(value["posePresetId"])
    || !isStringArray(value["gestureClipIds"])
    || !isProsody(value["prosody"])
    || !isNonEmptyString(value["voiceId"])
    || !isLanguageProvenance(value["languageProvenance"])
    || value["claimScope"] !== "simulated_actor_behavior"
    || !isNonEmptyStringArray(value["notEvidenceFor"])) {
    return undefined;
  }
  return value as ActorTurnPlan;
}

function parseActorTurnExecution(value: unknown): ActorTurnExecution | undefined {
  if (!isRecord(value)) {
    return undefined;
  }
  const interruption = value["interruption"];
  if (!isNonEmptyString(value["planId"])
    || !isNonEmptyString(value["turnId"])
    || !isRecord(interruption)
    || !isMember(interruption["kind"], INTERRUPTION_KINDS)
    || !isStringArray(value["renderedProsodyTags"])
    || !isStringArray(value["droppedProsodyTags"])
    || !isFallback(value["fallback"])) {
    return undefined;
  }
  return value as ActorTurnExecution;
}

function captionFromPlan(plan: ActorTurnPlan): { caption: string; extraDropped: string[] } {
  const candidateTags = uniquePreserve([
    ...plan.prosody.wrapTags,
    ...plan.prosody.inlineTags,
    ...plan.prosody.droppedTags,
  ]);
  let caption = plan.spokenText;
  const extraDropped: string[] = [];
  for (const tag of candidateTags) {
    if (!caption.includes(tag)) {
      continue;
    }
    caption = caption.split(tag).join(" ");
    extraDropped.push(tag);
    const close = wrapCloseTag(tag);
    if (close && caption.includes(close)) {
      caption = caption.split(close).join(" ");
    }
  }
  return { caption: caption.replace(/\s{2,}/g, " ").trim(), extraDropped };
}

function wrapCloseTag(tag: string): string | undefined {
  const match = /^<([a-z][a-z-]*)>$/i.exec(tag);
  return match ? `</${match[1]}>` : undefined;
}

function isProsodyNeutralized(payload: Record<string, unknown> | undefined): boolean {
  if (!payload) {
    return false;
  }
  if (payload["prosodyNeutralized"] === true) {
    return true;
  }
  const artifact = payload["prosodyReviewArtifact"];
  if (isRecord(artifact)) {
    const status = artifact["status"];
    if (status === "missing" || status === "expired") {
      return true;
    }
  }
  const blockers = payload["blockers"];
  return Array.isArray(blockers) && blockers.includes("emotional_prosody_policy_review_missing");
}

function neutralizationKey(
  payload: Record<string, unknown> | undefined,
  plan: ActorTurnPlan | undefined,
  execution: ActorTurnExecution | undefined,
): string | undefined {
  if (plan) {
    return replayKey(plan.planId, plan.turnId);
  }
  if (execution) {
    return replayKey(execution.planId, execution.turnId);
  }
  const planId = typeof payload?.["planId"] === "string" ? payload["planId"] : undefined;
  const turnId = typeof payload?.["turnId"] === "string" ? payload["turnId"] : undefined;
  if (planId && turnId) {
    return replayKey(planId, turnId);
  }
  return undefined;
}

function replayKey(planId: string, turnId: string): string {
  return `${planId}::${turnId}`;
}

function uniquePreserve(items: readonly string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of items) {
    if (!item || seen.has(item)) {
      continue;
    }
    seen.add(item);
    out.push(item);
  }
  return out;
}

function isProsody(value: unknown): value is ActorTurnPlan["prosody"] {
  if (!isRecord(value)) {
    return false;
  }
  const speed = value["speed"];
  return isStringArray(value["wrapTags"])
    && isStringArray(value["inlineTags"])
    && typeof speed === "number"
    && speed >= 0.7
    && speed <= 1.5
    && isStringArray(value["droppedTags"]);
}

function isLanguageProvenance(value: unknown): boolean {
  return isRecord(value)
    && typeof value["fallbackUsed"] === "boolean"
    && (value["providerId"] === undefined || typeof value["providerId"] === "string");
}

function isFallback(value: unknown): boolean {
  return isRecord(value)
    && typeof value["language"] === "boolean"
    && typeof value["tts"] === "boolean";
}

function isSomatic(value: unknown): boolean {
  return value === null || value === "pain";
}

function isMember(value: unknown, allowed: ReadonlySet<string>): value is string {
  return typeof value === "string" && allowed.has(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isPositiveInt(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 1;
}

function isNonNegativeInt(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function isNonEmptyStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.length > 0 && value.every((item) => isNonEmptyString(item));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
