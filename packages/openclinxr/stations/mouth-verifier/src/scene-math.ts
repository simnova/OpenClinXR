/**
 * Shared headless-scene math for the mouth verifier (MADR 0061 verifier).
 *
 * CPU skinning and morph helpers moved with the evaluator so the drive and the
 * premise probe share one implementation. Units follow the evaluator: metres in
 * world space, millimetres after the head-local conversion at the call site.
 */
import { Matrix4, Vector3 } from "three";
import type { HeadlessMesh } from "./headless-scene.js";

/** Round to six decimals for evaluator records. */
export function round6(value: number): number {
  return Math.round(value * 1e6) / 1e6;
}

/** Round to three decimals for premise-probe rows. */
export function round3(value: number): number {
  return Math.round(value * 1e3) / 1e3;
}

/** Standard linear-blend skinning over bone matrices (three.js SkinnedMesh math on CPU). */
export function skinPositions(
  mesh: HeadlessMesh,
  morphed: Float32Array,
  skinMatrices: ArrayLike<number>,
): Float32Array {
  const count = morphed.length / 3;
  const out = new Float32Array(morphed.length);
  const matrix = new Matrix4();
  const point = new Vector3();
  for (let vertex = 0; vertex < count; vertex += 1) {
    const x = morphed[vertex * 3] ?? 0;
    const y = morphed[vertex * 3 + 1] ?? 0;
    const z = morphed[vertex * 3 + 2] ?? 0;
    let ox = 0;
    let oy = 0;
    let oz = 0;
    for (let slot = 0; slot < 4; slot += 1) {
      const weight = mesh.weights[vertex * 4 + slot] ?? 0;
      if (weight === 0) continue;
      matrix.fromArray(skinMatrices, (mesh.joints[vertex * 4 + slot] ?? 0) * 16);
      point.set(x, y, z).applyMatrix4(matrix);
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

/** Apply morph-target deltas at the given influences to a mesh base. */
export function morphedPositions(mesh: HeadlessMesh, influences: ArrayLike<number>): Float32Array {
  const out = new Float32Array(mesh.base);
  for (let target = 0; target < mesh.targetDeltas.length; target += 1) {
    const weight = influences[target] ?? 0;
    if (weight === 0) continue;
    const delta = mesh.targetDeltas[target];
    if (!delta) continue;
    for (let i = 0; i < out.length; i += 1) out[i] = (out[i] ?? 0) + weight * (delta[i] ?? 0);
  }
  return out;
}

/** Current bone matrices for a headless mesh. */
export function boneMatrices(mesh: HeadlessMesh): Float32Array {
  mesh.skeleton.update();
  const matrices = mesh.skeleton.boneMatrices;
  if (!matrices) throw new Error("skeleton has no bone matrices");
  return matrices.slice();
}

/** Slice packed world positions down to the given vertex set. */
export function worldSlice(world: Float32Array, indices: readonly number[]): Float32Array {
  const out = new Float32Array(indices.length * 3);
  indices.forEach((vertex, i) => {
    out[i * 3] = world[vertex * 3] ?? 0;
    out[i * 3 + 1] = world[vertex * 3 + 1] ?? 0;
    out[i * 3 + 2] = world[vertex * 3 + 2] ?? 0;
  });
  return out;
}
