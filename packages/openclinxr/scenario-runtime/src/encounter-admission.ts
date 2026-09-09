import type { Scenario } from "@openclinxr/shared-schemas";

/**
 * A required STARTING predicate, taken structurally from the case rather than re-declared.
 *
 * `@openclinxr/shared-schemas` owns the TypeBox schema that puts `startingRequirements` on
 * `Scenario`, and deliberately does NOT republish a named type for it: that package's root
 * entrypoint sits at a shrink-only export ceiling of 75 symbols, and this card may not raise it.
 * Deriving the type keeps one definition and adds no published symbol.
 */
export type SceneStartingRequirement = NonNullable<Scenario["startingRequirements"]>[number];

/**
 * One consumer's observation of one requirement, bound to the run that produced it.
 *
 * This is a RUNTIME record, not case data, so it lives with the runtime that owns it rather than
 * in the case schema. `source` exists so a client cannot author its own success: only a runtime
 * consumer observation is admissible evidence, and `client_supplied` is representable precisely so
 * the refusal is testable rather than impossible to express.
 */
export type SceneRequirementObservation = {
  requirementId: string;
  capability: string;
  /** The instance actually realized at observation time. A replacement changes this. */
  instanceId: string;
  instanceVersion: string;
  observedValue: string | boolean | number;
  outcome: "satisfied" | "unsatisfied" | "pending" | "unknown";
  observedAtMs: number;
  /** The active run this observation belongs to. Another run's record is not evidence here. */
  stationRunId: string;
  caseRevision: string;
  requirementRevision: string;
  source: "runtime_consumer_observation" | "client_supplied";
};

/**
 * Whether the case's required STARTING predicates permit this encounter to be admitted.
 *
 * This module is the decision; `encounter-admission-runtime.ts` is the runtime state it decides
 * over, and `ScenarioRuntime.startEncounter` is the owner that enforces it. Splitting it that way
 * is deliberate: acceptance-v2.md requires enforcement "in the existing preparation/admission
 * owners and transport, not by putting lifecycle calls into the pure specification module", and a
 * pure function is the only part a caller can test without a session.
 *
 * The refusal vocabulary below is exhaustive on purpose. A boolean `admits` tells a caller that
 * something was wrong; it does not tell an operator WHICH predicate, observed at what value, by
 * which consumer — and a refusal nobody can act on is how the previous slice ended up reporting
 * rather than enforcing.
 */
export type EncounterAdmissionRefusalReason =
  /** No consumer has reported on this requirement at all. Absence is `unknown`, and unknown refuses. */
  | "no_observation"
  | "required_outcome_unsatisfied"
  | "required_outcome_pending"
  | "required_outcome_unknown"
  /** The observed value is not what the case authored for the start of the encounter. */
  | "initial_predicate_mismatch"
  /** The record belongs to a different station run. Another run's success is not this run's evidence. */
  | "observation_wrong_run"
  /** Older than the freshness window: the world may have moved since it was observed. */
  | "observation_stale"
  /** The requirement was revised after the observation was taken. */
  | "observation_requirement_revision_replaced"
  /** The case was revised after the observation was taken. */
  | "observation_case_revision_replaced"
  /** The instance the observation describes is not the instance the requirement is bound to. */
  | "observation_instance_replaced"
  /** The capability observed is not the capability required. */
  | "observation_capability_mismatch"
  /** A client authored its own success. Only a runtime consumer observation is admissible. */
  | "client_authored_observation"
  /** A learner-owned requirement already sits at its goal value: the exam has been pre-completed. */
  | "learner_goal_already_satisfied";

export type EncounterAdmissionRefusal = {
  requirementId: string;
  reason: EncounterAdmissionRefusalReason;
  /** The observed value that produced the refusal, or `null` when nothing was observed. */
  observed: string | number | boolean | null;
  expected: string | number | boolean;
  /** Human-readable account carrying the consumer and instance, for the API/UI refusal body. */
  evidence: string;
};

export type EncounterAdmissionDecision = {
  admits: boolean;
  refusals: EncounterAdmissionRefusal[];
  /**
   * How many required predicates were considered. A caller can distinguish "everything required
   * was verified" from "nothing was required", which are different claims and only one is
   * evidence. acceptance-v2.md: "Empty/missing requirements cannot pass this nonempty case."
   */
  requirementCount: number;
  /** Requirement IDs whose observation was accepted, in declaration order. */
  acceptedRequirementIds: string[];
  /**
   * Learner-owned requirements confirmed still incomplete at admission, with the value observed.
   * A02/A03 both need this: the learner task must exist and must NOT be done.
   */
  learnerGoalsIncomplete: Array<{ requirementId: string; observed: string | number | boolean | null }>;
};

export type EvaluateEncounterAdmissionInput = {
  requirements: readonly SceneStartingRequirement[];
  /** Latest observation per requirement id, as the runtime recorded it. */
  observations: ReadonlyMap<string, SceneRequirementObservation>;
  stationRunId: string;
  caseRevision: string;
  nowMs: number;
  /** Maximum age an observation may have at admission. */
  observationFreshnessMs: number;
};

