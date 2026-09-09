import { getScheduledEventsDue, type ScheduledEvent } from "@openclinxr/domain";
import type { Scenario } from "@openclinxr/shared-schemas";

export type { SceneRequirementObservation } from "./encounter-admission.js";

import {
  type EncounterAdmissionDecision,
  type EncounterAdmissionRefusal,
  encounterAdmissionRefusalMessage,
  evaluateEncounterAdmission,
  type SceneRequirementObservation,
} from "./encounter-admission.js";
import type { EncounterAdmissionOptions, SessionRecord } from "./runtime-types.js";

/**
 * The runtime state the admission decision is taken over, and the ordered effect execution that
 * follows it.
 *
 * This is the ENFORCEMENT half. `encounter-admission.ts` decides; this records observations, holds
 * the accepted snapshot on the existing session record, and drives scheduled effects through the
 * existing emitted-event set and domain clock. No new phase, no second clock, no parallel store —
 * acceptance-v2.md is explicit that "No new phase does not mean no enforcement" and equally
 * explicit that a parallel state engine is not the answer.
 */

/** Default observation age limit. Callers that care set their own; the tests always do. */
export const DEFAULT_OBSERVATION_FRESHNESS_MS = 30_000;

export type EncounterAdmissionSnapshot = {
  /** `accepted` until a later observation contradicts it, then `invalidated`. */
  status: "accepted" | "invalidated";
  /** Domain second the transition was taken at — the same value START_ENCOUNTER carried. */
  acceptedAtDomainSecond: number;
  /** Ledger sequence at acceptance. Every effect execution records a strictly greater sequence. */
  acceptedAtLedgerSequence: number;
  requirementCount: number;
  acceptedRequirementIds: string[];
  learnerGoalsIncomplete: EncounterAdmissionDecision["learnerGoalsIncomplete"];
  /** The observations admission was taken on, frozen at acceptance. */
  observedAtAcceptance: SceneRequirementObservation[];
  /** Present only when `status` is `invalidated`: what contradicted the acceptance, and when. */
  invalidation?: {
    requirementId: string;
    reason: EncounterAdmissionRefusal["reason"];
    evidence: string;
    atMs: number;
  };
};

/** One scheduled effect's attempt at the actual consumer, recorded whether or not it worked. */
export type ScheduledEffectExecution = {
  eventId: string;
  atSecond: number;
  /** 1 on the first attempt; a retry after failure increments it. */
  attempt: number;
  status: "acknowledged" | "failed";
  /** The consumer's acknowledgment id. Present only on success — this is the applied proof. */
  acknowledgmentId?: string;
  failureReason?: string;
  /** Ledger sequence the execution trace was written at. */
  ledgerSequence: number;
};

export type ScheduledEffectResult = {
  executions: ScheduledEffectExecution[];
  /** Due events considered this tick, in the order the domain returned them. */
  due: ScheduledEvent[];
  /** True when acceptance was invalidated: SC-05 consumes this as the stop/refusal signal. */
  stopped: boolean;
  stopReason?: string;
};

/**
 * What the runtime class must supply. Passing the host in keeps this module free of the class and
 * lets `verifier`-style tests drive it, but it is NOT an alternative execution path: the only
 * production caller is `ScenarioRuntime`.
 */
export type EncounterAdmissionHost = {
  scenario: Scenario;
  admission: EncounterAdmissionOptions | undefined;
  /** Append a trace event through the runtime's own ledger, returning the sequence used. */
  appendEffectTrace(session: SessionRecord, execution: Omit<ScheduledEffectExecution, "ledgerSequence">): number;
};

export function caseRevisionOf(scenario: Scenario): string {
  return `${scenario.scenarioId}@${scenario.version}`;
}

function requirementsOf(scenario: Scenario): NonNullable<Scenario["startingRequirements"]> {
  return scenario.startingRequirements ?? [];
}

function nowMs(admission: EncounterAdmissionOptions | undefined): number {
  return admission?.now ? admission.now() : Date.now();
}

