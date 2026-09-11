/**
 * Interrupted actor-turn resume for assembled-exam reconnect.
 *
 * Internal to @openclinxr/scenario-runtime: reached only through
 * resumeAssembledExam, never re-exported from the package entrypoint.
 * Barge-in state and cancelled modalities come from the canonical
 * conversation-policy resolver, not re-derived here.
 */
import {
  createDefaultConversationPolicy,
  type ActorTurnInProgress,
  type BargeInOutcome,
} from "@openclinxr/conversation-policy";

export type InterruptedActorTurnBargeIn = {
  atSecond: number;
  atMs?: number;
  interruptionId?: string;
  learnerUtterance?: string;
};

export type InterruptedActorTurnEntry = {
  stationRunId: string;
  actorId: string;
  conversationTurn: number;
  startedAtSecond: number;
  learnerUtterance?: string;
  turnId?: string;
  planId?: string;
  bargeIn?: InterruptedActorTurnBargeIn;
  emittedDurableEventRefs?: readonly string[];
};

export type RestoredActorTurn = {
  actorId: string;
  conversationTurn: number;
  startedAtSecond: number;
  clockMs: number;
  turnId: string | null;
  planId: string | null;
  bargeInOutcome: BargeInOutcome | null;
  interruptionId: string | null;
  cancelledModalities: readonly string[];
  alreadyEmittedDurableEventRefs: readonly string[];
};

function dedupeRefs(refs: readonly string[] | undefined): readonly string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const ref of refs ?? []) {
    if (!seen.has(ref)) {
      seen.add(ref);
      out.push(ref);
    }
  }
  return Object.freeze(out);
}

function requireNonblank(value: string, fieldName: string): string {
  if (value.trim().length === 0) {
    throw new Error(`assembled exam orchestrator requires nonblank ${fieldName}`);
  }
  return value;
}

function requireAtSecond(value: number, fieldName: string): number {
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`assembled exam orchestrator requires non-negative integer ${fieldName}`);
  }
  return value;
}

function validatedEntry(entry: InterruptedActorTurnEntry): InterruptedActorTurnEntry {
  requireNonblank(entry.stationRunId, "stationRunId");
  requireNonblank(entry.actorId, "actorId");
  if (!Number.isInteger(entry.conversationTurn) || entry.conversationTurn < 1) {
    throw new Error("assembled exam orchestrator requires positive integer conversationTurn");
  }
  requireAtSecond(entry.startedAtSecond, "startedAtSecond");
  const bargeIn = entry.bargeIn;
  if (bargeIn !== undefined) {
    requireAtSecond(bargeIn.atSecond, "bargeIn.atSecond");
    if (bargeIn.atMs !== undefined && (!Number.isFinite(bargeIn.atMs) || bargeIn.atMs < 0)) {
      throw new Error("assembled exam orchestrator requires non-negative bargeIn.atMs");
    }
  }
  return entry;
}

/**
 * Restore the interrupted turn for the current station, or null when the
 * projection carries none. Entries for any other station refuse: a reconnect
 * resumes exactly the current turn, never a neighbour's.
 */
export function restoreInterruptedActorTurn(
  currentStationRunId: string,
  entries: readonly InterruptedActorTurnEntry[] | undefined,
): RestoredActorTurn | null {
  if (!entries || entries.length === 0) {
    return null;
  }
  const seen = new Set<string>();
  for (const entry of entries) {
    validatedEntry(entry);
    if (seen.has(entry.stationRunId)) {
      throw new Error(
        `duplicated station identity: interrupted actor turn already recorded for ${entry.stationRunId}`,
      );
    }
    seen.add(entry.stationRunId);
  }
  const current = entries.find((entry) => entry.stationRunId === currentStationRunId);
  if (!current) {
    const [first] = entries;
    throw new Error(
      `skipped station identity: interrupted actor turn for stationRunId ${first?.stationRunId} is not current ${currentStationRunId}`,
    );
  }

  const inProgress: ActorTurnInProgress = {
    actorId: current.actorId,
    conversationTurn: current.conversationTurn,
    startedAtSecond: current.startedAtSecond,
    stationRunId: current.stationRunId,
    ...(current.learnerUtterance !== undefined ? { learnerUtterance: current.learnerUtterance } : {}),
    ...(current.turnId !== undefined ? { turnId: current.turnId } : {}),
    ...(current.planId !== undefined ? { planId: current.planId } : {}),
  };
  const bargeIn = current.bargeIn;
  const alreadyEmittedDurableEventRefs = dedupeRefs(current.emittedDurableEventRefs);
  if (bargeIn === undefined) {
    return Object.freeze({
      actorId: current.actorId,
      conversationTurn: current.conversationTurn,
      startedAtSecond: current.startedAtSecond,
      clockMs: current.startedAtSecond * 1000,
      turnId: current.turnId ?? null,
      planId: current.planId ?? null,
      bargeInOutcome: null,
      interruptionId: null,
      cancelledModalities: Object.freeze([]),
      alreadyEmittedDurableEventRefs,
    });
  }
  const policy = createDefaultConversationPolicy();
  const resolution = policy.resolveLearnerBargeIn(inProgress, {
    atSecond: bargeIn.atSecond,
    stationRunId: current.stationRunId,
    ...(bargeIn.atMs !== undefined ? { atMs: bargeIn.atMs } : {}),
    ...(bargeIn.interruptionId !== undefined ? { interruptionId: bargeIn.interruptionId } : {}),
    ...(current.turnId !== undefined ? { turnId: current.turnId } : {}),
    ...(bargeIn.learnerUtterance !== undefined ? { learnerUtterance: bargeIn.learnerUtterance } : {}),
  });

  return Object.freeze({
    actorId: current.actorId,
    conversationTurn: current.conversationTurn,
    startedAtSecond: current.startedAtSecond,
    clockMs: resolution.clockMs,
    turnId: resolution.turnId,
    planId: resolution.planId,
    bargeInOutcome: resolution.outcome,
    interruptionId: resolution.interruptionId,
    cancelledModalities: Object.freeze([...(resolution.cancellationDirective?.cancelModalities ?? [])]),
    alreadyEmittedDurableEventRefs,
  });
}
