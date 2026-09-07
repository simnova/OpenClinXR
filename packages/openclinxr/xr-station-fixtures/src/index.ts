/**
 * Station fixtures and equipment mounting phase — extracted from apps/ui-xr/src/main.ts
 * Lines ~3070-3180: #186 fixture role ownership suppression, #140/#185 plan equipment
 * BEFORE room props (XOR exclusive-mount rule), #140 mount equipment from manifest,
 * #209 stamp fixture-suppressed declared ids (no dual mesh).
 *
 * The app owns all module state and builds the context object; this package reads
 * through accessors and never exports or holds mutable module-scope values.
 */

import type {
  StationFixturesContext,
  StationFixturesResult,
} from "./types.js";

export type { StationFixturesContext, StationFixturesResult } from "./types.js";

import type {
  Group,
  Mesh,
  Scene,
  Color,
  WebGLRenderer,
  PerspectiveCamera,
  Object3D,
} from "three";
import type { StationRoomResult } from "@openclinxr/xr-station-room";
import type { EquipmentMountPlanItem, EquipmentMountSource, DeclaredEquipmentEvidenceItem, BuildRoomPropInput } from "@openclinxr/xr-station";
import type { EncounterRuntimeRoomProp, EncounterRuntimeEquipmentAsset } from "@openclinxr/asset-registry/runtime-bundles";

/**
 * Build the station fixtures and equipment mounts.
 * This covers the phase from line ~3070 to ~3180 in main.ts:
 * - #186: roles owned by shell fixtures suppress dual roomProp / equipment meshes
 * - #140 / #185: plan equipment BEFORE room props so the XOR exclusive-mount rule can skip
 *                builder-backed roomProps already claimed by the equipment channel
 * - #140: mount equipment declared by this station scene manifest / bundle
 * - #209: stamp fixture-suppressed declared ids (no dual mesh)
 */
