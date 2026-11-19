/**
 * Aisha-parity eye-shade lever (lane aisha-parity, P4a): sclera
 * env-reflection suppression + lid occlusion in the parity HDRI world.
 *
 * Runs the PRODUCT hook installs (applyScleraShade + applyCorneaFresnel,
 * same defaults/resolvers as the product path) on the globe meshes matched
 * by GLOBE_MATERIAL_RE, AFTER the eyes lever so it hooks the final globe
 * material. Fail closed: garbage values refuse as a value error (before the
 * globe search); 0 globe meshes refuse with the "0 globe" message; missing
 * pupils or lid margins refuse.
 *
 * Why parity-local pupils/margins instead of applyEyeShading (measured
 * 2026-11-19, E/uv-probe.txt): this GLB's eye is the LOW-POLY eyes mesh
 * (node mpfb_ob_patient_aisha_v1_body_mesh.low-poly, 96 verts) whose UVs
 * span the whole eyes texture (0.03..0.97) — there are NO verts within
 * 0.05 UV of the product iris-disc numerals (L mindist 0.185, R 0.18;
 * v-flipped L 3 verts / R 0), so the product globeIrisMeans refuses on this
 * asset. The FRAGMENT-space iris mask still works (vMapUv interpolates over
 * the same texture the numerals locate), so only the pupil ANCHOR is
 * parity-local: per-side centroid of live skinned eyes-verts (the column
 * search tolerates mm offsets). Lid margins use the product column
 * constants (LID_COLUMN_X_M 0.006 / LID_COLUMN_Z_BACK_M 0.008,
 * eye-lid-contact.ts) over live skinned mpfb_skin verts.
 */

import {
  Matrix4,
  Mesh,
  SkinnedMesh,
  Vector3,
  type MeshStandardMaterial,
  type Object3D,
} from "three";
import {
  applyCorneaFresnel,
  resolveCorneaFresnelOptions,
} from "../eye-shader/eye-cornea-fresnel.js";
import { GLOBE_MATERIAL_RE } from "../eye-shader/eye-lid-contact.js";
import {
  applyScleraShade,
  resolveScleraShadeOptions,
} from "../eye-shader/eye-sclera-shade.js";
import type { EyeShadeReadback, ParityEyeShade } from "./parity-types.js";

/** Lid-margin search material: BODY skin only (product constant, cited). */
const PARITY_LID_MARGIN_MATERIAL_RE = /mpfb_skin/i;

/** Pupil-column half-width (m) + socket back-wall offset (product constants). */
const PARITY_LID_COLUMN_X_M = 0.006;
const PARITY_LID_COLUMN_Z_BACK_M = 0.008;

function globeMaterialIndices(mesh: Mesh): number[] {
  const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
  const out: number[] = [];
  mats.forEach((m, i) => {
    if (m && GLOBE_MATERIAL_RE.test(m.name)) out.push(i);
  });
  return out;
}

/**
 * Vert indices rendered with a globe-matching material slot. Respects
 * geometry.groups (multi-material meshes); ungrouped/single-material meshes
 * contribute every vert.
 */
function globeVertMask(mesh: Mesh, slots: number[]): boolean[] {
  const pos = mesh.geometry.getAttribute("position");
  const mask = new Array<boolean>(pos.count).fill(false);
  const groups = mesh.geometry.groups;
  if (!Array.isArray(mesh.material) || groups.length === 0) {
    mask.fill(true);
    return mask;
  }
  const index = mesh.geometry.getIndex();
  const mark = (vi: number): void => {
    if (vi >= 0 && vi < mask.length) mask[vi] = true;
  };
  for (const g of groups) {
    if (g.materialIndex === undefined || !slots.includes(g.materialIndex)) continue;
    if (index) {
      for (let k = g.start; k < g.start + g.count; k += 1) mark(index.getX(k));
    } else {
      for (let k = g.start; k < g.start + g.count; k += 1) mark(k);
    }
  }
  return mask;
}

