/**
 * Realized equipment placement identity — two copies of one asset id mount separately.
 *
 * A realized placement gains an identity distinct from its asset id. The bundle's
 * equipmentPlacements is keyed by that realized id, with the asset id a field on
 * the value rather than the key. A collision or overflow is reported in the
 * notStaged-shaped form of runtime-actor-slots.ts:130-135, never silent.
 *
 * Split from runtime-bundles.ts under its SIZE_FREEZE (1638-line ceiling).
 */

import type {
  EncounterRuntimeEquipmentAsset,
  EncounterRuntimeEquipmentPlacement,
} from "./runtime-bundles.js";

/** Separator between asset id and copy suffix in a realized placement id. */
export const REALIZED_EQUIPMENT_PLACEMENT_COPY_SEPARATOR = "#";

/** A placement entry keyed by realized id carries its asset id as a field. */
export type RealizedEquipmentPlacementEntry = EncounterRuntimeEquipmentPlacement & {
  equipmentId: string;
};

/** Collapse report row in the assignRuntimeActorSlots notStaged shape. */
export type EquipmentPlacementCollapseRow = {
  assetId: string;
  placementId: string;
  reason: string;
};

/** Overflow/collision report carried beside the built bundle. */
export type EquipmentPlacementReport = {
  collapsed: EquipmentPlacementCollapseRow[];
};

/** Realized identity for one copy of an asset id. Never derived from iteration order. */
export function realizedEquipmentPlacementId(equipmentId: string, copyIndex: number): string {
  return copyIndex <= 1
    ? equipmentId
    : `${equipmentId}${REALIZED_EQUIPMENT_PLACEMENT_COPY_SEPARATOR}${copyIndex}`;
}

/**
 * Count how many copies of each asset id appear, in first-seen order.
 * Identity is a property of the placement (asset id + copy number), not of iteration order.
 */
export function realizedEquipmentCopyNumbers(
  equipment: readonly EncounterRuntimeEquipmentAsset[],
): number[] {
  const seen = new Map<string, number>();
  return equipment.map((entry) => {
    const next = (seen.get(entry.equipmentId) ?? 0) + 1;
    seen.set(entry.equipmentId, next);
    return next;
  });
}

/**
 * Build equipmentPlacements keyed by realized placement id. Two authored copies of
 * one asset id produce two entries; the asset id rides on the value, not the key.
 */
export function buildRealizedEquipmentPlacements(
  equipment: readonly EncounterRuntimeEquipmentAsset[],
  place: (equipment: EncounterRuntimeEquipmentAsset, index: number) => EncounterRuntimeEquipmentPlacement,
): Record<string, RealizedEquipmentPlacementEntry> {
  const copyNumbers = realizedEquipmentCopyNumbers(equipment);
  const out: Record<string, RealizedEquipmentPlacementEntry> = {};
  equipment.forEach((entry, index) => {
    const copyNumber = copyNumbers[index] ?? 1;
    const placementId = realizedEquipmentPlacementId(entry.equipmentId, copyNumber);
    out[placementId] = { ...place(entry, index), equipmentId: entry.equipmentId };
  });
  return out;
}

/**
 * Report copies that collapse onto an already-seen realized placement id.
 * Two references to the same realized placement are one mount, not a collapse.
 */
export function reportEquipmentPlacementCollisions(
  placementKeys: readonly string[],
): EquipmentPlacementReport {
  const seen = new Set<string>();
  const collapsed: EquipmentPlacementCollapseRow[] = [];
  for (const placementId of placementKeys) {
    if (seen.has(placementId)) {
      const assetId = placementId.split(REALIZED_EQUIPMENT_PLACEMENT_COPY_SEPARATOR)[0] ?? placementId;
      collapsed.push({
        assetId,
        placementId,
        reason: `duplicate_realized_placement_reference_${placementId}_already_mounted`,
      });
      continue;
    }
    seen.add(placementId);
  }
  return { collapsed };
}

/**
 * Resolve one realized placement entry by its realized id.
 * Returns undefined for unknown ids rather than the first match.
 */
export function findRealizedEquipmentPlacement(
  placements: Readonly<Record<string, RealizedEquipmentPlacementEntry | undefined>>,
  realizedId: string,
): RealizedEquipmentPlacementEntry | undefined {
  return placements[realizedId];
}
