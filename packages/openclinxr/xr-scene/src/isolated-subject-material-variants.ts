/**
 * Isolated-subject lab material variants (extracted from isolated-subject-lab.ts).
 *
 * Skin-realism portrait + variant evaluator: fitted-hair removal, skin
 * map/scalar overrides, and generic material overrides applied post-GLB-load.
 * Never writes a GLB. An override that matches nothing REFUSES (fail closed).
 */

import {
  Color,
  Mesh,
  MeshPhysicalMaterial,
  MeshStandardMaterial,
  NoColorSpace,
  type Object3D,
  SRGBColorSpace,
  TextureLoader,
} from "three";
import { isFittedHairMeshName } from "./head-box-from-geometry.js";
import {
  applyEyeShader,
  eyeShaderInstalled,
  resolveEyeShaderOptions,
  type EyeShaderOptions,
} from "./eye-shader/eye-parallax.js";
import {
  applySkinShade,
  resolveSkinShadeOptions,
  skinShadeCurvature,
  skinShadeInstalled,
  type SkinShadeOptions,
} from "./skin-shader/skin-shade.js";

/**
 * Skin index of refraction: ~1.4 for the stratum corneum / epidermis
 * (Tuchin, Tissue Optics 3rd ed., Table 1.3: n = 1.36-1.43; GPU Gems 3
 * ch. 14, d'Eon & Luebke, models the skin air-tissue interface at 1.4).
 * three.js MeshStandardMaterial hardcodes dielectric F0 0.04 (IOR 1.5);
 * at n = 1.4, F0 = ((n-1)/(n+1))^2 = 0.0278.
 */
export const SKIN_IOR = 1.4;
/** Fresnel F0 at SKIN_IOR: ((SKIN_IOR-1)/(SKIN_IOR+1))^2 = 0.0278. */
export const SKIN_F0 = ((SKIN_IOR - 1) / (SKIN_IOR + 1)) ** 2;

/**
 * Variant evaluator skin override (data-driven, deterministic).
 * Applied after GLB load to every material whose name matches `materialNameMatch`
 * (regex source, case-insensitive, default "mpfb_skin"). Never writes a GLB.
 */
export type SkinOverride = {
  baseColorUrl?: string;
  normalUrl?: string;
  normalScale?: number;
  roughness?: number;
  roughnessMapUrl?: string;
  aoMapUrl?: string;
  aoMapIntensity?: number;
  materialNameMatch?: string;
  /**
   * Explicit IOR for the G1 control only (card tsk_d4667a3e507da70):
   * physical swap at 1.5 vs the untouched MeshStandard render. Absent,
   * the skin renders at SKIN_IOR (1.4). Must be finite when present.
   */
  ior?: number;
};

/** Skin-realism portrait: remove fitted hair meshes (/hair/i over mesh, node, geometry names) so the head frames without hair. */
export function removeFittedHair(root: Object3D): string[] {
  const removed: string[] = [];
  const targets: Object3D[] = [];
  root.traverse((o) => {
    if (!(o instanceof Mesh)) return;
    const nodeName = typeof (o.userData?.["name"]) === "string" ? String(o.userData["name"]) : "";
    const geoName = o.geometry?.name ?? "";
    if (isFittedHairMeshName(o.name) || (nodeName && isFittedHairMeshName(nodeName)) || (geoName && isFittedHairMeshName(geoName))) {
      targets.push(o);
      removed.push(o.name || nodeName || geoName);
    }
  });
  for (const t of targets) t.parent?.remove(t);
  return removed;
}

export type SkinOverrideApplied = {
  pattern: string;
  matchedMaterials: string[];
  baseColor: { url: string; size: [number, number] } | null;
  normal: { url: string; size: [number, number]; scale: number } | null;
  roughness: number | null;
  roughnessMap: { url: string; size: [number, number] } | null;
  ao: { url: string; size: [number, number]; intensity: number } | null;
  /** Index of refraction the matched skin material(s) render at. */
  ior: number;
};

