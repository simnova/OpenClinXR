import type { LearnerRuntimeAssetBundle, EncounterRuntimeAsset } from "./runtime-bundles.js";
import { evaluateEncounterRuntimeLearnerUseGate } from "./runtime-bundles.js";

/**
 * THE SCENE-CLOSURE STATION, and it is DATA rather than a second parameter.
 *
 * No resolver in the tree maps a scenario id to its station: scenarios carry no station field,
 * the producer takes `stationId` as a caller parameter with an ED default, and the case source is
 * authoring input nothing under packages/ or apps/ may import. This table binds the case whose
 * frozen plan `CASE_FROZEN_SCENE_PLANS` carries to the bundle the runtime must build, and
 * `stationIdForSceneClosureScenario` is the resolution the app call site and this card's behavior
 * test both use — so the ordinary path and the tested path cannot disagree about which station a
 * scenario stages.
 *
 * A scenario with no frozen plan has no entry and resolves to undefined; the caller keeps its own
 * default, which is the honest answer for every encounter that has never been frozen.
 */
export const SCENE_CLOSURE_SCENARIO_STATION_ID: Readonly<Record<string, string>> = Object.freeze({
  "scene_closure_supine_bedside_v1": "scene_closure_supine_bedside_station_v1",
});

export function stationIdForSceneClosureScenario(scenarioId: string): string | undefined {
  return SCENE_CLOSURE_SCENARIO_STATION_ID[scenarioId];
}

/** The station fields an identity check needs. Structural so the app keeps owning its own type. */
export type PinnedStationSelection = {
  stationId: string;
  scenarioId: string;
};

export function inspectPinnedBundleIdentity(
  bundle: LearnerRuntimeAssetBundle,
  station: PinnedStationSelection,
  pinnedBundleId: string,
): string[] {
  const blockers: string[] = [];
  if (bundle.identityScope !== "learner_runtime_opaque_bundle") {
    blockers.push("identity_scope_mismatch");
  }
  if (bundle.bundleId !== pinnedBundleId) {
    blockers.push("pinned_bundle_id_mismatch");
  }
  if (bundle.stationId !== station.stationId) {
    blockers.push("station_id_mismatch");
  }
  if (bundle.scenarioId !== station.scenarioId) {
    blockers.push("scenario_id_mismatch");
  }
  return blockers;
}

export function inspectBundleEligibility(bundle: LearnerRuntimeAssetBundle): string[] {
  if (bundleUsesOnlyApprovedLocalFixtureAssets(bundle)) {
    return [];
  }
  const gate = evaluateEncounterRuntimeLearnerUseGate(bundle);
  if (gate.canUseGeneratedBundleForLearnerRuntime) {
    return [];
  }
  return gate.blockers.length > 0 ? [...gate.blockers] : ["learner_runtime_use_blocked"];
}

function bundleUsesOnlyApprovedLocalFixtureAssets(bundle: LearnerRuntimeAssetBundle): boolean {
  return runtimeBundleAssets(bundle).every((asset) =>
    asset.blob.storeKind === "app_public_fixture"
      && asset.reviewStatus !== "blocked"
      && (asset.reviewStatus === "fixture_approved_for_local_runtime"
        || asset.reviewStatus === "approved_for_local_runtime"),
  );
}

function runtimeBundleAssets(bundle: LearnerRuntimeAssetBundle): EncounterRuntimeAsset[] {
  return [
    bundle.environment,
    ...bundle.actors.map((actor) => actor.model),
    ...bundle.actors.flatMap((actor) => actor.animationClips),
    ...bundle.actors
      .map((actor) => actor.phonemeMap)
      .filter((asset): asset is EncounterRuntimeAsset => Boolean(asset)),
    ...bundle.equipment.map((equipment) => equipment.model),
  ];
}