/** Skinning-aware live world positions (product emitWorldPositions, cited). */
function liveWorldPositions(mesh: Mesh, out: Vector3[]): void {
  const pos = mesh.geometry.getAttribute("position");
  if (!pos) return;
  const v = new Vector3();
  if (mesh instanceof SkinnedMesh) {
    const si = mesh.geometry.getAttribute("skinIndex");
    const sw = mesh.geometry.getAttribute("skinWeight");
    if (!si || !sw || !mesh.skeleton?.boneMatrices) {
      throw new Error(
        `parity eyeShade skinned mesh ${mesh.name} lacks skinIndex/skinWeight/skeleton — refusing`,
      );
    }
    mesh.updateWorldMatrix(true, false);
    mesh.skeleton.update();
    const bm: Float32Array = mesh.skeleton.boneMatrices;
    const m = new Matrix4();
    const t = new Vector3();
    for (let i = 0; i < pos.count; i += 1) {
      v.set(0, 0, 0);
      const joints = [si.getX(i), si.getY(i), si.getZ(i), si.getW(i)];
      const weights = [sw.getX(i), sw.getY(i), sw.getZ(i), sw.getW(i)];
      for (let k = 0; k < 4; k += 1) {
        const wgt = weights[k] ?? 0;
        if (wgt === 0) continue;
        m.fromArray(bm, Math.round(joints[k] ?? 0) * 16);
        t.fromBufferAttribute(pos, i).applyMatrix4(m);
        v.addScaledVector(t, wgt);
      }
      v.applyMatrix4(mesh.matrixWorld);
      out.push(v.clone());
    }
    return;
  }
  mesh.updateWorldMatrix(true, false);
  for (let i = 0; i < pos.count; i += 1) {
    v.fromBufferAttribute(pos, i).applyMatrix4(mesh.matrixWorld);
    out.push(v.clone());
  }
}

/** Per-side pupil anchor: live centroid of the mesh's globe-slot verts. */
function pupilAnchors(mesh: Mesh, slots: number[]): { L: Vector3; R: Vector3 } {
  const pos = mesh.geometry.getAttribute("position");
  if (!pos) {
    throw new Error(`parity eyeShade needs position on globe mesh ${mesh.name} — refusing`);
  }
  const mask = globeVertMask(mesh, slots);
  const live: Vector3[] = [];
  const all: Vector3[] = [];
  liveWorldPositions(mesh, all);
  all.forEach((p, i) => {
    if (mask[i] === true) live.push(p);
  });
  if (live.length === 0) {
    throw new Error(`parity eyeShade found no globe-slot verts on ${mesh.name} — refusing`);
  }
  let cx = 0;
  for (const p of live) cx += p.x;
  cx /= live.length;
  const L: Vector3[] = [];
  const R: Vector3[] = [];
  for (const p of live) (p.x < cx ? L : R).push(p);
  if (L.length === 0 || R.length === 0) {
    throw new Error(`parity eyeShade found no L/R eye verts on ${mesh.name} — refusing`);
  }
  const mean = (pts: Vector3[]): Vector3 => {
    const s = new Vector3();
    for (const p of pts) s.add(p);
    return s.multiplyScalar(1 / pts.length);
  };
  return { L: mean(L), R: mean(R) };
}

/** Upper-lid margin world Y over one pupil (product column rule, cited). */
function lidMarginWorldY(root: Object3D, pupil: Vector3): number {
  let margin = Infinity;
  const v = new Vector3();
  root.traverse((o) => {
    if (!(o instanceof Mesh)) return;
    if (o.visible !== true) return;
    const mats = Array.isArray(o.material) ? o.material : [o.material];
    if (!mats.some((m) => m && PARITY_LID_MARGIN_MATERIAL_RE.test(m.name))) return;
    const pts: Vector3[] = [];
    liveWorldPositions(o, pts);
    for (const p of pts) {
      v.copy(p);
      if (
        Math.abs(v.x - pupil.x) < PARITY_LID_COLUMN_X_M &&
        v.z - pupil.z > -PARITY_LID_COLUMN_Z_BACK_M &&
        v.y > pupil.y
      ) {
        if (v.y < margin) margin = v.y;
      }
    }
  });
  if (!Number.isFinite(margin)) {
    throw new Error(
      `parity eyeShade found no lid verts over the pupil at (${pupil.x.toFixed(3)}, ${pupil.y.toFixed(3)}, ${pupil.z.toFixed(3)}) — refusing rather than placing a blind margin`,
    );
  }
  return margin;
}

