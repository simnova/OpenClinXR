/**
 * Aisha-parity HDRI world (P1a): the studio HDRI only, strength 1, Z rot 0.
 *
 * Equirect -> PMREMGenerator for scene.environment; the equirect texture
 * itself as scene.background (Blender film_transparent=False shows the HDRI
 * behind the subject). Rotation via scene.backgroundRotation /
 * scene.environmentRotation (three Y-up == Blender world-Z).
 */

import type { Scene, WebGLRenderer } from "three";
import { EquirectangularReflectionMapping, Euler, PMREMGenerator } from "three";
import { HDRLoader } from "three/addons/loaders/HDRLoader.js";
import type { HdriRig } from "./parity-types.js";

export type HdriReadback = {
  url: string;
  width: number;
  height: number;
  mapping: string;
  rotationYDeg: number;
  intensity: number;
  background: boolean;
  brightestUv: [number, number];
  brightestDir: [number, number, number];
  brightestLum: number;
  envMapPresent: boolean;
};

/** IEEE-754 binary16 -> float32 (for the brightest-texel scan). */
function halfToFloat(h: number): number {
  const s = (h & 0x8000) >> 15;
  const e = (h & 0x7c00) >> 10;
  const f = h & 0x03ff;
  if (e === 0) return (s ? -1 : 1) * 2 ** -14 * (f / 1024);
  if (e === 31) return f === 0 ? (s ? -Infinity : Infinity) : NaN;
  return (s ? -1 : 1) * 2 ** (e - 15) * (1 + f / 1024);
}

/**
 * Brightest equirect texel -> three-space direction, inverting three's
 * equirectUv (u = atan(z,x)/2pi + 0.5, v = asin(y)/pi + 0.5) with the
 * HDRLoader layout (flipY=true, file rows run top-to-bottom).
 */
export function brightestDirection(
  data: Uint16Array,
  width: number,
  height: number,
): { uv: [number, number]; dir: [number, number, number]; lum: number } {
  let best = -1;
  let bestLum = -Infinity;
  for (let i = 0; i < width * height; i += 1) {
    const r = halfToFloat(data[i * 3] ?? 0);
    const g = halfToFloat(data[i * 3 + 1] ?? 0);
    const b = halfToFloat(data[i * 3 + 2] ?? 0);
    const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    if (lum > bestLum) {
      bestLum = lum;
      best = i;
    }
  }
  const col = best % width;
  const row = Math.floor(best / width);
  // flipY: memory row 0 (file top) is v=1.
  const u = (col + 0.5) / width;
  const v = 1 - (row + 0.5) / height;
  const theta = (u - 0.5) * Math.PI * 2; // atan(z,x)
  const phi = (v - 0.5) * Math.PI; // asin(y)
  const y = Math.sin(phi);
  const rc = Math.cos(phi);
  const dir: [number, number, number] = [
    rc * Math.cos(theta),
    y,
    rc * Math.sin(theta),
  ];
  return { uv: [u, v], dir, lum: bestLum };
}

export async function loadParityHdri(
  renderer: WebGLRenderer,
  scene: Scene,
  hdri: HdriRig,
): Promise<HdriReadback> {
  const texture = await new HDRLoader().loadAsync(hdri.url);
  // HDRLoader leaves mapping at UVMapping (its docstring tells the caller to
  // set equirect). Without this the background box projection smears the
  // studio while the PMREM env stays correct — a silent brightness/pattern
  // mismatch against Blender. PMREM reads the pixels as equirect either way.
  texture.mapping = EquirectangularReflectionMapping;
  const w = texture.image.width as number;
  const h = texture.image.height as number;
  const data = texture.image.data as Uint16Array;
  const bright = brightestDirection(data, w, h);
  const pmrem = new PMREMGenerator(renderer);
  const env = pmrem.fromEquirectangular(texture).texture;
  pmrem.dispose();
  scene.environment = env;
  const rad = (hdri.rotationYDeg * Math.PI) / 180;
  scene.environmentRotation = new Euler(0, rad, 0);
  if (hdri.background) {
    scene.background = texture;
    scene.backgroundRotation = new Euler(0, rad, 0);
  }
  if (Number.isFinite(hdri.intensity)) {
    (scene as unknown as { environmentIntensity?: number }).environmentIntensity = hdri.intensity;
  }
  return {
    url: hdri.url,
    width: w,
    height: h,
    mapping: "EquirectangularReflectionMapping",
    rotationYDeg: hdri.rotationYDeg,
    intensity: hdri.intensity,
    background: hdri.background,
    brightestUv: [Math.round(bright.uv[0] * 1e5) / 1e5, Math.round(bright.uv[1] * 1e5) / 1e5],
    brightestDir: [
      Math.round(bright.dir[0] * 1e5) / 1e5,
      Math.round(bright.dir[1] * 1e5) / 1e5,
      Math.round(bright.dir[2] * 1e5) / 1e5,
    ],
    brightestLum: Math.round(bright.lum * 1000) / 1000,
    envMapPresent: scene.environment != null,
  };
}