/** Variant evaluator: override skin maps/scalars on matching materials (post-load, no GLB write). */
export async function applySkinOverride(root: Object3D, override: SkinOverride): Promise<SkinOverrideApplied> {
  const pattern = override.materialNameMatch ?? "mpfb_skin";
  let re: RegExp;
  try {
    re = new RegExp(pattern, "i");
  } catch {
    throw new Error(`skinOverride.materialNameMatch is not a valid regex: ${pattern}`);
  }
  if (override.ior != null && !Number.isFinite(override.ior)) {
    throw new Error(`skinOverride.ior must be finite, got ${JSON.stringify(override.ior)}`);
  }
  const loader = new TextureLoader();
  const matched: MeshStandardMaterial[] = [];
  const matchedNames: string[] = [];
  const availableNames: string[] = [];
  root.traverse((o) => {
    if (!(o instanceof Mesh)) return;
    const mats = Array.isArray(o.material) ? o.material : [o.material];
    for (const m of mats) {
      if (!m) continue;
      if (!availableNames.includes(m.name)) availableNames.push(m.name);
      if (!re.test(m.name)) continue;
      if (m instanceof MeshStandardMaterial && !matched.includes(m)) {
        matched.push(m);
        matchedNames.push(m.name);
      }
    }
  });
  if (matched.length === 0) {
    throw new Error(`skinOverride matched no material (pattern /${pattern}/i) — refusing rather than rendering the base skin. Available materials: ${JSON.stringify(availableNames.sort())}`);
  }
  const texSize = (t: { image?: { width?: number; height?: number } } | null): [number, number] | null =>
    t?.image?.width ? [t.image.width, t.image.height ?? t.image.width] : null;
  let baseColor: SkinOverrideApplied["baseColor"] = null;
  let normal: SkinOverrideApplied["normal"] = null;
  let roughnessMap: SkinOverrideApplied["roughnessMap"] = null;
  let ao: SkinOverrideApplied["ao"] = null;
  if (override.baseColorUrl) {
    const tex = await loader.loadAsync(override.baseColorUrl);
    tex.colorSpace = SRGBColorSpace;
    tex.flipY = false;
    baseColor = { url: override.baseColorUrl, size: texSize(tex) ?? [0, 0] };
    for (const m of matched) {
      const srcChannel = (m.map as unknown as { channel?: number } | null)?.channel ?? 0;
      (tex as unknown as { channel?: number }).channel = srcChannel;
      m.map = tex;
      m.needsUpdate = true;
    }
  }
  if (override.normalUrl) {
    const tex = await loader.loadAsync(override.normalUrl);
    tex.colorSpace = NoColorSpace;
    tex.flipY = false;
    const scale = override.normalScale ?? 1;
    normal = { url: override.normalUrl, size: texSize(tex) ?? [0, 0], scale };
    for (const m of matched) {
      const srcChannel = (m.map as unknown as { channel?: number } | null)?.channel ?? 0;
      (tex as unknown as { channel?: number }).channel = srcChannel;
      m.normalMap = tex;
      m.normalScale.set(scale, scale);
      m.needsUpdate = true;
    }
  }
  if (override.roughnessMapUrl) {
    const tex = await loader.loadAsync(override.roughnessMapUrl);
    tex.colorSpace = NoColorSpace;
    tex.flipY = false;
    roughnessMap = { url: override.roughnessMapUrl, size: texSize(tex) ?? [0, 0] };
    for (const m of matched) {
      const srcChannel = (m.map as unknown as { channel?: number } | null)?.channel ?? 0;
      (tex as unknown as { channel?: number }).channel = srcChannel;
      m.roughnessMap = tex;
      m.needsUpdate = true;
    }
  }
  let roughness: number | null = null;
  if (override.roughness != null && Number.isFinite(override.roughness)) {
    roughness = override.roughness;
    for (const m of matched) m.roughness = override.roughness;
  }
  if (override.aoMapUrl) {
    const tex = await loader.loadAsync(override.aoMapUrl);
    tex.colorSpace = NoColorSpace;
    tex.flipY = false;
    const intensity = override.aoMapIntensity ?? 1;
    ao = { url: override.aoMapUrl, size: texSize(tex) ?? [0, 0], intensity };
    for (const m of matched) {
      // aoMap shares the base-colour UV set here (same channel as map).
      const srcChannel = (m.map as unknown as { channel?: number } | null)?.channel ?? 0;
      (tex as unknown as { channel?: number }).channel = srcChannel;
      m.aoMap = tex;
      m.aoMapIntensity = intensity;
      m.needsUpdate = true;
    }
  }
  // Skin renders at SKIN_IOR: swap each matched MeshStandardMaterial for a
  // MeshPhysicalMaterial carrying ALL of its state (three r184:
  // Material.copy covers side/transparent/opacity/alphaTest/depth/blend/
  // polygonOffset/vertexColors/userData; MeshStandardMaterial.copy the
  // maps/scalars/envMap/flatShading/fog). Standard.copy resets defines to
  // {STANDARD}, so restore the constructor's {STANDARD, PHYSICAL} after
  // (MeshPhysicalMaterial.js ctor + copy()). Fresh-physical defaults are
  // effect-free (clearcoat/sheen/transmission 0; specularIntensity 1 keeps
  // F0 0.04 at ior 1.5). NOTE: next.copy(src) would be wrong here:
  // Physical.copy reads physical-only fields off the standard source.
  const ior = override.ior ?? SKIN_IOR;
  const swapped = new Map<MeshStandardMaterial, MeshPhysicalMaterial>();
  const standardCopy = MeshStandardMaterial.prototype.copy as unknown as (
    this: MeshPhysicalMaterial,
    source: MeshStandardMaterial,
  ) => void;
  for (const src of matched) {
    const next = new MeshPhysicalMaterial();
    standardCopy.call(next, src);
    next.defines = { STANDARD: "", PHYSICAL: "" };
    next.ior = ior;
    swapped.set(src, next);
  }
  root.traverse((o) => {
    if (!(o instanceof Mesh)) return;
    if (Array.isArray(o.material)) {
      o.material = o.material.map((m) => {
        const next = m instanceof MeshStandardMaterial ? swapped.get(m) : undefined;
        if (next) next.needsUpdate = true;
        return next ?? m;
      });
    } else if (o.material instanceof MeshStandardMaterial) {
      const next = swapped.get(o.material);
      if (next) {
        next.needsUpdate = true;
        o.material = next;
      }
    }
  });
  return { pattern, matchedMaterials: matchedNames, baseColor, normal, roughness, roughnessMap, ao, ior };
}

