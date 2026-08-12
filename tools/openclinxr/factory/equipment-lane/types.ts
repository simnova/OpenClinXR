/**
 * Equipment three-lane catalogue types (MADR 0054 / 0055).
 *
 * claimScope: factory routing metadata for equipment ids.
 * notEvidenceFor: clinical fidelity, Quest readiness.
 */

export const EQUIPMENT_CATALOG_SCHEMA = "openclinxr.equipment-catalog.v1" as const;

export type EquipmentLane = "bank" | "thin_parametric" | "modular_kit";

export type EquipmentRuntimeSource = "gltf" | "parametric" | "fallback" | "unknown";

export type MidbandStatus =
  | "none"
  | "pack_only"
  | "glb_present"
  | "kit_default"
  | "graded";

export type LicenceStatus =
  | "internal"
  | "cc0"
  | "cc_by"
  | "refused"
  | "unspecified_blocked"
  | "n/a";

export type EquipmentCatalogRow = {
  equipmentId: string;
  lane: EquipmentLane;
  runtimeSource: EquipmentRuntimeSource;
  gltfFileName: string | null;
  builderSymbol: string | null;
  kitRecipeId: string | null;
  proseAliases: string[];
  scenarioIds: string[];
  midbandStatus: MidbandStatus;
  licenceStatus: LicenceStatus;
  provenancePath: string | null;
  ledgerSource: string | null;
  claimScope: string;
  notEvidenceFor: string[];
  notes: string;
};

export type EquipmentCatalogDocument = {
  schemaVersion: typeof EQUIPMENT_CATALOG_SCHEMA;
  measuredAt: string;
  claimScope: string;
  notEvidenceFor: string[];
  madr: string[];
  scenarioCount: number;
  equipmentCount: number;
  rows: EquipmentCatalogRow[];
  unmappedProse: Array<{
    prose: string;
    scenarioIds: string[];
    recommendedEquipmentId: string | null;
    reason: string;
  }>;
  summary: {
    byLane: Record<EquipmentLane, number>;
    byRuntimeSource: Record<string, number>;
    gltfMissingOnDisk: string[];
    scenariosWithUnmappedProse: string[];
  };
};
