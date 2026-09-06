/**
 * Scene-manifest + case-defined humanoid performance evidence builders —
 * extracted from apps/ui-xr/src/main.ts (shrink-only SIZE_FREEZE).
 *
 * The app-owned selectors (selected scenario, bundle match, embodiment lookup)
 * arrive as parameters; the package owns no module state.
 */

import { scenarioBank } from "@openclinxr/scenario-fixtures/scenario-bank";
import { edChestPainScenario } from "@openclinxr/scenario-fixtures/ed-chest-pain";
import type {
  EncounterRuntimeAsset,
  LearnerRuntimeAssetBundle,
} from "@openclinxr/asset-registry/runtime-bundles";
import type {
  CaseDefinedHumanoidPerformanceContractEvidence,
  CaseDefinedHumanoidRuntimeHandoffEvidence,
  RuntimeSceneManifestEvidence,
} from "@openclinxr/xr-runtime-state";

export function buildCaseDefinedHumanoidPerformanceContractEvidence(
  selectedScenarioId: string,
): CaseDefinedHumanoidPerformanceContractEvidence {
  const scenario = scenarioBank.find((candidate) => candidate.scenarioId === selectedScenarioId) ?? edChestPainScenario;
  const actors = scenario.actors.filter((actor) => actor.role !== "system");
  const actorRoles = Array.from(new Set(actors.map((actor) => actor.role))).sort();
  const emotionStates = Array.from(new Set(actors.flatMap((actor) => actor.communicationProfile?.baselineMood ?? [])));
  const dialogueDrivenVisemeMappingRequired = scenario.requiredTraceTags.length > 0;

  return {
    source: "case_definition_humanoid_performance_contract",
    scenarioId: scenario.scenarioId,
    claimBoundary: "case_definition_humanoid_performance_metadata_only",
    actorCount: actors.length,
    locomotionActorRoles: actorRoles,
    expressionActorRoles: actorRoles,
    gazeActorRoles: actorRoles,
    lipSyncActorRoles: dialogueDrivenVisemeMappingRequired ? actorRoles : [],
    interactiveActorRoles: actorRoles,
    emotionStateCount: emotionStates.length,
    dialogueDrivenVisemeMappingRequired,
    gazeTargetingRequired: actors.length > 1,
    locomotionPlanningRequired: scenario.eventSchedule.length > 0,
    notEvidenceFor: [
      "generated_humanoid_asset_readiness",
      "animation_quality",
      "quest_readiness",
      "runtime_readiness",
      "clinical_validity",
    ],
  };
}

export function formatCaseDefinedHumanoidPerformanceContractEvidence(evidence: CaseDefinedHumanoidPerformanceContractEvidence | null): string {
  if (!evidence) {
    return "case humanoid contract pending";
  }
  return [
    `case humanoid contract ${evidence.actorCount} actors`,
    `locomotion ${evidence.locomotionActorRoles.length}`,
    `expression ${evidence.expressionActorRoles.length}`,
    `gaze ${evidence.gazeActorRoles.length}`,
    `lip-sync ${evidence.lipSyncActorRoles.length}`,
    `interactivity ${evidence.interactiveActorRoles.length}`,
    `emotion states ${evidence.emotionStateCount}`,
    `viseme ${String(evidence.dialogueDrivenVisemeMappingRequired)}`,
    evidence.claimBoundary,
    `not readiness ${evidence.notEvidenceFor.join(",")}`,
  ].join(" | ");
}

export type RuntimeSceneManifestEvidenceInput = {
  bundle: LearnerRuntimeAssetBundle;
  selectedScenarioId: string;
  selectedScenarioMatchesBundle: boolean;
  actorEmbodimentFor: (bundle: LearnerRuntimeAssetBundle, actorId: string) => LearnerRuntimeAssetBundle["actors"][number]["embodiment"] | undefined;
};

