import type { Group } from "three";

/**
 * Stamp a mounted equipment slot with the identity a runtime consumer reads back off it.
 *
 * TWO ids, and they are not the same thing. `assetId` says WHAT the slot holds; `placementId`
 * says WHICH COPY it is. A room with two of one asset id has one asset id and two placement
 * ids, and every consumer that keys by asset id alone collapses those copies into one — the
 * defect this card exists to close.
 *
 * `placementId` falls back to `assetId` because the single-copy case is the common one and a
 * caller that has no realized id should not have to invent one.
 *
 * Extracted from generated-loaders.ts rather than left inline: that file is at a shrink-only
 * frozen ceiling, and slot identity is its own job.
 */
export function stampEquipmentSlotIdentity(
  sceneSlot: Group,
  identity: { assetId: string; placementId?: string | undefined },
): void {
  const userData = sceneSlot.userData as Record<string, unknown>;
  userData["openClinXrRuntimeEquipmentAssetId"] = identity.assetId;
  userData["openClinXrRuntimeEquipmentPlacementId"] = identity.placementId ?? identity.assetId;
}

/** What a scene-slot load needs to know: which file, which asset, which copy, which object. */
export type LoadSceneSlotOptions = {
  assetPath: string;
  assetId: string;
  objectName: string;
  /** Realized placement id when mounting one copy of a repeated asset id. */
  placementId?: string | undefined;
};
