/**
 * Lower-lip landmark, inner rim and front-shell helpers (MADR 0061 mouth executor).
 *
 * Moved verbatim from tools/openclinxr/asset-pipeline/makeclothes/couple-fitted-teeth-to-lip-viseme.ts
 * so the executor owns the rim geometry its seat transfer runs against. The tools module
 * re-exports these symbols; behavior is unchanged (the S0 producer counterweight and
 * jaw-lip-couple pin the bytes). `rimGap` moves from seat-teeth-on-lip-rim.ts with it.
 */
import type { Node as GltfNode } from "@gltf-transform/core";

/** Rig-plus-response floor: viseme_aa bind delta y below this marks a jaw-driven lip vert. */
export const LOWER_LIP_DELTA_Y_BELOW = -0.002;
/** Row membership half-band around the teeth median y. */
export const CLEAR_BAND_M = 0.006;
/** Front-shell half-width in x. */
export const FRONT_SHELL_ABS_X_M = 0.012;
/** Front-shell depth band behind the row max z. */
export const FRONT_SHELL_Z_BAND_M = 0.004;

type Vec3 = [number, number, number];

/** Median of a number list. */
export function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? ((sorted[mid - 1] ?? 0) + (sorted[mid] ?? 0)) / 2 : (sorted[mid] ?? 0);
}

/** Dominant skinning joint of one vertex (ties to the lowest joint index). */
export function dominantJoint(joints: ArrayLike<number>, weights: ArrayLike<number>, vertex: number): number {
  let joint = joints[vertex * 4] ?? 0;
  let weight = weights[vertex * 4] ?? 0;
  for (let slot = 1; slot < 4; slot += 1) {
    const next = weights[vertex * 4 + slot] ?? 0;
    if (next > weight) {
      weight = next;
      joint = joints[vertex * 4 + slot] ?? joint;
    }
  }
  return joint;
}

/** True when the node is the jaw or descends from it. */
export function isJawDescendant(node: GltfNode): boolean {
  const seen = new Set<GltfNode>();
  let current: GltfNode | null = node;
  while (current && !seen.has(current)) {
    if (current.getName() === "jaw") return true;
    seen.add(current);
    current = current.getParentNode();
  }
  return false;
}

/** Central crowns of one row. Membership is on the base POSITION accessor. */
export function frontShellIndices(positions: Float32Array): { upper: number[]; lower: number[] } {
  const count = positions.length / 3;
  const ys: number[] = [];
  for (let vertex = 0; vertex < count; vertex += 1) ys.push(positions[vertex * 3 + 1] ?? 0);
  const mid = median(ys);
  const upperRow: number[] = [];
  const lowerRow: number[] = [];
  for (let vertex = 0; vertex < count; vertex += 1) {
    const y = ys[vertex] ?? 0;
    if (y > mid + CLEAR_BAND_M) upperRow.push(vertex);
    else if (y < mid - CLEAR_BAND_M) lowerRow.push(vertex);
  }
  const pick = (row: number[]): number[] => {
    let maxZ = -Infinity;
    for (const vertex of row) maxZ = Math.max(maxZ, positions[vertex * 3 + 2] ?? 0);
    return row.filter(
      (vertex) =>
        Math.abs(positions[vertex * 3] ?? 0) <= FRONT_SHELL_ABS_X_M &&
        (positions[vertex * 3 + 2] ?? 0) >= maxZ - FRONT_SHELL_Z_BAND_M,
    );
  };
  return { upper: pick(upperRow), lower: pick(lowerRow) };
}

/**
 * Lower-lip landmark: rig-plus-response rule with no body coordinates.
 *
 * Dominant joint is `jaw` or a jaw descendant and the viseme_aa bind delta y
 * is below LOWER_LIP_DELTA_Y_BELOW.
 */
export function lowerLipLandmark(
  deltas: Float32Array,
  joints: ArrayLike<number>,
  weights: ArrayLike<number>,
  jointNodes: readonly GltfNode[],
): number[] {
  const indices: number[] = [];
  const count = deltas.length / 3;
  for (let vertex = 0; vertex < count; vertex += 1) {
    if ((deltas[vertex * 3 + 1] ?? 0) >= LOWER_LIP_DELTA_Y_BELOW) continue;
    const joint = jointNodes[dominantJoint(joints, weights, vertex)];
    if (!joint || !isJawDescendant(joint)) continue;
    indices.push(vertex);
  }
  return indices;
}

/**
 * Lower-lip inner rim: landmark vertices whose bind-space mesh normal faces
 * the front-shell centroid (dot product sign only, no thresholds). These are
 * the mucosa-edge vertices the lower crowns face. Stated rule, fully
 * procedural: jaw-descendant + aa-down response, then facing sign against
 * the shell centroid. No body coordinates.
 */
export function lowerLipInnerRim(
  bodyBase: Float32Array,
  bodyNormals: Float32Array,
  bodyDeltaAa: Float32Array,
  joints: ArrayLike<number>,
  weights: Float32Array,
  jointNodes: readonly GltfNode[],
  teethBase: Float32Array,
): number[] {
  const landmark = lowerLipLandmark(bodyDeltaAa, joints, weights, jointNodes);
  const shells = frontShellIndices(teethBase);
  const shell = [...shells.upper, ...shells.lower];
  let cx = 0;
  let cy = 0;
  let cz = 0;
  for (const vertex of shell) {
    cx += teethBase[vertex * 3] ?? 0;
    cy += teethBase[vertex * 3 + 1] ?? 0;
    cz += teethBase[vertex * 3 + 2] ?? 0;
  }
  const count = shell.length || 1;
  const center: Vec3 = [cx / count, cy / count, cz / count];
  const rim: number[] = [];
  for (const vertex of landmark) {
    const nx = bodyNormals[vertex * 3] ?? 0;
    const ny = bodyNormals[vertex * 3 + 1] ?? 0;
    const nz = bodyNormals[vertex * 3 + 2] ?? 0;
    const dx = center[0] - (bodyBase[vertex * 3] ?? 0);
    const dy = center[1] - (bodyBase[vertex * 3 + 1] ?? 0);
    const dz = center[2] - (bodyBase[vertex * 3 + 2] ?? 0);
    if (nx * dx + ny * dy + nz * dz > 0) rim.push(vertex);
  }
  return rim;
}

/** Rim gap: mean 3D distance from lower-shell verts to the nearest rim vert. */
export function rimGap(
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
