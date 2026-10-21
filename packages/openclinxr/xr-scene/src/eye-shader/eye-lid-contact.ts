/**
 * Eye lid-contact shading (card tsk_e0afe706b7a5f071): per-mesh margins +
 * sclera-hook install for the product rig path. Split out of
 * isolated-subject-rig-variants.ts by the file-size budget (zone 500):
 * behaviour verbatim, new file, no entrypoint export.
 *
 * Mechanism: the globe hook darkens sclera texels within a band below the
 * live upper-lid margin plane. The margin is recomputed from SKINNED
 * lid-vertex positions every render (bind ~= garbage: bind y ~ -0.13 vs
 * live y ~ 1.55, so position+matrixWorld alone searches the bind pose),
 * follows the lid under pose/gaze (world-space margin transformed into the
 * globe's current object space each render, never baked to globe UV),
 * masked to sclera texels by (1-irisM) (iris-sparing), no skin mesh
 * touched. Chosen over a key shadow map: the map measured no-op
 * (shadow-only ablation M2b -0.05 vs 0.156 floor — conformed ~0-1mm lid gap
 * at grazing incidence is below shadow-texel resolution at 0.29mm).
 */

import {
  Matrix4,
  Mesh,
  type MeshStandardMaterial,
  type Object3D,
  SkinnedMesh,
  Vector3,
} from "three";
import {
  applyScleraShade,
  EYE_SCLERA_CENTER_L_UV,
  EYE_SCLERA_CENTER_R_UV,
  resolveScleraShadeOptions,
} from "./eye-sclera-shade.js";
import {
  applyCorneaFresnel,
  resolveCorneaFresnelOptions,
} from "./eye-cornea-fresnel.js";

/**
 * Globe (eye) material filter for the scoped product-path env map. Mirrors
 * the lab eye-channel regex (isolated-subject-focus.ts EYE_MESH_RE) but on
 * MATERIAL names: the shipped MPFB eye node is renamed by GLTFLoader to
 * `mpfb_*_body_mesh.low-poly`, so the mesh name never matches — the
 * materialize script names the globe material `mat_makeclothes_library_eyes_*`
 * on every MPFB actor. Eyelash/eyebrow materials (`..._eyelashes_...`,
 * `..._eyebrow_...`) contain no `eyes|iris|cornea|sclera` substring and are
 * never matched.
 */
export const GLOBE_MATERIAL_RE = /eyes|iris|cornea|sclera/i;

/**
 * Lid-margin search material: BODY skin only. Lashes are excluded:
 * upper-lash tips curve down to globe-centre height and would win the
 * minimum (measured 2026-10-18: margin == centre Y, whole lower band
 * darkened, M2b +7.7). The lid-margin skin over the pupil is the lowest
 * body surface above the centre in the narrow column.
 */
const LID_MARGIN_MATERIAL_RE = /mpfb_skin/i;

/**
 * Skinning-aware world positions: the body is a posed SkinnedMesh, so
 * position+matrixWorld alone reads the bind pose. Skinned verts accumulate
 * bone matrices; plain meshes use matrixWorld. Both paths need
 * updateMatrixWorld first (done by the caller via scene.updateMatrixWorld).
 */
function emitWorldPositions(mesh: Mesh, emit: (p: Vector3) => void): void {
  const pos = mesh.geometry.getAttribute("position");
  if (!pos) return;
  const v = new Vector3();
  if (mesh instanceof SkinnedMesh) {
    const si = mesh.geometry.getAttribute("skinIndex");
    const sw = mesh.geometry.getAttribute("skinWeight");
    if (!si || !sw || !mesh.skeleton?.boneMatrices) {
      throw new Error(
        `eyeRuntimeShading skinned mesh ${mesh.name} lacks skinIndex/skinWeight/skeleton — refusing`,
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
        const w = weights[k] ?? 0;
        if (w === 0) continue;
        m.fromArray(bm, Math.round(joints[k] ?? 0) * 16);
        t.fromBufferAttribute(pos, i).applyMatrix4(m);
        v.addScaledVector(t, w);
      }
      v.applyMatrix4(mesh.matrixWorld);
      emit(v);
    }
    return;
  }
  for (let i = 0; i < pos.count; i += 1) {
    v.fromBufferAttribute(pos, i).applyMatrix4(mesh.matrixWorld);
    emit(v);
  }
}

