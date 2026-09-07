/**
 * Station room shell and environment loading — extracted from apps/ui-xr/src/main.ts
 * Lines ~3010-3202: #44 station shell from shared environmentId descriptor,
 * Case-env glTF handoff, #336 generated Infinigen room, Env glTF container,
 * Load produced/stub env glTF, bed, monitor, scenario mismatch panel.
 * Ends where fixture and equipment role suppression begins (#186 / #140 / #185).
 */

import type {
  StationRoomContext,
  StationRoomResult,
  StationRoomScenarioTheme,
} from "./types.js";

// The context and result types are the package's contract with main.ts, which declares its
// own local variables against them. Re-export them.
export type { StationRoomContext, StationRoomResult, StationRoomScenarioTheme };
import type { LearnerRuntimeAssetBundle, EncounterRuntimeAsset } from "@openclinxr/asset-registry/runtime-bundles";
import type { StationContextView } from "@openclinxr/xr-station";
import type { Group, Mesh, Scene, Color, WebGLRenderer, PerspectiveCamera, Object3D } from "three";
import type { GLTF } from "three/addons/loaders/GLTFLoader.js";

/**
 * Build the station room shell and load environment assets.
 * This covers the phase from line ~3010 to ~3202 in main.ts:
 * - #44: station shell from shared environmentId descriptor
 * - Case-env glTF handoff (factory caseDerivedVirtualEnvironment -> player load)
 * - #336: generated Infinigen room selected by environmentId; procedural box stays as fallback
 * - Env glTF container for factory-produced world assets
 * - Load produced/stub env glTF into the container when available
 * - Bed and monitor meshes
 * - Scenario mismatch panel
 * - Environment shell loading
 * Ends where fixture and equipment role suppression begins (#186 / #140 / #185).
 */
