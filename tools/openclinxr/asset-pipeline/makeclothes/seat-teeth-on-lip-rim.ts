/**
 * Seat the lower teeth on the lower-lip inner rim (operator direction, 2026-10-06).
 *
 * Principle: the lower teeth deform with the SAME function as the rim, so
 * their relative distance is constant by construction for any jaw angle and
 * any viseme blend. Both halves are standard procedural operations:
 *
 * 1. Skin weight transfer: each lower-arch tooth vertex copies the skin
 *    joints/weights of its nearest inner-rim triangle (barycentric blend,
 *    top-4 renormalized). Jaw rotation then moves teeth and rim identically.
 * 2. Morph transfer: each lower-arch tooth vertex takes the rim delta at
 *    that same nearest point per viseme target (rigid mean over the arch
 *    when the per-vertex field distorts crowns past 0.3 mm).
 *
 * Upper-arch deltas are exactly 0 with unchanged weights (head). The
 * lower-arch BASE is translated once (bind +z, fixed point) toward
 * --target-gap-mm, then per-vertex face clearance pulls back the teeth
 * vertices ahead of the #739 clearance plane (cap skin median minus the
 * 0.5 mm test safety) along bind -z by iterated quadratic falloff: each
 * pass moves every crossing vertex by the square of its own excess over
 * the plane divided by the pass maximum excess. Each pass is C1-smooth at
 * the contour, parameter-free, and never moves a vertex more than its own
 * excess; the residual max quarters (or better) every pass, so the field
 * converges to full clearance (16-pass bound, 1 um stop) while staying
 * smooth as a sum of smooth fields. Body meshes,
 * upper-arch base, and skin weights of every non-teeth mesh are untouched.
 *
 * --down-gain scales the vertical head-local component of each lower-arch
 * teeth viseme delta after transfer (default 1, no-op). Head-local comes
 * from the head bone rest world rotation, so the rule carries to other
 * rigs. viseme_PP writes zeros. viseme_sil stays off the teeth. No target
 * names are added, removed, or reordered.
 *
 * --rest-drop-mm translates the lower-arch base along head-down by that
 * many millimetres after the face pullback (default 0, no-op; signed:
 * negative rises toward head-up). Skin weights and morph transfer are
 * untouched, so the edge-to-rim vertical gap shifts by the same amount on
 * every frame. Closed form: d = rest(edge_y - rim_top_y) - target.
 *
 * Inner rim rule (stated, procedural, no thresholds): lowerLipInnerRim —
 * rig+response landmark vertices whose bind normals face the front-shell
 * centroid (dot sign only).
 *
 * Run: pnpm exec tsx tools/openclinxr/asset-pipeline/makeclothes/seat-teeth-on-lip-rim.ts <glb> --target-gap-mm <mm> [--dry] [--rigid] [--down-gain <x>] [--rest-drop-mm <mm>]
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { NodeIO } from "@gltf-transform/core";
import { Matrix3, Matrix4, Vector3 } from "three";
import { loadHeadlessScene } from "../../mouth-solver/headless-scene.js";
import {
  frontShellIndices,
  type GlbJson,
  lowerLipInnerRim,
  writeGlb,
} from "./couple-fitted-teeth-to-lip-viseme.js";
import { measureFaceMarginsFromDoc, runtimeCap } from "./face-median.js";
import { transferArch } from "./rim-seat-transfer.js";

const REST_TOL_M = 1e-4;
const REST_SHOTS = 8;
/** #739 uniform cap-margin target: the clearance plane sits this far behind the cap median. */
const FACE_SAFETY_M = 0.0005;
/** Quadratic pullback passes: residual max quarters each pass, so 16 always suffices. */
const PULLBACK_PASSES = 16;
/** Float32-safe epsilon: pullback stop tolerance and self-check bound, physically nothing. */
const SNAP_M = 1e-6;

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");

function floatArray(accessor: { getArray: () => ArrayLike<number> | null }): Float32Array {
  const array = accessor.getArray();
  if (!array) throw new Error("empty accessor");
  return array instanceof Float32Array ? array : Float32Array.from(array);
}

function medianY(positions: Float32Array): number {
  const ys: number[] = [];
  for (let i = 0; i < positions.length / 3; i += 1) ys.push(positions[i * 3 + 1] ?? 0);
  ys.sort((a, b) => a - b);
  return ys[Math.floor(ys.length / 2)] ?? 0;
}

