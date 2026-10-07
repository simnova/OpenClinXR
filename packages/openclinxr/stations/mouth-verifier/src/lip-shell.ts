/**
 * Lip-shell geometry vendored for the mouth verifier (MADR 0061 verifier).
 *
 * Byte-for-byte logic copy of the four evaluator-reached helpers in
 * tools/openclinxr/asset-pipeline/makeclothes/couple-fitted-teeth-to-lip-viseme.ts
 * [ref:couple-fitted-teeth-to-lip-viseme.ts:frontShellIndices/frontShellMeanGap/lowerLipLandmark/lowerLipInnerRim]:
 * frontShellIndices, frontShellMeanGap, lowerLipLandmark, lowerLipInnerRim plus
 * LOWER_LIP_MIN_VERTS and their private helpers. Vendored (not imported) so the
 * verifier package stays under its own rootDir and depends only on the
 * objective for station vocabulary. The producer keeps its copy in tools/.
 */
import type { Node as GltfNode } from "@gltf-transform/core";

/** Packed xyz vector, metres. */
type Vec3 = [number, number, number];

/** Lower-lip landmark rule: aa-down response at or below this Y delta, metres. */
export const LOWER_LIP_DELTA_Y_BELOW = -0.002;

/** Minimum lower-lip landmark vertex count. */
export const LOWER_LIP_MIN_VERTS = 20;

/** Midline exclusion half-width splitting upper and lower shell rows, metres. */
export const CLEAR_BAND_M = 0.006;

/** Central-crown half-width around world x = 0, metres. */
export const FRONT_SHELL_ABS_X_M = 0.012;

/** Front-shell z band behind the row max, metres. */
export const FRONT_SHELL_Z_BAND_M = 0.004;

/** Uniform body grid cell for the nearest-body lookup, metres. */
const BODY_GRID_CELL_M = 0.008;

type BodyGrid = {
  body: Float32Array;
  origin: Vec3;
  buckets: Map<number, number[]>;
};

/** True when the joint node sits under the jaw joint. */
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

/** Dominant skinning joint index for a vertex. */
function dominantJoint(joints: ArrayLike<number>, weights: ArrayLike<number>, vertex: number): number {
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

/** Median of a numeric series. */
function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? ((sorted[mid - 1] ?? 0) + (sorted[mid] ?? 0)) / 2 : (sorted[mid] ?? 0);
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

/** Grid key for the uniform body grid. */
function gridKey(ix: number, iy: number, iz: number): number {
  return ix * 73856093 + iy * 19349663 + iz * 83492791;
}

/** Build the uniform grid over body world positions. */
function buildBodyGrid(bodyWorld: Float32Array): BodyGrid {
  const count = bodyWorld.length / 3;
  let minX = Infinity;
  let minY = Infinity;
  let minZ = Infinity;
  for (let lip = 0; lip < count; lip += 1) {
    const x = bodyWorld[lip * 3] ?? 0;
    const y = bodyWorld[lip * 3 + 1] ?? 0;
    const z = bodyWorld[lip * 3 + 2] ?? 0;
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (z < minZ) minZ = z;
  }
  const origin: Vec3 = [minX, minY, minZ];
  const buckets = new Map<number, number[]>();
  for (let lip = 0; lip < count; lip += 1) {
    const ix = Math.floor(((bodyWorld[lip * 3] ?? 0) - minX) / BODY_GRID_CELL_M);
    const iy = Math.floor(((bodyWorld[lip * 3 + 1] ?? 0) - minY) / BODY_GRID_CELL_M);
    const iz = Math.floor(((bodyWorld[lip * 3 + 2] ?? 0) - minZ) / BODY_GRID_CELL_M);
    const key = gridKey(ix, iy, iz);
    const bucket = buckets.get(key);
    if (bucket) bucket.push(lip);
    else buckets.set(key, [lip]);
  }
  return { body: bodyWorld, origin, buckets };
}

/** Nearest body vertex to a query point, expanding Chebyshev rings. */
function nearestBody(grid: BodyGrid, x: number, y: number, z: number): { dist: number; dx: number; dy: number; dz: number } {
  const ix = Math.floor((x - grid.origin[0]) / BODY_GRID_CELL_M);
  const iy = Math.floor((y - grid.origin[1]) / BODY_GRID_CELL_M);
  const iz = Math.floor((z - grid.origin[2]) / BODY_GRID_CELL_M);
  let best = Infinity;
  let bx = 0;
  let by = 0;
  let bz = 0;
  const body = grid.body;
  for (let radius = 0; radius < 80; radius += 1) {
    for (let cz = -radius; cz <= radius; cz += 1) {
      for (let cy = -radius; cy <= radius; cy += 1) {
        for (let cx = -radius; cx <= radius; cx += 1) {
          if (radius > 0 && Math.max(Math.abs(cx), Math.abs(cy), Math.abs(cz)) !== radius) continue;
          const bucket = grid.buckets.get(gridKey(ix + cx, iy + cy, iz + cz));
          if (!bucket) continue;
          for (const lip of bucket) {
            const lx = (body[lip * 3] ?? 0) - x;
            const ly = (body[lip * 3 + 1] ?? 0) - y;
            const lz = (body[lip * 3 + 2] ?? 0) - z;
            const d2 = lx * lx + ly * ly + lz * lz;
            if (d2 < best) {
              best = d2;
              bx = lx;
              by = ly;
              bz = lz;
            }
          }
        }
      }
    }
    // A cell at Chebyshev distance radius+1 is at least radius cells away.
    if (best <= radius * radius * BODY_GRID_CELL_M * BODY_GRID_CELL_M) break;
  }
  return { dist: Math.sqrt(best), dx: bx, dy: by, dz: bz };
}

/** Mean distance from each shell vertex to the nearest body vertex, and the mean of those vectors. */
function gapAgainstGrid(
  teethWorld: Float32Array,
  shell: readonly number[],
  grid: BodyGrid,
  offset: Vec3,
): { meanM: number; dirM: Vec3 } {
  let dist = 0;
  let dx = 0;
  let dy = 0;
  let dz = 0;
  for (const tooth of shell) {
    const nearest = nearestBody(
      grid,
      (teethWorld[tooth * 3] ?? 0) + offset[0],
      (teethWorld[tooth * 3 + 1] ?? 0) + offset[1],
      (teethWorld[tooth * 3 + 2] ?? 0) + offset[2],
    );
    dist += nearest.dist;
    dx += nearest.dx;
    dy += nearest.dy;
    dz += nearest.dz;
  }
  const count = shell.length || 1;
  return { meanM: dist / count, dirM: [dx / count, dy / count, dz / count] };
}

/** Mean distance from each shell vertex to the nearest body vertex, and the mean of those vectors. */
export function frontShellMeanGap(
  teethWorld: Float32Array,
  shell: readonly number[],
  bodyWorld: Float32Array,
): { meanM: number; dirM: Vec3 } {
  return gapAgainstGrid(teethWorld, shell, buildBodyGrid(bodyWorld), [0, 0, 0]);
}

/** Lower-lip landmark: jaw-descendant verts responding down in the aa delta. */
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
