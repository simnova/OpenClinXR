/**
 * Aisha-parity physical material levers + flat-ID mask materials.
 *
 * Every swap copies the full map/flag set (map, normalMap+scale,
 * roughnessMap, metalnessMap, alphaMap, alphaTest, side, transparent,
 * opacity, vertexColors, envMapIntensity, emissive+emissiveMap, and the
 * onBeforeCompile/customProgramCacheKey hooks so the GLB's
 * OPENCLINXR_skin_shade hook is never dropped). Hidden MASK materials stay
 * on visible-but-occluded meshes, exactly as P1a kept them (occluded under
 * clothing, mask other=0).
 */

import {
  Mesh,
  MeshPhysicalMaterial,
  MeshStandardMaterial,
  type Object3D,
} from "three";

export { applyBrowLash } from "./parity-hair-mask.js";

export type PhysicalSwapReadback = {
  mesh: string;
  material: string;
  from: string;
  to: "MeshPhysicalMaterial";
  params: Record<string, number | string | number[]>;
};

/** Copy every map/flag the brief names (plus the hook pair) Standard -> Physical. */
export function cloneToPhysical(src: MeshStandardMaterial): MeshPhysicalMaterial {
  const next = new MeshPhysicalMaterial();
  next.name = src.name;
  next.color.copy(src.color);
  next.map = src.map;
  next.normalMap = src.normalMap;
  next.normalScale.copy(src.normalScale);
  next.roughnessMap = src.roughnessMap;
  next.roughness = src.roughness;
  next.metalnessMap = src.metalnessMap;
  next.metalness = src.metalness;
  next.alphaMap = src.alphaMap;
  next.alphaTest = src.alphaTest;
  next.side = src.side;
  next.transparent = src.transparent;
  next.opacity = src.opacity;
  next.vertexColors = src.vertexColors;
  next.emissive.copy(src.emissive);
  next.emissiveMap = src.emissiveMap;
  next.emissiveIntensity = src.emissiveIntensity;
  next.envMapIntensity = src.envMapIntensity;
  next.envMap = src.envMap;
  // Morph/skinning live on geometry/object, not the material — but alpha
  // coverage, depth and flat flags ride the material.
  next.alphaToCoverage = src.alphaToCoverage;
  next.alphaHash = (src as unknown as { alphaHash?: boolean }).alphaHash ?? false;
  next.depthWrite = src.depthWrite;
  next.flatShading = src.flatShading;
  // Never drop the GLB's skin_shade (or any other) hook across the swap.
  // Own-property check: Material.prototype carries a no-op onBeforeCompile,
  // so `typeof === "function"` is true even with no hook installed.
  const hasOwnHook = Object.hasOwn(src, "onBeforeCompile");
  const hasOwnKey = Object.hasOwn(src, "customProgramCacheKey");
  const prevHook = hasOwnHook ? src.onBeforeCompile : undefined;
  const prevKey = hasOwnKey ? src.customProgramCacheKey : undefined;
  if (prevHook) next.onBeforeCompile = prevHook;
  if (prevKey) next.customProgramCacheKey = prevKey;
  return next;
}

function swapMeshMaterial(mesh: Mesh, index: number, next: MeshPhysicalMaterial): void {
  if (Array.isArray(mesh.material)) {
    (mesh.material as unknown[])[index] = next;
  } else {
    mesh.material = next;
  }
  next.needsUpdate = true;
}

export function eachMaterialSlot(
  root: Object3D,
  test: (materialName: string, meshName: string) => boolean,
  visit: (mesh: Mesh, index: number, m: MeshStandardMaterial) => void,
): void {
  root.traverse((o) => {
    if (!(o instanceof Mesh)) return;
    const mats = Array.isArray(o.material) ? o.material : [o.material];
    mats.forEach((m, index) => {
      if (!m) return;
      if (m instanceof MeshPhysicalMaterial) {
        if (test(m.name, o.name)) visit(o, index, m as unknown as MeshStandardMaterial);
        return;
      }
      if (m instanceof MeshStandardMaterial && test(m.name, o.name)) visit(o, index, m);
    });
  });
}

