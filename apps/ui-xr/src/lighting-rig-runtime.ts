/**
 * Base layer is the raised_hemisphere_ground variant (read-only sweep: lifts
 * walls, no blowout). Rig JSONs promoted to public/xr-assets/lighting overlay
 * key/wash/spill + exposure. Fail closed: no/malformed rig -> variant as-is.
 *
 * Blender bake energies /100, clamped at 5. Area -> aimed DirectionalLight
 * (no RectAreaLightUniformsLib); point fill -> PointLight. Shadows stay owned
 * by the capture key light.
 */
import {
  DirectionalLight,
  type Light,
  PointLight,
  type Scene,
  type WebGLRenderer,
} from "three";
import {
  applyStationInteriorLighting,
  type StationInteriorLightingApplyResult,
  type StationInteriorLightingVariantId,
} from "./station-interior-lighting.js";

export const LIGHTING_RIG_SCHEMA_VERSION = "openclinxr.lighting-rig.v1";
export const LIGHTING_RIG_PUBLIC_DIR = "/xr-assets/lighting";

/** Indoor ranges enforced by the station (lighting-rig.py MAX_ENERGY/MAX_SIZE_M). */
const MAX_RIG_ENERGY = 500;
const MAX_RIG_SIZE_M = 4;

/** Blender bake energy -> three.js intensity. Key 234.7 -> ~2.35. */
const RIG_ENERGY_TO_THREE = 0.01;
const MAX_THREE_INTENSITY = 5;

export type RigLightType = "point" | "area" | "directional";

export type LightingRigLight = {
  name: string;
  type: RigLightType;
  position: [number, number, number];
  target?: [number, number, number];
  energy: number;
  size: number;
  colorTemperatureK: number;
};

export type LightingRig = {
  schemaVersion: typeof LIGHTING_RIG_SCHEMA_VERSION;
  room: { environmentId?: string };
  bbox: { minX: number; minY: number; minZ: number; maxX: number; maxY: number; maxZ: number };
  exposure: number;
  lights: LightingRigLight[];
};

export function resolveLightingRigPublicPath(environmentId: string): string {
  return `${LIGHTING_RIG_PUBLIC_DIR}/${environmentId}.rig.json`;
}

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
export function colorForTemperatureK(kelvin: number): number {
  const t = Math.min(100, Math.max(10, kelvin / 100));
  const r = t <= 66 ? 255 : 329.698727446 * Math.pow(t - 60, -0.1332047592);
  const g = t <= 66
    ? 99.4708025861 * Math.log(t) - 161.1195681661
    : 288.1221695283 * Math.pow(t - 60, -0.0755148492);
  const b = t >= 66 ? 255 : t <= 19 ? 0 : 138.5177312231 * Math.log(t - 10) - 305.0447927307;
  const clamp = (v: number): number => Math.min(255, Math.max(0, Math.round(v)));
  return (clamp(r) << 16) | (clamp(g) << 8) | clamp(b);
}

export function rigEnergyToThreeIntensity(energy: number): number {
  return Math.min(MAX_THREE_INTENSITY, energy * RIG_ENERGY_TO_THREE);
}

/**
 * Overlay rig lights on the scene (base variant applied separately).
 * Rig lights never cast shadows — the capture key owns contact shadows.
 */
export function applyLightingRigOverlay(input: {
  scene: Scene;
  renderer?: WebGLRenderer;
  rig: LightingRig;
}): Light[] {
  const lights: Light[] = [];
  const cx = (input.rig.bbox.minX + input.rig.bbox.maxX) / 2;
  const cy = (input.rig.bbox.minY + input.rig.bbox.maxY) / 2;
  const cz = (input.rig.bbox.minZ + input.rig.bbox.maxZ) / 2;
  for (const entry of input.rig.lights) {
    const color = colorForTemperatureK(entry.colorTemperatureK);
    const intensity = rigEnergyToThreeIntensity(entry.energy);
    if (entry.type === "point") {
      const point = new PointLight(color, intensity, 0, 2);
      point.position.set(...entry.position);
      tagRigLight(point, entry.name);
      input.scene.add(point);
      lights.push(point);
      continue;
    }
    const directional = new DirectionalLight(color, intensity);
    directional.position.set(...entry.position);
    const aim = entry.target ?? [cx, cy, cz];
    directional.target.position.set(...aim);
    input.scene.add(directional.target);
    tagRigLight(directional, entry.name);
    input.scene.add(directional);
    lights.push(directional);
  }
  if (input.renderer && typeof input.renderer.toneMappingExposure === "number") {
    input.renderer.toneMappingExposure = input.rig.exposure;
  }
  return lights;
}

function tagRigLight(light: Light, role: string): void {
  light.userData.openClinXrLightingRig = true;
  light.userData.openClinXrLightingRigRole = role;
}

export type FetchLike = (url: string, init?: Record<string, unknown>) => Promise<{
  ok: boolean;
  json: () => Promise<unknown>;
}>;

/** Fetch + validate; null on missing/malformed (caller keeps constants). */
export async function loadLightingRig(
  environmentId: string,
  fetchImpl: FetchLike = fetch,
): Promise<LightingRig | null> {
  let response: { ok: boolean; json: () => Promise<unknown> };
  try {
    response = await fetchImpl(resolveLightingRigPublicPath(environmentId), { cache: "no-store" });
  } catch {
    return null;
  }
  if (!response.ok) return null;
  try {
    return parseLightingRig(await response.json());
  } catch {
    return null;
  }
}

export type StationLightingWithRigResult = StationInteriorLightingApplyResult & {
  rigApplied: boolean;
};

/**
 * Base raised_hemisphere_ground + rig overlay when a valid rig exists;
 * otherwise the requested variant unchanged (fail closed).
 */
export async function applyStationInteriorLightingForEnvironment(input: {
  scene: Scene;
  renderer: WebGLRenderer;
  environmentId: string;
  variantId: StationInteriorLightingVariantId;
  ambientLightName: string;
  keyLightName: string;
  keyCastShadow: boolean;
  fetchImpl?: FetchLike;
}): Promise<StationLightingWithRigResult> {
  const rig = await loadLightingRig(input.environmentId, input.fetchImpl);
  if (!rig) {
    const fallback = applyStationInteriorLighting(input);
    return { ...fallback, rigApplied: false };
  }
  const base = applyStationInteriorLighting({ ...input, variantId: "raised_hemisphere_ground" });
  const overlay = applyLightingRigOverlay({ scene: input.scene, renderer: input.renderer, rig });
  return { variantId: base.variantId, lights: [...base.lights, ...overlay], rigApplied: true };
}
