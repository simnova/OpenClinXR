import { getScheduledEventsDue, type ScheduledEvent } from "@openclinxr/domain";
import type { Scenario } from "@openclinxr/shared-schemas";

/** Ensemble turn owner: case cast mapped onto the three-role clock. */
export type EncounterRoleKind = "patient" | "parent" | "nurse";

export type EncounterRoleAssignment = ScheduledEvent & {
  role: EncounterRoleKind;
};

const ROLE_PRECEDENCE: Record<EncounterRoleKind, number> = { patient: 0, parent: 1, nurse: 2 };

/**
 * Map a case actor onto the ensemble clock.
 * Unknown casts default to patient, matching the primary-actor default in station-state.
 */
export function encounterRoleForActorId(
  actorId: string,
  scenario: Pick<Scenario, "actors">,
): EncounterRoleKind {
  const actor = scenario.actors.find((entry) => entry.actorId === actorId);
  if (!actor || actor.role === "patient") {
    return "patient";
  }
  if (actor.role === "nurse") {
    return "nurse";
  }
  return "parent";
}

/** Due scheduled events annotated with case-defined role, ordered by second, role, eventId. */
export function getEncounterRolesDue(
  scenario: Pick<Scenario, "actors" | "eventSchedule">,
  atSecond: number,
  emittedEventIds: ReadonlySet<string>,
): EncounterRoleAssignment[] {
  return getScheduledEventsDue(scenario, atSecond, emittedEventIds)
    .map((event) => ({ ...event, role: encounterRoleForActorId(event.actorId, scenario) }))
    .sort(
      (left, right) =>
        left.atSecond - right.atSecond
        || ROLE_PRECEDENCE[left.role] - ROLE_PRECEDENCE[right.role]
        || left.eventId.localeCompare(right.eventId),
    );
}
