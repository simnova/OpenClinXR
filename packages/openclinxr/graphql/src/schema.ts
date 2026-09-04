import { defaultFieldResolver, type GraphQLFieldResolver } from "graphql";

export { openClinXrAdminSchemaSdl } from "./generated/schema.generated.js";

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
const INTERRUPTION_KINDS = new Set(["none", "truncated", "replaced"]);
const PRIVATE_KEYS = new Set([
  "hiddenFacts",
  "privateFacts",
  "hiddenFactRefs",
  "serverOnlyNotes",
  "hiddenFact",
  "confidentialNote",
]);
const PROVIDER_MARKUP = /<\/?[a-z][a-z0-9-]*\s*\/?>|\[[a-z][a-z0-9-]*\]/gi;
export const REVIEW_PACKET_ACTOR_TURN_CLAIM_SCOPE = "simulated_actor_behavior" as const;

export type ReviewPacketActorTurnGraphql = {
  plan: {
    planId: string;
    spokenText: string;
    dialogueEmotionFrom: string;
    dialogueEmotionTo: string;
    performancePlanId: string;
    facePresetId: string;
    eventKind: string;
    droppedTags: string[];
    claimScope: typeof REVIEW_PACKET_ACTOR_TURN_CLAIM_SCOPE;
  };
  execution: {
    planId: string;
    truncated: boolean;
    visemeCueCount: number;
    ttsProviderId: string;
    interruptionKind: string;
  };
};

export type ReviewPacketEmotionalTimelineGraphql = {
  turnIndex?: number;
  actorId?: string;
  from: string;
  to: string;
  trigger?: string;
  planId?: string;
  atSecond?: number;
};

export type ReviewPacketActorTurnLayers = {
  actorTurns: ReviewPacketActorTurnGraphql[];
  emotionalTimeline: ReviewPacketEmotionalTimelineGraphql[];
  prosodyNeutralized: boolean;
};

export function projectReviewPacketActorTurnLayers(source: unknown): ReviewPacketActorTurnLayers {
  const packet = isRecord(source) ? source : {};
  const actorTurns = projectActorTurns(packet);
  return {
    actorTurns,
    emotionalTimeline: projectEmotionalTimeline(packet),
    prosodyNeutralized: projectProsodyNeutralized(packet),
  };
}

export const adminGraphqlFieldResolver: GraphQLFieldResolver<unknown, unknown> = (
  source,
  args,
  context,
  info,
) => {
  if (info.parentType.name === "ReviewPacket") {
    const layers = projectReviewPacketActorTurnLayers(source);
    if (info.fieldName === "actorTurns") {
      return layers.actorTurns;
    }
    if (info.fieldName === "emotionalTimeline") {
      return layers.emotionalTimeline;
    }
    if (info.fieldName === "prosodyNeutralized") {
      return layers.prosodyNeutralized;
    }
  }
  return defaultFieldResolver(source, args, context, info);
};

function projectActorTurns(packet: Record<string, unknown>): ReviewPacketActorTurnGraphql[] {
  const actorTurns = read(packet, "actorTurns");
  if (Array.isArray(actorTurns)) {
    return actorTurns
      .map((turn) => projectActorTurn(turn))
      .filter((turn): turn is ReviewPacketActorTurnGraphql => Boolean(turn));
  }
  const actorTurnReplays = read(packet, "actorTurnReplays");
  if (Array.isArray(actorTurnReplays)) {
    return actorTurnReplays
      .map((turn) => projectActorTurn(turn))
      .filter((turn): turn is ReviewPacketActorTurnGraphql => Boolean(turn));
  }
  const turns = read(packet, "turns");
  if (Array.isArray(turns)) {
    return turns
      .map((turn) => projectActorTurnFromExecutionRecord(turn))
      .filter((turn): turn is ReviewPacketActorTurnGraphql => Boolean(turn));
  }
  return [];
}

