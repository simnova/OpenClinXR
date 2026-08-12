/**
 * Default lane assignment policy (MADR 0054).
 * Inventory may override with notes; policy is the starting classification.
 */

import type { EquipmentLane, MidbandStatus } from "./types.js";

/** GLB bank ids (REAL_EQUIPMENT_GLTF_BY_ID + aliases). */
export const BANK_EQUIPMENT_IDS = new Set([
  "ecg_cart_equipment",
  "iv_stand_equipment",
  "wall_clock_equipment",
  "bedside_monitor_equipment",
]);

/** Modular kit targets (Approach B). Main may still be parametric until kit merges. */
export const MODULAR_KIT_IDS = new Set(["12_lead_ecg_machine_equipment", "ecg_cart_equipment"]);

/** Deck / support surfaces — bank preferred long-term; thin parametric today. */
export const DECK_SURFACE_IDS = new Set([
  "hospital_bed_equipment",
  "stretcher_equipment",
  "pediatric_stretcher_equipment",
  "post_op_bed_equipment",
  "side_rails_equipment",
  "exam_table_equipment",
]);

export function defaultLaneFor(equipmentId: string, hasGlb: boolean): EquipmentLane {
  if (hasGlb || BANK_EQUIPMENT_IDS.has(equipmentId)) return "bank";
  if (MODULAR_KIT_IDS.has(equipmentId)) return "modular_kit";
  return "thin_parametric";
}

export function defaultMidbandStatus(
  equipmentId: string,
  hasGlb: boolean,
  lane: EquipmentLane,
): MidbandStatus {
  if (hasGlb) return "glb_present";
  if (lane === "modular_kit") return "kit_default";
  if (DECK_SURFACE_IDS.has(equipmentId)) return "none";
  return "none";
}

export function defaultBuilderSymbol(equipmentId: string): string {
  // Convention: buildX from id — not always true; inventory uses switch parse when possible.
  const stem = equipmentId.replace(/_equipment$/, "");
  const parts = stem.split("_").map((p) => p.charAt(0).toUpperCase() + p.slice(1));
  return `build${parts.join("")}` + "Equipment";
}