export async function buildStationFixturesAndEquipment(
  ctx: StationFixturesContext,
  stationRoomResult: StationRoomResult,
  scene: Scene,
): Promise<StationFixturesResult> {
  const {
    scenarioId,
    encounterBundle,
    scenarioTheme,
    sceneObjectPrefix,
    selectedCaptureMode,
    hideRoomForCleanCapture,
    edBayVisibleCapture,
    selectedScenarioRuntimeMismatch,
    runtimeSceneObjectPrefix,
    assetLoadingContext,
    recordBootPhase,
    iwsdkStationSceneObjects,
    Scene: SceneCtor,
    Group: GroupCtor,
    Mesh: MeshCtor,
    BoxGeometry,
    MeshStandardMaterial,
    Color: ColorCtor,
    GLTFLoader,
    planStationEquipmentMounts,
    buildGltfEquipmentPlaceholderSlot,
    buildDeclaredEquipmentGeometry,
    findRuntimeEquipmentAsset,
    loadPackageGeneratedEquipmentIntoSceneSlot,
    resolveEmulatorRuntimeAssetUrl,
    runtimeGeneratedSceneObjectName,
    isDynamicGeneratedEncounterSceneMode,
    addPediatricRespiratoryEquipmentCues,
    stampRoomPropAliasesOnEquipmentRoot,
    createActorNameplate,
    stampSuppressedDeclaredEquipmentOntoFixtures,
    countEquipmentGeometry,
    shouldRenderRoomProp,
    roomPropColourNumbers,
    roomPropSuppressedByFixtureOwnership,
    buildRoomPropGroup,
    hasVector3,
    registerReactiveProp,
    createAffordanceMarker,
    roomPropObjectPrefix,
  } = ctx;

  const bundle = encounterBundle();
  const prefix = runtimeSceneObjectPrefix();
  const fixtureOwnedRoles = stationRoomResult.fixtureOwnedRoles;

  // #140 / #185 — plan equipment BEFORE room props so the XOR exclusive-mount rule
  // can skip builder-backed roomProps already claimed by the equipment channel.
  const runtimeEquipmentSlotsByAssetId = new Map<string, Group>();
  const equipmentPlan = planStationEquipmentMounts({
    scenarioId: bundle.scenarioId,
    equipment: bundle.equipment,
    equipmentPlacements: bundle.sceneManifest.equipmentPlacements ?? {},
    fixtureOwnedRoles,
  });
  const exclusiveMountedEquipmentIds = new Set(equipmentPlan.map((item) => item.equipmentId));

  // Room props (created by xr-scene-cues, filtered by equipment plan)
  const roomPropContext = {
    scenarioObjectPrefix: prefix,
    shouldRenderRoomProp,
    roomPropColourNumbers,
    roomPropSuppressedByFixtureOwnership,
    buildRoomPropGroup,
    hasVector3,
    registerReactiveProp,
    createAffordanceMarker,
    createActorNameplate,
    roomPropObjectPrefix,
  };

  const roomProps = (await import("@openclinxr/xr-scene-cues"))
    .createDetailedEdRoomProps(roomPropContext, bundle.sceneManifest.roomProps, fixtureOwnedRoles, exclusiveMountedEquipmentIds);

  for (const prop of roomProps) {
    if (selectedScenarioRuntimeMismatch()) {
      prop.visible = false;
      prop.userData.openClinXrDynamicScenePolicy = "hidden_because_selected_scenario_specific_3d_bundle_missing";
    } else if (hideRoomForCleanCapture()) {
      prop.visible = false;
      prop.userData.openClinXrCaptureDeclutterPolicy = "hidden_for_clean_humanoid_source_comparator_capture";
    } else if (bundle.scenarioId === "ob_headache_preeclampsia_triage_v1") {
      prop.visible = false;
      prop.userData.openClinXrObVisualReviewPolicy = "hidden_when_ob_specific_set_dressing_supplies_required_context_without_generic_prop_artifacts";
    }
    scene.add(prop);
  }

  // #140 — mount equipment declared by this station's scene manifest / bundle
  // (parametric multi-mesh for kinds without real GLBs; keep ED bay GLBs).
  const equipmentEvidenceItems: DeclaredEquipmentEvidenceItem[] = [];
  for (const item of equipmentPlan) {
    const slot =
      item.source === "gltf"
        ? buildGltfEquipmentPlaceholderSlot(item.equipmentId)
        : buildDeclaredEquipmentGeometry(item.equipmentId);
    if (item.equipmentId === "ecg_cart_equipment" && !isDynamicGeneratedEncounterSceneMode()) {
      slot.name = iwsdkStationSceneObjects.ecgCart;
    } else if (item.equipmentId === "iv_stand_equipment" && !isDynamicGeneratedEncounterSceneMode()) {
      slot.name = iwsdkStationSceneObjects.ivPoleWithPump;
    } else {
      slot.name = `${prefix}.generated-equipment-slot.${item.equipmentId}`;
    }
    slot.position.set(item.position.x, item.position.y, item.position.z);
    slot.visible = !selectedScenarioRuntimeMismatch();
    if (hideRoomForCleanCapture()) {
      slot.visible = false;
      slot.userData.openClinXrComparatorVisibilityPolicy = "hidden_for_clean_humanoid_source_comparator_capture";
    }
    slot.userData.openClinXrRuntimeEquipmentPlacementCueIds = item.interactionCueIds;
    slot.userData.openClinXrDynamicEncounterEquipmentSlot = "manifest_declared_equipment_mount";
    slot.userData.openClinXrEquipmentDeclared = item.declared;
    // #223: roomProp ids that alias to this builder (telehealth-tablet-stand → tablet_visit…)
    // so declared-equipment inspectors match the prop declaration without dual geometry.
    stampRoomPropAliasesOnEquipmentRoot(slot, item.equipmentId);
    slot.add(createActorNameplate(item.label, item.source === "gltf" ? 0x286b54 : 0x2563eb));
    scene.add(slot);

    // Register the slot for later access
    runtimeEquipmentSlotsByAssetId.set(item.equipmentId, slot);

    if (item.source === "gltf" && item.gltfFileName) {
      const equipmentAsset = findRuntimeEquipmentAsset(bundle, item.equipmentId);
      const bundleModel = equipmentAsset?.model;
      const assetId = equipmentAsset?.equipmentId ?? item.equipmentId;
      loadPackageGeneratedEquipmentIntoSceneSlot(assetLoadingContext(), slot, {
        assetPath: `/xr-assets/medical-equipment/${item.gltfFileName}`,
        assetId,
        objectName: bundleModel ? runtimeGeneratedSceneObjectName(bundleModel) : item.equipmentId,
      });
    } else {
      addPediatricRespiratoryEquipmentCues(slot, item.equipmentId);
    }
    const counts = countEquipmentGeometry(slot);
    equipmentEvidenceItems.push({
      equipmentId: item.equipmentId,
      source: item.source,
      triangleCount: counts.triangleCount,
      meshCount: counts.meshCount,
    });
  }

  // #209: stamp fixture-suppressed declared ids (no dual mesh). Helper lives in xr-station.
  equipmentEvidenceItems.push(
    ...stampSuppressedDeclaredEquipmentOntoFixtures({
      shell: stationRoomResult.stationEnvironment,
      plannedEquipmentIds: equipmentPlan.map((item) => item.equipmentId),
      equipmentPlacements: bundle.sceneManifest.equipmentPlacements ?? {},
      equipment: bundle.equipment,
      roomProps: bundle.sceneManifest.roomProps,
    }),
  );

  return {
    equipmentEvidenceItems,
    runtimeEquipmentSlotsByAssetId,
  };
}