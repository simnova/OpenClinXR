/**
 * Linear-blend skinning at rest bone transforms (MADR 0061 mouth executor).
 *
 * Moved verbatim from tools/openclinxr/asset-pipeline/makeclothes/seat-teeth-on-lip-rim.ts.
 * Shared by the seat plan, the FF press solve and the tongue TH solve.
 */
import { Matrix4, Vector3 } from "three";

/** Skin a base field with rest bone matrices. */
export function skinAtRest(
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