function freshnessMs(admission: EncounterAdmissionOptions | undefined): number {
  return admission?.observationFreshnessMs ?? DEFAULT_OBSERVATION_FRESHNESS_MS;
}

function decide(host: EncounterAdmissionHost, session: SessionRecord): EncounterAdmissionDecision {
  return evaluateEncounterAdmission({
    requirements: requirementsOf(host.scenario),
    observations: session.requirementObservations,
    stationRunId: session.run.stationRunId,
    caseRevision: caseRevisionOf(host.scenario),
    nowMs: nowMs(host.admission),
    observationFreshnessMs: freshnessMs(host.admission),
  });
}

/**
 * Record one consumer observation against the active run.
 *
 * Two refusals happen HERE rather than at admission, because an inadmissible record must not be
 * able to sit in the session at all: a client-authored success and another run's record are
 * rejected at intake. Everything else is stored and judged at admission, where the freshness
 * window is evaluated against the moment entry is attempted rather than the moment of recording.
 */
export function recordRequirementObservation(
  host: EncounterAdmissionHost,
  session: SessionRecord,
  observation: SceneRequirementObservation,
): SceneRequirementObservation {
  if (observation.source !== "runtime_consumer_observation") {
    throw new Error(
      `Cannot record requirement observation: ${observation.requirementId} was ${observation.source}; `
      + "only a runtime consumer observation is admissible evidence",
    );
  }
  if (observation.stationRunId !== session.run.stationRunId) {
    throw new Error(
      `Cannot record requirement observation: ${observation.requirementId} belongs to run `
      + `${observation.stationRunId}, not ${session.run.stationRunId}`,
    );
  }
  session.requirementObservations.set(observation.requirementId, observation);

  // Post-admission invalidation. acceptance-v2.md: "After acceptance, asset removal/replacement or
  // changed requirements invalidate the acknowledgment and accepted plan; stop/refuse approach
  // until the new state is accepted through the normal owner."
  const snapshot = session.encounterAdmission;
  if (snapshot?.status === "accepted") {
    const recheck = decide(host, session);
    const refusal = recheck.refusals.find((entry) => entry.requirementId === observation.requirementId);
    if (refusal) {
      snapshot.status = "invalidated";
      snapshot.invalidation = {
        requirementId: refusal.requirementId,
        reason: refusal.reason,
        evidence: refusal.evidence,
        atMs: nowMs(host.admission),
      };
    }
  }
  return observation;
}

/**
 * The gate. Called by `ScenarioRuntime.startEncounter` BEFORE `transitionStation`, so a refused
 * encounter takes no transition, writes no `encounter.started` trace and leaves the phase alone —
 * and so the accepted snapshot exists before any due-zero effect can run.
 */
export function admitEncounterOrThrow(
  host: EncounterAdmissionHost,
  session: SessionRecord,
  domainAtSecond: number,
): EncounterAdmissionSnapshot {
  const decision = decide(host, session);
  if (!decision.admits) {
    throw new Error(encounterAdmissionRefusalMessage(decision));
  }
  const snapshot: EncounterAdmissionSnapshot = {
    status: "accepted",
    acceptedAtDomainSecond: domainAtSecond,
    acceptedAtLedgerSequence: session.nextSequence,
    requirementCount: decision.requirementCount,
    acceptedRequirementIds: decision.acceptedRequirementIds,
    learnerGoalsIncomplete: decision.learnerGoalsIncomplete,
    observedAtAcceptance: [...session.requirementObservations.values()],
  };
  session.encounterAdmission = snapshot;
  return snapshot;
}

/**
 * Apply the scheduled effects due at `atSecond` through the actual effect consumer.
 *
 * The defect this replaces: `advanceScheduledEvents` added every due id to the emitted set and
 * returned, so "emitted" meant "we told someone" and a consumer that threw lost its effect
 * permanently. Here the emitted set is written ONLY after the consumer acknowledges, which is what
 * makes a retry possible and what stops a duplicate tick from applying twice.
 */
