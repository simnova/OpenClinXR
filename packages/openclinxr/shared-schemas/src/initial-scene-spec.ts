/**
 * Reviewable initial scene specification for one encounter.
 *
 * Each required asset names the unwired consumer it is checked against:
 * `spatialState.objectTransforms` (session-state/src/session-core.ts:127) or
 * `StationRunOptions.doorway` (domain/src/station-state.ts:36-39). No readiness
 * phase is created; this only reports starting-state checks with evidence.
 */

export const InitialSceneSpec = {
  schemaVersion: "openclinxr.initial-scene-spec.v1",
} as const;

export type InitialSceneSpec = {
  schemaVersion: typeof InitialSceneSpec.schemaVersion;
  scenarioId: string;
  requiredAssets: Array<{
    assetId: string;
    satisfied: boolean;
    consumer: "spatialState.objectTransforms" | "StationRunOptions.doorway";
    outcome: "satisfied" | "unsatisfied" | "pending" | "unknown";
    evidence: string;
  }>;
};
