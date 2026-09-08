import type { AssetLoadingScenarioTheme } from "@openclinxr/xr-asset-loading";
/**
 * Station room shell and environment loading context — extracted from apps/ui-xr/src/main.ts
 * (shrink-only SIZE_FREEZE). The app owns the module state and builds this object;
 * the package reads through it and never exports or holds a mutable value.
 */

import type {
  LearnerRuntimeAssetBundle,
  EncounterRuntimeAsset,
} from "@openclinxr/asset-registry/runtime-bundles";
import type { StationContextView } from "@openclinxr/xr-station";
import type { Group, Mesh, Scene, Color, WebGLRenderer, } from "three";
import type { StationInteriorLightingVariantId, StationInteriorLightingApplyResult } from "@openclinxr/xr-station";

/**
 * The doorway theme this package hands straight to @openclinxr/xr-asset-loading. It was
 * redeclared here field-for-field, and the two call sites in index.ts bridged the gap with
 * `theme as any` — two declarations of one contract, with a cast holding them together.
 * Alias the canonical type instead; the casts go away and a field added upstream reaches
 * this package rather than being silently dropped.
 */
export type StationRoomScenarioTheme = AssetLoadingScenarioTheme;

export type StationRoomContext = {
  scenarioId: () => string;
  encounterBundle: () => LearnerRuntimeAssetBundle;
  scenarioTheme: () => StationRoomScenarioTheme;
  sceneObjectPrefix: () => string;
  selectedCaptureMode: () => string;
  isCaptureShadowPath: (captureMode: string) => boolean;
  hideRoomForCleanCapture: () => boolean;
  edBayVisibleCapture: () => boolean;
  selectedScenarioRuntimeMismatch: () => boolean;
  activeEnvironmentId: () => string;
  // resolveStationInteriorLightingVariantId never returns null; the ` | null` here was a
  // widening the extraction introduced and it does not match what main.ts supplies.
  stationInteriorLightingVariantId: () => StationInteriorLightingVariantId;
  runtimeSceneObjectPrefix: () => string;
  assetLoadingContext: () => import("@openclinxr/xr-asset-loading").AssetLoadingContext;
  recordBootPhase: (phase: string, error?: unknown) => void;
  iwsdkStationSceneObjects: typeof import("@openclinxr/xr-runtime-state").iwsdkStationSceneObjects;
  // Three.js types needed
  Scene: typeof Scene;
  Group: typeof Group;
  Mesh: typeof Mesh;
  BoxGeometry: typeof import("three").BoxGeometry;
  MeshStandardMaterial: typeof import("three").MeshStandardMaterial;
  Color: typeof Color;
  GLTFLoader: typeof import("three/addons/loaders/GLTFLoader.js").GLTFLoader;
  // Functions from other packages
  // Declared by apps/ui-xr/src/lighting-rig-runtime.ts, which the package must not import
  // (an app is not a dependency of a package). The signature is restated here and must
  // MATCH that export exactly; the first version had `variantId: ... | null` and no
  // fetchImpl, and the app would not typecheck against it.
  applyStationInteriorLightingForEnvironment: (input: {
    scene: Scene;
    renderer: WebGLRenderer;
    environmentId: string;
    variantId: StationInteriorLightingVariantId;
    ambientLightName: string;
    keyLightName: string;
    keyCastShadow: boolean;
    fetchImpl?: typeof globalThis.fetch;
  }) => Promise<StationInteriorLightingApplyResult & { rigApplied: boolean }>;
  addPackageReusableExteriorPreEncounterRoom: typeof import("@openclinxr/xr-asset-loading").addReusableExteriorPreEncounterRoom;
  mountStationEnvironmentForRuntime: typeof import("@openclinxr/xr-scene").mountStationEnvironmentForRuntime;
  loadInfinigenEnvironmentIntoStation: typeof import("@openclinxr/xr-scene").loadInfinigenEnvironmentIntoStation;
  addPackageScenarioSpecificClinicalSetDressing: typeof import("@openclinxr/xr-asset-loading").addScenarioSpecificClinicalSetDressing;
  // main.ts's own wrapper: it supplies the clinical panel context, so the package passes
  // options only. Typing this as the package export's 2-arg form invited a mock context.
  createReadableVrTextPanel: (
    options: Parameters<typeof import("@openclinxr/xr-scene-cues").createReadableVrTextPanel>[1],
  ) => ReturnType<typeof import("@openclinxr/xr-scene-cues").createReadableVrTextPanel>;
  addScenarioExpectationPanel: (scene: Scene, stationContext: StationContextView) => void;
  shouldSuppressGeneratedEnvironmentShell: (asset: EncounterRuntimeAsset) => boolean;
  loadPackageGeneratedEnvironmentIntoSceneSlot: typeof import("@openclinxr/xr-asset-loading").loadGeneratedEnvironmentIntoSceneSlot;
  resolveEmulatorRuntimeAssetUrl: (asset: EncounterRuntimeAsset) => string;
  runtimeGeneratedSceneObjectName: (asset: EncounterRuntimeAsset) => string;
  isDynamicGeneratedEncounterSceneMode: () => boolean;
  enableCaptureRendererShadowMap: typeof import("@openclinxr/xr-station").enableCaptureRendererShadowMap;
  markFloorReceiveShadow: typeof import("@openclinxr/xr-station").markFloorReceiveShadow;
  stationContextForScenario: typeof import("@openclinxr/xr-station").stationContextForScenario;
};

export type StationRoomResult = {
  stationEnvironment: Group;
  floor: Mesh;
  gltfEnvContainer: Group;
  environmentShell: Group;
  bed: Mesh;
  monitor: Mesh;
  fixtureOwnedRoles: string[];
};