/**
 * Variant evaluator generic material override (data-driven, deterministic).
 * `match` is a regex source tested against the material name OR the mesh name.
 * `color` multiplies the base colour (material.color). `hide` sets
 * visible=false on matching meshes. `physical` swaps a MeshStandardMaterial
 * for a MeshPhysicalMaterial copying its maps and scalars, then sets the
 * clearcoat/ior params. An override that matches nothing REFUSES.
 */
export type MaterialPhysicalOverride = {
  clearcoat?: number;
  clearcoatRoughness?: number;
  ior?: number;
};

export type MaterialOverride = {
  match: string;
  baseColorUrl?: string;
  color?: string;
  roughness?: number;
  metalness?: number;
  envMapIntensity?: number;
  /**
   * Portrait skin-shade flag (tsk_2f1eca863f8134f6): true installs the
   * onBeforeCompile skin shader at default strength; an object sets the
   * T-zone sweep strength. Absent/false installs nothing (CW1: the default
   * program is byte-identical to origin/main). A flag WITHOUT
   * skinShadeCurvatureUrl REFUSES: the shader samples the baked curvature
   * map (aisha-curvature-1024.png), so an unbound sampler is a failure.
   */
  skinShade?: boolean | SkinShadeOptions;
  /** Baked curvature map for the skin-shade flag (data texture, like aoMap). */
  skinShadeCurvatureUrl?: string;
  /**
   * Portrait eye-shade flag (tsk_4ca1eb82092e11bd): true installs the
   * onBeforeCompile iris-parallax shader at defaults (pupil scale 1, limbus
   * 0.4); an object sets pupil/limbus. Absent/false installs nothing (CW1:
   * the default program is byte-identical to origin/main). Targets the
   * realism eye globe material (mat_makeclothes_library_eyes_ob_patient_aisha);
   * the clear cornea shell is never touched (catch-light stays on the shell).
   */
  eyeShade?: boolean | EyeShaderOptions;
  emissive?: string;
  emissiveIntensity?: number;
  hide?: boolean;
  physical?: MaterialPhysicalOverride;
};

/** One material slot in the loaded scene (mesh x material). */
export type MaterialInventoryEntry = {
  mesh: string;
  material: string;
  type: string;
  color: string;
  roughness: number | null;
  metalness: number | null;
  hasBaseColorMap: boolean;
  baseColorMapSize: [number, number] | null;
  vertexCount: number;
};

export type MaterialOverrideReadback = {
  mesh: string;
  material: string;
  type: string;
  color: string;
  roughness: number | null;
  metalness: number | null;
  envMapIntensity: number | null;
  emissive: string;
  emissiveIntensity: number | null;
  hidden: boolean;
  skinShade: boolean;
  skinShadeCurvature: boolean;
  eyeShade: boolean;
  clearcoat: number | null;
  clearcoatRoughness: number | null;
  ior: number | null;
  hasBaseColorMap: boolean;
};