/**
 * Lever e (physical.eyes): clearcoat/ior/specular swap on the eye-globe slot
 * (meshlow-poly carries mat_makeclothes_library_eyes_*). `true` = the landed
 * P2 values; an object overrides per-field (P2b step 3: P1b manifest eye
 * values roughness 0.05 / specular 0.5 / coat 1/0.02/1.376).
 */
export function applyEyePhysical(
  root: Object3D,
  params?: {
    roughness?: number;
    envMapIntensity?: number;
    specularIntensity?: number;
    clearcoat?: number;
    clearcoatRoughness?: number;
  },
  scene?: Pick<import("three").Scene, "environment" | "environmentRotation" | "environmentIntensity">,
): PhysicalSwapReadback[] {
  const eye = {
    roughness: params?.roughness,
    envMapIntensity: params?.envMapIntensity,
    specularIntensity: params?.specularIntensity ?? 1,
    clearcoat: params?.clearcoat ?? 1,
    clearcoatRoughness: params?.clearcoatRoughness ?? 0.03,
  };
  for (const [name, v] of [
    ["roughness", eye.roughness],
    ["envMapIntensity", eye.envMapIntensity],
    ["specularIntensity", eye.specularIntensity],
    ["clearcoat", eye.clearcoat],
    ["clearcoatRoughness", eye.clearcoatRoughness],
  ] as const) {
    if (v !== undefined && (!Number.isFinite(v) || v < 0 || v > 2)) {
      throw new Error(`parity eyes refuses ${name}=${v} (need finite 0..2) — refusing`);
    }
  }
  const out: PhysicalSwapReadback[] = [];
  eachMaterialSlot(
    root,
    (name) => /^mat_makeclothes_library_eyes_/.test(name),
    (mesh, index, m) => {
      const next = m instanceof MeshPhysicalMaterial ? m : cloneToPhysical(m);
      if (!(m instanceof MeshPhysicalMaterial)) swapMeshMaterial(mesh, index, next);
      next.clearcoat = eye.clearcoat;
      next.clearcoatRoughness = eye.clearcoatRoughness;
      next.ior = 1.376;
      next.specularIntensity = eye.specularIntensity;
      if (eye.roughness !== undefined) next.roughness = eye.roughness;
      if (scene?.environment) {
        next.envMap = scene.environment;
        next.envMapRotation.copy(scene.environmentRotation);
        next.envMapIntensity = eye.envMapIntensity ?? scene.environmentIntensity;
      }
      next.needsUpdate = true;
      out.push({
        mesh: mesh.name,
        material: next.name,
        from: m.type,
        to: "MeshPhysicalMaterial",
        params: {
          clearcoat: eye.clearcoat,
          clearcoatRoughness: eye.clearcoatRoughness,
          ior: 1.376,
          specularIntensity: eye.specularIntensity,
          ...(eye.roughness !== undefined ? { roughness: eye.roughness } : {}),
          ...(scene?.environment ? { envMapIntensity: next.envMapIntensity } : {}),
        },
      });
    },
  );
  if (out.length === 0) throw new Error("physical.eyes matched no mat_makeclothes_library_eyes_* material — refusing");
  return out;
}

/** Mean sRGB of a loaded base-colour map (64px thumbnail, same-origin GLB asset). */
export function mapMeanSrgb(map: { image?: unknown } | null): [number, number, number] | null {
  const image = map?.image as
    | HTMLImageElement
    | HTMLCanvasElement
    | ImageBitmap
    | undefined;
  if (!image || (image as { width?: number }).width === 0) return null;
  try {
    const canvas = document.createElement("canvas");
    canvas.width = 64;
    canvas.height = 64;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) return null;
    ctx.drawImage(image as unknown as CanvasImageSource, 0, 0, 64, 64);
    const px = ctx.getImageData(0, 0, 64, 64).data;
    let r = 0, g = 0, b = 0;
    const n = px.length / 4;
    for (let i = 0; i < px.length; i += 4) {
      r += px[i]! / 255;
      g += px[i + 1]! / 255;
      b += px[i + 2]! / 255;
    }
    return [r / n, g / n, b / n];
  } catch {
    return null;
  }
}

