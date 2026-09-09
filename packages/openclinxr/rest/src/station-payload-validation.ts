/**
 * Station-payload validation (moved from apps/api composition root).
 *
 * Validator-only module: parseStationPayloads validates per-station payloads
 * against the factory station schemas before they reach the compile runner.
 */

import {
  PRODUCTION_STATION_IDS,
  factoryStationSchemas,
  type ProductionStationId,
} from "@openclinxr/factory-stations";

export function parseStationPayloads(raw: unknown):
  | { ok: true; value: Record<string, Record<string, unknown>> | undefined }
  | { ok: false; reason: string } {
  if (raw === undefined) {
    return { ok: true, value: undefined };
  }
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    return { ok: false, reason: "stationPayloads_expected_object" };
  }
  const known = new Set<string>(PRODUCTION_STATION_IDS);
  const value: Record<string, Record<string, unknown>> = {};
  for (const [stationId, payload] of Object.entries(raw as Record<string, unknown>)) {
    if (!known.has(stationId)) {
      return { ok: false, reason: `unknown_station_${stationId}` };
    }
    const schema = factoryStationSchemas[stationId as ProductionStationId];
    const checked = schema["~standard"].validate(payload);
    // The spec discriminates on a FALSY `issues`, not on the key being present; the success
    // branch now carries `issues?: undefined`, so `"issues" in checked` no longer narrows.
    if (checked.issues !== undefined) {
      const first = checked.issues[0];
      const field = first?.path?.[0] !== undefined ? String(first.path[0]) : (first?.message ?? "unknown_field");
      return { ok: false, reason: `invalid_station_${stationId}_field_${field}` };
    }
    value[stationId] = checked.value;
  }
  return { ok: true, value };
}
