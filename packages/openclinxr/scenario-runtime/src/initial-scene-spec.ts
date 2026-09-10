/**
 * Reviewable initial scene specification for one encounter.
 *
 * Reports each required asset as satisfied/unsatisfied with observed evidence,
 * naming one of the two real (currently unwired) consumers from the diagnosis:
 * `spatialState.objectTransforms` (session-state/src/session-core.ts:127) or
 * `StationRunOptions.doorway` (domain/src/station-state.ts:36-39). With only an
 * assetId as routing input, consumers alternate deterministically so both real
 * consumers are named and the report is stable. Creates no readiness phase.
 */
import type { InitialSceneSpec as SharedInitialSceneSpec } from "@openclinxr/shared-schemas";

export const REQUIRED_STATE_OUTCOMES = [
  "satisfied",
  "unsatisfied",
  "pending",
  "unknown",
] as const;

export function requiredStateOutcomePromotes(outcome: string): boolean {
  return outcome === "satisfied";
}

/**
 * The report shape. Assignability to the contracted shared-schemas type is
 * checked below, so the literal the builder emits cannot drift from the type
 * the package publishes.
 */
type InitialSceneSpecReport = SharedInitialSceneSpec;

/**
 * Which real consumer a required asset is checked against.
 *
 * DERIVED FROM THE ASSET IDENTITY, never from its position in the list. The first version of this
 * function used `index % 2`, so swapping two entries in `assetNeeds` moved the monitor from
 * `spatialState.objectTransforms` to `StationRunOptions.doorway` — a consumer binding that changes
 * when nothing about the scene changed. acceptance-v2.md: "never alternate labels by index".
 *
 * A caller that has an ACTUAL observed binding passes it in `consumerBindings` and this is not
 * consulted. This is the fallback for a spec built before any consumer has reported, and it is
 * stable rather than correct: it guarantees the same asset always lands on the same consumer.
 */
function stableConsumerFor(assetId: string): "spatialState.objectTransforms" | "StationRunOptions.doorway" {
  let accumulator = 0;
  for (let index = 0; index < assetId.length; index += 1) accumulator = (accumulator * 31 + assetId.charCodeAt(index)) >>> 0;
  return accumulator % 2 === 0 ? "spatialState.objectTransforms" : "StationRunOptions.doorway";
}

export function buildInitialSceneSpec(input: {
  scenario: { scenarioId: string; assetNeeds?: Array<{ assetId: string }> };
  presentAssetIds: readonly string[];
  /** Observed consumer bindings, when a consumer has actually reported which one holds the asset. */
  consumerBindings?: ReadonlyArray<{
    assetId: string;
    consumer: "spatialState.objectTransforms" | "StationRunOptions.doorway";
  }>;
}): InitialSceneSpecReport {
  const present = new Set(input.presentAssetIds);
  const observedConsumers = new Map((input.consumerBindings ?? []).map((entry) => [entry.assetId, entry.consumer]));
  const needs = input.scenario.assetNeeds ?? [];
  const report: InitialSceneSpecReport = {
    schemaVersion: "openclinxr.initial-scene-spec.v1",
    scenarioId: input.scenario.scenarioId,
    requiredAssets: needs.map((need) => {
      const isPresent = present.has(need.assetId);
      return {
        assetId: need.assetId,
        satisfied: isPresent,
        consumer: observedConsumers.get(need.assetId) ?? stableConsumerFor(need.assetId),
        outcome: (isPresent ? "satisfied" : "unsatisfied") as
          | "satisfied"
          | "unsatisfied"
          | "pending"
          | "unknown",
        evidence: isPresent
          ? `asset ${need.assetId} found among ${present.size} present asset(s)`
          : `asset ${need.assetId} absent from ${present.size} present asset(s)`,
      };
    }),
  };
  return report;
}

/**
 * THE CONSUMER. Decide whether a station's required starting states permit promotion.
 *
 * Brief §7 step 0: "Required contents and states must have ACTUAL CONSUMERS; report
 * missing/unsupported requirements and preserve deliberately absent or unconnected items." And on
 * the outcomes: "Pending means an identified consumer is still loading; unknown means no adequate
 * observation yet. Neither permits required-state promotion."
 *
 * `buildInitialSceneSpec` reported and nothing read it, which is this repo's characteristic defect
 * — a mechanism that lands correct and inert. This is the read.
 *
 * WHAT IT DELIBERATELY IS NOT. Step 0's own out-of-scope forbids "creating a scene-readiness phase,
 * changing the phase machine". So this does not block a phase or gate `startEncounter`. It answers
 * a question — may this station be promoted on its starting states? — and the caller records the
 * answer. A promotion decision that nobody can read is the thing being fixed; a phase gate nobody
 * asked for would be a different defect.
 *
 * ONLY `satisfied` PROMOTES, which `requiredStateOutcomePromotes` already encodes. `pending` and
 * `unknown` are refusals here, not soft passes: the brief says neither permits promotion, and
 * treating "still loading" as good enough is how a station promotes on assets that never arrived.
 */
