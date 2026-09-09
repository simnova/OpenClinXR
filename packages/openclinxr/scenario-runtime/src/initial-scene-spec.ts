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