export type RimSeatPlan = {
  rimCount: number;
  rimTriangles: number;
  lowerArchCount: number;
  targetGapMm: number;
  restGap0Mm: number;
  restShiftMm: number;
  faceMarginRest0Mm: number;
  faceMarginCap0Mm: number;
  faceSafetyMm: number;
  /** Clearance plane: cap skin median minus safety (bind z, metres in mm field). */
  clearancePlaneMm: number;
  pullbackVertCount: number;
  pullbackMaxMm: number;
  pullbackMeanMm: number;
  pullbackPasses: number;
  downGain: number;
  restDropMm: number;
  /** Rest rim gap after seat + pullback (equals the target only when nothing crosses). */
  honestRestGapMm: number;
  rigid: boolean;
  distortionMm: Record<string, number>;
  jawMaxVerts: number;
  teethCount: number;
};

function readArgs(): { glbPath: string; targetGapMm: number; dry: boolean; rigid: boolean; downGain: number; restDropMm: number } {
  const flag = (name: string): string | undefined => {
    const index = process.argv.indexOf(name);
    const value = index >= 0 ? process.argv[index + 1] : undefined;
    return value && !value.startsWith("--") ? value : undefined;
  };
  const glbPath = process.argv.slice(2).find((arg) => !arg.startsWith("--"));
  const target = flag("--target-gap-mm");
  if (!glbPath || target === undefined) {
    throw new Error("usage: seat-teeth-on-lip-rim.ts <glb> --target-gap-mm <mm> [--dry] [--rigid] [--down-gain <x>] [--rest-drop-mm <mm>]");
  }
  const targetGapMm = Number(target);
  if (!Number.isFinite(targetGapMm) || targetGapMm <= 0) throw new Error(`bad --target-gap-mm ${target}`);
  const downGainRaw = flag("--down-gain");
  const downGain = downGainRaw === undefined ? 1 : Number(downGainRaw);
  if (!Number.isFinite(downGain) || downGain <= 0) throw new Error(`bad --down-gain ${downGainRaw}`);
  const restDropRaw = flag("--rest-drop-mm");
  const restDropMm = restDropRaw === undefined ? 0 : Number(restDropRaw);
  if (!Number.isFinite(restDropMm)) throw new Error(`bad --rest-drop-mm ${restDropRaw}`);
  return { glbPath, targetGapMm, dry: process.argv.includes("--dry"), rigid: process.argv.includes("--rigid"), downGain, restDropMm };
}

type SeatResult = {
  plan: RimSeatPlan;
  newBase: Float32Array;
  newJoints: number[];
  newWeights: number[];
  newDeltas: Record<string, Float32Array>;
  jointsType: number;
};

function skinAtRest(
  base: Float32Array,
  joints: ArrayLike<number>,
  weights: ArrayLike<number>,
  boneMats: Float32Array,
): Float32Array {
  const out = new Float32Array(base.length);
  const matrix = new Matrix4();
  const point = new Vector3();
  for (let vertex = 0; vertex < base.length / 3; vertex += 1) {
    let ox = 0;
    let oy = 0;
    let oz = 0;
    for (let slot = 0; slot < 4; slot += 1) {
      const weight = weights[vertex * 4 + slot] ?? 0;
      if (weight === 0) continue;
      matrix.fromArray(boneMats, (joints[vertex * 4 + slot] ?? 0) * 16);
      point.set(base[vertex * 3] ?? 0, base[vertex * 3 + 1] ?? 0, base[vertex * 3 + 2] ?? 0).applyMatrix4(matrix);
      ox += weight * point.x;
      oy += weight * point.y;
      oz += weight * point.z;
    }
    out[vertex * 3] = ox;
    out[vertex * 3 + 1] = oy;
    out[vertex * 3 + 2] = oz;
  }
  return out;
}

