/**
 * Generated actor/equipment placement helpers extracted from runtime-bundles (#81 freeze).
 */

import { resolveActorPosture } from "./actor-posture-mod.js";
import type {
  EncounterRuntimeActorAsset,
  EncounterRuntimeActorPlacement,
  EncounterRuntimeEquipmentAsset,
  EncounterRuntimeEquipmentPlacement,
} from "./runtime-bundles.js";

export function safeRuntimeManifestKey(value: string): string {
  return value.trim().replace(/[^a-zA-Z0-9_.:-]+/gu, "_") || "unknown";
}

export function generatedActorLabel(actor: EncounterRuntimeActorAsset): string {
  return actor.role
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

export type AuthoredActorCasePlacement = {
  plantOffsetMeters?: { x: number; y: number; z: number } | undefined;
  supportSurface?: string | undefined;
  headingRadians?: number | undefined;
};

export type GeneratedActorPlacementOptions = {
  scenarioId?: string | undefined;
  casePlacements?: Record<string, AuthoredActorCasePlacement> | undefined;
};

function isPlantVector(value: unknown): value is { x: number; y: number; z: number } {
  if (typeof value !== "object" || value === null) return false;
  const record = value as { x?: unknown; y?: unknown; z?: unknown };
  return typeof record.x === "number" && typeof record.y === "number" && typeof record.z === "number";
}

export function generatedActorPlacement(
  actor: EncounterRuntimeActorAsset,
  index: number,
  options: GeneratedActorPlacementOptions = {},
): EncounterRuntimeActorPlacement {
  // #123: physician is clinical team class (not family fallback). Index 3+ uses
  // team-adjacent additional_cast anchor rather than doorway-forward spacing.
  const clinicalRoles = ["nurse", "consultant", "respiratory_therapist", "nurse_observer", "physician", "medical_assistant"];
  let slotKind: EncounterRuntimeActorPlacement["slotKind"];
  if (actor.role === "patient") {
    slotKind = "primary_patient";
  } else if (clinicalRoles.includes(actor.role) && index <= 1) {
    slotKind = "clinical_team";
  } else if (index >= 3) {
    slotKind = "additional_cast";
  } else {
    slotKind = clinicalRoles.includes(actor.role) ? "clinical_team" : "family_or_observer";
  }

  const posture = resolveActorPosture({
    scenarioId: options.scenarioId,
    slotKind,
  });

  const position = slotKind === "additional_cast"
    ? { x: 1.95, y: 0.95, z: 0.15 }
    : { x: -0.8 + (index * 0.8), y: 0.95, z: 0.3 + (index % 2) * 0.45 };

  const authored = options.casePlacements?.[actor.actorId];
  const authoredOffset = authored && isPlantVector(authored.plantOffsetMeters)
    ? { x: authored.plantOffsetMeters.x, y: authored.plantOffsetMeters.y, z: authored.plantOffsetMeters.z }
    : undefined;
  // Absent means no authored facing; 0 is a real heading and is not the same as absent.
  const authoredHeading = typeof authored?.headingRadians === "number" ? authored.headingRadians : undefined;

  const out: EncounterRuntimeActorPlacement = {
    slotKind,
    position: authoredOffset ?? position,
    scale: { x: 1, y: 1, z: 1 },
    verticalOffsetMeters: -0.95,
    labelPrefix: generatedActorLabel(actor),
    posture,
  };
  if (authoredHeading !== undefined) out.headingRadians = authoredHeading;
  return out;
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
