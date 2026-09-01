import type { ProductionStationId } from "./catalog.js";

/** Persist a validated station payload onto a compile-node spec. No baker spawn. */
export function applyStationPayloadToCompileSpec(
  spec: Record<string, unknown>,
  stationId: ProductionStationId,
  value: Record<string, unknown>,
): Record<string, unknown> {
  if (stationId === "equipment_generate") {
    return { ...spec, equipmentGenerate: value };
  }
  if (stationId === "room_generate") {
    return { ...spec, infinigenPrompt: value["infinigenPrompt"] ?? spec["infinigenPrompt"] };
  }
  if (stationId === "staging") {
    return {
      ...spec,
      supportSurface: value["supportSurface"] ?? spec["supportSurface"],
      plantOffsetMeters: value["plantOffsetMeters"] ?? spec["plantOffsetMeters"],
    };
  }
  return { ...spec, stationPayload: { stationId, value } };
}