function describe(
  requirement: SceneStartingRequirement,
  observation: SceneRequirementObservation | undefined,
): string {
  const consumer = observation ? `${observation.capability}@${observation.instanceId}` : requirement.capability;
  const version = observation ? ` version ${observation.instanceVersion}` : "";
  return `requirement ${requirement.requirementId} bound to ${requirement.instanceId}, consumer ${consumer}${version}`;
}

/**
 * Reject an observation that cannot speak for this requirement in this run, whatever it says.
 *
 * These are checked BEFORE the outcome, because an observation from another run, another instance
 * or a client can carry `outcome: "satisfied"` — and reading the outcome first is exactly how a
 * replayed acknowledgment admits an encounter.
 */
function bindingRefusal(
  requirement: SceneStartingRequirement,
  observation: SceneRequirementObservation,
  input: EvaluateEncounterAdmissionInput,
): EncounterAdmissionRefusalReason | undefined {
  if (observation.source !== "runtime_consumer_observation") return "client_authored_observation";
  if (observation.stationRunId !== input.stationRunId) return "observation_wrong_run";
  if (observation.capability !== requirement.capability) return "observation_capability_mismatch";
  if (observation.instanceId !== requirement.instanceId) return "observation_instance_replaced";
  if (observation.requirementRevision !== requirement.requirementRevision) {
    return "observation_requirement_revision_replaced";
  }
  if (observation.caseRevision !== input.caseRevision) return "observation_case_revision_replaced";
  if (input.nowMs - observation.observedAtMs > input.observationFreshnessMs) return "observation_stale";
  return undefined;
}

const OUTCOME_REFUSAL = {
  unsatisfied: "required_outcome_unsatisfied",
  pending: "required_outcome_pending",
  unknown: "required_outcome_unknown",
} as const satisfies Record<string, EncounterAdmissionRefusalReason>;

export function evaluateEncounterAdmission(
  input: EvaluateEncounterAdmissionInput,
): EncounterAdmissionDecision {
  const refusals: EncounterAdmissionRefusal[] = [];
  const acceptedRequirementIds: string[] = [];
  const learnerGoalsIncomplete: EncounterAdmissionDecision["learnerGoalsIncomplete"] = [];

  for (const requirement of input.requirements) {
    const observation = input.observations.get(requirement.requirementId);
    const refuse = (reason: EncounterAdmissionRefusalReason): void => {
      refusals.push({
        requirementId: requirement.requirementId,
        reason,
        observed: observation ? observation.observedValue : null,
        expected: requirement.expectedInitialValue,
        evidence: describe(requirement, observation),
      });
    };

    if (!observation) {
      // A learner-owned requirement with no observation is NOT a refusal: acceptance-v2.md says
      // "Unknown/pending is not proof of verified incompleteness", and the symmetric reading is
      // that it is not proof of completeness either. It cannot pre-complete the exam, so it
      // cannot block entry — but it also cannot be reported as a verified incomplete goal.
      if (requirement.ownedBy === "runtime") refuse("no_observation");
      continue;
    }

    const binding = bindingRefusal(requirement, observation, input);
    if (binding) {
      refuse(binding);
      continue;
    }

    if (requirement.ownedBy === "learner") {
      // The discriminator. A learner requirement is refused for sitting at its GOAL, never for
      // sitting at its authored initial value — an observed `connected=false` is exactly the
      // starting state the case authored and must admit.
      if (requirement.goalValue !== undefined && observation.observedValue === requirement.goalValue) {
        refuse("learner_goal_already_satisfied");
        continue;
      }
      if (observation.outcome === "satisfied" && observation.observedValue === requirement.expectedInitialValue) {
        learnerGoalsIncomplete.push({
          requirementId: requirement.requirementId,
          observed: observation.observedValue,
        });
        acceptedRequirementIds.push(requirement.requirementId);
      }
      continue;
    }

    if (observation.outcome !== "satisfied") {
      refuse(OUTCOME_REFUSAL[observation.outcome]);
      continue;
    }
    if (observation.observedValue !== requirement.expectedInitialValue) {
      refuse("initial_predicate_mismatch");
      continue;
    }
    acceptedRequirementIds.push(requirement.requirementId);
  }

  return {
    admits: refusals.length === 0,
    refusals,
    requirementCount: input.requirements.length,
    acceptedRequirementIds,
    learnerGoalsIncomplete,
  };
}

/** The refusal text the admission owner throws, which the API maps to `station_command_invalid`. */
export function encounterAdmissionRefusalMessage(decision: EncounterAdmissionDecision): string {
  const detail = decision.refusals
    .map((refusal) => `${refusal.requirementId}: ${refusal.reason} (observed ${String(refusal.observed)}, ${refusal.evidence})`)
    .join("; ");
  return `Cannot start encounter: ${decision.refusals.length} required starting predicate(s) refused admission — ${detail}`;
}