/**
 * Per-chart iris means: mean world position of globe verts within 0.05 UV
 * of the mesh-derived iris centres (52 verts per eye on
 * aisha-lidconform, x = +-30.7mm measured 2026-10-18). Robust where chart
 * means fail: both eyeballs share one mesh and each UV half carries ~49
 * stray verts from the far eye (mean pulled 7mm off the pupil), while the
 * iris disc itself is unambiguous. The globe mesh is static (bind = live
 * for these portraits), so plain matrixWorld is exact here.
 */
function globeIrisMeans(mesh: Mesh): { L: Vector3; R: Vector3 } {
  const pos = mesh.geometry.getAttribute("position");
  const uv = mesh.geometry.getAttribute("uv");
  if (!pos || !uv) {
    throw new Error(
      `eyeRuntimeShading needs position+uv on the globe mesh ${mesh.name} — refusing`,
    );
  }
  mesh.updateWorldMatrix(true, false);
  const meanNear = (cu: number, cv: number): Vector3 => {
    const sum = new Vector3();
    let n = 0;
    const v = new Vector3();
    for (let i = 0; i < pos.count; i += 1) {
      if (Math.hypot(uv.getX(i) - cu, uv.getY(i) - cv) > 0.05) continue;
      v.fromBufferAttribute(pos, i).applyMatrix4(mesh.matrixWorld);
      sum.add(v);
      n += 1;
    }
    if (n === 0) {
      throw new Error(
        `eyeRuntimeShading found no iris verts near (${cu.toFixed(3)}, ${cv.toFixed(3)}) on ${mesh.name} — refusing`,
      );
    }
    return sum.multiplyScalar(1 / n);
  };
  return {
    L: meanNear(EYE_SCLERA_CENTER_L_UV[0], EYE_SCLERA_CENTER_L_UV[1]),
    R: meanNear(EYE_SCLERA_CENTER_R_UV[0], EYE_SCLERA_CENTER_R_UV[1]),
  };
}

/**
 * Upper-lid margin world Y over one eye: minimum Y of SKINNED body-skin
 * verts in a narrow +-6mm pupil column, in front of the socket back wall
 * (pupil z - 8mm), above the pupil. The lid-margin skin over the pupil is
 * the lowest such surface. Fails closed when the column is empty (never a
 * silent fallback).
 */
const LID_COLUMN_X_M = 0.006;
const LID_COLUMN_Z_BACK_M = 0.008;

function lidMarginWorldY(
  root: Object3D,
  pupil: Vector3,
): { marginY: number; columnVerts: number } {
  let margin = Infinity;
  let column = 0;
  const v = new Vector3();
  root.traverse((o) => {
    if (!(o instanceof Mesh)) return;
    if (o.visible !== true) return;
    const mats = Array.isArray(o.material) ? o.material : [o.material];
    if (!mats.some((m) => m && LID_MARGIN_MATERIAL_RE.test(m.name))) return;
    emitWorldPositions(o, (p) => {
      v.copy(p);
      if (
        Math.abs(v.x - pupil.x) < LID_COLUMN_X_M &&
        v.z - pupil.z > -LID_COLUMN_Z_BACK_M &&
        v.y > pupil.y
      ) {
        column += 1;
        if (v.y < margin) margin = v.y;
      }
    });
  });
  if (!Number.isFinite(margin)) {
    throw new Error(
      `eyeRuntimeShading found no lid verts over the pupil at (${pupil.x.toFixed(3)}, ${pupil.y.toFixed(3)}, ${pupil.z.toFixed(3)}) — refusing rather than placing a blind margin`,
    );
  }
  return { marginY: margin, columnVerts: column };
}

