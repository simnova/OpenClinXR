import type { ScheduledEvent } from "@openclinxr/domain";
import type { Scenario, TraceEvent } from "@openclinxr/shared-schemas";
import { durableEventRef } from "../trace.js";
import { getEncounterRolesDue, type EncounterRoleKind } from "./roles.js";

/**
 * Case-defined three-role ensemble clock. The case, not a hard-coded roster, owns turn
 * ownership: due scheduled events carry their cast role, and the role order (patient,
 * then parent, then nurse) is the only tie-break inside one domain second.
 *
 * Pure except for the trace append callback the caller supplies. No clock of its own:
 * the caller's atSecond is the domain second. No wall-clock, no randomness.
 */
export type MultiActorEnsembleInput = {
  scenario: Pick<Scenario, "actors" | "eventSchedule">;
  atSecond: number;
  stationRunId: string;
  learnerUtterance: string;
  emittedEventIds: ReadonlySet<string>;
  /** Distinct encounter turns already spoken, in emission order. */
  priorTurnOwnerActorIds: readonly string[];
  /** Ledger sequence the trace write will use, so durableEventRef stays replayable. */
  ledgerSequence: number;
};

export type MultiActorEnsembleTurn = {
  ownerActorId: string;
  ownerRole: EncounterRoleKind;
  gazeTargetActorId: string | null;
  trace: Omit<TraceEvent, "occurredAt"> & { occurredAt: string };
  turnOwnerEvent: ScheduledEvent | null;
};

export type MultiActorEnsembleTracePayload = {
  ownerRole: EncounterRoleKind;
  gazeTargetActorId: string | null;
  dueRoleCount: number;
  encounterClockAtSecond: number;
  durableEventRef: string;
  claimScope: "multi_actor_ensemble_turn_traced_not_scored";
  notEvidenceFor: string[];
  interruptionPolicy: "nurse_escalation_interrupts" | "owner_holds_turn";
  interruptedOwnerActorId?: string;
  priorTurnOwnerActorIds?: string[];
};

/** Fixed roster: which case cast members fill each ensemble role. */
export function ensembleCastForScenario(scenario: Pick<Scenario, "actors">): {
  patientActorId: string | null;
  parentActorId: string | null;
  nurseActorId: string | null;
} {
  return {
    patientActorId: scenario.actors.find((actor) => actor.role === "patient")?.actorId ?? null,
    parentActorId: scenario.actors.find((actor) => actor.role === "family")?.actorId ?? null,
    nurseActorId: scenario.actors.find((actor) => actor.role === "nurse")?.actorId ?? null,
  };
}

/** Gaze for one ensemble turn: patient looks at the parent, others at the patient. */
export function gazeTargetForEnsembleTurn(ownerActorId: string, cast: ReturnType<typeof ensembleCastForScenario>): string | null {
  if (ownerActorId === cast.patientActorId) {
    return cast.parentActorId;
  }
  return cast.patientActorId;
}

/**
 * One ensemble clock tick. Advances the encounter from a single speaking actor to the
 * case-defined trio: the due role event with the earliest (second, role) rank owns this
 * turn, and a due nurse escalation interrupts a non-nurse owner with its own event.
 */
export function advanceMultiActorEnsemble(
  input: MultiActorEnsembleInput,
  appendTrace: (event: {
    eventType: string;
    atSecond: number;
    source: string;
    actorId?: string;
    tag?: string;
    payload?: Record<string, unknown>;
  }) => TraceEvent,
): MultiActorEnsembleTurn | null {
  const cast = ensembleCastForScenario(input.scenario);
  const dueRoles = getEncounterRolesDue(input.scenario, input.atSecond, input.emittedEventIds);
  if (dueRoles.length === 0) {
    return null;
  }
  const owner = dueRoles[0];
  if (!owner) {
    return null;
  }
  const interruption = dueRoles.find((entry) => entry.role === "nurse" && entry.actorId !== owner.actorId);
  const turnOwnerEvent = interruption && owner.role !== "nurse" ? interruption : owner;
  const ownerActorId = turnOwnerEvent.actorId;
  const payload: MultiActorEnsembleTracePayload = {
    ownerRole: turnOwnerEvent.role,
    gazeTargetActorId: gazeTargetForEnsembleTurn(ownerActorId, cast),
    dueRoleCount: dueRoles.length,
    encounterClockAtSecond: input.atSecond,
    durableEventRef: durableEventRef(input.stationRunId, input.ledgerSequence),
    claimScope: "multi_actor_ensemble_turn_traced_not_scored",
    notEvidenceFor: ["clinical_validity", "exam_equivalence", "scoring"],
    interruptionPolicy: interruption && owner.role !== "nurse" ? "nurse_escalation_interrupts" : "owner_holds_turn",
  };
  if (interruption && owner.role !== "nurse") {
    payload.interruptedOwnerActorId = owner.actorId;
  }
  if (input.priorTurnOwnerActorIds.length > 0) {
    payload.priorTurnOwnerActorIds = [...input.priorTurnOwnerActorIds];
  }
  const trace = appendTrace({
    eventType: "multi_actor.ensemble.turn",
    atSecond: input.atSecond,
    source: "scenario-runtime",
    actorId: ownerActorId,
    tag: turnOwnerEvent.tag,
    payload,
  });
  return {
    ownerActorId,
    ownerRole: turnOwnerEvent.role,
    gazeTargetActorId: gazeTargetForEnsembleTurn(ownerActorId, cast),
    trace,
    turnOwnerEvent,
  };
}
