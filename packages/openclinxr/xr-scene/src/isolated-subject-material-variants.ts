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
  materialNameMatch?: string;
};

/** Skin-realism portrait: remove fitted hair meshes (/hair/i over mesh, node, geometry names) so the head frames without hair. */
export function removeFittedHair(root: Object3D): string[] {
  const removed: string[] = [];
  const targets: Object3D[] = [];
  root.traverse((o) => {
    if (!(o instanceof Mesh)) return;
    const nodeName = typeof (o.userData?.name) === "string" ? String(o.userData.name) : "";
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
  return { pattern, matchedMaterials: matchedNames, baseColor, normal, roughness, roughnessMap };
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
