/**
 * Aisha-parity in-place material tweaks + flat-ID mask materials.
 *
 * Brow/lash darkening, scalp-hair rim polygonOffset, and P1a-table mask
 * materials mutate Standard materials in place (no Physical swap). Split
 * from parity-materials.ts (file-size zone budget): the Physical-swap
 * levers stay there; this file imports its slot iterator + rounder.
 */

import {
  Mesh,
  MeshBasicMaterial,
  MeshPhysicalMaterial,
  type Object3D,
  type Scene,
} from "three";
import { eachMaterialSlot, round4 } from "./parity-materials.js";
import {
  PARITY_MASK_TABLE,
  type ParityMaskCategory,
  parityMaskCategory,
} from "./parity-types.js";

const BROWLASH_RE =
  /openclinxr_fitted_eyebrow_mindfront_eyebrows_05_mpfb_ob_patient_aisha_v1_mat|openclinxr_fitted_eyelash_mindfront_eyelashes_01_mpfb_ob_patient_aisha_v1_mat/;

export type BrowLashReadback = {
  mesh: string;
  material: string;
  from: string;
  params: {
    colorScale: number;
    color: [number, number, number];
    envMapIntensity: number;
    roughness: number;
  };
};

/**
 * Lever browLash (P2b step 2): darken the fitted brow/lash albedo and cut
 * its IBL response to compensate the three.js AgX-toe lift vs Blender
 * Cycles AgX (strand-core L* 24.6 vs 6.8 at identical GLB albedo). Mutates
 * the two Standard materials in place (no Physical swap: roughness 0.9,
 * metalness 0, DoubleSide already match the GLB); refuses on bad params or
 * no match.
 */
export function applyBrowLash(
  root: Object3D,
  params: { colorScale: number; envMapIntensity: number; roughness: number },
  scene?: Pick<Scene, "environment" | "environmentRotation">,
): BrowLashReadback[] {
  const { colorScale, envMapIntensity, roughness } = params;
  for (const [name, v] of [
    ["colorScale", colorScale],
    ["envMapIntensity", envMapIntensity],
    ["roughness", roughness],
  ] as const) {
    if (!Number.isFinite(v) || v < 0 || v > 1) {
      throw new Error(`parity browLash refuses ${name}=${v} (need finite 0..1) — refusing`);
    }
  }
  const out: BrowLashReadback[] = [];
  eachMaterialSlot(
    root,
    (name) => BROWLASH_RE.test(name),
    (mesh, _index, m) => {
      if (m instanceof MeshPhysicalMaterial) {
        throw new Error(`parity browLash refuses Physical brow/lash material on ${mesh.name} — refusing`);
      }
      m.color.multiplyScalar(colorScale);
      if (scene?.environment) {
        m.envMap = scene.environment;
        m.envMapRotation.copy(scene.environmentRotation);
      }
      m.envMapIntensity = envMapIntensity;
      m.roughness = roughness;
      m.needsUpdate = true;
      out.push({
        mesh: mesh.name,
        material: m.name,
        from: m.type,
        params: {
          colorScale,
          color: [round4(m.color.r), round4(m.color.g), round4(m.color.b)],
          envMapIntensity,
          roughness,
        },
      });
    },
  );
  if (out.length === 0) throw new Error("parity browLash matched no eyebrow/eyelash material — refusing");
  return out;
}

const SCALP_HAIR_RE =
  /^openclinxr_fitted_hair_toigo_blunt_bob_with_bangs_mpfb_ob_patient_aisha_v1_mat$/;

export type HairRimReadback = {
  mesh: string;
  material: string;
  from: string;
  params: {
    factor: number;
    units: number;
  };
};

/**
 * Lever hairRim (P2b step 4F): polygonOffset on the SCALP hair material only
 * (brows/lashes untouched) to resolve the rim z-fight where the fitted cap
 * sits ~sub-mm off the forehead/cheek (dotted dark fringe, runtime only).
 * Refuses on bad params or no match.
 */
export function applyHairRim(
  root: Object3D,
  params: { factor: number; units: number },
): HairRimReadback[] {
  const { factor, units } = params;
  for (const [name, v] of [
    ["factor", factor],
    ["units", units],
  ] as const) {
    if (!Number.isFinite(v) || v > 0 || v < -8) {
      throw new Error(`parity hairRim refuses ${name}=${v} (need finite -8..0) — refusing`);
    }
  }
  const out: HairRimReadback[] = [];
  eachMaterialSlot(
    root,
    (name) => SCALP_HAIR_RE.test(name),
    (mesh, _index, m) => {
      m.polygonOffset = true;
      m.polygonOffsetFactor = factor;
      m.polygonOffsetUnits = units;
      m.needsUpdate = true;
      out.push({
        mesh: mesh.name,
        material: m.name,
        from: m.type,
        params: { factor, units },
      });
    },
  );
  if (out.length === 0) throw new Error("parity hairRim matched no scalp hair material — refusing");
  return out;
}

export type MaskReadback = {
  slots: number;
  categories: Partial<Record<ParityMaskCategory, number>>;
};

/**
 * Mask mode: flat MeshBasicMaterial ID colours with the P1a table
 * (toneMapped=false, no AA, no tone mapping). Hidden-category slots keep
 * their meshes visible with black, exactly as P1a kept the original material
 * under a black world (occluded under clothing, mask other=0).
 */
export function applyMaskMaterials(root: Object3D): MaskReadback {
  const cache = new Map<ParityMaskCategory, MeshBasicMaterial>();
  const counts: Partial<Record<ParityMaskCategory, number>> = {};
  let slots = 0;
  const unmapped: string[] = [];
  root.traverse((o) => {
    if (!(o instanceof Mesh)) return;
    const mats = Array.isArray(o.material) ? o.material : [o.material];
    mats.forEach((m, index) => {
      if (!m) return;
      const cat = parityMaskCategory(m.name);
      if (!cat) {
        unmapped.push(`${o.name}|${m.name}`);
        return;
      }
      let flat = cache.get(cat);
      if (!flat) {
        const c = PARITY_MASK_TABLE[cat];
        flat = new MeshBasicMaterial();
        flat.color.setRGB(c[0], c[1], c[2]);
        flat.toneMapped = false;
        flat.name = `parity_mask_${cat}`;
        cache.set(cat, flat);
      }
      if (Array.isArray(o.material)) {
        (o.material as unknown[])[index] = flat;
      } else {
        o.material = flat;
      }
      slots += 1;
      counts[cat] = (counts[cat] ?? 0) + 1;
    });
  });
  for (const cached of cache.values()) cached.needsUpdate = true;
  if (unmapped.length > 0) {
    throw new Error(`mask mode: unmapped materials (P1a table is closed): ${JSON.stringify(unmapped)}`);
  }
  return { slots, categories: counts };
}
