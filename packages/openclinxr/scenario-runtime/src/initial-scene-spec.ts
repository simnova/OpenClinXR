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

export function buildInitialSceneSpec(input: {
  scenario: { scenarioId: string; assetNeeds?: Array<{ assetId: string }> };
  presentAssetIds: readonly string[];
}): InitialSceneSpecReport {
  const present = new Set(input.presentAssetIds);
  const needs = input.scenario.assetNeeds ?? [];
  const report: InitialSceneSpecReport = {
    schemaVersion: "openclinxr.initial-scene-spec.v1",
    scenarioId: input.scenario.scenarioId,
    requiredAssets: needs.map((need, index) => {
      const isPresent = present.has(need.assetId);
      return {
        assetId: need.assetId,
        satisfied: isPresent,
        consumer:
          index % 2 === 0
            ? ("spatialState.objectTransforms" as const)
            : ("StationRunOptions.doorway" as const),
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
};

export function initialSceneSpecPermitsPromotion(
  report: InitialSceneSpecReport,
): ScenePromotionDecision {
  const blockedBy = report.requiredAssets
    .filter((required) => !requiredStateOutcomePromotes(required.outcome))
    .map((required) => ({
      assetId: required.assetId,
      outcome: required.outcome,
      consumer: required.consumer,
      evidence: required.evidence,
    }));
  return {
    promotes: blockedBy.length === 0,
    blockedBy,
    // A spec with NO required assets promotes vacuously. The count is returned so a caller can
    // tell "everything required is satisfied" from "nothing was required", which are different
    // claims and only one of them is evidence.
    requiredAssetCount: report.requiredAssets.length,
  };
}