export type MaterialOverrideApplied = {
  match: string;
  matched: string[];
  readback: MaterialOverrideReadback[];
};

/** Every material slot in the scene: mesh/material names, type, scalars, map presence/size, mesh vertex count. */
export function collectMaterialInventory(root: Object3D): MaterialInventoryEntry[] {
  const out: MaterialInventoryEntry[] = [];
  root.traverse((o) => {
    if (!(o instanceof Mesh)) return;
    const mats = Array.isArray(o.material) ? o.material : [o.material];
    const vertexCount = o.geometry?.getAttribute("position")?.count ?? 0;
    for (const m of mats) {
      if (!m) continue;
      const std = m as MeshStandardMaterial;
      const map = (std as unknown as { map?: { image?: { width?: number; height?: number } } }).map;
      out.push({
        mesh: o.name,
        material: m.name,
        type: m.type,
        color: `#${std.color?.getHexString() ?? "000000"}`,
        roughness: typeof std.roughness === "number" ? std.roughness : null,
        metalness: typeof std.metalness === "number" ? std.metalness : null,
        hasBaseColorMap: map != null,
        baseColorMapSize: map?.image?.width ? [map.image.width, map.image.height ?? map.image.width] : null,
        vertexCount,
      });
    }
  });
  return out;
}

function readbackMaterial(mesh: Mesh, m: MeshStandardMaterial | MeshPhysicalMaterial): MaterialOverrideReadback {
  const phys = m as MeshPhysicalMaterial;
  const map = (m as unknown as { map?: unknown }).map;
  return {
    mesh: mesh.name,
    material: m.name,
    type: m.type,
    color: `#${m.color.getHexString()}`,
    roughness: typeof m.roughness === "number" ? m.roughness : null,
    metalness: typeof m.metalness === "number" ? m.metalness : null,
    envMapIntensity: typeof m.envMapIntensity === "number" ? m.envMapIntensity : null,
    emissive: `#${m.emissive.getHexString()}`,
    emissiveIntensity: typeof m.emissiveIntensity === "number" ? m.emissiveIntensity : null,
    hidden: mesh.visible !== true,
    skinShade: skinShadeInstalled(m),
    skinShadeCurvature: skinShadeCurvature(m) != null,
    eyeShade: eyeShaderInstalled(m),
    clearcoat: typeof phys.clearcoat === "number" ? phys.clearcoat : null,
    clearcoatRoughness: typeof phys.clearcoatRoughness === "number" ? phys.clearcoatRoughness : null,
    ior: typeof phys.ior === "number" ? phys.ior : null,
    hasBaseColorMap: map != null,
  };
}

function parseHexColor(hex: string, field: string): Color {
  if (!/^#[0-9a-fA-F]{6}$/.test(hex)) {
    throw new Error(`material override ${field} must be "#rrggbb", got ${JSON.stringify(hex)}`);
  }
  return new Color(hex);
}

