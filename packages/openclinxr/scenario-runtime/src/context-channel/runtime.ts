import type { Scenario, TraceEvent } from "@openclinxr/shared-schemas";
import type { SessionRecord } from "../runtime-types.js";
import {
  ackKey,
  authoredContextChannelsFromCase,
  availableContextChannelsAt,
  CONTEXT_CHANNEL_CLAIM_SCOPE,
  CONTEXT_CHANNEL_NOT_EVIDENCE_FOR,
  hiddenFactsFromCase,
  requireAcknowledgeableChannel,
  type AuthoredContextChannel,
  type AvailableContextChannel,
  type ContextChannelModality,
} from "./evaluate.js";

const snapshotBySession = new WeakMap<SessionRecord, readonly AuthoredContextChannel[]>();
const acksBySession = new WeakMap<SessionRecord, Set<string>>();

export type AcknowledgeContextChannelInput = {
  channelId: string;
  modality: ContextChannelModality;
  atSecond: number;
};

export type ContextChannelTraceAppend = (input: {
  eventType: string;
  atSecond: number;
  source: string;
  tag?: string;
  payload: Record<string, unknown>;
}) => TraceEvent;

function snapshotChannels(session: SessionRecord, scenario: Scenario): readonly AuthoredContextChannel[] {
  const cached = snapshotBySession.get(session);
  if (cached) {
    return cached;
  }
  const authored = authoredContextChannelsFromCase(scenario);
  snapshotBySession.set(session, authored);
  return authored;
}

function acksFor(session: SessionRecord): Set<string> {
  const existing = acksBySession.get(session);
  if (existing) {
    return existing;
  }
  const created = new Set<string>();
  acksBySession.set(session, created);
  return created;
}

export function listAvailableContextChannels(
  session: SessionRecord,
  scenario: Scenario,
  atSecond: number,
): readonly AvailableContextChannel[] {
  if (session.run.scenarioId !== scenario.scenarioId) {
    throw new Error("stale context-channel identity");
  }
  return availableContextChannelsAt({
    channels: snapshotChannels(session, scenario),
    phase: session.run.phase,
    atSecond,
    hiddenFacts: hiddenFactsFromCase(scenario),
    scenarioId: scenario.scenarioId,
  });
}

export function acknowledgeContextChannelOnSession(
  session: SessionRecord,
  scenario: Scenario,
  input: AcknowledgeContextChannelInput,
  appendTrace: ContextChannelTraceAppend,
): TraceEvent {
  if (session.run.scenarioId !== scenario.scenarioId) {
    throw new Error("stale context-channel identity");
  }
  const acks = acksFor(session);
  const channel = requireAcknowledgeableChannel({
    channels: snapshotChannels(session, scenario),
    channelId: input.channelId,
    modality: input.modality,
    phase: session.run.phase,
    atSecond: input.atSecond,
    hiddenFacts: hiddenFactsFromCase(scenario),
    scenarioId: scenario.scenarioId,
    alreadyAcknowledged: acks,
  });
  const payload = Object.freeze({
    channelId: channel.channelId,
    kind: channel.kind,
    modality: input.modality,
    claimScope: CONTEXT_CHANNEL_CLAIM_SCOPE,
    notEvidenceFor: CONTEXT_CHANNEL_NOT_EVIDENCE_FOR,
  });
  const event = appendTrace({
    eventType: "context_channel.acknowledged",
    atSecond: input.atSecond,
    source: "learner",
    tag: `context_channel:${channel.kind}:${input.modality}`,
    payload,
  });
  acks.add(ackKey(channel.channelId, input.modality));
  Object.freeze(event);
  return event;
}