export type LidMarginRec = {
  mesh: string;
  pupilWorldL: [number, number, number];
  pupilWorldR: [number, number, number];
  columnVertsL: number;
  columnVertsR: number;
  centreWorldL: [number, number, number];
  centreWorldR: [number, number, number];
  marginObjYL: number;
  marginObjYR: number;
  marginWorldYL: number;
  marginWorldYR: number;
};

export type EyeShadingFlags = {
  scleraShade: boolean;
  lidShadow: boolean;
  scleraAtten?: number | undefined;
  lidBandM?: number | undefined;
  lidDarken?: number | undefined;
  /**
   * Fresnel-weighted cornea film (eye-finish): Schlick env lift on the
   * globe's iris disc, exactly +0 head-on, ramping at grazing/yaw.
   * Defaults to following scleraShade (the eyeShading master); explicit
   * false renders the legacy eye.
   */
  corneaFresnel?: boolean | undefined;
  /** Fresnel lift gain override (fail-closed, finite >= 0). */
  corneaFresnelGain?: number | undefined;
  /** Schlick shaping exponent override (fail-closed, finite > 0). */
  corneaFresnelExponent?: number | undefined;
  /**
   * Counterweight ablation: force the fresnel weight to its head-on value
   * everywhere (constant term, no angular dependence). Head-on response is
   * unchanged; the yaw lift must vanish.
   */
  corneaFresnelFlat?: boolean | undefined;
};

export type EyeShadingResult = {
  scleraMatched: string[];
  scleraEnvAtten: number;
  shadowMechanism: "lid-contact" | null;
  lidContact: {
    bandM: number;
    darken: number;
    margins: LidMarginRec[];
  } | null;
  /**
   * Cornea fresnel readback: which globe materials carry the hook and the
   * landed shaping values, for the cornea-env gate report.
   */
  corneaFresnel: {
    enabled: boolean;
    matched: string[];
    gain: number;
    exponent: number;
    flat: boolean;
  };
};

export type ProductEyeShadingArgs = {
  eyeShading: boolean;
  scleraShade: boolean;
  lidShadow: boolean;
  scleraAtten?: number | undefined;
  lidBandM?: number | undefined;
  lidDarken?: number | undefined;
  corneaFresnel?: boolean | undefined;
  corneaFresnelGain?: number | undefined;
  corneaFresnelExponent?: number | undefined;
  corneaFresnelFlat?: boolean | undefined;
};

/**
 * Product-rig eye-shading application (extracted from
 * isolated-subject-rig-variants.ts by the file-size budget): resolves the
 * eyeShading value object for the ProductRigApplied readback. Returns the
 * legacy disabled shape when the master is off — the traverse/env path is
 * untouched, so the old h1/h2/pos cells render identically.
 */
export function resolveProductEyeShading(
  scene: Object3D,
  globeMeshes: Mesh[],
  args: ProductEyeShadingArgs,
): {
  enabled: boolean;
  scleraEnvAtten: number;
  scleraMatched: string[];
  shadowMechanism: "lid-contact" | null;
  lidContact: EyeShadingResult["lidContact"];
  corneaFresnel: EyeShadingResult["corneaFresnel"] | null;
} {
  const { eyeShading, scleraShade, lidShadow } = args;
  if (!(eyeShading && (scleraShade || lidShadow || args.corneaFresnel === true))) {
    return {
      enabled: eyeShading,
      scleraEnvAtten: 1,
      scleraMatched: [],
      shadowMechanism: null,
      lidContact: null,
      corneaFresnel: null,
    };
  }
  const r = applyEyeShading(scene, globeMeshes, args);
  return {
    enabled: eyeShading,
    scleraEnvAtten: r.scleraEnvAtten,
    scleraMatched: r.scleraMatched,
    shadowMechanism: r.shadowMechanism,
    lidContact: r.lidContact,
    corneaFresnel: r.corneaFresnel,
  };
}