const CLOTH_RE =
  /^(mat_makeclothes_library_female_tight_jeans_pants|mat_makeclothes_library_footwear_toigo_mj_cloth_shoes|mat_makeclothes_library_toigo_t_shirt)$/;

/**
 * Lever f (physical.cloth): sheen 1 / sheenRoughness 0.8, sheenColor from the
 * map mean, roughness kept. Object params override per-field (P2b step 5);
 * absent fields keep the landed P2 values.
 */
export function applyClothPhysical(
  root: Object3D,
  params?: { sheen?: number; sheenColorScale?: number; sheenRoughness?: number },
): PhysicalSwapReadback[] {
  const sheen = params?.sheen ?? 1;
  const colorScale = params?.sheenColorScale ?? 1;
  const sheenRoughness = params?.sheenRoughness ?? 0.8;
  if (!(sheen >= 0 && sheen <= 1 && colorScale >= 0 && sheenRoughness > 0 && sheenRoughness <= 1)) {
    throw new Error(
      `parity cloth refuses sheen=${sheen} colorScale=${colorScale} roughness=${sheenRoughness} — refusing`,
    );
  }
  const out: PhysicalSwapReadback[] = [];
  eachMaterialSlot(
    root,
    (name) => CLOTH_RE.test(name),
    (mesh, index, m) => {
      const next = m instanceof MeshPhysicalMaterial ? m : cloneToPhysical(m);
      if (!(m instanceof MeshPhysicalMaterial)) swapMeshMaterial(mesh, index, next);
      const mean = mapMeanSrgb(next.map as { image?: unknown } | null);
      next.sheen = sheen;
      next.sheenRoughness = sheenRoughness;
      if (mean) next.sheenColor.setRGB(mean[0] * colorScale, mean[1] * colorScale, mean[2] * colorScale);
      next.needsUpdate = true;
      out.push({
        mesh: mesh.name,
        material: next.name,
        from: m.type,
        to: "MeshPhysicalMaterial",
        params: {
          sheen,
          sheenRoughness,
          sheenColor: mean
            ? [round4(mean[0] * colorScale), round4(mean[1] * colorScale), round4(mean[2] * colorScale)]
            : "map-unreadable-kept-white",
          roughnessKept: round4(next.roughness),
        },
      });
    },
  );
  if (out.length === 0) throw new Error("physical.cloth matched no jeans/shoes/t_shirt material — refusing");
  return out;
}

export type SssWrapParams = {
  /** Linear red-shift colour added by the wrap term. */
  color: [number, number, number];
  strength: number;
  wrap: number;
  exponent: number;
  /** Dominant light dir in WORLD space (converted to view space per camera). */
  lightDirWorld: [number, number, number];
};

export const DEFAULT_SSS_WRAP: SssWrapParams = {
  color: [0.32, 0.045, 0.02],
  strength: 0.06,
  wrap: 0.45,
  exponent: 1.6,
  lightDirWorld: [0, 1, 0],
};

export function round4(n: number): number {
  return Math.round(n * 10000) / 10000;
}

