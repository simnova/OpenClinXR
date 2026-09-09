import { type Static, Type } from "@sinclair/typebox";

/**
 * A required STARTING predicate the case declares, and the actual consumer that must observe it.
 *
 * acceptance-v2.md: "Observe actual consumers for each predicate, keyed by entity/instance,
 * version and capability; never alternate labels by index or treat a supplied asset-ID set as
 * proof of power, connection, support or loading."
 *
 * So a requirement names three things a list index cannot supply: the CAPABILITY a consumer must
 * report on, the exact realized INSTANCE it is bound to, and the revision of the requirement
 * itself. An observation that does not match all three is about something else.
 */
export const SceneStartingRequirementSchema = Type.Object({
  requirementId: Type.String({ minLength: 1 }),
  /**
   * Who completes it. `runtime` requirements must be verified before admission; `learner`
   * requirements are the exam and must NOT be complete at start.
   */
  ownedBy: Type.Union([Type.Literal("runtime"), Type.Literal("learner")]),
  /** The capability an actual consumer reports on, e.g. `equipment.power`, `equipment.connection`. */
  capability: Type.String({ minLength: 1 }),
  /** The exact realized instance. Two copies of one equipment type are two instances. */
  instanceId: Type.String({ minLength: 1 }),
  /** The value the case authored for the START of the encounter. */
  expectedInitialValue: Type.Union([Type.String(), Type.Boolean(), Type.Number()]),
  /**
   * For a learner-owned requirement, the value reaching it COMPLETES the task. Distinct from
   * {@link SceneStartingRequirementSchema} `expectedInitialValue`: a monitor authored
   * `connected=false` at start with `goalValue=true` is a learner task that begins incomplete.
   */
  goalValue: Type.Optional(Type.Union([Type.String(), Type.Boolean(), Type.Number()])),
  requirementRevision: Type.String({ minLength: 1 }),
});

export type SceneStartingRequirement = Static<typeof SceneStartingRequirementSchema>;