export async function buildStationRoomShell(
  ctx: StationRoomContext,
  scene: Scene,
  renderer: WebGLRenderer,
  camera: PerspectiveCamera,
): Promise<StationRoomResult> {
  const {
    scenarioId,
    encounterBundle,
    scenarioTheme,
    sceneObjectPrefix,
    selectedCaptureMode,
    isCaptureShadowPath,
    hideRoomForCleanCapture,
    edBayVisibleCapture,
    selectedScenarioRuntimeMismatch,
    activeEnvironmentId,
    stationInteriorLightingVariantId,
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
    applyStationInteriorLightingForEnvironment,
    addPackageReusableExteriorPreEncounterRoom,
    mountStationEnvironmentForRuntime,
    loadInfinigenEnvironmentIntoStation,
    addPackageScenarioSpecificClinicalSetDressing,
    createReadableVrTextPanel,
    addScenarioExpectationPanel,
    shouldSuppressGeneratedEnvironmentShell,
    loadPackageGeneratedEnvironmentIntoSceneSlot,
    resolveEmulatorRuntimeAssetUrl,
    runtimeGeneratedSceneObjectName,
    isDynamicGeneratedEncounterSceneMode,
    enableCaptureRendererShadowMap,
    markFloorReceiveShadow,
    stationContextForScenario,
  } = ctx;

  const bundle = encounterBundle();
  const theme = scenarioTheme();
  const prefix = runtimeSceneObjectPrefix();

  // Apply station interior lighting
  await applyStationInteriorLightingForEnvironment({
    scene,
    renderer,
    environmentId: activeEnvironmentId(),
    variantId: stationInteriorLightingVariantId(),
    ambientLightName: iwsdkStationSceneObjects.ambientLight,
    keyLightName: iwsdkStationSceneObjects.keyLight,
    keyCastShadow: isCaptureShadowPath(selectedCaptureMode()),
  });

  // Add reusable exterior pre-encounter room (anteroom)
  let reusableExteriorAnteroom: Group | null = null;
  addPackageReusableExteriorPreEncounterRoom(assetLoadingContext(), scene, theme as any, (room: Group | null) => {
    reusableExteriorAnteroom = room;
  });

  // #44: station shell from shared environmentId descriptor (not scenarioId doorway tint alone).
  const envId = activeEnvironmentId();
  const stationEnvironment = await mountStationEnvironmentForRuntime({
    environmentId: envId,
    environment: bundle.environment,
  });

  // Floor mesh from environment or fallback procedural box
  const floor = (stationEnvironment.userData.floorMesh as Mesh | undefined)
    ?? new MeshCtor(
      new BoxGeometry(7, 0.08, 3.45),
      new MeshStandardMaterial({ color: theme.floorColor, roughness: 0.8 }),
    );
  floor.name = iwsdkStationSceneObjects.floor;

  if (isCaptureShadowPath(selectedCaptureMode())) {
    enableCaptureRendererShadowMap(renderer);
    markFloorReceiveShadow(floor);
  }

  floor.userData.openClinXrSceneNecessityPolicy = "dynamic_encounter_world_floor_from_environment_descriptor";
  floor.userData.openClinXrEncounterSpecificRuntimeTheme = "floor_color_derived_from_environmentId_descriptor";
  floor.userData.openClinXrPortalBoundaryPolicy = "belongs_to_dynamic_world_on_encounter_side_of_doorway";

  if (hideRoomForCleanCapture()) {
    stationEnvironment.visible = false;
    floor.visible = false;
    floor.userData.openClinXrComparatorVisibilityPolicy = "hidden_for_clean_humanoid_source_comparator_capture";
  } else if (edBayVisibleCapture()) {
    floor.userData.openClinXrComparatorVisibilityPolicy = "kept_visible_for_ed_bay_visible_comparator_capture";
  }

  // Case-env glTF handoff (factory caseDerivedVirtualEnvironment -> player load).
  // #85 + #189: NEVER load a humanoid/candidate GLB as "environment".
  floor.userData.caseDerivedVirtualEnvGltfHandoff = {
    gltfAssetUrl: null,
    policy: "gltf handoff reserved for factory-produced ROOM shells only; humanoid candidates are actors via loadGeneratedHumanoidIntoActorSlot, never environment",
    source: "factory case spec derivation + tech vet",
    producedManifestPath: (() => {
      const sid = bundle.scenarioId;
      const room = sid === "peds_asthma_parent_anxiety_v1"
        ? "peds_asthma_clinic_exam_room"
        : sid === "ed_chest_pain_priority_v1"
          ? "ed_trauma_bay"
          : null;
      return room ? `/tmp/openclinxr-produced-env-gltf-${room}.json` : null;
    })(),
    producedGltfUrl: null as string | null,
  };

  scene.add(stationEnvironment);
  scene.userData.openClinXrStationEnvironment = {
    environmentId: envId,
    floorColor: stationEnvironment.userData.floorColor,
    roomDepthMeters: stationEnvironment.userData.roomDepthMeters,
    environmentFallbackActive: stationEnvironment.userData.environmentFallbackActive,
  };

  // #336: generated Infinigen room selected by environmentId; procedural box stays as fallback.
  if (!hideRoomForCleanCapture() && stationEnvironment.userData.openClinXrCompiledRoom !== true) {
    loadInfinigenEnvironmentIntoStation({
      scene,
      environmentId: envId,
      stationEnvironment,
      onStatus: (status) => {
        stationEnvironment.userData.openClinXrInfinigenEnvironmentStatus = status;
      },
    });
  }

  // Env glTF container for factory-produced world assets.
  const gltfEnvContainer = new GroupCtor();
  gltfEnvContainer.name = `${prefix}.case-env-gltf-container`;
  gltfEnvContainer.userData.openClinXrGltfEnvHandoff = floor.userData.caseDerivedVirtualEnvGltfHandoff;
  gltfEnvContainer.userData.producedManifestPath = floor.userData.caseDerivedVirtualEnvGltfHandoff?.producedManifestPath;
  gltfEnvContainer.userData.producedGltfUrl = floor.userData.caseDerivedVirtualEnvGltfHandoff?.producedGltfUrl;
  gltfEnvContainer.userData.openClinXrLaunchTestPolicy =
    "virtual env world launched in player (props + gltf handoff + authoring vet from case); experience via dev server + station select";

  if (hideRoomForCleanCapture()) {
    gltfEnvContainer.visible = false;
    gltfEnvContainer.userData.openClinXrComparatorVisibilityPolicy = "hidden_for_clean_humanoid_source_comparator_capture";
  }
  scene.add(gltfEnvContainer);

  // Load produced/stub env glTF into the container when available.
  const gltfUrlForActualLoad =
    floor.userData.caseDerivedVirtualEnvGltfHandoff?.producedGltfUrl ||
    floor.userData.caseDerivedVirtualEnvGltfHandoff?.gltfAssetUrl;

  if (gltfUrlForActualLoad && !hideRoomForCleanCapture()) {
    try {
      const loader = new GLTFLoader();
      loader.load(
        gltfUrlForActualLoad,
        (gltf: GLTF) => {
          gltfEnvContainer.add(gltf.scene);
          gltf.scene.userData.loadedFromFactoryCaseEnv = true;
          gltf.scene.userData.cuesFromGenDrive = "emotionTimeline / runtimeExecutionHints from case spec";

          // Deeper visual cue from drive (tint/scale on env gltf or props from emotion in launched player world).
          try {
            const cue =
              bundle.scenarioId === "peds_asthma_parent_anxiety_v1"
                ? "anxious_parent"
                : bundle.scenarioId === "ed_chest_pain_priority_v1"
                  ? "urgent"
                  : null;
            if (cue) {
              gltf.scene.traverse((obj: Object3D) => {
                if (obj instanceof MeshCtor && obj.material) {
                  const mat = Array.isArray(obj.material) ? obj.material[0] : obj.material;
                  if (mat && mat.emissive !== undefined) {
                    mat.emissive = new ColorCtor(
                      cue.includes("anx") || cue.includes("urgent") ? 0x1e3a5f : 0x000000,
                    );
                    mat.emissiveIntensity = 0.12;
                  }
                }
              });
              gltf.scene.userData.deeperVisualCueApplied = { cue, atLoad: true, source: "drive fromEmotion" };
            }
          } catch {
            // Non-fatal visual cue.
          }
        },
        undefined,
        (err: unknown) => {
          gltfEnvContainer.userData.actualGltfLoadError = err instanceof Error ? err.message : String(err);
          // world remains valid via the three props (exam_table etc) + container
        },
      );
    } catch (e) {
      gltfEnvContainer.userData.actualGltfLoadSetupError = String(e);
    }
  }

  if (!hideRoomForCleanCapture()) {
    // Room walls/floor: mountStationEnvironmentForRuntime; buildStationEnvironment is parametric fallback.
    addPackageScenarioSpecificClinicalSetDressing(assetLoadingContext(), scene, theme as any);
  }

  // Scenario mismatch panel
  if (selectedScenarioRuntimeMismatch()) {
    // main.ts supplies its own 1-argument wrapper, which passes the REAL clinical panel
    // context. An earlier version of this extraction built a throwaway { evidenceStore:
    // new Map() } here, which would have sent this panel's evidence nowhere.
    const mismatchPanel = createReadableVrTextPanel(
      {
        name: `${prefix}.scenario-specific-3d-pending-panel`,
        title: `${stationContextForScenario({ scenarioId: bundle.scenarioId, bundleMismatch: true }).title} 3D Pending`,
        lines: [
          "Scenario-specific 3D bundle is not loaded yet.",
          `Selected: ${scenarioId()}`,
          `Fallback bundle hidden: ${bundle.scenarioId}`,
          "Use factory materialization before realism review.",
        ],
        widthMeters: 2.8,
        heightMeters: 0.92,
        background: "#fff8e5",
        accent: "#d97706",
      },
    );
    mismatchPanel.mesh.position.set(0, 1.55, -1.25);
    mismatchPanel.mesh.userData.openClinXrScenarioMismatchPolicy =
      "selected_scenario_specific_3d_pending_ed_fallback_hidden_to_prevent_false_realism_evidence";
    scene.add(mismatchPanel.mesh);
  } else if (!hideRoomForCleanCapture()) {
    addScenarioExpectationPanel(scene, stationContextForScenario({ scenarioId: bundle.scenarioId }));
  }

  // Environment shell
  const environmentShell = new GroupCtor();
  environmentShell.name = iwsdkStationSceneObjects.environmentShell;

  if (selectedScenarioRuntimeMismatch()) {
    environmentShell.visible = false;
    environmentShell.userData.openClinXrDynamicScenePolicy = "hidden_because_selected_scenario_specific_3d_bundle_missing";
  } else if (shouldSuppressGeneratedEnvironmentShell(bundle.environment)) {
    environmentShell.visible = false;
    environmentShell.userData.openClinXrDynamicScenePolicy = "suppressed_mismatched_placeholder_environment_for_case_defined_scene_manifest";
  } else if (hideRoomForCleanCapture()) {
    environmentShell.visible = false;
    environmentShell.userData.openClinXrComparatorVisibilityPolicy = "hidden_for_clean_humanoid_source_comparator_capture";
  }
  // actorPoseReviewCapture not in scope for this phase
  scene.add(environmentShell);

  loadPackageGeneratedEnvironmentIntoSceneSlot(assetLoadingContext(), environmentShell, {
    assetPath: resolveEmulatorRuntimeAssetUrl(bundle.environment),
    assetId: bundle.environment.assetId,
    objectName: runtimeGeneratedSceneObjectName(bundle.environment),
  });

  // Bed
  const bed = new MeshCtor(
    new BoxGeometry(2.35, 0.24, 0.92),
    new MeshStandardMaterial({ color: 0xd9dde3, roughness: 0.65 }),
  );
  bed.name = iwsdkStationSceneObjects.bed;
  bed.position.set(-0.42, 0.42, -0.08);

  if (selectedScenarioRuntimeMismatch()) {
    bed.visible = false;
    bed.userData.openClinXrDynamicScenePolicy = "hidden_because_selected_scenario_specific_3d_bundle_missing";
  } else if (isDynamicGeneratedEncounterSceneMode()) {
    bed.visible = false;
    bed.userData.openClinXrDynamicScenePolicy = "hidden_when_scene_manifest_and_generated_environment_supply_encounter_context";
  } else if (hideRoomForCleanCapture()) {
    bed.visible = false;
    bed.userData.openClinXrComparatorVisibilityPolicy = "hidden_for_clean_humanoid_source_comparator_capture";
  }
  // actorPoseReviewCapture not in scope for this phase
  scene.add(bed);

  // Monitor
  const monitor = new MeshCtor(
    new BoxGeometry(0.8, 0.55, 0.08),
    new MeshStandardMaterial({ color: 0x203040, emissive: 0x0b3d2e }),
  );
  monitor.name = iwsdkStationSceneObjects.monitor;
  monitor.position.set(1.7, 1.45, -0.65);

  if (selectedScenarioRuntimeMismatch()) {
    monitor.visible = false;
    monitor.userData.openClinXrDynamicScenePolicy = "hidden_because_selected_scenario_specific_3d_bundle_missing";
  } else if (isDynamicGeneratedEncounterSceneMode()) {
    monitor.visible = false;
    monitor.userData.openClinXrDynamicScenePolicy = "hidden_when_scene_manifest_and_generated_environment_supply_encounter_context";
  } else if (hideRoomForCleanCapture()) {
    monitor.visible = false;
    monitor.userData.openClinXrComparatorVisibilityPolicy = "hidden_for_clean_humanoid_source_comparator_capture";
  }
  // actorPoseReviewCapture not in scope for this phase
  scene.add(monitor);

  // #186 — roles owned by shell fixtures suppress dual roomProp / equipment meshes.
  const fixtureOwnedRoles = Array.isArray(stationEnvironment.userData.fixtureOwnedRoles)
    ? (stationEnvironment.userData.fixtureOwnedRoles as string[])
    : [];

  return {
    stationEnvironment,
    floor,
    gltfEnvContainer,
    environmentShell,
    bed,
    monitor,
    fixtureOwnedRoles,
  };
}