function projectActorTurn(value: unknown): ReviewPacketActorTurnGraphql | undefined {
  if (!isRecord(value)) {
    return undefined;
  }
  const planValue = read(value, "plan");
  if (isRecord(planValue)) {
    const planRecord = stripPrivate(planValue);
    const executionValue = read(value, "execution");
    const executionRecord = isRecord(executionValue) ? stripPrivate(executionValue) : {};
    const droppedTags = stringArray(
      read(value, "droppedTags")
        ?? read(value, "droppedTagLog")
        ?? read(planRecord, "droppedTags")
        ?? nestedDroppedTags(planRecord),
    );
    const planId = nonEmptyString(read(planRecord, "planId"));
    const spokenTextRaw = read(planRecord, "spokenText");
    const spokenText = markupFreeSpokenText(typeof spokenTextRaw === "string" ? spokenTextRaw : "");
    const dialogueEmotionFrom = dialogueEmotion(read(planRecord, "dialogueEmotionFrom"));
    const dialogueEmotionTo = dialogueEmotion(read(planRecord, "dialogueEmotionTo"));
    const performancePlanId = nonEmptyString(read(planRecord, "performancePlanId"));
    const facePresetId = nonEmptyString(read(planRecord, "facePresetId"));
    const eventKind = eventKindValue(read(planRecord, "eventKind"));
    if (!planId || !dialogueEmotionFrom || !dialogueEmotionTo || !performancePlanId || !facePresetId || !eventKind) {
      return undefined;
    }
    const interruptionValue = read(executionRecord, "interruption");
    const interruptionKind = interruptionKindValue(
      read(executionRecord, "interruptionKind")
        ?? (isRecord(interruptionValue) ? read(interruptionValue, "kind") : undefined),
    );
    const visemeCueCount = visemeCount(executionRecord);
    const ttsProviderId = ttsProvider(executionRecord, planRecord);
    return {
      plan: {
        planId,
        spokenText,
        dialogueEmotionFrom,
        dialogueEmotionTo,
        performancePlanId,
        facePresetId,
        eventKind,
        droppedTags,
        claimScope: REVIEW_PACKET_ACTOR_TURN_CLAIM_SCOPE,
      },
      execution: {
        planId: nonEmptyString(read(executionRecord, "planId")) ?? planId,
        truncated: read(executionRecord, "truncated") === true || interruptionKind === "truncated",
        visemeCueCount,
        ttsProviderId,
        interruptionKind,
      },
    };
  }
  return projectActorTurnFromExecutionRecord(value);
}

function projectActorTurnFromExecutionRecord(value: unknown): ReviewPacketActorTurnGraphql | undefined {
  if (!isRecord(value)) {
    return undefined;
  }
  const record = stripPrivate(value);
  const planId = nonEmptyString(read(record, "planId"));
  const spokenTextRaw = read(record, "spokenText");
  const spokenText = markupFreeSpokenText(typeof spokenTextRaw === "string" ? spokenTextRaw : "");
  const dialogueEmotionFrom = dialogueEmotion(read(record, "dialogueEmotionFrom"));
  const dialogueEmotionTo = dialogueEmotion(read(record, "dialogueEmotionTo"));
  const performancePlanId = nonEmptyString(read(record, "performancePlanId"));
  const facePresetId = nonEmptyString(read(record, "facePresetId")) ?? performancePlanId;
  const eventKind = eventKindValue(read(record, "eventKind")) ?? "learner_unclassified";
  if (!planId || !dialogueEmotionFrom || !dialogueEmotionTo || !performancePlanId || !facePresetId) {
    return undefined;
  }
  const interruptionKind = interruptionKindValue(read(record, "interruptionKind"));
  return {
    plan: {
      planId,
      spokenText,
      dialogueEmotionFrom,
      dialogueEmotionTo,
      performancePlanId,
      facePresetId,
      eventKind,
      droppedTags: stringArray(read(record, "droppedTags")),
      claimScope: REVIEW_PACKET_ACTOR_TURN_CLAIM_SCOPE,
    },
    execution: {
      planId,
      truncated: read(record, "truncated") === true || interruptionKind === "truncated",
      visemeCueCount: visemeCount(record),
      ttsProviderId: ttsProvider(record, record),
      interruptionKind,
    },
  };
}