export async function planRimSeat(glbPath: string, targetGapMm: number, forceRigid: boolean, downGain = 1, restDropMm = 0): Promise<SeatResult> {
  const doc = await new NodeIO().read(glbPath);
  const teeth = doc.getRoot().listMeshes().find((mesh) => /fitted_teeth/i.test(mesh.getName()));
  if (!teeth) throw new Error(`no fitted teeth mesh in ${glbPath}`);
  const body = doc.getRoot().listMeshes().find((mesh) => /_body$/i.test(mesh.getName()));
  if (!body) throw new Error(`no body mesh in ${glbPath}`);
  const teethPrim = teeth.listPrimitives()[0];
  const bodyPrim = body.listPrimitives()[0];
  if (!teethPrim || !bodyPrim) throw new Error("missing primitive 0");
  const teethNames = (teeth.getExtras() as { targetNames?: string[] } | null)?.targetNames ?? [];
  const expected = ["viseme_aa", "viseme_E", "viseme_I", "viseme_O", "viseme_U", "viseme_FF", "viseme_PP"];
  if (teethNames.length !== expected.length || !expected.every((name) => teethNames.includes(name))) {
    throw new Error(`teeth targets are not the solved seven: ${teethNames.join(",")}`);
  }
  const teethBaseAttr = teethPrim.getAttribute("POSITION");
  if (!teethBaseAttr) throw new Error("teeth mesh has no POSITION attribute");
  const teethBase = floatArray(teethBaseAttr);
  const teethCount = teethBase.length / 3;
  if (teethCount !== 4494) throw new Error(`teeth vertex count moved: ${teethCount}`);
  const bodyBaseAttr = bodyPrim.getAttribute("POSITION");
  if (!bodyBaseAttr) throw new Error("body mesh has no POSITION attribute");
  const bodyBase = floatArray(bodyBaseAttr);
  const bodyNormalsAttr = bodyPrim.getAttribute("NORMAL");
  if (!bodyNormalsAttr) throw new Error("body mesh has no NORMAL accessor for the inner-rim rule");
  const bodyNormals = floatArray(bodyNormalsAttr);
  const bodyTargets = (body.getExtras() as { targetNames?: string[] } | null)?.targetNames ?? [];
  const bodyDeltas = bodyTargets.map((_, index) => {
    const accessor = bodyPrim.listTargets()[index]?.getAttribute("POSITION");
    return accessor ? floatArray(accessor) : new Float32Array(bodyBase.length);
  });
  const teethJoints = teethPrim.getAttribute("JOINTS_0");
  const teethWeights = teethPrim.getAttribute("WEIGHTS_0");
  if (!teethJoints || !teethWeights) throw new Error("teeth mesh has no skinning attributes");
  const teethJointsType = teethJoints.getComponentType();
  if (teethJointsType !== 5121) throw new Error(`teeth JOINTS_0 component ${teethJointsType}, expected UNSIGNED_BYTE`);
  const jointArray = teethJoints.getArray();
  const weightArray = floatArray(teethWeights);
  if (!jointArray) throw new Error("empty JOINTS_0");
  const bodyJointsAttr = bodyPrim.getAttribute("JOINTS_0");
  const bodyWeightsAttr = bodyPrim.getAttribute("WEIGHTS_0");
  if (!bodyJointsAttr || !bodyWeightsAttr) throw new Error("body mesh has no skinning attributes");
  const bodyJoints = bodyJointsAttr.getArray();
  const bodyWeights = floatArray(bodyWeightsAttr);
  if (!bodyJoints) throw new Error("empty body JOINTS_0");
  const bodyNode = doc.getRoot().listNodes().find((node) => node.getMesh() === body);
  const jointNodes = bodyNode?.getSkin()?.listJoints() ?? [];
  const teethNode = doc.getRoot().listNodes().find((node) => node.getMesh() === teeth);
  const teethSkinJoints = teethNode?.getSkin()?.listJoints().map((joint) => joint.getName()) ?? [];
  if (!teethSkinJoints.some((name) => /^jaw$/i.test(name ?? ""))) throw new Error("teeth skin has no jaw joint");
  const aaIndex = bodyTargets.indexOf("viseme_aa");
  if (aaIndex < 0) throw new Error("body has no viseme_aa target");

  // Inner rim (stated rule) and its triangles.
  const rim = lowerLipInnerRim(
    bodyBase, bodyNormals, bodyDeltas[aaIndex] ?? new Float32Array(bodyBase.length),
    bodyJoints, bodyWeights, jointNodes, teethBase,
  );
  if (rim.length === 0) throw new Error("inner rim is empty: facing rule matched no landmark vertex");
  const rimSet = new Set(rim);
  const bodyIndexAttr = bodyPrim.getIndices();
  if (!bodyIndexAttr) throw new Error("body primitive has no indices for rim triangles");
  const bodyIndex = bodyIndexAttr.getArray();
  if (!bodyIndex) throw new Error("empty body index");
  const rimTris: Array<readonly [number, number, number]> = [];
  for (let tri = 0; tri < bodyIndex.length / 3; tri += 1) {
    const a = bodyIndex[tri * 3] ?? -1;
    const b = bodyIndex[tri * 3 + 1] ?? -1;
    const c = bodyIndex[tri * 3 + 2] ?? -1;
    if (rimSet.has(a) && rimSet.has(b) && rimSet.has(c)) rimTris.push([a, b, c]);
  }
  if (rimTris.length === 0) throw new Error("inner rim has no interior triangles");

  // Lower arch: below the teeth base-y median (anatomical, weight-independent).
  const midY = medianY(teethBase);
  const lowerArch: number[] = [];
  for (let vertex = 0; vertex < teethCount; vertex += 1) {
    if ((teethBase[vertex * 3 + 1] ?? 0) <= midY) lowerArch.push(vertex);
  }
  if (lowerArch.length === 0) throw new Error("lower arch is empty");

  // Rest pose via the headless scene (rest bone transforms).
  const scene = await loadHeadlessScene(glbPath);
  scene.root.updateMatrixWorld(true);
  const restTeethMats = (() => {
    scene.teeth.skeleton.update();
    const mats = scene.teeth.skeleton.boneMatrices;
    if (!mats) throw new Error("teeth skeleton has no bone matrices");
    return mats.slice();
  })();
  const restBodyMats = (() => {
    scene.body.skeleton.update();
    const mats = scene.body.skeleton.boneMatrices;
    if (!mats) throw new Error("body skeleton has no bone matrices");
    return mats.slice();
  })();
  const restRimGap = (teethPositions: Float32Array): number => {
    const teethWorld = skinAtRest(teethPositions, jointArray, weightArray, restTeethMats);
    const bodyWorld = skinAtRest(bodyBase, bodyJoints, bodyWeights, restBodyMats);
    return rimGap(teethWorld, frontShellIndices(teethPositions).lower, bodyWorld, rim);
  };

  // Clearance plane P (#739 instrument, imported): cap skin median minus the
  // test's own 0.5 mm safety. Teeth z never moves the skin medians (the band
  // is teeth y/x, the shift is z), so P measured on the input doc binds the
  // output too.
  const face = measureFaceMarginsFromDoc(doc, runtimeCap(REPO_ROOT));
  if (!face) throw new Error("face instrument found no teeth or body mesh");
  const planeZ = face.medianAtCap - FACE_SAFETY_M;

  // Rest offset on the lower arch (bind +z; fixed point for assignment switching).
  const targetM = targetGapMm / 1000;
  const restGap0 = restRimGap(teethBase);
  let rimBase = teethBase;
  let rimCheck = restGap0;
  let rimShift = 0;
  for (let shot = 0; shot < REST_SHOTS; shot += 1) {
    if (Math.abs(rimCheck - targetM) <= REST_TOL_M) break;
    const step = rimCheck - targetM;
    const shifted = new Float32Array(rimBase);
    for (const vertex of lowerArch) shifted[vertex * 3 + 2] = (shifted[vertex * 3 + 2] ?? 0) + step;
    rimBase = shifted;
    rimShift += step;
    rimCheck = restRimGap(rimBase);
  }
  if (Math.abs(rimCheck - targetM) > REST_TOL_M) {
    throw new Error(`rest offset missed: gap ${rimCheck} vs target ${targetM}`);
  }

  // Per-vertex face clearance on the seated base: teeth ahead of P retreat
  // along bind -z by iterated quadratic falloff. One pass moves each
  // crossing vertex by the square of its own excess over P divided by the
  // maximum excess: C1-smooth at the contour (value and slope vanish there),
  // parameter-free, and no vertex ever moves more than its own excess
  // (excess squared over the max never exceeds the excess). A single pass
  // undershoots (it pins only the worst vertex), so passes repeat on the
  // residual with a recomputed max: the residual max quarters (or better)
  // every pass, totals stay below per-vertex excess, and the field stays
  // smooth as a sum of smooth fields. Stops when the residual max is at or
  // below SNAP_M (float32-safe, physically nothing) with a 16-pass bound.
  // Float32Array keeps every assignment at accessor precision, so a re-plan
  // from cleared bytes measures no excess and applies nothing.
  let newBase = rimBase;
  let pullbackVertCount = 0;
  let pullbackMax = 0;
  let pullbackSum = 0;
  let pullbackPasses = 0;
  for (let pass = 0; pass < PULLBACK_PASSES; pass += 1) {
    let excessMax = 0;
    for (let vertex = 0; vertex < teethCount; vertex += 1) {
      excessMax = Math.max(excessMax, (newBase[vertex * 3 + 2] ?? 0) - planeZ);
    }
    if (excessMax <= SNAP_M) break;
    pullbackPasses = pass + 1;
    const moved = new Float32Array(newBase);
    for (let vertex = 0; vertex < teethCount; vertex += 1) {
      const excess = (newBase[vertex * 3 + 2] ?? 0) - planeZ;
      if (excess <= SNAP_M) continue;
      const drop = (excess * excess) / excessMax;
      moved[vertex * 3 + 2] = (moved[vertex * 3 + 2] ?? 0) - drop;
      if (pass === 0) {
        pullbackVertCount += 1;
        pullbackMax = Math.max(pullbackMax, drop);
        pullbackSum += drop;
      }
    }
    newBase = moved;
  }
  let seatedMaxZ = -Infinity;
  for (let vertex = 0; vertex < teethCount; vertex += 1) {
    seatedMaxZ = Math.max(seatedMaxZ, newBase[vertex * 3 + 2] ?? 0);
  }
  if (!(seatedMaxZ <= planeZ + SNAP_M)) {
    throw new Error(`pullback missed the clearance plane: maxZ ${seatedMaxZ} vs plane ${planeZ}`);
  }
  const honestCheck = restRimGap(newBase);

  // Rest drop: signed head-down translation of the lower-arch base after
  // the face pullback. Skin weights and morph transfer above are untouched,
  // so the edge-to-rim vertical gap shifts by the same amount on every
  // frame. Default 0 is a no-op (newBase reference kept, bytes unchanged).
  let droppedBase = newBase;
  if (restDropMm !== 0) {
    scene.root.updateMatrixWorld(true);
    const headRotation = new Matrix4().extractRotation(scene.headBone.matrixWorld);
    const toBind = new Matrix3().setFromMatrix4(headRotation).transpose();
    const headDown = new Vector3(0, -restDropMm / 1000, 0).applyMatrix3(toBind);
    droppedBase = new Float32Array(newBase);
    for (const vertex of lowerArch) {
      droppedBase[vertex * 3] = (droppedBase[vertex * 3] ?? 0) + headDown.x;
      droppedBase[vertex * 3 + 1] = (droppedBase[vertex * 3 + 1] ?? 0) + headDown.y;
      droppedBase[vertex * 3 + 2] = (droppedBase[vertex * 3 + 2] ?? 0) + headDown.z;
    }
  }
  const honestDropCheck = restDropMm === 0 ? honestCheck : restRimGap(droppedBase);

  const transfer = transferArch({
    teethBase, bodyBase, bodyDeltas, bodyTargets, teethNames, bodyJoints, bodyWeights,
    lowerArch, rimTris, newBase, forceRigid, teethSkinJoints, teethCount, jointArray, weightArray,
  });
  const { newJoints, newWeights, newDeltas, distortionMm, rigid, jawMaxVerts } = transfer;

  // Variant-A down gain: scale the vertical head-local component of each
  // lower-arch teeth viseme delta. Head-local comes from the head bone rest
  // world rotation (rotation only, no translation, no scale), so the rule
  // carries to other rigs. Forward component, jaw rotation, lip and body
  // morphs are untouched. Default 1 is a no-op.
  if (downGain !== 1) {
    scene.root.updateMatrixWorld(true);
    const headRotation = new Matrix4().extractRotation(scene.headBone.matrixWorld);
    const toHead = new Matrix3().setFromMatrix4(headRotation);
    const toBind = toHead.clone().transpose();
    const point = new Vector3();
    for (const targetName of Object.keys(newDeltas)) {
      const field = newDeltas[targetName];
      if (!field) throw new Error(`no delta for ${targetName}`);
      for (const vertex of lowerArch) {
        point
          .set(field[vertex * 3] ?? 0, field[vertex * 3 + 1] ?? 0, field[vertex * 3 + 2] ?? 0)
          .applyMatrix3(toHead);
        point.y *= downGain;
        point.applyMatrix3(toBind);
        field[vertex * 3] = point.x;
        field[vertex * 3 + 1] = point.y;
        field[vertex * 3 + 2] = point.z;
      }
    }
  }

  const plan: RimSeatPlan = {
    rimCount: rim.length,
    rimTriangles: rimTris.length,
    lowerArchCount: lowerArch.length,
    targetGapMm,
    restGap0Mm: Math.round(restGap0 * 1e6) / 1e3,
    restShiftMm: Math.round(rimShift * 1e6) / 1e3,
    faceMarginRest0Mm: Math.round(face.marginAtRest * 1e6) / 1e3,
    faceMarginCap0Mm: Math.round(face.marginAtCap * 1e6) / 1e3,
    faceSafetyMm: FACE_SAFETY_M * 1000,
    clearancePlaneMm: Math.round(planeZ * 1e6) / 1e3,
    pullbackVertCount,
    pullbackMaxMm: Math.round(pullbackMax * 1e6) / 1e3,
    pullbackMeanMm: Math.round((pullbackVertCount === 0 ? 0 : pullbackSum / pullbackVertCount) * 1e6) / 1e3,
    pullbackPasses,
    downGain,
    restDropMm,
    honestRestGapMm: Math.round(honestDropCheck * 1e6) / 1e3,
    rigid,
    distortionMm,
    jawMaxVerts,
    teethCount,
  };
  return { plan, newBase: droppedBase, newJoints, newWeights, newDeltas, jointsType: teethJointsType };
}