export function buildRuntimeSceneManifestEvidence(input: RuntimeSceneManifestEvidenceInput): RuntimeSceneManifestEvidence {
  const { bundle } = input;
  const sceneManifestWithHumanoidRuntimeHandoff = bundle.sceneManifest as unknown as {
    caseDefinedHumanoidRuntimeHandoff?: unknown[];
  };
  const rawCaseDefinedHumanoidRuntimeHandoff = Array.isArray(sceneManifestWithHumanoidRuntimeHandoff.caseDefinedHumanoidRuntimeHandoff)
    ? sceneManifestWithHumanoidRuntimeHandoff.caseDefinedHumanoidRuntimeHandoff
    : [];
  const humanoidRuntimeHandoffNotEvidenceFor: CaseDefinedHumanoidRuntimeHandoffEvidence["notEvidenceFor"] = [
    "generated_humanoid_asset_readiness",
    "animation_quality",
    "quest_readiness",
    "runtime_readiness",
    "clinical_validity",
    "scoring_validity",
  ];
  const caseDefinedHumanoidRuntimeHandoff = rawCaseDefinedHumanoidRuntimeHandoff
    .filter((handoff): handoff is Record<string, unknown> => typeof handoff === "object" && handoff !== null)
    .map((handoff): CaseDefinedHumanoidRuntimeHandoffEvidence => ({
      claimBoundary: "case_definition_humanoid_runtime_handoff_metadata_only",
      actorRole: typeof handoff["actorRole"] === "string" ? (handoff["actorRole"] as string) : "unknown_actor_role",
      workOrderIds: Array.isArray(handoff["workOrderIds"])
        ? (handoff["workOrderIds"] as unknown[]).filter((workOrderId): workOrderId is string => typeof workOrderId === "string")
        : [],
      locomotionRequired: handoff["locomotionRequired"] === true,
      expressionRequired: handoff["expressionRequired"] === true,
      gazeRequired: handoff["gazeRequired"] === true,
      lipSyncRequired: handoff["lipSyncRequired"] === true,
      interactiveRequired: handoff["interactiveRequired"] === true,
      requiredSignalIds: Array.isArray(handoff["requiredSignalIds"])
        ? (handoff["requiredSignalIds"] as unknown[]).filter((signalId): signalId is string => typeof signalId === "string")
        : [],
      blockers: Array.isArray(handoff["blockers"])
        ? (handoff["blockers"] as unknown[]).filter((blocker): blocker is string => typeof blocker === "string")
        : [],
      notEvidenceFor: Array.isArray(handoff["notEvidenceFor"])
        ? (handoff["notEvidenceFor"] as unknown[]).filter((item): item is CaseDefinedHumanoidRuntimeHandoffEvidence["notEvidenceFor"][number] =>
          humanoidRuntimeHandoffNotEvidenceFor.includes(item as CaseDefinedHumanoidRuntimeHandoffEvidence["notEvidenceFor"][number])
        )
        : humanoidRuntimeHandoffNotEvidenceFor,
    }));
  return {
    source: "learner_runtime_asset_bundle_scene_manifest",
    manifestId: bundle.sceneManifest.manifestId,
    schemaVersion: bundle.sceneManifest.schemaVersion,
    selectedScenarioId: input.selectedScenarioId,
    bundleScenarioId: bundle.scenarioId,
    selectedScenarioMatchesBundle: input.selectedScenarioMatchesBundle,
    stationId: bundle.stationId,
    stationContextTitle: bundle.sceneManifest.stationContext?.title ?? null,
    stationContextChiefConcern: bundle.sceneManifest.stationContext?.chiefConcern ?? null,
    actorRoster: bundle.actors.map((actor) => ({
      actorId: actor.actorId,
      role: actor.role,
      embodiment: actor.embodiment,
    })),
    equipmentIds: bundle.equipment.map((equipment) => equipment.equipmentId),
    dialogueTraceTags: (bundle.sceneManifest.dialogueTurns ?? []).map((turn) => turn.traceTag),
    roomPropCount: bundle.sceneManifest.roomProps.length,
    semanticRoomPropCount: bundle.sceneManifest.roomProps.filter((prop) => Boolean(prop.semanticRole && prop.evidenceCue)).length,
    actorPlacementCount: Object.keys(bundle.sceneManifest.actorPlacements ?? {}).length,
    equipmentPlacementCount: Object.keys(bundle.sceneManifest.equipmentPlacements ?? {}).length,
    dialogueTurnCount: bundle.sceneManifest.dialogueTurns?.length ?? 0,
    virtualDeviceActorCount: bundle.actors.filter((actor) => actor.embodiment === "virtual_device").length,
    virtualDeviceDialogueRoutedCount: (bundle.sceneManifest.dialogueTurns ?? []).filter((turn) => input.actorEmbodimentFor(bundle, turn.actorId) === "virtual_device").length,
    generatedBySceneManifestCount: bundle.sceneManifest.roomProps.filter((prop) => prop.generatedBy === "scene_manifest").length,
    propIds: bundle.sceneManifest.roomProps.map((prop) => prop.propId),
    caseDefinedHumanoidRuntimeHandoffCount: caseDefinedHumanoidRuntimeHandoff.length,
    caseDefinedHumanoidRuntimeHandoffActorRoles: Array.from(new Set(caseDefinedHumanoidRuntimeHandoff
      .map((handoff) => typeof handoff.actorRole === "string" ? handoff.actorRole : "")
      .filter((actorRole) => actorRole.length > 0))),
    caseDefinedHumanoidRuntimeHandoffRequiredSignalIds: Array.from(new Set(caseDefinedHumanoidRuntimeHandoff.flatMap((handoff) =>
      Array.isArray(handoff.requiredSignalIds)
        ? handoff.requiredSignalIds.filter((signalId): signalId is string => typeof signalId === "string")
        : []
    ))),
    caseDefinedHumanoidRuntimeHandoff,
    storageBackedBundle: bundle.assetStoreKind === "azurite_blob" || bundle.assetStoreKind === "azure_blob",
    productionReadinessClaimed: false,
    notEvidenceFor: ["production_asset_readiness", "quest_readiness", "clinical_validity", "scoring_validity"],
  };
}