function projectEmotionalTimeline(packet: Record<string, unknown>): ReviewPacketEmotionalTimelineGraphql[] {
  const raw = read(packet, "emotionalTimeline");
  const entries = Array.isArray(raw) ? raw : [];
  return entries
    .map((entry) => {
      if (!isRecord(entry)) {
        return undefined;
      }
      const fromValue = read(entry, "from");
      const toValue = read(entry, "to");
      const from = typeof fromValue === "string" ? fromValue : "";
      const to = typeof toValue === "string" ? toValue : "";
      if (!from || !to || to === "pain") {
        return undefined;
      }
      const projected: ReviewPacketEmotionalTimelineGraphql = { from, to };
      const turnIndex = read(entry, "turnIndex");
      if (typeof turnIndex === "number") {
        projected.turnIndex = turnIndex;
      }
      const actorId = read(entry, "actorId");
      if (typeof actorId === "string") {
        projected.actorId = actorId;
      }
      const trigger = read(entry, "trigger");
      if (typeof trigger === "string") {
        projected.trigger = trigger;
      }
      const planId = read(entry, "planId");
      if (typeof planId === "string") {
        projected.planId = planId;
      }
      const atSecond = read(entry, "atSecond");
      if (typeof atSecond === "number") {
        projected.atSecond = atSecond;
      }
      return projected;
    })
    .filter((entry): entry is ReviewPacketEmotionalTimelineGraphql => Boolean(entry))
    .sort((left, right) => {
      const leftOrder = left.atSecond ?? left.turnIndex ?? Number.MAX_SAFE_INTEGER;
      const rightOrder = right.atSecond ?? right.turnIndex ?? Number.MAX_SAFE_INTEGER;
      return leftOrder - rightOrder;
    });
}

function projectProsodyNeutralized(packet: Record<string, unknown>): boolean {
  if (read(packet, "prosodyNeutralized") === true) {
    return true;
  }
  for (const key of ["actorTurnReplays", "turns", "actorTurns"]) {
    const rows = read(packet, key);
    if (Array.isArray(rows) && rows.some((turn) => isRecord(turn) && read(turn, "prosodyNeutralized") === true)) {
      return true;
    }
  }
  return false;
}

function nestedDroppedTags(plan: Record<string, unknown>): unknown {
  const prosody = read(plan, "prosody");
  return isRecord(prosody) ? read(prosody, "droppedTags") : [];
}

function visemeCount(execution: Record<string, unknown>): number {
  const count = read(execution, "visemeCueCount");
  if (typeof count === "number" && Number.isInteger(count) && count >= 0) {
    return count;
  }
  const cues = read(execution, "visemeCues");
  if (Array.isArray(cues)) {
    return cues.length;
  }
  return 0;
}

function ttsProvider(execution: Record<string, unknown>, plan: Record<string, unknown>): string {
  const fromExecution = nonEmptyString(read(execution, "ttsProviderId"));
  if (fromExecution) {
    return fromExecution;
  }
  const provenanceValue = read(plan, "languageProvenance");
  const provenance = isRecord(provenanceValue) ? provenanceValue : {};
  return nonEmptyString(read(provenance, "providerId")) ?? nonEmptyString(read(plan, "voiceId")) ?? "local-fixture";
}

function markupFreeSpokenText(text: string): string {
  return text.replace(PROVIDER_MARKUP, " ").replace(/\s{2,}/g, " ").trim();
}

function dialogueEmotion(value: unknown): string | undefined {
  return typeof value === "string" && DIALOGUE_EMOTIONS.has(value) ? value : undefined;
}

function eventKindValue(value: unknown): string | undefined {
  return typeof value === "string" && EVENT_KINDS.has(value) ? value : undefined;
}

function interruptionKindValue(value: unknown): string {
  return typeof value === "string" && INTERRUPTION_KINDS.has(value) ? value : "none";
}

function stripPrivate(value: Record<string, unknown>): Record<string, unknown> {
  const next: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (PRIVATE_KEYS.has(key)) {
      continue;
    }
    next[key] = isRecord(entry) ? stripPrivate(entry) : entry;
  }
  return next;
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string" && item.length > 0) : [];
}

function nonEmptyString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function read(record: Record<string, unknown>, key: string): unknown {
  return record[key];
}