/** Rim gap: mean 3D distance from lower-shell verts to the nearest rim vert. */
function rimGap(
  teethWorld: Float32Array,
  shellLower: readonly number[],
  bodyWorld: Float32Array,
  rim: readonly number[],
): number {
  let sum = 0;
  for (const tooth of shellLower) {
    const tx = teethWorld[tooth * 3] ?? 0;
    const ty = teethWorld[tooth * 3 + 1] ?? 0;
    const tz = teethWorld[tooth * 3 + 2] ?? 0;
    let best = Infinity;
    for (const lip of rim) {
      const dx = (bodyWorld[lip * 3] ?? 0) - tx;
      const dy = (bodyWorld[lip * 3 + 1] ?? 0) - ty;
      const dz = (bodyWorld[lip * 3 + 2] ?? 0) - tz;
      const dist = dx * dx + dy * dy + dz * dz;
      if (dist < best) best = dist;
    }
    sum += Math.sqrt(best);
  }
  return sum / (shellLower.length || 1);
}

/** In-place accessor overwrite honoring interleaved byteStride. Counts and types must match. */
function writeAccessorBytes(
  json: GlbJson,
  bin: Buffer,
  accessorIndex: number,
  values: ArrayLike<number>,
  count: number,
  components: number,
): void {
  const accessor = json.accessors[accessorIndex] as {
    bufferView: number;
    byteOffset?: number;
    count: number;
    componentType: number;
    type: string;
    min?: number[];
    max?: number[];
  };
  const view = json.bufferViews[accessor.bufferView] as
    | { byteOffset?: number; byteLength?: number; byteStride?: number }
    | undefined;
  if (!accessor || !view) throw new Error(`accessor ${accessorIndex} missing`);
  const size =
    accessor.componentType === 5121 ? 1 : accessor.componentType === 5123 ? 2 : accessor.componentType === 5126 ? 4 : 0;
  const expectType = components === 3 ? "VEC3" : "VEC4";
  if (accessor.count !== count || accessor.type !== expectType || size === 0) {
    throw new Error(`accessor ${accessorIndex} is not ${expectType} x${count}`);
  }
  const stride = view.byteStride ?? components * size;
  const start = (view.byteOffset ?? 0) + (accessor.byteOffset ?? 0);
  if (start + (count - 1) * stride + components * size > bin.length) {
    throw new Error(`accessor ${accessorIndex} overruns the buffer`);
  }
  const min: number[] = [];
  const max: number[] = [];
  for (let axis = 0; axis < components; axis += 1) {
    min.push(Infinity);
    max.push(-Infinity);
  }
  for (let vertex = 0; vertex < count; vertex += 1) {
    for (let axis = 0; axis < components; axis += 1) {
      const value = values[vertex * components + axis] ?? 0;
      const at = start + vertex * stride + axis * size;
      if (size === 1) {
        if (!Number.isInteger(value) || value < 0 || value > 255) throw new Error(`joint index out of range: ${value}`);
        bin.writeUInt8(value, at);
      } else if (size === 2) {
        bin.writeUInt16LE(value, at);
      } else {
        bin.writeFloatLE(value, at);
      }
      min[axis] = Math.min(min[axis] ?? 0, value);
      max[axis] = Math.max(max[axis] ?? 0, value);
    }
  }
  accessor.min = min;
  accessor.max = max;
}

