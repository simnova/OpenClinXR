/**
 * Realized equipment mount ordering — two copies of one asset id mount separately.
 *
 * planStationEquipmentMounts orders by realized placement id: two copies of one
 * asset id produce two mount items, while two references to the same realized
 * placement still produce one. Split from station-equipment.ts (500-line zone
 * budget): the mount-shape helpers below are the seam this module owns.
 */

import { REAL_EQUIPMENT_GLTF_BY_ID, equipmentDisplayLabel } from "./station-equipment-catalog.js";
import {
  PARAMETRIC_KINDS,
} from "./room-prop-classification.js";
import type { EquipmentMountSource } from "./station-equipment-builders.js";
import type { EquipmentPlacement, PlanStationEquipmentInput } from "./station-equipment.js";
import { DEFAULT_STATION_EQUIPMENT_POSITIONS } from "./station-equipment-positions.js";

export type EquipmentMountPlanItem = {
  equipmentId: string;
  /** Realized placement id this mount was ordered from. */
  placementId: string;
  label: string;
  position: { x: number; y: number; z: number };
  interactionCueIds: string[];
  source: EquipmentMountSource;
  /** Filename under /xr-assets/medical-equipment/ when source is gltf. */
  gltfFileName?: string;
  /** True when this id appears in the shipped placement map or bundle.equipment. */
  declared: boolean;
};

export function equipmentIdForStationPlacement(
  placements: Readonly<Record<string, Partial<EquipmentPlacement> | undefined>>,
  placementId: string,
): string {
  return placements[placementId]?.equipmentId ?? placementId;
}

export function stationPlacementHasAssetField(
  placements: Readonly<Record<string, Partial<EquipmentPlacement> | undefined>>,
  placementId: string,
): boolean {
  const field = placements[placementId]?.equipmentId;
  return typeof field === "string" && field.length > 0;
}

/**
 * Order realized placement ids: placement-map keys first (in map order), then
 * equipment rows. Copy keys that match no row's asset id are consumed
 * positionally by otherwise-uncovered rows; rows resolving to the same realized
 * id dedupe, so two references to one placement mount once.
 */
export function orderRealizedEquipmentPlacementIds(
  input: PlanStationEquipmentInput,
  placements: Readonly<Record<string, Partial<EquipmentPlacement> | undefined>>,
): string[] {
  const realizedKeysByAssetId = new Map<string, string[]>();
  for (const key of Object.keys(placements)) {
    if (!stationPlacementHasAssetField(placements, key)) continue;
    const assetId = equipmentIdForStationPlacement(placements, key);
    const list = realizedKeysByAssetId.get(assetId) ?? [];
    list.push(key);
    realizedKeysByAssetId.set(assetId, list);
  }

  const rowAssetIds = new Set<string>();
  for (const row of input.equipment) {
    if (row.equipmentId) rowAssetIds.add(row.equipmentId);
  }
  const copyKeysInMapOrder = Object.keys(placements).filter(
    (key) => !stationPlacementHasAssetField(placements, key) && !rowAssetIds.has(key),
  );

  const ordered: string[] = [];
  const push = (id: string) => {
    if (!id || ordered.includes(id)) return;
    ordered.push(id);
  };

  const consumedRealizedKeys = new Set<string>();
  const seenAssetIds = new Set<string>();
  const copyCursorByAssetId = new Map<string, number>();
  const uncoveredRow = (assetId: string): boolean =>
    (realizedKeysByAssetId.get(assetId) ?? []).length === 0
    && (stationPlacementHasAssetField(placements, assetId) || !(assetId in placements));
  const rowPlacementIds: string[] = [];
  for (const row of input.equipment) {
    const named = (row as { placementId?: unknown }).placementId;
    if (typeof named === "string" && named.length > 0) {
      rowPlacementIds.push(named);
      continue;
    }
    const candidates = realizedKeysByAssetId.get(row.equipmentId) ?? [];
    const next = candidates.find((key) => !consumedRealizedKeys.has(key));
    if (next !== undefined) {
      consumedRealizedKeys.add(next);
      rowPlacementIds.push(next);
      continue;
    }
    if (uncoveredRow(row.equipmentId)) {
      const cursor = copyCursorByAssetId.get(row.equipmentId) ?? 0;
      const copyKey = copyKeysInMapOrder[cursor];
      copyCursorByAssetId.set(row.equipmentId, cursor + 1);
      if (copyKey !== undefined) {
        rowPlacementIds.push(copyKey);
        continue;
      }
    }
    if (candidates.length === 0 && !seenAssetIds.has(row.equipmentId)) {
      const legacyOwned = !stationPlacementHasAssetField(placements, row.equipmentId)
        && row.equipmentId in placements;
      if (!legacyOwned) rowPlacementIds.push(row.equipmentId);
    }
    seenAssetIds.add(row.equipmentId);
  }
  for (const placementId of rowPlacementIds) push(placementId);
  // Map-only legacy keys mount in map order: row-owned keys were consumed above,
  // realized identities never mount from the map side.
  for (const id of Object.keys(placements)) {
    if (stationPlacementHasAssetField(placements, id)) continue;
    if (rowAssetIds.has(id) || rowAssetIds.size === 0) push(id);
  }
  return ordered;
}

