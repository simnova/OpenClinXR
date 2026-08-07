/**
 * Generated actor/equipment placement helpers extracted from runtime-bundles (#81 freeze).
 */

import type {
  EncounterRuntimeActorAsset,
  EncounterRuntimeActorPlacement,
  EncounterRuntimeEquipmentAsset,
  EncounterRuntimeEquipmentPlacement,
} from "./runtime-bundles.js";
import { resolveActorPosture } from "./actor-posture.js";

export function safeRuntimeManifestKey(value: string): string {
  return value.trim().replace(/[^a-zA-Z0-9_.:-]+/gu, "_") || "unknown";
}

export function generatedActorLabel(actor: EncounterRuntimeActorAsset): string {
  return actor.role
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

export function generatedActorPlacement(
  actor: EncounterRuntimeActorAsset,
  index: number,
  options: { scenarioId?: string | undefined } = {},
): EncounterRuntimeActorPlacement {
  const slotKind: EncounterRuntimeActorPlacement["slotKind"] = actor.role === "patient"
    ? "primary_patient"
    : ["nurse", "consultant", "respiratory_therapist", "nurse_observer"].includes(actor.role)
      ? "clinical_team"
      : "family_or_observer";

  const posture = resolveActorPosture({
    scenarioId: options.scenarioId,
    slotKind,
  });

  return {
    slotKind,
    position: { x: -0.8 + (index * 0.8), y: 0.95, z: 0.3 + (index % 2) * 0.45 },
    scale: { x: 1, y: 1, z: 1 },
    verticalOffsetMeters: -0.95,
    labelPrefix: generatedActorLabel(actor),
    posture,
  };
}

export function generatedEquipmentPlacement(
  equipment: EncounterRuntimeEquipmentAsset,
  index: number,
): EncounterRuntimeEquipmentPlacement {
  return {
    position: { x: 1.2 + (index * 0.45), y: 0, z: 0.45 + (index % 2) * 0.45 },
    label: equipment.model.displayName,
    interactionCueIds: ["selectable_equipment_reference"],
  };
}