/** Chain the red-shifted diffuse-wrap SSS approximation after any hook. */
export function applySssWrap(
  material: MeshPhysicalMaterial,
  params: SssWrapParams,
): { chainedOntoHook: boolean; cacheKey: string } {
  // Own-property check (see cloneToPhysical): the prototype no-op must not
  // count as "chained onto the skin_shade hook".
  const chainedOntoHook = Object.hasOwn(material, "onBeforeCompile");
  const prevHook = chainedOntoHook ? material.onBeforeCompile : undefined;
  const prevKey = Object.hasOwn(material, "customProgramCacheKey")
    ? material.customProgramCacheKey?.bind(material)
    : undefined;
  const keyFragment =
    `parity-sss:c${params.color.join(",")}:s${params.strength}:w${params.wrap}:x${params.exponent}`;
  material.onBeforeCompile = function (shader, renderer) {
    prevHook?.call(this, shader, renderer);
    (material.userData as Record<string, unknown>)["paritySSSUniforms"] = shader.uniforms;
    (material.userData as Record<string, unknown>)["paritySSSLightDirWorld"] = params.lightDirWorld;
    shader.uniforms["uParitySSSLightView"] = { value: [0, 0, 1] };
    shader.uniforms["uParitySSSColor"] = { value: params.color };
    shader.uniforms["uParitySSSStrength"] = { value: params.strength };
    shader.uniforms["uParitySSSWrap"] = { value: params.wrap };
    shader.uniforms["uParitySSSExponent"] = { value: params.exponent };
    shader.fragmentShader = shader.fragmentShader
      .replace(
        "#include <common>",
        `#include <common>
uniform vec3 uParitySSSLightView;
uniform vec3 uParitySSSColor;
uniform float uParitySSSStrength;
uniform float uParitySSSWrap;
uniform float uParitySSSExponent;`,
      )
      .replace(
        "#include <lights_fragment_end>",
        `#include <lights_fragment_end>
{
  float parityNdl = dot( normalize( geometryNormal ), normalize( uParitySSSLightView ) );
  float parityWrap = clamp( ( parityNdl + uParitySSSWrap ) / ( 1.0 + uParitySSSWrap ), 0.0, 1.0 );
  reflectedLight.directDiffuse += uParitySSSColor * ( uParitySSSStrength * pow( parityWrap, uParitySSSExponent ) );
}`,
      );
  };
  material.customProgramCacheKey = () => `${prevKey?.() ?? "physical"}|${keyFragment}`;
  material.needsUpdate = true;
  return { chainedOntoHook, cacheKey: keyFragment };
}

/**
 * Lever g (physical.skin): sheen 0.25/0.6 + chained SSS wrap. The GLB's
 * skin_shade hook (factory-loader install) is carried across the
 * Standard->Physical swap by cloneToPhysical and the wrap chains after it —
 * never replaced.
 */
export function applySkinPhysical(
  root: Object3D,
  sss: SssWrapParams = DEFAULT_SSS_WRAP,
  roughness?: number,
): Array<PhysicalSwapReadback & { skinShadeHookPresent: boolean; sssChainedOntoHook: boolean; sssCacheKey: string }> {
  const out: Array<
    PhysicalSwapReadback & { skinShadeHookPresent: boolean; sssChainedOntoHook: boolean; sssCacheKey: string }
  > = [];
  eachMaterialSlot(
    root,
    (name) => name === "mpfb_skin_ob_patient_aisha_v1",
    (mesh, index, m) => {
      // Own-property: the prototype no-op onBeforeCompile is not the hook.
      const hookPresent = Object.hasOwn(m, "onBeforeCompile");
      const next = m instanceof MeshPhysicalMaterial ? m : cloneToPhysical(m);
      if (!(m instanceof MeshPhysicalMaterial)) swapMeshMaterial(mesh, index, next);
      next.sheen = 0.25;
      next.sheenRoughness = 0.6;
      if (roughness !== undefined) next.roughness = roughness;
      const wrap = applySssWrap(next, sss);
      next.needsUpdate = true;
      out.push({
        mesh: mesh.name,
        material: next.name,
        from: m.type,
        to: "MeshPhysicalMaterial",
        params: {
          sheen: 0.25,
          sheenRoughness: 0.6,
          ...(roughness !== undefined ? { roughness } : { roughnessKept: round4(next.roughness) }),
          sssColor: sss.color,
          sssStrength: sss.strength,
          sssWrap: sss.wrap,
          sssExponent: sss.exponent,
          sssLightDirWorld: sss.lightDirWorld,
        },
        skinShadeHookPresent: hookPresent,
        sssChainedOntoHook: wrap.chainedOntoHook,
        sssCacheKey: wrap.cacheKey,
      });
    },
  );
  if (out.length === 0) throw new Error("physical.skin matched no mpfb_skin material — refusing");
  return out;
}