export function applyScheduledEffects(
  host: EncounterAdmissionHost,
  session: SessionRecord,
  atSecond: number,
): ScheduledEffectResult {
  const snapshot = session.encounterAdmission;
  if (!snapshot) {
    throw new Error(
      "Cannot apply scheduled effects: this station run has no accepted encounter snapshot, "
      + "so no effect may run before admission",
    );
  }
  if (snapshot.status === "invalidated") {
    const reason = snapshot.invalidation
      ? `${snapshot.invalidation.requirementId}: ${snapshot.invalidation.reason}`
      : "acceptance invalidated";
    return { executions: [], due: [], stopped: true, stopReason: reason };
  }

  const consumer = host.admission?.scheduledEffectConsumer;
  const due = getScheduledEventsDue(host.scenario, atSecond, session.emittedScheduledEventIds);
  if (!consumer) {
    // No effect consumer wired: the only fact available is that the event came due. Mark it
    // emitted and say nothing about application — claiming an acknowledgment here would be the
    // report-authored pass this card exists to remove.
    for (const event of due) session.emittedScheduledEventIds.add(event.eventId);
    return { executions: [], due, stopped: false };
  }

  const executions: ScheduledEffectExecution[] = [];
  for (const event of due) {
    const attempt = (session.scheduledEffectAttempts.get(event.eventId) ?? 0) + 1;
    session.scheduledEffectAttempts.set(event.eventId, attempt);
    try {
      const acknowledgment = consumer.applyEffect({
        event,
        stationRunId: session.run.stationRunId,
        atSecond,
        attempt,
        acceptedAtDomainSecond: snapshot.acceptedAtDomainSecond,
      });
      // Emitted is written HERE, after the acknowledgment, and nowhere else.
      session.emittedScheduledEventIds.add(event.eventId);
      const partial = {
        eventId: event.eventId,
        atSecond: event.atSecond,
        attempt,
        status: "acknowledged" as const,
        acknowledgmentId: acknowledgment.acknowledgmentId,
      };
      executions.push({ ...partial, ledgerSequence: host.appendEffectTrace(session, partial) });
    } catch (error) {
      const partial = {
        eventId: event.eventId,
        atSecond: event.atSecond,
        attempt,
        status: "failed" as const,
        failureReason: error instanceof Error ? error.message : String(error),
      };
      executions.push({ ...partial, ledgerSequence: host.appendEffectTrace(session, partial) });
    }
  }
  return { executions, due, stopped: false };
}

/**
 * Legacy shape for `advanceScheduledEvents`, which existing callers use to ask only which events
 * came due. It runs the same path, so a wired consumer still applies and still retries.
 */
export function advanceScheduledEffects(
  host: EncounterAdmissionHost,
  session: SessionRecord,
  atSecond: number,
): ScheduledEvent[] {
  if (!session.encounterAdmission) {
    const due = getScheduledEventsDue(host.scenario, atSecond, session.emittedScheduledEventIds);
    for (const event of due) session.emittedScheduledEventIds.add(event.eventId);
    return due;
  }
  return applyScheduledEffects(host, session, atSecond).due;
}

/**
 * Build the host the runtime class passes into this module.
 *
 * It lives here, not in `ScenarioRuntime`, because that class sits under a shrink-only file-size
 * ceiling (806 lines) that this card must not raise. Enforcement belongs at the existing owner;
 * the plumbing does not have to.
 */
export function createEncounterAdmissionHost(
  scenario: Scenario,
  admission: EncounterAdmissionOptions | undefined,
  appendTrace: (
    session: SessionRecord,
    input: { eventType: string; atSecond: number; source: string; payload?: Record<string, unknown> },
  ) => unknown,
): EncounterAdmissionHost {
  return {
    scenario,
    admission,
    appendEffectTrace: (session, execution) => {
      const sequence = session.nextSequence;
      appendTrace(session, {
        eventType: `scheduled.effect.${execution.status}`,
        atSecond: execution.atSecond,
        source: "scenario-runtime",
        payload: { ...execution },
      });
      return sequence;
    },
  };
}
