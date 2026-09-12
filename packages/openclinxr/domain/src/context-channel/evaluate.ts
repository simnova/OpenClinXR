/**
 * Case-defined context channels (internal). Not on the package entrypoint.
 *
 * A case may author chart-fragment, ems-handoff, nurse-whisper, vital-stream, and
 * doorway channels. Availability is timing + phase. Hidden truth and reviewer-only
 * context fail closed and never become learner-visible.
 */

export const CONTEXT_CHANNEL_KINDS = [
  "chart-fragment",
  "ems-handoff",
  "nurse-whisper",
  "vital-stream",
  "doorway",
] as const;

export type ContextChannelKind = (typeof CONTEXT_CHANNEL_KINDS)[number];
export type ContextChannelModality = "viewed" | "heard";
export type ContextChannelAudience = "learner" | "reviewer";
export type ContextChannelPhase = "doorway" | "encounter" | "note" | "review";

export const CONTEXT_CHANNEL_CLAIM_SCOPE = "case_defined_context_channel" as const;

export const CONTEXT_CHANNEL_NOT_EVIDENCE_FOR = [
  "exam_equivalence",
  "clinical_validity",
  "scoring_validity",
  "assessment_validity",
  "learner_readiness",
  "quest_readiness",
  "production_deployment",
] as const;

export type AuthoredContextChannel = {
  channelId: string;
  kind: ContextChannelKind;
  audience: ContextChannelAudience;
  opensAtSecond: number;
  closesAtSecond?: number;
  availableInPhases?: readonly ContextChannelPhase[];
  modality: ContextChannelModality;
  carriesHiddenTruth?: boolean;
  hiddenTruthFingerprint?: string;
  scenarioId?: string;
  content: Readonly<Record<string, string>>;
};

export type AvailableContextChannel = {
  channelId: string;
  kind: ContextChannelKind;
  modality: ContextChannelModality;
  opensAtSecond: number;
  closesAtSecond?: number;
  content: Readonly<Record<string, string>>;
};

const KIND_SET = new Set<string>(CONTEXT_CHANNEL_KINDS);
const MODALITY_SET = new Set<string>(["viewed", "heard"]);
const AUDIENCE_SET = new Set<string>(["learner", "reviewer"]);
const PHASE_SET = new Set<string>(["doorway", "encounter", "note", "review"]);

export function hiddenFactsFromCase(scenario: { actors?: readonly { hiddenFacts?: readonly string[] }[] }): string[] {
  const facts: string[] = [];
  for (const actor of scenario.actors ?? []) {
    for (const fact of actor.hiddenFacts ?? []) {
      if (fact.trim().length > 0) {
        facts.push(fact);
      }
    }
  }
  return facts;
}

export function hiddenTruthFingerprintFromFacts(hiddenFacts: readonly string[]): string {
  return [...hiddenFacts].sort().join("\n");
}

export function authoredContextChannelsFromCase(scenario: {
  scenarioId: string;
  contextChannels?: unknown;
  actors?: readonly { hiddenFacts?: readonly string[] }[];
}): readonly AuthoredContextChannel[] {
  const raw = (scenario as { contextChannels?: unknown }).contextChannels;
  if (raw === undefined) {
    return Object.freeze([]);
  }
  if (!Array.isArray(raw)) {
    throw new Error("contextChannels must be an array");
  }
  const hiddenFacts = hiddenFactsFromCase(scenario);
  const caseFingerprint = hiddenTruthFingerprintFromFacts(hiddenFacts);
  const parsed = raw.map((entry, index) => parseAuthoredChannel(entry, index, scenario.scenarioId, caseFingerprint));
  return Object.freeze(parsed);
}

export function availableContextChannelsAt(input: {
  channels: readonly AuthoredContextChannel[];
  phase: ContextChannelPhase;
  atSecond: number;
  hiddenFacts: readonly string[];
  scenarioId: string;
}): readonly AvailableContextChannel[] {
  const caseFingerprint = hiddenTruthFingerprintFromFacts(input.hiddenFacts);
  const available: AvailableContextChannel[] = [];
  for (const channel of input.channels) {
    refuseMalformedIdentity(channel, input.scenarioId, caseFingerprint);
    if (!channelIsLearnerSafe(channel, input.hiddenFacts)) {
      continue;
    }
    if (!channelIsOpen(channel, input.phase, input.atSecond)) {
      continue;
    }
    available.push(freezeAvailable(channel));
  }
  return Object.freeze(available);
}

export function requireAcknowledgeableChannel(input: {
  channels: readonly AuthoredContextChannel[];
  channelId: string;
  modality: ContextChannelModality;
  phase: ContextChannelPhase;
  atSecond: number;
  hiddenFacts: readonly string[];
  scenarioId: string;
}): AuthoredContextChannel {
  const authored = input.channels.find((channel) => channel.channelId === input.channelId);
  if (!authored) {
    throw new Error("stale context-channel identity");
  }
  const caseFingerprint = hiddenTruthFingerprintFromFacts(input.hiddenFacts);
  refuseMalformedIdentity(authored, input.scenarioId, caseFingerprint);
  if (authored.audience === "reviewer") {
    throw new Error("reviewer-only context cannot reach the learner");
  }
  if (channelCarriesHiddenTruth(authored, input.hiddenFacts)) {
    throw new Error("hidden truth cannot reach the learner");
  }
  if (!channelIsOpen(authored, input.phase, input.atSecond)) {
    throw new Error("context channel is not available");
  }
  if (authored.modality !== input.modality) {
    throw new Error("context channel modality mismatch");
  }
  return authored;
}