/**
 * Install the sclera hook + the fresnel cornea hook on every globe mesh
 * with live lid margins. Value overrides are fail-closed via
 * resolveScleraShadeOptions / resolveCorneaFresnelOptions.
 */
export function applyEyeShading(
  scene: Object3D,
  globeMeshes: Mesh[],
  flags: EyeShadingFlags,
): EyeShadingResult {
  const { scleraShade, lidShadow } = flags;
  // Fail-closed value resolution (garbage refuses here, before any hook).
  const resolved = resolveScleraShadeOptions({
    attenuation: flags.scleraAtten,
    bandM: flags.lidBandM,
    darken: flags.lidDarken,
  });
  const corneaFresnelEnabled = flags.corneaFresnel ?? scleraShade;
  // Fail-closed even when disabled: a garbage gain/exponent refuses rather
  // than silently landing a different film later.
  const corneaResolved = resolveCorneaFresnelOptions({
    gain: flags.corneaFresnelGain,
    exponent: flags.corneaFresnelExponent,
    flat: flags.corneaFresnelFlat,
  });
  const margins: LidMarginRec[] = [];
  const scleraMatched: string[] = [];
  const corneaMatched: string[] = [];
  for (const mesh of globeMeshes) {
    // Pupil columns from the iris-disc verts (stray-proof); the margin
    // search below runs on SKINNED body positions (live pose).
    const pupils = globeIrisMeans(mesh);
    const rimL = lidMarginWorldY(scene, pupils.L);
    const rimR = lidMarginWorldY(scene, pupils.R);
    const marginWorldYL = rimL.marginY;
    const marginWorldYR = rimR.marginY;
    const localL = mesh.worldToLocal(new Vector3(pupils.L.x, marginWorldYL, pupils.L.z));
    const localR = mesh.worldToLocal(new Vector3(pupils.R.x, marginWorldYR, pupils.R.z));
    margins.push({
      mesh: mesh.name,
      pupilWorldL: [pupils.L.x, pupils.L.y, pupils.L.z],
      pupilWorldR: [pupils.R.x, pupils.R.y, pupils.R.z],
      columnVertsL: rimL.columnVerts,
      columnVertsR: rimR.columnVerts,
      centreWorldL: [pupils.L.x, pupils.L.y, pupils.L.z],
      centreWorldR: [pupils.R.x, pupils.R.y, pupils.R.z],
      marginObjYL: localL.y,
      marginObjYR: localR.y,
      marginWorldYL,
      marginWorldYR,
    });
    const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    for (const m of mats) {
      if (!m || !GLOBE_MATERIAL_RE.test(m.name)) continue;
      applyScleraShade(m as MeshStandardMaterial, {
        attenuation: scleraShade ? resolved.attenuation : 1,
        lidMarginY: [localL.y, localR.y],
        bandM: resolved.bandM,
        darken: lidShadow ? resolved.darken : 0,
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
      "eyeRuntimeShading matched no globe material for the sclera hook — refusing rather than rendering a legacy eye as shaded",
    );
  }
  return {
    scleraMatched,
    scleraEnvAtten: scleraShade ? resolved.attenuation : 1,
    shadowMechanism: "lid-contact",
    lidContact: {
      bandM: resolved.bandM,
      darken: lidShadow ? resolved.darken : 0,
      margins,
    },
    corneaFresnel: {
      enabled: corneaFresnelEnabled,
      matched: corneaMatched,
      gain: corneaResolved.gain,
      exponent: corneaResolved.exponent,
      flat: corneaResolved.flat,
    },
  };
}