export function isGeneratedPlaceholderSourceForDifferentScenario(
  source: string,
  bundleScenarioId: string,
  generatedSceneMode: boolean,
  scenarioSpecificFixture: (normalizedSource: string) => boolean,
): boolean {
  const scenarioSlug = bundleScenarioId.replaceAll("_", "-");
  const normalizedSource = source.toLowerCase();
  if (scenarioSpecificFixture(normalizedSource)) {
    return false;
  }
  return generatedSceneMode
    && !normalizedSource.includes(bundleScenarioId.toLowerCase())
    && !normalizedSource.includes(scenarioSlug.toLowerCase());
}

export function isGeneratedPlaceholderAssetForDifferentScenario(
  asset: EncounterRuntimeAsset,
  bundleScenarioId: string,
  generatedSceneMode: boolean,
  scenarioSpecificFixture: (normalizedSource: string) => boolean,
): boolean {
  return isGeneratedPlaceholderSourceForDifferentScenario(
    `${asset.blob.blobName} ${asset.blob.url ?? ""}`,
    bundleScenarioId,
    generatedSceneMode,
    scenarioSpecificFixture,
  );
}

export function shouldSuppressGeneratedEquipmentModel(
  assetPath: string,
  isRealLibraryEquipmentPath: (assetPath: string) => boolean,
  isPlaceholderSource: (source: string) => boolean,
): boolean {
  // Real library medical-equipment GLBs are shared clinical equipment, never scenario-mismatched placeholders (#140 counterweight; #245 wall clock).
  if (isRealLibraryEquipmentPath(assetPath)) {
    return false;
  }
  return isPlaceholderSource(assetPath);
}

export function shouldSuppressGeneratedEnvironmentShell(
  asset: EncounterRuntimeAsset,
  isPlaceholderAsset: (asset: EncounterRuntimeAsset) => boolean,
): boolean {
  return isPlaceholderAsset(asset);
}
