import type { ActorTurnExecution, ActorTurnPlan } from "@openclinxr/shared-schemas";
import {
  extractFacultyActorTurnReplays,
  type FacultyActorTurnReplay,
} from "./faculty-actor-turn-replay.js";
import type { ReviewTraceInput } from "./review-packet.js";

export const assembledActorTurnReplayNotEvidenceFor = [
  "exam_equivalence",
  "clinical_validity",
  "scoring_validity",
  "quest_readiness",
  "learner_readiness",
  "production_deployment",
  "automated_scoring",
  "clinical_approval",
  "hidden_fact_disclosure",
] as const;

export const assembledActorTurnReplayClaimBoundary =
  "assembled_actor_turn_replay_not_exam_equivalence" as const;

export type ActorTurnExecutionIdentity = {
  stationRunId: string;
  planId: string;
  turnId: string;
};

export type ActorTurnModalityProvenance = {
  voiceId: string;
  languageFallback: boolean;
  ttsFallback: boolean;
  providerId?: string;
};

export type ActorTurnExecutionLedgerRecord = {
  identity: ActorTurnExecutionIdentity;
  plan: ActorTurnPlan;
  execution: ActorTurnExecution;
  actorId: string;
  respondingActorId: string;
  turnIndex: number;
  atSecond: number;
  modalityProvenance: ActorTurnModalityProvenance;
  durableEventRef: string;
  claimScope: "simulated_actor_behavior";
  notEvidenceFor: readonly string[];
};

export type AssembledActorTurnReplay = {
  stationRunId: string;
  turns: readonly FacultyActorTurnReplay[];
  timeline: readonly AssembledActorTurnReplayTimelineEntry[];
  claimBoundary: typeof assembledActorTurnReplayClaimBoundary;
  notEvidenceFor: typeof assembledActorTurnReplayNotEvidenceFor;
  examEquivalenceGate: false;
};

export type AssembledActorTurnReplayTimelineEntry = {
  stationRunId: string;
  sequence: number;
  atSecond: number;
  eventType: "actor.turn.planned" | "actor.turn.executed";
  kind: "plan" | "execution";
  planId: string;
  turnId: string;
  summary: string;
};

const PRIVATE_PAYLOAD_KEY = /(?:hidden|private|serverOnly|server_only|internal|secret|confidential)/i;

export function isPrivateHiddenFactPayloadKey(key: string): boolean {
  return PRIVATE_PAYLOAD_KEY.test(key);
}

export function stripPrivateHiddenFactPayload(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(stripPrivateHiddenFactPayload);
  }
  if (typeof value !== "object" || value === null) {
    return value;
  }
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .filter(([key]) => !isPrivateHiddenFactPayloadKey(key))
      .map(([key, nested]) => [key, stripPrivateHiddenFactPayload(nested)]),
  );
}

export function facultyTraceEventsFromActorTurnRecords(
  records: readonly ActorTurnExecutionLedgerRecord[],
): ReviewTraceInput[] {
  return orderedRecords(records).flatMap((record, index) => {
    const plan = stripPrivateHiddenFactPayload(record.plan) as ActorTurnPlan;
    const execution = stripPrivateHiddenFactPayload(record.execution) as ActorTurnExecution;
    const sequence = index * 2;
    return [
      {
        sequence,
        atSecond: record.atSecond,
        eventType: "actor.turn.planned",
        source: "actor-turn-execution-ledger",
        actorId: record.actorId,
        payload: { actorTurnPlan: plan },
      },
      {
        sequence: sequence + 1,
        atSecond: record.atSecond,
        eventType: "actor.turn.executed",
        source: "actor-turn-execution-ledger",
        actorId: record.actorId,
        payload: { actorTurnExecution: execution },
      },
    ];
  });
}

export function assembleActorTurnReplay(
  stationRunId: string,
  records: readonly ActorTurnExecutionLedgerRecord[],
): AssembledActorTurnReplay {
  if (stationRunId.trim().length === 0) {
    throw new Error("assembled actor-turn replay requires stationRunId");
  }
  const scoped = orderedRecords(records).filter((record) => record.identity.stationRunId === stationRunId);
  const events = facultyTraceEventsFromActorTurnRecords(scoped);
  const turns = extractFacultyActorTurnReplays(events);
  const timeline = events.map((event, sequence) => {
    const payload = event.payload ?? {};
    const plan = payload["actorTurnPlan"] as ActorTurnPlan | undefined;
    const execution = payload["actorTurnExecution"] as ActorTurnExecution | undefined;
    const isPlan = event.eventType === "actor.turn.planned";
    return {
      stationRunId,
      sequence,
      atSecond: event.atSecond,
      eventType: isPlan ? "actor.turn.planned" : "actor.turn.executed",
      kind: isPlan ? "plan" : "execution",
      planId: plan?.planId ?? execution?.planId ?? "",
      turnId: plan?.turnId ?? execution?.turnId ?? "",
      summary: isPlan
        ? `ActorTurnPlan ${plan?.planId ?? ""}`
        : `ActorTurnExecution ${execution?.planId ?? ""}`,
    } as const;
  });
  const assembled: AssembledActorTurnReplay = {
    stationRunId,
    turns,
    timeline,
    claimBoundary: assembledActorTurnReplayClaimBoundary,
    notEvidenceFor: assembledActorTurnReplayNotEvidenceFor,
    examEquivalenceGate: false,
  };
  return stripPrivateHiddenFactPayload(assembled) as AssembledActorTurnReplay;
}

function orderedRecords(
  records: readonly ActorTurnExecutionLedgerRecord[],
): ActorTurnExecutionLedgerRecord[] {
  return [...records].sort((left, right) =>
    left.turnIndex === right.turnIndex
      ? left.atSecond - right.atSecond
      : left.turnIndex - right.turnIndex,
  );
}