/** Variant evaluator: apply generic material overrides post-load (no GLB write). Empty match REFUSES. */
export async function applyMaterialOverrides(
  root: Object3D,
  overrides: MaterialOverride[],
): Promise<MaterialOverrideApplied[]> {
  const loader = new TextureLoader();
  const applied: MaterialOverrideApplied[] = [];
  for (const ov of overrides) {
    let re: RegExp;
    try {
      re = new RegExp(ov.match, "i");
    } catch {
      throw new Error(`materialOverride.match is not a valid regex: ${ov.match}`);
    }
    const hits: Array<{ mesh: Mesh; index: number }> = [];
    const availableSlots: string[] = [];
    root.traverse((o) => {
      if (!(o instanceof Mesh)) return;
      const mats = Array.isArray(o.material) ? o.material : [o.material];
      mats.forEach((m, index) => {
        if (!m) return;
        const slot = `${o.name}|${m.name}`;
        if (!availableSlots.includes(slot)) availableSlots.push(slot);
        if (re.test(m.name) || re.test(o.name)) hits.push({ mesh: o, index });
      });
    });
    if (hits.length === 0) {
      throw new Error(`materialOverride /${ov.match}/i matched nothing — refusing rather than silently no-opping. Available mesh|material slots: ${JSON.stringify(availableSlots.sort())}`);
    }
    let baseTex: Awaited<ReturnType<TextureLoader["loadAsync"]>> | null = null;
    if (ov.baseColorUrl) {
      baseTex = await loader.loadAsync(ov.baseColorUrl);
      baseTex.colorSpace = SRGBColorSpace;
      baseTex.flipY = false;
    }
    const color = ov.color !== undefined ? parseHexColor(ov.color, "color") : null;
    const emissive = ov.emissive !== undefined ? parseHexColor(ov.emissive, "emissive") : null;
    for (const hit of hits) {
      const mats = Array.isArray(hit.mesh.material) ? hit.mesh.material : [hit.mesh.material];
      let m = mats[hit.index] as MeshStandardMaterial | MeshPhysicalMaterial;
      if (ov.physical && m instanceof MeshStandardMaterial) {
        const src = m;
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
        next.emissive.copy(src.emissive);
        next.emissiveIntensity = src.emissiveIntensity;
        next.envMapIntensity = src.envMapIntensity;
        if (ov.physical.clearcoat !== undefined) next.clearcoat = ov.physical.clearcoat;
        if (ov.physical.clearcoatRoughness !== undefined) next.clearcoatRoughness = ov.physical.clearcoatRoughness;
        if (ov.physical.ior !== undefined) next.ior = ov.physical.ior;
        if (Array.isArray(hit.mesh.material)) {
          (hit.mesh.material as (typeof m)[])[hit.index] = next;
        } else {
          hit.mesh.material = next;
        }
        m = next;
      } else if (ov.physical && m instanceof MeshPhysicalMaterial) {
        if (ov.physical.clearcoat !== undefined) m.clearcoat = ov.physical.clearcoat;
        if (ov.physical.clearcoatRoughness !== undefined) m.clearcoatRoughness = ov.physical.clearcoatRoughness;
        if (ov.physical.ior !== undefined) m.ior = ov.physical.ior;
      }
      if (baseTex) {
        const srcChannel = (m.map as unknown as { channel?: number } | null)?.channel ?? 0;
        (baseTex as unknown as { channel?: number }).channel = srcChannel;
        (m as MeshStandardMaterial).map = baseTex;
      }
      if (color) m.color.copy(color);
      if (ov.roughness !== undefined) m.roughness = ov.roughness;
      if (ov.metalness !== undefined) m.metalness = ov.metalness;
      if (ov.envMapIntensity !== undefined) m.envMapIntensity = ov.envMapIntensity;
      if (ov.skinShade !== undefined && ov.skinShade !== false) {
        if (typeof ov.skinShadeCurvatureUrl !== "string" || !ov.skinShadeCurvatureUrl) {
          throw new Error(
            `materialOverride /${ov.match}/i sets skinShade without skinShadeCurvatureUrl — refusing rather than binding an unbound curvature sampler`,
          );
        }
        const flagOpts: SkinShadeOptions =
          ov.skinShade === true ? {} : (ov.skinShade as SkinShadeOptions);
        // Fail-closed resolution first: garbage strengths throw before install.
        resolveSkinShadeOptions(flagOpts);
        const curvTex = await loader.loadAsync(ov.skinShadeCurvatureUrl);
        curvTex.colorSpace = NoColorSpace;
        curvTex.flipY = false;
        applySkinShade(m, { ...flagOpts, curvatureMap: curvTex });
      }
      if (ov.eyeShade !== undefined && ov.eyeShade !== false) {
        const eyeOpts: EyeShaderOptions =
          ov.eyeShade === true ? {} : (ov.eyeShade as EyeShaderOptions);
        // Fail-closed resolution first: garbage strengths throw before install.
        resolveEyeShaderOptions(eyeOpts);
        if (!eyeShaderInstalled(m)) applyEyeShader(m, eyeOpts);
      }
      if (emissive) m.emissive.copy(emissive);
      if (ov.emissiveIntensity !== undefined) m.emissiveIntensity = ov.emissiveIntensity;
      if (ov.hide === true) hit.mesh.visible = false;
      m.needsUpdate = true;
    }
    const readback: MaterialOverrideReadback[] = hits.map((hit) => {
      const mats = Array.isArray(hit.mesh.material) ? hit.mesh.material : [hit.mesh.material];
      return readbackMaterial(hit.mesh, mats[hit.index] as MeshStandardMaterial | MeshPhysicalMaterial);
    });
    applied.push({
      match: ov.match,
      matched: readback.map((r) => `${r.mesh}|${r.material}`),
      readback,
    });
  }
  return applied;
}
