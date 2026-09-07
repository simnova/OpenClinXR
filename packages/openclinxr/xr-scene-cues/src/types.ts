import type { EncounterRuntimeRoomProp } from "@openclinxr/asset-registry/runtime-bundles";
import type {
  EnvironmentStateEvidence,
  ReadableVrTextPanelEvidence,
  ReadableVrTextPanelEvidenceSet,
} from "@openclinxr/xr-runtime-state";
import type { EncounterActorFramingInput } from "@openclinxr/xr-scene";
import type { BuildRoomPropInput } from "@openclinxr/xr-station";
import type { Group, Mesh } from "three";

export type ReadableVrTextPanel = {
  mesh: Mesh;
  update(lines: readonly string[]): void;
};

export type DynamicSceneObjectNamingEvidence = {
  source: "window.__openClinXrDynamicSceneObjectNamingEvidence";
  scenarioId: string;
  selectedScenarioId: string;
  selectedScenarioMatchesBundle: boolean;
  totalNamedObjects: number;
  scenarioPrefixedObjectCount: number;
  stableIwsdkLegacyObjectNameCount: number;
  stableIwsdkLegacyObjectNames: string[];
  hardcodedEdPrefixLeakCount: number;
  hardcodedEdPrefixLeakNames: string[];
  sampleScenarioPrefixedObjectNames: string[];
  notEvidenceFor: Array<"quest_readiness" | "clinical_validity" | "scoring_validity" | "production_readiness">;
};

export type RoleDistinctHumanoidCueEvidence = {
  source: "window.__openClinXrRoleDistinctHumanoidCueEvidence";
  scenarioId: string;
  cueCount: number;
  cues: Array<{
    actorId: string;
    role: string | null;
    cueId: string;
    sceneObjectName: string;
  }>;
  notEvidenceFor: Array<"quest_readiness" | "clinical_validity" | "scoring_validity" | "production_readiness" | "animation_quality">;
};

export type PediatricRespiratoryEquipmentCueEvidence = {
  source: "window.__openClinXrPediatricRespiratoryEquipmentCueEvidence";
  scenarioId: string;
  cueCount: number;
  cues: Array<{
    equipmentId: string;
    cueId: string;
    sceneObjectName: string;
  }>;
  notEvidenceFor: Array<"quest_readiness" | "clinical_validity" | "scoring_validity" | "production_readiness" | "equipment_asset_readiness">;
};

declare global {
  interface Window {
    __openClinXrTextPanelEvidence?: ReadableVrTextPanelEvidenceSet;
    __openClinXrDynamicSceneObjectNamingEvidence?: DynamicSceneObjectNamingEvidence;
    __openClinXrRoleDistinctHumanoidCueEvidence?: RoleDistinctHumanoidCueEvidence;
    __openClinXrPediatricRespiratoryEquipmentCueEvidence?: PediatricRespiratoryEquipmentCueEvidence;
    __openClinXrEnvironmentStateEvidence?: EnvironmentStateEvidence;
  }
}

export type SceneCueClinicalPanelContext = {
  clinicalPanelObjectName: string;
  evidenceStore: Map<string, ReadableVrTextPanelEvidence>;
  clinicalPanelLines: () => string[];
  buildTextPanelEvidence: (input: {
    name: string;
    title: string;
    lines: readonly string[];
    canvasPixels: { width: number; height: number };
    worldMeters: { width: number; height: number };
    updatedAtMs: number;
  }) => ReadableVrTextPanelEvidence;
};

export type SceneCueVirtualDeviceContext = {
  resolvePlacement: (actorId: string) => {
    position: { x: number; y: number; z: number };
    scale: { x: number; y: number; z: number };
    labelPrefix: string;
  };
  actorNameplateLabel: (prefix: string, actorId: string) => string;
  registerSlot: (actorId: string, group: Group) => void;
  buildVirtualDeviceAffordance: (input: {
    actorId: string;
    placement: { position: { x: number; y: number; z: number }; scale: { x: number; y: number; z: number }; labelPrefix: string };
    createAffordanceMarker: (id: string, color: number) => Mesh;
    createActorNameplate: (label: string, accentColor: number) => Mesh;
    actorNameplateLabel: (prefix: string, actorId: string) => string;
    registerSlot: (actorId: string, group: Group) => void;
  }) => Group;
};

export type SceneCueNameplateContext = {
  scenarioObjectPrefix: string;
  shouldShowIdentityLabels: () => boolean;
};

export type SceneCueRoomPropContext = {
  scenarioObjectPrefix: string;
  createAffordanceMarker: (cueId: string, color: number) => Mesh;
  createActorNameplate: (label: string, accentColor: number) => Mesh;
  roomPropObjectPrefix: string;
  shouldRenderRoomProp: (prop: EncounterRuntimeRoomProp) => boolean;
  roomPropColourNumbers: (prop: { colorHex: string; accentColorHex: string }) => { color: number; accentColor: number };
  roomPropSuppressedByFixtureOwnership: (propId: string, owned: ReadonlySet<string>) => boolean;
  buildRoomPropGroup: (input: BuildRoomPropInput) => Group | null;
  hasVector3: (value: unknown) => value is { x: number; y: number; z: number };
  registerReactiveProp: (propId: string, group: Group) => void;
};

export type SceneCueHumanoidCueContext = {
  scenarioObjectPrefix: string;
  shouldShowAffordanceMarkers: () => boolean;
};

export type SceneCueTraceVisualContext = {
  equipmentSlots: ReadonlyMap<string, Group>;
  equipmentIdsForTag: (tag: string) => string[];
  scenarioObjectPrefix: string;
};

export type SceneCueEnvironmentVisualContext = {
  reactiveProps: ReadonlyMap<string, Group>;
};

export type SceneCueNamingEvidenceContext = {
  scenarioId: string;
  selectedScenarioId: string;
  selectedScenarioMatchesBundle: boolean;
  stableIwsdkObjectNames: readonly string[];
  scenarioObjectPrefix: string;
};

export type SceneCueRoleCueEvidenceContext = {
  scenarioId: string;
  runtimeActorRole: (actorId: string) => string | undefined;
};

export type SceneCuePediatricCueEvidenceContext = {
  scenarioId: string;
};

export type SceneCuePediatricEquipmentContext = {
  scenarioObjectPrefix: string;
  isPediatricScenario: () => boolean;
};

export type SceneCueActorFramingContext = {
  scenarioId: string;
  runtimeActorRole: (actorId: string) => string | undefined;
  selectedScenarioId: () => string;
  skipFraming: boolean;
  applyActorFraming: (input: EncounterActorFramingInput) => void;
  onWardrobeCue: (actor: Group, roleCue: "patient" | "clinical" | "family") => void;
};