async function main(): Promise<void> {
  const wallStart = Date.now();
  const { glbPath, targetGapMm, dry, rigid, downGain, restDropMm } = readArgs();
  const { plan, newBase, newJoints, newWeights, newDeltas } = await planRimSeat(glbPath, targetGapMm, rigid, downGain, restDropMm);
  process.stdout.write(`${JSON.stringify(plan, null, 2)}\n`);
  if (dry) {
    process.stdout.write(`wall clock ${((Date.now() - wallStart) / 1000).toFixed(1)}s (dry run, no write)\n`);
    return;
  }
  const file = readFileSync(glbPath);
  if (file.readUInt32LE(0) !== 0x46546c67) throw new Error("not a glb");
  const jsonLength = file.readUInt32LE(12);
  const json = JSON.parse(file.subarray(20, 20 + jsonLength).toString("utf8")) as GlbJson;
  const binHeader = 20 + jsonLength;
  const binLength = json.buffers[0]?.byteLength;
  if (typeof binLength !== "number") throw new Error("missing buffer length");
  const bin = Buffer.from(file.subarray(binHeader + 8, binHeader + 8 + binLength));
  const teeth = json.meshes.find((mesh) => mesh.name !== undefined && /fitted_teeth/i.test(mesh.name));
  const primitive = teeth?.primitives[0];
  if (!teeth || !primitive) throw new Error("teeth primitive missing from JSON");
  const existing = teeth.extras?.targetNames ?? [];
  const plannedNames = Object.keys(newDeltas);
  if (existing.length !== plannedNames.length || !plannedNames.every((name) => existing.includes(name))) {
    throw new Error(`teeth target names moved: ${existing.join(",")}`);
  }
  const existingIndex = new Map(existing.map((name, index) => [name, index]));
  const targets: { POSITION: number }[] = [];
  for (const name of existing) {
    const values = newDeltas[name];
    if (!values) throw new Error(`no delta for ${name}`);
    const prior = existingIndex.get(name);
    const accessorIndex = prior === undefined ? undefined : primitive.targets?.[prior]?.POSITION;
    if (typeof accessorIndex !== "number") throw new Error(`missing POSITION on ${name}`);
    writeAccessorBytes(json, bin, accessorIndex, values, plan.teethCount, 3);
    targets.push({ POSITION: accessorIndex });
  }
  primitive.targets = targets;
  const baseAccessor = (primitive as { attributes?: { POSITION?: number } }).attributes?.POSITION;
  if (typeof baseAccessor !== "number") throw new Error("teeth primitive has no POSITION attribute");
  writeAccessorBytes(json, bin, baseAccessor, newBase, plan.teethCount, 3);
  const jointsAccessor = (primitive as { attributes?: { JOINTS_0?: number } }).attributes?.JOINTS_0;
  const weightsAccessor = (primitive as { attributes?: { WEIGHTS_0?: number } }).attributes?.WEIGHTS_0;
  if (typeof jointsAccessor !== "number" || typeof weightsAccessor !== "number") {
    throw new Error("teeth primitive has no skinning attributes");
  }
  writeAccessorBytes(json, bin, jointsAccessor, newJoints, plan.teethCount, 4);
  writeAccessorBytes(json, bin, weightsAccessor, newWeights, plan.teethCount, 4);
  const outBuffer = json.buffers[0];
  if (!outBuffer) throw new Error("missing buffer length");
  outBuffer.byteLength = bin.length;
  writeGlb(json, bin, glbPath);
  const bytes = readFileSync(glbPath);
  process.stdout.write(
    `wrote ${glbPath} sha256=${createHash("sha256").update(bytes).digest("hex")} bytes=${bytes.length}\n`,
  );
  process.stdout.write(`wall clock ${((Date.now() - wallStart) / 1000).toFixed(1)}s\n`);
}

if (import.meta.url === new URL(`file://${process.argv[1] ?? ""}`).href) {
  main().catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  });
}
