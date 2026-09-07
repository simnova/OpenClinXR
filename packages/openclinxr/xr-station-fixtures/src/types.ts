/**
 * Station fixtures and equipment mounting context — extracted from apps/ui-xr/src/main.ts
 * (shrink-only SIZE_FREEZE). The app owns the module state and builds this object;
 * the package reads through it and never exports or holds a mutable value.
 */

import type {
  LearnerRuntimeAssetBundle,
  EncounterRuntimeAsset,
  EncounterRuntimeRoomProp,
  EncounterRuntimeEquipmentAsset,
} from "@openclinxr/asset-registry/runtime-bundles";
import type { StationContextView } from "@openclinxr/xr-station";
import type { Group, Mesh, Scene, Color, WebGLRenderer, PerspectiveCamera, Object3D } from "three";
import type { StationRoomResult } from "@openclinxr/xr-station-room";
import type { EquipmentMountPlanItem, EquipmentMountSource, DeclaredEquipmentEvidenceItem, BuildRoomPropInput } from "@openclinxr/xr-station";

export type StationFixturesScenarioTheme = {
  backgroundColor: number;
  floorColor: number;
  panelBackground: string;
  panelAccent: string;
  reusedAssetAccentColor: number;
};

export type StationFixturesContext = {
  scenarioId: () => string;
  encounterBundle: () => LearnerRuntimeAssetBundle;
  scenarioTheme: () => StationFixturesScenarioTheme;
  sceneObjectPrefix: () => string;
  selectedCaptureMode: () => string;
  hideRoomForCleanCapture: () => boolean;
  edBayVisibleCapture: () => boolean;
  selectedScenarioRuntimeMismatch: () => boolean;
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
  // Room prop functions (from xr-scene-cues / xr-station) - app-wrapped versions
  shouldRenderRoomProp: (prop: EncounterRuntimeRoomProp) => boolean;
  roomPropColourNumbers: (prop: { colorHex: string; accentColorHex: string }) => { color: number; accentColor: number };
  roomPropSuppressedByFixtureOwnership: (propId: string, owned: ReadonlySet<string>) => boolean;
  buildRoomPropGroup: (input: BuildRoomPropInput) => Group | null;
  hasVector3: (value: unknown) => value is { x: number; y: number; z: number };
  registerReactiveProp: (propId: string, group: Group) => void;
  createAffordanceMarker: (cueId: string, color: number) => Mesh;
  createActorNameplate: (label: string, accentColor: number) => Mesh;
  roomPropObjectPrefix: string;
  // Equipment functions (from xr-station)
  planStationEquipmentMounts: typeof import("@openclinxr/xr-station").planStationEquipmentMounts;
  buildGltfEquipmentPlaceholderSlot: typeof import("@openclinxr/xr-station").buildGltfEquipmentPlaceholderSlot;
  buildDeclaredEquipmentGeometry: typeof import("@openclinxr/xr-station").buildDeclaredEquipmentGeometry;
  findRuntimeEquipmentAsset: typeof import("@openclinxr/asset-registry/runtime-bundles").findRuntimeEquipmentAsset;
  loadPackageGeneratedEquipmentIntoSceneSlot: typeof import("@openclinxr/xr-asset-loading").loadGeneratedEquipmentIntoSceneSlot;
  resolveEmulatorRuntimeAssetUrl: (asset: EncounterRuntimeAsset) => string;
  runtimeGeneratedSceneObjectName: (asset: EncounterRuntimeAsset) => string;
  isDynamicGeneratedEncounterSceneMode: () => boolean;
  // addPediatricRespiratoryEquipmentCues from xr-scene-cues - app wrapper takes 2 args
  addPediatricRespiratoryEquipmentCues: (slot: Group, equipmentId: string) => void;
  stampRoomPropAliasesOnEquipmentRoot: typeof import("@openclinxr/xr-station").stampRoomPropAliasesOnEquipmentRoot;
  stampSuppressedDeclaredEquipmentOntoFixtures: typeof import("@openclinxr/xr-station").stampSuppressedDeclaredEquipmentOntoFixtures;
  countEquipmentGeometry: typeof import("@openclinxr/xr-station").countEquipmentGeometry;
};

export type StationFixturesResult = {
  equipmentEvidenceItems: DeclaredEquipmentEvidenceItem[];
  // For later phases that need equipment slots registered
  runtimeEquipmentSlotsByAssetId: Map<string, Group>;
};