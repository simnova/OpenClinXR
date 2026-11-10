/**
 * hair-groom-2 sheen: compact light rig -> the lab's RigOverride (xr-scene isolated-subject-rig-variants.ts).
 * Directions are camera-relative by default: az 0 = from the camera, az > 0 = from screen right, el > 0 = from
 * above, in every pack view. Each directional is placed 100 m out along its direction (the lab aims it at the
 * world origin; the head sits ~1.6 m from it, < 1 deg of error). The lab default rig is always removed, so a rig
 * file describes the whole lighting. A file may carry `views: { <view>: partial rig }` merged over the base.
 */
import { readFileSync } from "node:fs";

export type RigLight = { az: number; el: number; intensity: number; color?: string };
export type LightRig = {
  frame?: "camera" | "world";
  key?: RigLight;
  fill?: RigLight;
  rim?: RigLight;
  ambient?: { intensity: number; color?: string };
  hemisphere?: { intensity: number; sky?: string; ground?: string };
  environment?: "room" | null;
  environmentIntensity?: number;
  toneMapping?: "None" | "ACESFilmic" | "AgX" | "Neutral";
  exposure?: number;
  views?: Record<string, Partial<LightRig>>;
};

/** Camera azimuth per pack view (camera-fit-to-bounds.ts VIEW_DIRECTIONS: front = +Z, side = +X). */
const VIEW_AZ: Record<string, number> = { front: 0, three_quarter_left: 45, side: 90, back: 180, three_quarter_right: -45 };

export function loadLightRig(file: string): LightRig {
  const rig = JSON.parse(readFileSync(file, "utf8")) as LightRig;
  if (typeof rig !== "object" || rig === null) throw new Error(`--light-rig ${file}: not a JSON object`);
  return rig;
}

function dirPos(azDeg: number, elDeg: number): [number, number, number] {
  const a = (azDeg * Math.PI) / 180;
  const e = (elDeg * Math.PI) / 180;
  return [100 * Math.sin(a) * Math.cos(e), 100 * Math.sin(e), 100 * Math.cos(a) * Math.cos(e)];
}

export function rigOverrideFor(base: LightRig, view: string): Record<string, unknown> {
  const rig: LightRig = { ...base, ...(base.views?.[view] ?? {}) };
  const camAz = rig.frame === "world" ? 0 : VIEW_AZ[view];
  if (camAz === undefined) throw new Error(`light rig: unknown view ${view}`);
  const directionals: Array<{ color: string; intensity: number; position: [number, number, number] }> = [];
  for (const l of [rig.key, rig.fill, rig.rim]) {
    if (!l) continue;
    for (const v of [l.az, l.el, l.intensity]) {
      if (!Number.isFinite(v)) throw new Error("light rig: az, el and intensity must be finite numbers");
    }
    directionals.push({ color: l.color ?? "#ffffff", intensity: l.intensity, position: dirPos(camAz + l.az, l.el) });
  }
  return {
    removeDefaultLights: true,
    ...(rig.ambient ? { ambient: { color: rig.ambient.color ?? "#ffffff", intensity: rig.ambient.intensity } } : {}),
    ...(rig.hemisphere
      ? { hemisphere: { skyColor: rig.hemisphere.sky ?? "#ffffff", groundColor: rig.hemisphere.ground ?? "#808080", intensity: rig.hemisphere.intensity } }
      : {}),
    directionals,
    ...(rig.toneMapping ? { toneMapping: rig.toneMapping } : {}),
    ...(rig.exposure != null ? { exposure: rig.exposure } : {}),
    ...(rig.environment === "room" ? { environment: "room" } : {}),
    ...(rig.environmentIntensity != null ? { environmentIntensity: rig.environmentIntensity } : {}),
  };
}
