/**
 * Support-surface deck SSOT stamps for bank GLB mounts (MADR 0054 lane 1).
 *
 * claimScope: runtime stamps deckTopYMeters so supine plant does not re-detect
 * mattress planes from mesh faces after load.
 * notEvidenceFor: clinical accuracy, Quest readiness.
 */

import type { Object3D } from "three";
import {
  HOSPITAL_BED_DECK_TOP_M,
  STRETCHER_EQ_DECK_TOP_M,
} from "./station-equipment-support-surfaces.js";

export const SUPPORT_SURFACE_DECK_TOP_BY_EQUIPMENT_ID: Readonly<Record<string, number>> = {
  hospital_bed_equipment: HOSPITAL_BED_DECK_TOP_M,
  post_op_bed_equipment: HOSPITAL_BED_DECK_TOP_M,
  stretcher_equipment: STRETCHER_EQ_DECK_TOP_M,
  pediatric_stretcher_equipment: STRETCHER_EQ_DECK_TOP_M,
  exam_table_equipment: 0.55,
};

export function stampSupportSurfaceDeckMetadata(
  equipment: Object3D,
  equipmentId: string | null,
): void {
  if (!equipmentId) return;
  const deck = SUPPORT_SURFACE_DECK_TOP_BY_EQUIPMENT_ID[equipmentId];
  if (typeof deck !== "number") return;
  equipment.userData.deckTopYMeters = deck;
  equipment.userData.seatHeightMeters = deck;
  equipment.userData.openClinXrSupportSurfaceDeckSource = "bank_glb_ssot_stamp";
}
