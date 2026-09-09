import type {
  EncounterRuntimeActorAsset,
  EncounterRuntimeAssetBundle,
  EncounterRuntimeEquipmentAsset,
  EncounterRuntimeEquipmentPlacement,
} from "./runtime-bundles.js";

/**
 * Read one thing back out of a built bundle.
 *
 * Split from runtime-bundles.ts, which is at a shrink-only frozen ceiling whose own note asks
 * for builder / validate / shape to separate. Lookups are the read side of that split: nothing
 * here constructs a bundle, and nothing in the builder needs to call them.
 */

export function findRuntimeActorAsset(
  bundle: Pick<EncounterRuntimeAssetBundle, "actors">,
  actorId: string,
): EncounterRuntimeActorAsset | undefined {
  return bundle.actors.find((actor) => actor.actorId === actorId);
}

export function findRuntimeEquipmentAsset(
  bundle: Pick<EncounterRuntimeAssetBundle, "equipment">,
  equipmentId: string,
): EncounterRuntimeEquipmentAsset | undefined {
  return bundle.equipment.find((equipment) => equipment.equipmentId === equipmentId);
}

/**
 * Resolve one equipment copy by its realized placement id
 * (`<equipmentId>` for the first copy, `<equipmentId>#<n>` after).
 */
export function findRuntimeEquipmentPlacementByRealizedId(
  bundle: Pick<EncounterRuntimeAssetBundle, "equipment" | "sceneManifest">,
  realizedId: string,
): EncounterRuntimeEquipmentAsset | EncounterRuntimeEquipmentPlacement | undefined {
  const hashIndex = realizedId.lastIndexOf("#");
  if (hashIndex < 0) {
    const direct = bundle.equipment.find((entry) => entry.equipmentId === realizedId);
    if (direct !== undefined) return direct;
    return bundle.sceneManifest.equipmentPlacements[realizedId];
  }
  const equipmentId = realizedId.slice(0, hashIndex);
  const copyNumber = Number.parseInt(realizedId.slice(hashIndex + 1), 10);
  if (equipmentId.length === 0 || !Number.isInteger(copyNumber) || copyNumber < 1) return undefined;
  const copies = bundle.equipment.filter((entry) => entry.equipmentId === equipmentId);
  // `#1` names the first copy, which the bundle also keys under the bare asset id.
  const copy = copies[copyNumber - 1];
  if (copy !== undefined) return copy;
  // Fall back to the scene manifest's realized placement entry (built bundles
  // key every copy there, including copies with no equipment-row match).
  // A realized id the bundle does not contain resolves to UNDEFINED. An earlier draft returned
  // the Nth entry of the manifest regardless of asset id, which made two absent ids resolve to
  // two DIFFERENT assets' placements and satisfied "distinct" by accident. Absent is absent.
  return bundle.sceneManifest.equipmentPlacements[realizedId]
    ?? (copyNumber === 1 ? bundle.sceneManifest.equipmentPlacements[equipmentId] : undefined);
}