function refuseMalformedIdentity(
  channel: AuthoredContextChannel,
  scenarioId: string,
  caseFingerprint: string,
): void {
  if (channel.scenarioId !== undefined && channel.scenarioId !== scenarioId) {
    throw new Error("stale context-channel identity");
  }
  if (channel.hiddenTruthFingerprint !== undefined && channel.hiddenTruthFingerprint !== caseFingerprint) {
    throw new Error("authored hidden-truth fingerprint diverged");
  }
}

function channelIsLearnerSafe(channel: AuthoredContextChannel, hiddenFacts: readonly string[]): boolean {
  return channel.audience === "learner" && !channelCarriesHiddenTruth(channel, hiddenFacts);
}

function channelCarriesHiddenTruth(channel: AuthoredContextChannel, hiddenFacts: readonly string[]): boolean {
  if (channel.carriesHiddenTruth === true) {
    return true;
  }
  const values = Object.values(channel.content);
  return hiddenFacts.some((fact) => values.includes(fact));
}

function channelIsOpen(channel: AuthoredContextChannel, phase: ContextChannelPhase, atSecond: number): boolean {
  if (atSecond < channel.opensAtSecond) {
    return false;
  }
  if (channel.closesAtSecond !== undefined && atSecond > channel.closesAtSecond) {
    return false;
  }
  if (channel.availableInPhases !== undefined && !channel.availableInPhases.includes(phase)) {
    return false;
  }
  return true;
}

function freezeAvailable(channel: AuthoredContextChannel): AvailableContextChannel {
  const available: AvailableContextChannel = {
    channelId: channel.channelId,
    kind: channel.kind,
    modality: channel.modality,
    opensAtSecond: channel.opensAtSecond,
    content: Object.freeze({ ...channel.content }),
  };
  if (channel.closesAtSecond !== undefined) {
    available.closesAtSecond = channel.closesAtSecond;
  }
  return Object.freeze(available);
}

function parseAuthoredChannel(
  entry: unknown,
  index: number,
  scenarioId: string,
  caseFingerprint: string,
): AuthoredContextChannel {
  if (entry === null || typeof entry !== "object" || Array.isArray(entry)) {
    throw new Error(`contextChannels[${index}] is not an object`);
  }
  const record = entry as Record<string, unknown>;
  const channelId = requiredString(record["channelId"], `contextChannels[${index}].channelId`);
  const kindRaw = requiredString(record["kind"], `contextChannels[${index}].kind`);
  if (!KIND_SET.has(kindRaw)) {
    throw new Error(`contextChannels[${index}].kind is not a context channel`);
  }
  const audienceRaw = requiredString(record["audience"], `contextChannels[${index}].audience`);
  if (!AUDIENCE_SET.has(audienceRaw)) {
    throw new Error(`contextChannels[${index}].audience must be learner or reviewer`);
  }
  const modalityRaw = requiredString(record["modality"], `contextChannels[${index}].modality`);
  if (!MODALITY_SET.has(modalityRaw)) {
    throw new Error(`contextChannels[${index}].modality must be viewed or heard`);
  }
  const opensAtSecond = requiredSecond(record["opensAtSecond"], `contextChannels[${index}].opensAtSecond`);
  const content = parseContent(record["content"], index);
  const channel: AuthoredContextChannel = {
    channelId,
    kind: kindRaw as ContextChannelKind,
    audience: audienceRaw as ContextChannelAudience,
    opensAtSecond,
    modality: modalityRaw as ContextChannelModality,
    content: Object.freeze(content),
  };
  if (record["closesAtSecond"] !== undefined) {
    channel.closesAtSecond = requiredSecond(record["closesAtSecond"], `contextChannels[${index}].closesAtSecond`);
  }
  if (record["availableInPhases"] !== undefined) {
    channel.availableInPhases = parsePhases(record["availableInPhases"], index);
  }
  if (record["carriesHiddenTruth"] === true) {
    channel.carriesHiddenTruth = true;
  }
  if (typeof record["hiddenTruthFingerprint"] === "string") {
    channel.hiddenTruthFingerprint = record["hiddenTruthFingerprint"];
    if (channel.hiddenTruthFingerprint !== caseFingerprint) {
      throw new Error("authored hidden-truth fingerprint diverged");
    }
  }
  if (typeof record["scenarioId"] === "string") {
    channel.scenarioId = record["scenarioId"];
    if (channel.scenarioId !== scenarioId) {
      throw new Error("stale context-channel identity");
    }
  }
  return Object.freeze(channel);
}

function parseContent(value: unknown, index: number): Record<string, string> {
  if (value === undefined) {
    return {};
  }
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`contextChannels[${index}].content must be an object`);
  }
  const content: Record<string, string> = {};
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    if (typeof entry !== "string") {
      throw new Error(`contextChannels[${index}].content.${key} must be a string`);
    }
    content[key] = entry;
  }
  return content;
}

function parsePhases(value: unknown, index: number): readonly ContextChannelPhase[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error(`contextChannels[${index}].availableInPhases must be a non-empty array`);
  }
  const phases: ContextChannelPhase[] = [];
  for (const entry of value) {
    if (typeof entry !== "string" || !PHASE_SET.has(entry)) {
      throw new Error(`contextChannels[${index}].availableInPhases contains an unknown phase`);
    }
    phases.push(entry as ContextChannelPhase);
  }
  return Object.freeze(phases);
}

function requiredString(value: unknown, label: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${label} is required`);
  }
  return value;
}

function requiredSecond(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0) {
    throw new Error(`${label} must be a non-negative integer`);
  }
  return value;
}