export type ScenePromotionDecision = {
  promotes: boolean;
  /** Every required asset that blocked promotion, with its outcome and observed evidence. */
  blockedBy: Array<{ assetId: string; outcome: string; consumer: string; evidence: string }>;
  /** Count of required assets considered, so an EMPTY spec is distinguishable from a passing one. */
  requiredAssetCount: number;
  /**
   * Required states the encounter must NOT begin with already done, with the reason each is
   * refused. Empty when nothing was declared learner-owned.
   */
  refusedPreCompletions: Array<{ stateId: string; ownedBy: string; reason: string }>;
  /**
   * Runtime-owned required starting states that are NOT satisfied, with the reason each refuses.
   *
   * THE HOLE THIS CLOSES. The first version of this function read `requiredStates` only to catch a
   * learner-owned state that was already complete. A runtime-owned state reported `unsatisfied`,
   * `pending` or `unknown` — the monitor that never powered on — passed straight through, because
   * nothing filtered on it. `requiredStateOutcomePromotes` already said only `satisfied` promotes;
   * this is the caller that finally applies it to the states as well as the assets.
   */
  refusedRuntimeStates: Array<{ stateId: string; ownedBy: string; outcome: string; reason: string }>;
};

/**
 * A required starting state, and WHO completes it.
 *
 * Brief §3, first planner slice: *"If connecting equipment is a learner task, do not pre-complete
 * it."* A learner-owned state is not a scene requirement the planner may satisfy — satisfying it is
 * the exam. The planner records that the state exists and that it starts incomplete.
 */
export type RequiredStartingState = {
  stateId: string;
  ownedBy: "runtime" | "learner";
  /** What the specification asserts about the state at start. */
  outcome: string;
  evidence: string;
};

export function initialSceneSpecPermitsPromotion(
  report: InitialSceneSpecReport,
  /** Declared starting states beside the asset list. Absent means none were declared. */
  requiredStates: readonly RequiredStartingState[] = [],
): ScenePromotionDecision {
  const blockedBy = report.requiredAssets
    .filter((required) => !requiredStateOutcomePromotes(required.outcome))
    .map((required) => ({
      assetId: required.assetId,
      outcome: required.outcome,
      consumer: required.consumer,
      evidence: required.evidence,
    }));
  // A learner-owned state reported as already satisfied is the planner pre-completing the exam.
  // It blocks promotion in its own right: a station that starts with the learner's task done is
  // not the station the case authored, and the failure is invisible in the asset list.
  const refusedPreCompletions = requiredStates
    .filter((state) => state.ownedBy === "learner" && requiredStateOutcomePromotes(state.outcome))
    .map((state) => ({
      stateId: state.stateId,
      ownedBy: state.ownedBy,
      reason:
        `the specification reports ${state.stateId} as satisfied at start, but it is learner-owned: `
        + "completing it is the exam, so a starting scene that has already done it removes the task. "
        + `Observed evidence: ${state.evidence}`,
    }));
  const refusedRuntimeStates = requiredStates
    .filter((state) => state.ownedBy === "runtime" && !requiredStateOutcomePromotes(state.outcome))
    .map((state) => ({
      stateId: state.stateId,
      ownedBy: state.ownedBy,
      outcome: state.outcome,
      reason:
        `${state.stateId} is runtime-owned and reported ${state.outcome} at start; only satisfied permits `
        + `promotion, so the encounter must not begin. Observed evidence: ${state.evidence}`,
    }));
  return {
    promotes: blockedBy.length === 0 && refusedPreCompletions.length === 0 && refusedRuntimeStates.length === 0,
    blockedBy,
    // A spec with NO required assets promotes vacuously. The count is returned so a caller can
    // tell "everything required is satisfied" from "nothing was required", which are different
    // claims and only one of them is evidence.
    requiredAssetCount: report.requiredAssets.length,
    refusedPreCompletions,
    refusedRuntimeStates,
  };
}
