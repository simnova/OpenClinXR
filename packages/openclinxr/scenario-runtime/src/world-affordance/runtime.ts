import type { Scenario, TraceEvent } from "@openclinxr/shared-schemas";
import type { SessionRecord } from "../runtime-types.js";
import {
  authoredWorldAffordanceGraphFromCase,
  availableWorldAffordancesAt,
  followedConsequence,
  requireExecutableAffordance,
  WORLD_AFFORDANCE_CLAIM_SCOPE,
  WORLD_AFFORDANCE_NOT_EVIDENCE_FOR,
  type AvailableWorldAffordance,
  type BoundSessionIdentities,
  type ExecuteWorldAffordanceAction,
  type WorldAffordanceGraph,
  type WorldAffordanceKind,
  type WorldAffordancePhase,
} from "./evaluate.js";

const graphBySession = new WeakMap<SessionRecord, WorldAffordanceGraph>();
const executedBySession = new WeakMap<SessionRecord, Map<string, TraceEvent>>();

export type ExecuteWorldAffordanceInput = {
  affordanceId: string;
  kind: WorldAffordanceKind;
  atSecond: number;
  stationId: string;
  bundleId: string;
  actorId?: string;
  equipmentId?: string;
  examRunId?: string;
  stationOrder?: number;
};

export type AffordanceTraceAppend = (
  session: SessionRecord,
  input: {
    eventType: string;
    atSecond: number;
    source: string;
    actorId?: string;
    tag?: string;
    payload: Record<string, unknown>;
  },
) => TraceEvent;

function graphFor(session: SessionRecord, scenario: Scenario): WorldAffordanceGraph {
  const cached = graphBySession.get(session);
  if (cached) {
    return cached;
  }
  const graph = authoredWorldAffordanceGraphFromCase(scenario);
  graphBySession.set(session, graph);
  return graph;
}

function executedFor(session: SessionRecord): Map<string, TraceEvent> {
  const existing = executedBySession.get(session);
  if (existing) {
    return existing;
  }
  const created = new Map<string, TraceEvent>();
  executedBySession.set(session, created);
  return created;
}

function boundIdentities(session: SessionRecord, scenario: Scenario): BoundSessionIdentities {
  if (session.run.scenarioId !== scenario.scenarioId) {
    throw new Error("stale affordance identity");
  }
  const bound: BoundSessionIdentities = {
    scenarioId: scenario.scenarioId,
    stationId: scenario.scenarioId,
    phase: session.run.phase as WorldAffordancePhase,
  };
  if (session.assembledStation) {
    bound.examRunId = session.assembledStation.examRunId;
    bound.stationOrder = session.assembledStation.stationOrder;
    if (session.assembledStation.scenarioId !== scenario.scenarioId) {
      throw new Error("stale affordance identity");
    }
  }
  return bound;
}

function refuseAssembledMismatch(session: SessionRecord, action: ExecuteWorldAffordanceAction): void {
  const assembled = session.assembledStation;
  if (!assembled) {
    return;
  }
  if (action.examRunId !== undefined && action.examRunId !== assembled.examRunId) {
    throw new Error("stale affordance identity");
  }
  if (action.stationOrder !== undefined && action.stationOrder !== assembled.stationOrder) {
    throw new Error("stale affordance identity");
  }
}

export function listAvailableWorldAffordances(
  session: SessionRecord,
  scenario: Scenario,
  atSecond: number,
): readonly AvailableWorldAffordance[] {
  const bound = boundIdentities(session, scenario);
  return availableWorldAffordancesAt({
    graph: graphFor(session, scenario),
    phase: bound.phase,
    atSecond,
    executedIds: new Set(executedFor(session).keys()),
    bound,
  });
}

export function executeWorldAffordanceOnSession(
  session: SessionRecord,
  scenario: Scenario,
  input: ExecuteWorldAffordanceInput,
  appendTrace: AffordanceTraceAppend,
): TraceEvent {
  const bound = boundIdentities(session, scenario);
  refuseAssembledMismatch(session, input);
  const executed = executedFor(session);
  const existing = executed.get(input.affordanceId);
  if (existing) {
    requireExecutableAffordance({
      graph: graphFor(session, scenario),
      action: input,
      phase: bound.phase,
      executedIds: new Set(),
      bound,
    });
    const graph = graphFor(session, scenario);
    const authored = graph.affordances.find((row) => row.affordanceId === input.affordanceId);
    if (authored?.kind === "inspect") {
      return existing;
    }
  }
  const attemptedPayload = Object.freeze({
    affordanceId: input.affordanceId,
    kind: input.kind,
    stationId: input.stationId,
    bundleId: input.bundleId,
    ...(input.actorId !== undefined ? { actorId: input.actorId } : {}),
    ...(input.equipmentId !== undefined ? { equipmentId: input.equipmentId } : {}),
    claimScope: WORLD_AFFORDANCE_CLAIM_SCOPE,
    notEvidenceFor: WORLD_AFFORDANCE_NOT_EVIDENCE_FOR,
  });
  const attempted = appendTrace(session, {
    eventType: "world_affordance.attempted",
    atSecond: input.atSecond,
    source: "learner",
    ...(input.actorId !== undefined ? { actorId: input.actorId } : {}),
    tag: `world_affordance:${input.kind}:attempted`,
    payload: attemptedPayload,
  });
  Object.freeze(attempted);
  try {
    const affordance = requireExecutableAffordance({
      graph: graphFor(session, scenario),
      action: input,
      phase: bound.phase,
      executedIds: new Set(executed.keys()),
      bound,
    });
    const followed = followedConsequence(affordance);
    const executedEvent = appendTrace(session, {
      eventType: "world_affordance.executed",
      atSecond: input.atSecond,
      source: "system",
      ...(affordance.actorId !== undefined ? { actorId: affordance.actorId } : {}),
      tag: followed.traceTag,
      payload: Object.freeze({
        affordanceId: affordance.affordanceId,
        kind: affordance.kind,
        attempted: attemptedPayload,
        followed,
        claimScope: WORLD_AFFORDANCE_CLAIM_SCOPE,
        notEvidenceFor: WORLD_AFFORDANCE_NOT_EVIDENCE_FOR,
      }),
    });
    Object.freeze(executedEvent);
    executed.set(affordance.affordanceId, executedEvent);
    return executedEvent;
  } catch (failure) {
    const message = failure instanceof Error ? failure.message : "affordance is not available";
    const refused = appendTrace(session, {
      eventType: "world_affordance.refused",
      atSecond: input.atSecond,
      source: "system",
      ...(input.actorId !== undefined ? { actorId: input.actorId } : {}),
      tag: `world_affordance:${input.kind}:refused`,
      payload: Object.freeze({
        affordanceId: input.affordanceId,
        kind: input.kind,
        attempted: attemptedPayload,
        followed: Object.freeze({ refused: true, reason: message }),
        claimScope: WORLD_AFFORDANCE_CLAIM_SCOPE,
        notEvidenceFor: WORLD_AFFORDANCE_NOT_EVIDENCE_FOR,
      }),
    });
    Object.freeze(refused);
    throw failure;
  }
}