/** Resolve a realized placement id to the asset id it mounts. */
export function resolveRealizedEquipmentAssetId(
  placements: Readonly<Record<string, Partial<EquipmentPlacement> | undefined>>,
  rowAssetIds: ReadonlySet<string>,
  copyKeysInMapOrder: readonly string[],
  placementId: string,
): string {
  if (stationPlacementHasAssetField(placements, placementId)) {
    return equipmentIdForStationPlacement(placements, placementId);
  }
  if (rowAssetIds.has(placementId)) return placementId;
  if (copyKeysInMapOrder.includes(placementId)) {
    // Positional copy key: the rows feeding it share one asset id when the
    // caller is mounting copies of one asset (3a/3b). Otherwise the key mounts
    // under its own name (map-only placement).
    const feeders = [...rowAssetIds].filter((assetId) =>
      !stationPlacementHasAssetField(placements, assetId) && !(assetId in placements),
    );
    if (feeders.length === 1 && feeders[0] !== undefined) return feeders[0];
    if (rowAssetIds.size === 1) return [...rowAssetIds][0] ?? placementId;
  }
  return equipmentIdForStationPlacement(placements, placementId);
}

/** Copy keys in map order: legacy keys matching no row's asset id. */
export function copyPlacementKeysInMapOrder(
  placements: Readonly<Record<string, Partial<EquipmentPlacement> | undefined>>,
  rowAssetIds: ReadonlySet<string>,
): string[] {
  return Object.keys(placements).filter(
    (key) => !stationPlacementHasAssetField(placements, key) && !rowAssetIds.has(key),
  );
}

/** Row asset ids in first-seen order. */
export function rowEquipmentAssetIds(
  equipment: PlanStationEquipmentInput["equipment"],
): Set<string> {
  const out = new Set<string>();
  for (const row of equipment) {
    if (row.equipmentId) out.add(row.equipmentId);
  }
  return out;
}

/**
 * Build one mount item from a realized placement id.
 */
export function buildRealizedEquipmentMountItem(
  placements: Readonly<Record<string, Partial<EquipmentPlacement> | undefined>>,
  placementId: string,
  equipmentId: string,
  index: number,
  declared: ReadonlySet<string>,
): EquipmentMountPlanItem {
  const placement = placements[placementId];
  const fallbackPos = DEFAULT_STATION_EQUIPMENT_POSITIONS[index % DEFAULT_STATION_EQUIPMENT_POSITIONS.length]
    ?? DEFAULT_STATION_EQUIPMENT_POSITIONS[0];
  const gltfFile = REAL_EQUIPMENT_GLTF_BY_ID[equipmentId];
  let source: EquipmentMountSource;
  if (gltfFile) {
    source = "gltf";
  } else if (PARAMETRIC_KINDS.has(equipmentId)) {
    source = "parametric";
  } else {
    source = "fallback";
  }
  const plantAlignedBed = equipmentId === "post_op_bed_equipment"
    ? { x: -0.9, y: 0, z: -0.1 }
    : null;
  const position = plantAlignedBed
    ?? (placement?.position
      ? { x: placement.position.x, y: placement.position.y, z: placement.position.z }
      : { x: fallbackPos?.x ?? 0, y: fallbackPos?.y ?? 0, z: fallbackPos?.z ?? 0 });
  return {
    equipmentId,
    placementId,
    label: placement?.label ?? equipmentDisplayLabel(equipmentId),
    position,
    interactionCueIds: Array.isArray(placement?.interactionCueIds) && placement.interactionCueIds.length > 0
      ? [...placement.interactionCueIds]
      : [
          `${equipmentId}:selectable_equipment_reference`,
          `${equipmentId}:clinical_workflow_cue`,
        ],
    source,
    ...(gltfFile ? { gltfFileName: gltfFile } : {}),
    declared: declared.has(equipmentId),
  };
}

