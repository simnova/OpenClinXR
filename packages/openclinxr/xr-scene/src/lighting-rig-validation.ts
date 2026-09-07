import {
  LIGHTING_RIG_SCHEMA_VERSION,
  MAX_RIG_ENERGY,
  MAX_RIG_SIZE_M,
  type LightingRig,
  type LightingRigLight,
  type RigLightType,
} from "./lighting-rig-contract.js";

/**
 * Validators only. Moved out of apps/ui-xr/src/lighting-rig-runtime.ts, where the parser
 * sat beside the three.js light construction it feeds, so the app kept a validation rule
 * inside a functionality module.
 */
function isFiniteVec3(value: unknown): value is [number, number, number] {
  return (
    Array.isArray(value)
    && value.length === 3
    && value.every((v) => typeof v === "number" && Number.isFinite(v))
  );
}

/** Refuse malformed rigs (null = fall back to constants). */
export function parseLightingRig(value: unknown): LightingRig | null {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return null;
  const rec = value as Record<string, unknown>;
  if (rec["schemaVersion"] !== LIGHTING_RIG_SCHEMA_VERSION) return null;
  const lights = rec["lights"];
  if (!Array.isArray(lights) || lights.length === 0) return null;
  const bbox = rec["bbox"] as Record<string, unknown> | undefined;
  if (
    !bbox
    || !["minX", "minY", "minZ", "maxX", "maxY", "maxZ"].every(
      (k) => typeof bbox[k] === "number" && Number.isFinite(bbox[k]),
    )
  ) {
    return null;
  }
  const parsed: LightingRigLight[] = [];
  for (const entry of lights) {
    if (entry === null || typeof entry !== "object" || Array.isArray(entry)) return null;
    const light = entry as Record<string, unknown>;
    if (typeof light["name"] !== "string" || (light["name"] as string).length === 0) return null;
    if (light["type"] !== "point" && light["type"] !== "area" && light["type"] !== "directional") {
      return null;
    }
    if (!isFiniteVec3(light["position"])) return null;
    if (light["target"] !== undefined && !isFiniteVec3(light["target"])) return null;
    const energy = light["energy"];
    if (typeof energy !== "number" || !(energy > 0 && energy <= MAX_RIG_ENERGY)) return null;
    const size = light["size"];
    if (typeof size !== "number" || !(size >= 0 && size <= MAX_RIG_SIZE_M)) return null;
    const temp = light["colorTemperatureK"];
    if (typeof temp !== "number" || !(temp >= 1000 && temp <= 10000)) return null;
    parsed.push({
      name: light["name"] as string,
      type: light["type"] as RigLightType,
      position: light["position"] as [number, number, number],
      ...(isFiniteVec3(light["target"]) ? { target: light["target"] } : {}),
      energy,
      size,
      colorTemperatureK: temp,
    });
  }
  const exposure = rec["exposure"];
  if (typeof exposure !== "number" || !(exposure > 0 && exposure <= 2)) return null;
  const roomValue = rec["room"] as Record<string, unknown> | undefined;
  const roomEnvironmentId = roomValue?.["environmentId"];
  return {
    schemaVersion: LIGHTING_RIG_SCHEMA_VERSION,
    room: typeof roomEnvironmentId === "string" ? { environmentId: roomEnvironmentId } : {},
    bbox: bbox as unknown as LightingRig["bbox"],
    exposure,
    lights: parsed,
  };
}

/** Tanner Helland kelvin -> RGB approximation for rig color temperatures. */
