import type { AssetLoadingScenarioTheme } from "@openclinxr/xr-asset-loading";
import type { AssetLoadingContext } from "@openclinxr/xr-asset-loading";
import type {
  LearnerRuntimeAssetBundle,
  EncounterRuntimeAsset,
} from "@openclinxr/asset-registry/runtime-bundles";
import type { StationContextView, StationInteriorLightingVariantId, StationInteriorLightingApplyResult } from "@openclinxr/xr-station";
import type { Scene, WebGLRenderer, Group, Mesh } from "three";

/**
 * Station room shell and environment loading context — extracted from apps/ui-xr/src/main.ts
 * (shrink-only SIZE_FREEZE). The app owns the module state and builds this object;
 * the package reads through it and never exports or holds a mutable value.
 *
 * Fields that are imported functions have been removed; the package imports them directly.
 * Only app state getters/setters and genuinely app-owned callbacks remain.
 */

/**
 * The doorway theme this package hands straight to @openclinxr/xr-asset-loading.
 * Alias the canonical type instead of redeclaring; casts go away and a field added
 * upstream reaches this package rather than being silently dropped.
 */
export type StationRoomScenarioTheme = AssetLoadingScenarioTheme;

/** Canonical signature for applyStationInteriorLightingForEnvironment from lighting-rig-runtime.ts */
export type ApplyStationInteriorLightingForEnvironment = (input: {
  scene: Scene;
  renderer: WebGLRenderer;
  environmentId: string;
  variantId: StationInteriorLightingVariantId;
  ambientLightName: string;
  keyLightName: string;
  keyCastShadow: boolean;
  fetchImpl?: typeof globalThis.fetch;
}) => Promise<StationInteriorLightingApplyResult & { rigApplied: boolean }>;

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
  stationInteriorLightingVariantId: () => StationInteriorLightingVariantId;
  runtimeSceneObjectPrefix: () => string;
  assetLoadingContext: () => AssetLoadingContext;
  recordBootPhase: (phase: string, error?: unknown) => void;
  iwsdkStationSceneObjects: typeof import("@openclinxr/xr-runtime-state").iwsdkStationSceneObjects;
  // Functions from apps/ui-xr that are app-owned callbacks (state-dependent)
  applyStationInteriorLightingForEnvironment: ApplyStationInteriorLightingForEnvironment;
  addScenarioExpectationPanel: (scene: Scene, stationContext: StationContextView) => void;
  resolveEmulatorRuntimeAssetUrl: (asset: EncounterRuntimeAsset) => string;
  isDynamicGeneratedEncounterSceneMode: () => boolean;
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