/**
 * Install the parity sclera env-suppression + lid-occlusion hook on the globe materials.
 *
 * Fail-closed value resolution runs before the globe search; 0 globe meshes or
 * 0 lid margins refuse rather than rendering a legacy eye as shaded.
 */
export function applyParityEyeShade(
  root: Object3D,
  params: ParityEyeShade,
): EyeShadeReadback {
  // Fail-closed value resolution BEFORE the globe search, so garbage refuses
  // here as a value error even on a globe-less scene (counterweight pins it).
  const { scleraAtten, lidBandM, lidDarken } = params;
  for (const [name, v] of [
    ["scleraAtten", scleraAtten],
    ["lidBandM", lidBandM],
    ["lidDarken", lidDarken],
  ] as const) {
    if (typeof v !== "number" || !Number.isFinite(v)) {
      throw new Error(
        `parity eyeShade refuses ${name}=${JSON.stringify(v)} (need finite number) — refusing`,
      );
    }
  }
  if (scleraAtten < 0 || scleraAtten > 1) {
    throw new Error(
      `parity eyeShade refuses scleraAtten=${scleraAtten} (need finite 0..1) — refusing`,
    );
  }
  if (!(lidBandM > 0)) {
    throw new Error(
      `parity eyeShade refuses lidBandM=${lidBandM} (need finite > 0) — refusing`,
    );
  }
  if (lidDarken < 0 || lidDarken > 1) {
    throw new Error(
      `parity eyeShade refuses lidDarken=${lidDarken} (need finite 0..1) — refusing`,
    );
  }
  // Product resolvers (same fail-closed numerals the product hook uses).
  const resolved = resolveScleraShadeOptions({
    attenuation: scleraAtten,
    bandM: lidBandM,
    darken: lidDarken,
  });
  const corneaFresnelEnabled = params.corneaFresnel ?? true;
  const corneaResolved = resolveCorneaFresnelOptions({});
  root.updateMatrixWorld(true);
  const globeMeshes: Mesh[] = [];
  root.traverse((o) => {
    if (!(o instanceof Mesh)) return;
    if (globeMaterialIndices(o).length > 0) globeMeshes.push(o);
  });
  if (globeMeshes.length === 0) {
    throw new Error(
      "parity eyeShade matched 0 globe meshes (GLOBE_MATERIAL_RE) — refusing",
    );
  }
  const scleraMatched: string[] = [];
  const corneaMatched: string[] = [];
  let marginPairs = 0;
  for (const mesh of globeMeshes) {
    const slots = globeMaterialIndices(mesh);
    const pupils = pupilAnchors(mesh, slots);
    const rimL = lidMarginWorldY(root, pupils.L);
    const rimR = lidMarginWorldY(root, pupils.R);
    mesh.updateWorldMatrix(true, false);
    const localL = mesh.worldToLocal(new Vector3(pupils.L.x, rimL, pupils.L.z));
    const localR = mesh.worldToLocal(new Vector3(pupils.R.x, rimR, pupils.R.z));
    marginPairs += 1;
    const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    for (const m of mats) {
      if (!m || !GLOBE_MATERIAL_RE.test(m.name)) continue;
      applyScleraShade(m as MeshStandardMaterial, {
        attenuation: resolved.attenuation,
        lidMarginY: [localL.y, localR.y],
        bandM: resolved.bandM,
        darken: resolved.darken,
      });
      scleraMatched.push(`${mesh.name}|${m.name}`);
      if (corneaFresnelEnabled) {
        applyCorneaFresnel(m as MeshStandardMaterial, {
          gain: corneaResolved.gain,
          exponent: corneaResolved.exponent,
          flat: corneaResolved.flat,
        });
        corneaMatched.push(`${mesh.name}|${m.name}`);
      }
    }
  }
  if (scleraMatched.length === 0) {
    throw new Error(
      "parity eyeShade installed on 0 globe materials — refusing rather than rendering a legacy eye as shaded",
    );
  }
  if (marginPairs === 0) {
    throw new Error("parity eyeShade found 0 lid margins — refusing");
  }
  return {
    matched: scleraMatched,
    margins: marginPairs,
    scleraAtten: resolved.attenuation,
    lidBandM: resolved.bandM,
    lidDarken: resolved.darken,
    corneaFresnel: corneaFresnelEnabled,
  };
}
