import { factoryStationSchemas, findEquipmentSubject } from "@openclinxr/factory-stations";
import type { CompileGraphNode } from "./encounter-materialization-evidence.js";

export type EquipmentWouldInvokePlan = {
  wouldInvoke: "trellis" | null;
  skipped: boolean;
};

/**
 * EquipVariant nodes with a valid equipment_generate payload plan TRELLIS.
 * Locked or tombstoned nodes stay skipped (lock skip survives invocation).
 * Other families are unchanged (wouldInvoke null, not skipped).
 */
export function planEquipmentWouldInvoke(node: CompileGraphNode): EquipmentWouldInvokePlan {
  if (node.family !== "EquipVariant") {
    return { wouldInvoke: null, skipped: false };
  }
  if (node.tombstone || node.lock.locked) {
    return { wouldInvoke: null, skipped: true };
  }
  const payload = equipmentGeneratePayloadFromSpec(node.spec);
  if (!payload) {
    return { wouldInvoke: null, skipped: false };
  }
  const checked = factoryStationSchemas.equipment_generate["~standard"].validate(payload);
  if ("issues" in checked) {
    return { wouldInvoke: null, skipped: false };
  }
  return { wouldInvoke: "trellis", skipped: false };
}

export function equipmentGeneratePayloadFromSpec(
  spec: CompileGraphNode["spec"],
): Record<string, unknown> | null {
  const nested = spec.equipmentGenerate;
  if (nested && typeof nested === "object" && !Array.isArray(nested)) {
    return nested;
  }
  const equipmentId = spec.equipmentId;
  if (!equipmentId || !findEquipmentSubject(equipmentId)) {
    return null;
  }
  return {
    subjectId: equipmentId,
    packId: equipmentId,
    seed: 0,
    remesh: false,
    viewCount: 4,
    decimationTarget: 1_000_000,
  };
}
