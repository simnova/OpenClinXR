/**
 * Couple a fitted-teeth primitive to the body viseme targets.
 *
 * Every opening body `viseme_*` (jaw aperture above zero) gets one POSITION
 * morph on the teeth primitive, solved from the front-shell gap. The old
 * lower-lip landmark does not gate that solve: E, FF, nn, RR, TH, and U were
 * skipped when the landmark had fewer than 20 vertices, and the teeth then
 * had no translation. A closed viseme still needs that landmark before it
 * writes zeros (viseme_PP). viseme_sil stays off the teeth. No `mouth-open`
 * target is added. Skin weights are not changed.
 *
 * An opening morph is a per-vertex POSITION delta. A rigid translation seats
 * the front shell, then each arch-face crown gets its own posterior Z, and
 * side crowns (|x| > 12 mm) also tuck inward in X. After
 * `applyJawOpenToRoot` for that viseme, each front shell's mean distance to
 * the nearest body vertex is between 0.5 mm and 2 mm, with the lip still in
 * front of the crowns (+Z). Upper crowns are not pulled forward of that seat.
 *
 * Front shell: |x| <= 0.012, clear of the teeth median by 6 mm, and within
 * 4 mm of that row's max z, on the base POSITION accessor.
 *
 * Landmark, measured on the parent body primitive 0 before this morph existed:
 * |x| <= 0.03, y in [1.448, 1.488], morph delta y < -2 mm, and the dominant
 * joint is `jaw` or a descendant of `jaw`. It is not the translation.
 *
 * Run: pnpm exec tsx tools/openclinxr/asset-pipeline/makeclothes/couple-fitted-teeth-to-lip-viseme.ts <glb> [--dry|--measure]
 */
import { readFileSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { NodeIO, type Node as GltfNode } from "@gltf-transform/core";
import { Bone, BufferAttribute, BufferGeometry, Group, Matrix4, Skeleton, SkinnedMesh, Vector3 } from "three";
import { applyVisemeWeights, type MorphTargetLike } from "../../../../packages/openclinxr/xr-dialogue/src/viseme-morph-apply.ts";
import { applyJawOpenToRoot } from "../../../../packages/openclinxr/xr-dialogue/src/viseme-runtime-wire.ts";
import {
  jawApertureFractionTable,
  jawOpenRadiansForPhoneme,
} from "../../../../packages/openclinxr/xr-dialogue/src/viseme-timeline-drive.ts";

export const LOWER_LIP_ABS_X_MAX = 0.03;
export const LOWER_LIP_Y_MIN = 1.448;
export const LOWER_LIP_Y_MAX = 1.488;
export const LOWER_LIP_DELTA_Y_BELOW = -0.002;
export const LOWER_LIP_MIN_VERTS = 20;
export const CLEAR_BAND_M = 0.006;
export const JAW_WEIGHT_MIN = 0.5;
export const FRONT_SHELL_ABS_X_M = 0.012;
export const FRONT_SHELL_Z_BAND_M = 0.004;
/** Crowns stay behind the lip surface, close enough that the gap does not show. */
export const FRONT_SHELL_GAP_MIN_M = 0.0005;
export const FRONT_SHELL_GAP_MAX_M = 0.002;
const FRONT_SHELL_GAP_AIM_M = 0.00125;
/** Arch face: 2 mm world-x bins, verts within 2 mm of that bin's world max z. */
const ARCH_BIN_M = 0.002;
const ARCH_FACE_Z_M = 0.002;
/** Lead window: body verts within 6 mm in x and y. */
const LEAD_WINDOW_M = 0.006;
/** Land this far past the lead limit so the compare is not a float tie. */
const LEAD_PAST_M = 0.00001;
const COMMISSURE_Z_BAND_M = 0.004;
const COMMISSURE_INSET_M = 0.001;

const GLB_MAGIC = 0x46546c67;
const GLB_JSON = 0x4e4f534a;
const GLB_BIN = 0x004e4942;
const FLOAT = 5126;
const ARRAY_BUFFER = 34962;

type Vec3 = [number, number, number];

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

function floatArray(accessor: { getArray: () => ArrayLike<number> | null }): Float32Array {
  const array = accessor.getArray();
  if (!array) throw new Error("empty accessor");
  return array instanceof Float32Array ? array : Float32Array.from(array);
}

function indexArray(accessor: { getArray: () => ArrayLike<number> | null }): Uint8Array | Uint16Array | Uint32Array {
  const array = accessor.getArray();
  if (!array) throw new Error("empty accessor");
  if (array instanceof Uint8Array || array instanceof Uint16Array || array instanceof Uint32Array) return array;
  return Uint16Array.from(array);
}

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

export function jawWeightSum(joints: ArrayLike<number>, weights: ArrayLike<number>, vertex: number, jawIndex: number): number {
  let sum = 0;
  for (let slot = 0; slot < 4; slot += 1) {
    if (joints[vertex * 4 + slot] === jawIndex) sum += weights[vertex * 4 + slot] ?? 0;
  }
  return sum;
}

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

/**
 * Uniform grid over body vertices. Nearest lookup expands Chebyshev rings and
 * stops when the unsearched ring cannot beat the current best, so the neighbor
 * is the same vertex a full scan would return.
 */
const BODY_GRID_CELL_M = 0.008;

type BodyGrid = {
  body: Float32Array;
  origin: Vec3;
  buckets: Map<number, number[]>;
};

function gridKey(ix: number, iy: number, iz: number): number {
  return ix * 73856093 + iy * 19349663 + iz * 83492791;
}

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

export function frontShellMeanGap(
  teethWorld: Float32Array,
  shell: readonly number[],
  bodyWorld: Float32Array,
): { meanM: number; dirM: Vec3 } {
  return gapAgainstGrid(teethWorld, shell, buildBodyGrid(bodyWorld), [0, 0, 0]);
}

function gapInBand(gap: { meanM: number; dirM: Vec3 }): boolean {
  return gap.meanM >= FRONT_SHELL_GAP_MIN_M && gap.meanM <= FRONT_SHELL_GAP_MAX_M && gap.dirM[2] > 0;
}

function skinMesh(
  positions: Float32Array,
  joints: ArrayLike<number>,
  weights: ArrayLike<number>,
  skinMatrices: ArrayLike<number>,
): Float32Array {
  const count = positions.length / 3;
  const out = new Float32Array(positions.length);
  const matrix = new Matrix4();
  const point = new Vector3();
  for (let vertex = 0; vertex < count; vertex += 1) {
    const x = positions[vertex * 3] ?? 0;
    const y = positions[vertex * 3 + 1] ?? 0;
    const z = positions[vertex * 3 + 2] ?? 0;
    let ox = 0;
    let oy = 0;
    let oz = 0;
    for (let slot = 0; slot < 4; slot += 1) {
      const weight = weights[vertex * 4 + slot] ?? 0;
      if (weight === 0) continue;
      matrix.fromArray(skinMatrices, (joints[vertex * 4 + slot] ?? 0) * 16);
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

function morphed(base: Float32Array, targets: readonly Float32Array[], influences: ArrayLike<number>): Float32Array {
  const out = new Float32Array(base);
  for (let target = 0; target < targets.length; target += 1) {
    const weight = influences[target] ?? 0;
    if (weight === 0) continue;
    const delta = targets[target]!;
    for (let i = 0; i < out.length; i += 1) out[i] = (out[i] ?? 0) + weight * (delta[i] ?? 0);
  }
  return out;
}

function applyLinear(matrix: Matrix4, value: Vec3): Vec3 {
  const e = matrix.elements;
  return [
    (e[0] ?? 0) * value[0] + (e[4] ?? 0) * value[1] + (e[8] ?? 0) * value[2],
    (e[1] ?? 0) * value[0] + (e[5] ?? 0) * value[1] + (e[9] ?? 0) * value[2],
    (e[2] ?? 0) * value[0] + (e[6] ?? 0) * value[1] + (e[10] ?? 0) * value[2],
  ];
}

function jointLinear(skinMatrices: Float32Array, jointIndex: number): Matrix4 {
  const matrix = new Matrix4().fromArray(skinMatrices, jointIndex * 16);
  const e = matrix.elements;
  e[12] = 0;
  e[13] = 0;
  e[14] = 0;
  e[3] = 0;
  e[7] = 0;
  e[11] = 0;
  e[15] = 1;
  return matrix;
}

/**
 * In-band gaps score by distance to the aim, plus a small lateral penalty so a
 * centered shell wins over a sideways slide that is only slightly closer.
 * Crossed or out-of-band gaps score above 1.
 */
function scoreGap(gap: { meanM: number; dirM: Vec3 }, offsetX = 0): number {
  if (gapInBand(gap)) return Math.abs(gap.meanM - FRONT_SHELL_GAP_AIM_M) + Math.abs(offsetX) * 0.25;
  const over = Math.max(0, gap.meanM - FRONT_SHELL_GAP_MAX_M);
  const under = Math.max(0, FRONT_SHELL_GAP_MIN_M - gap.meanM);
  const crossed = gap.dirM[2] > 0 ? 0 : 1 + Math.abs(gap.dirM[2]);
  return 1 + over + under * 2 + crossed;
}

function considerOffsets(
  teethWorld: Float32Array,
  shell: readonly number[],
  grid: BodyGrid,
  center: Vec3,
  step: number,
  radius: number,
  best: { offset: Vec3; gap: { meanM: number; dirM: Vec3 }; score: number },
): void {
  const count = Math.round((radius * 2) / step);
  for (let iz = 0; iz <= count; iz += 1) {
    for (let iy = 0; iy <= count; iy += 1) {
      for (let ix = 0; ix <= count; ix += 1) {
        const offset: Vec3 = [
          center[0] - radius + ix * step,
          center[1] - radius + iy * step,
          center[2] - radius + iz * step,
        ];
        const gap = gapAgainstGrid(teethWorld, shell, grid, offset);
        const score = scoreGap(gap, offset[0]);
        if (score < best.score) {
          best.score = score;
          best.offset = offset;
          best.gap = gap;
        }
      }
    }
  }
}

function remember(
  teethWorld: Float32Array,
  shell: readonly number[],
  grid: BodyGrid,
  offset: Vec3,
  best: { offset: Vec3; gap: { meanM: number; dirM: Vec3 }; score: number },
): void {
  const gap = gapAgainstGrid(teethWorld, shell, grid, offset);
  const score = scoreGap(gap, offset[0]);
  if (score < best.score) {
    best.score = score;
    best.offset = offset;
    best.gap = gap;
  }
}

/**
 * One world translation of a rigid shell. The box stays behind the lip (+Z) and
 * covers the swing the jaw hinge adds, then a finer grid pulls the mean into band.
 */
function solveWorldOffset(
  teethWorld: Float32Array,
  shell: readonly number[],
  grid: BodyGrid,
): { offset: Vec3; gap: { meanM: number; dirM: Vec3 } } {
  const zero = gapAgainstGrid(teethWorld, shell, grid, [0, 0, 0]);
  const best = { offset: [0, 0, 0] as Vec3, gap: zero, score: scoreGap(zero) };
  // Partial jaw openings leave the shells 5–11 mm behind the lip. A 2 mm
  // lattice covers that swing, including shapes the lip landmark never marked.
  // Integer steps keep the sample on the lattice instead of drifting with 0.002.
  for (let iz = -2; iz <= 12; iz += 1) {
    for (let iy = -12; iy <= 4; iy += 1) {
      for (let ix = -5; ix <= 5; ix += 1) {
        remember(teethWorld, shell, grid, [ix * 0.002, iy * 0.002, iz * 0.002], best);
      }
    }
  }
  considerOffsets(teethWorld, shell, grid, best.offset, 0.0005, 0.002, best);
  let polish = 0.0004;
  for (let round = 0; round < 12 && polish >= 0.00005; round += 1) {
    let improved = false;
    for (const axis of [0, 1, 2] as const) {
      for (const sign of [-1, 1] as const) {
        const offset: Vec3 = [best.offset[0], best.offset[1], best.offset[2]];
        offset[axis] += sign * polish;
        const before = best.score;
        remember(teethWorld, shell, grid, offset, best);
        if (best.score < before) improved = true;
      }
    }
    if (!improved) polish *= 0.5;
  }
  return { offset: best.offset, gap: best.gap };
}

export function lowerLipLandmark(
  positions: Float32Array,
  deltas: Float32Array,
  joints: ArrayLike<number>,
  weights: ArrayLike<number>,
  jointNodes: readonly GltfNode[],
): number[] {
  const indices: number[] = [];
  const count = positions.length / 3;
  for (let vertex = 0; vertex < count; vertex += 1) {
    const x = positions[vertex * 3] ?? 0;
    const y = positions[vertex * 3 + 1] ?? 0;
    if (Math.abs(x) > LOWER_LIP_ABS_X_MAX) continue;
    if (y < LOWER_LIP_Y_MIN || y > LOWER_LIP_Y_MAX) continue;
    if ((deltas[vertex * 3 + 1] ?? 0) >= LOWER_LIP_DELTA_Y_BELOW) continue;
    const joint = jointNodes[dominantJoint(joints, weights, vertex)];
    if (!joint || !isJawDescendant(joint)) continue;
    indices.push(vertex);
  }
  return indices;
}

export type TeethVisemeTarget = {
  name: string;
  landmarkCount: number;
  /** Rigid front-shell translation, bone-local. Side crowns are not this vector. */
  jawDelta: Vec3;
  headDelta: Vec3;
  /** Per-vertex POSITION delta in the same space as the base accessor. */
  delta: Float32Array;
  /** Front-shell gaps after the solved deltas and the shipped jaw rotation, metres. */
  upperGapM: number;
  lowerGapM: number;
};

type Pose = {
  root: Group;
  teethPos: Float32Array;
  teethJoints: ArrayLike<number>;
  teethWeights: ArrayLike<number>;
  teethTargets: Float32Array[];
  teethTargetNames: string[];
  teethSkinned: SkinnedMesh;
  teethSkeleton: Skeleton;
  bodyPos: Float32Array;
  bodyJoints: ArrayLike<number>;
  bodyWeights: ArrayLike<number>;
  bodyTargets: Float32Array[];
  bodyTargetNames: string[];
  bodySkinned: SkinnedMesh;
  bodySkeleton: Skeleton;
  jointNodes: GltfNode[];
};

function boneMatrices(root: Group, skeleton: Skeleton): Float32Array {
  root.updateMatrixWorld(true);
  skeleton.update();
  const matrices = skeleton.boneMatrices;
  if (!matrices) throw new Error("skeleton has no bone matrices");
  return matrices.slice();
}

/** The shipped applier writes this same influences array. */
function morphTarget(mesh: SkinnedMesh): MorphTargetLike {
  const dict = mesh.morphTargetDictionary;
  const influences = mesh.morphTargetInfluences;
  if (!dict || !influences) throw new Error(`${mesh.name} has no morph targets`);
  return { morphTargetDictionary: dict, morphTargetInfluences: influences };
}

function buildPose(doc: Awaited<ReturnType<NodeIO["read"]>>): Pose {
  const nodeMap = new Map<unknown, Bone | Group>();
  const joints = new Set(doc.getRoot().listSkins().flatMap((skin) => skin.listJoints()));
  const build = (node: GltfNode): Bone | Group => {
    const object = joints.has(node) ? new Bone() : new Group();
    object.name = node.getName();
    const translation = node.getTranslation();
    const rotation = node.getRotation();
    const scale = node.getScale();
    object.position.set(translation[0]!, translation[1]!, translation[2]!);
    object.quaternion.set(rotation[0]!, rotation[1]!, rotation[2]!, rotation[3]!);
    object.scale.set(scale[0]!, scale[1]!, scale[2]!);
    nodeMap.set(node, object);
    for (const child of node.listChildren()) object.add(build(child));
    return object;
  };
  const root = new Group();
  for (const scene of doc.getRoot().listScenes()) {
    for (const child of scene.listChildren()) root.add(build(child));
  }
  root.updateMatrixWorld(true);

  const attach = (meshName: RegExp) => {
    const mesh = doc.getRoot().listMeshes().find((item) => meshName.test(item.getName()));
    if (!mesh) throw new Error(`mesh ${meshName} missing`);
    const prim = mesh.listPrimitives()[0];
    const node = doc.getRoot().listNodes().find((item) => item.getMesh() === mesh);
    const skin = node?.getSkin();
    if (!prim || !node || !skin) throw new Error(`${mesh.getName()} has no skinned primitive`);
    const positions = floatArray(prim.getAttribute("POSITION")!);
    const jointArray = indexArray(prim.getAttribute("JOINTS_0")!);
    const weightArray = floatArray(prim.getAttribute("WEIGHTS_0")!);
    const targetNames = (mesh.getExtras() as { targetNames?: string[] } | null)?.targetNames ?? [];
    const targets = targetNames.map((_, index) => {
      const accessor = prim.listTargets()[index]?.getAttribute("POSITION");
      return accessor ? floatArray(accessor) : new Float32Array(positions.length);
    });
    const jointNodes = skin.listJoints();
    const bones = jointNodes.map((joint) => {
      const bone = nodeMap.get(joint);
      if (!(bone instanceof Bone)) throw new Error(`joint ${joint.getName()} is not a bone`);
      return bone;
    });
    const ibm = floatArray(skin.getInverseBindMatrices()!);
    const inverses = bones.map((_, index) => new Matrix4().fromArray(ibm, index * 16));
    const skeleton = new Skeleton(bones, inverses);
    const geometry = new BufferGeometry();
    geometry.setAttribute("position", new BufferAttribute(new Float32Array([0, 0, 0]), 3));
    const skinned = new SkinnedMesh(geometry);
    skinned.name = mesh.getName();
    skinned.morphTargetDictionary = Object.fromEntries(targetNames.map((name, index) => [name, index]));
    skinned.morphTargetInfluences = targetNames.map(() => 0);
    skinned.bind(skeleton, new Matrix4());
    (nodeMap.get(node) ?? root).add(skinned);
    return { positions, jointArray, weightArray, targets, targetNames, skinned, skeleton, jointNodes };
  };

  const teeth = attach(/fitted_teeth/i);
  const body = attach(/_body$/i);
  return {
    root,
    teethPos: teeth.positions,
    teethJoints: teeth.jointArray,
    teethWeights: teeth.weightArray,
    teethTargets: teeth.targets,
    teethTargetNames: teeth.targetNames,
    teethSkinned: teeth.skinned,
    teethSkeleton: teeth.skeleton,
    bodyPos: body.positions,
    bodyJoints: body.jointArray,
    bodyWeights: body.weightArray,
    bodyTargets: body.targets,
    bodyTargetNames: body.targetNames,
    bodySkinned: body.skinned,
    bodySkeleton: body.skeleton,
    jointNodes: body.jointNodes,
  };
}

export type MeasuredVisemeGap = {
  name: string;
  jawFraction: number;
  jawOpenRadians: number;
  teethTargetApplied: boolean;
  landmarkCount: number;
  upperM: number;
  lowerM: number;
};

/** Jaw-aperture fraction for a body `viseme_*` name. Unknown tokens use the driver's 0.25 partial. */
export function jawFractionForVisemeName(name: string): number {
  const phoneme = name.replace(/^viseme_/i, "").trim().toLowerCase();
  if (!phoneme || phoneme === "sil" || phoneme === "silence" || phoneme === "rest") return 0;
  const fraction = jawApertureFractionTable()[phoneme];
  return typeof fraction === "number" ? fraction : 0.25;
}

/** Mean of the per-viseme upper/lower front-shell means, over jaw fractions above zero. */
export function openingMeanShellM(
  rows: readonly { jawFraction: number; upperM: number; lowerM: number }[],
): number {
  const opening = rows.filter((row) => row.jawFraction > 0);
  if (opening.length === 0) throw new Error("no jaw-opening viseme");
  let sum = 0;
  for (const row of opening) sum += (row.upperM + row.lowerM) / 2;
  return sum / opening.length;
}

/**
 * Front-shell gaps for every body viseme, through applyVisemeWeights and applyJawOpenToRoot.
 * A teeth target is applied only when that name already exists on the teeth mesh. Missing
 * names stay at the base teeth, which is the pre-solve measurement for those shapes.
 */
export async function measureTeethVisemeGaps(glbPath: string): Promise<{
  teethName: string;
  teethTargets: string[];
  restUpperM: number;
  restLowerM: number;
  rows: MeasuredVisemeGap[];
  openingMeanM: number;
}> {
  const doc = await new NodeIO().read(glbPath);
  const pose = buildPose(doc);
  const shells = frontShellIndices(pose.teethPos);
  const bodyMorph = morphTarget(pose.bodySkinned);
  const teethInfluences = pose.teethSkinned.morphTargetInfluences;
  const teethDictionary = pose.teethSkinned.morphTargetDictionary;
  if (!teethInfluences || !teethDictionary) throw new Error(`${pose.teethSkinned.name} has no morph targets`);

  const restTeeth = skinMesh(pose.teethPos, pose.teethJoints, pose.teethWeights, boneMatrices(pose.root, pose.teethSkeleton));
  const restBody = skinMesh(pose.bodyPos, pose.bodyJoints, pose.bodyWeights, boneMatrices(pose.root, pose.bodySkeleton));
  const restUpperM = frontShellMeanGap(restTeeth, shells.upper, restBody).meanM;
  const restLowerM = frontShellMeanGap(restTeeth, shells.lower, restBody).meanM;

  const rows: MeasuredVisemeGap[] = [];
  for (let index = 0; index < pose.bodyTargetNames.length; index += 1) {
    const name = pose.bodyTargetNames[index]!;
    if (!name.toLowerCase().startsWith("viseme_")) continue;
    const deltas = pose.bodyTargets[index] ?? new Float32Array(pose.bodyPos.length);
    const landmarkCount = lowerLipLandmark(
      pose.bodyPos,
      deltas,
      pose.bodyJoints,
      pose.bodyWeights,
      pose.jointNodes,
    ).length;
    bodyMorph.morphTargetInfluences.fill(0);
    teethInfluences.fill(0);
    applyVisemeWeights(bodyMorph, { [name]: 1 });
    const teethTargetApplied = pose.teethTargetNames.includes(name);
    if (teethTargetApplied) applyVisemeWeights({ morphTargetDictionary: teethDictionary, morphTargetInfluences: teethInfluences }, { [name]: 1 });
    const jawOpenRadians = jawOpenRadiansForPhoneme(name.replace(/^viseme_/i, ""));
    applyJawOpenToRoot(pose.root, jawOpenRadians);
    const teethWorld = skinMesh(
      morphed(pose.teethPos, pose.teethTargets, teethInfluences),
      pose.teethJoints,
      pose.teethWeights,
      boneMatrices(pose.root, pose.teethSkeleton),
    );
    const bodyWorld = skinMesh(
      morphed(pose.bodyPos, pose.bodyTargets, bodyMorph.morphTargetInfluences),
      pose.bodyJoints,
      pose.bodyWeights,
      boneMatrices(pose.root, pose.bodySkeleton),
    );
    rows.push({
      name,
      jawFraction: jawFractionForVisemeName(name),
      jawOpenRadians,
      teethTargetApplied,
      landmarkCount,
      upperM: frontShellMeanGap(teethWorld, shells.upper, bodyWorld).meanM,
      lowerM: frontShellMeanGap(teethWorld, shells.lower, bodyWorld).meanM,
    });
  }
  return {
    teethName: pose.teethSkinned.name,
    teethTargets: pose.teethTargetNames,
    restUpperM,
    restLowerM,
    rows,
    openingMeanM: openingMeanShellM(rows),
  };
}

/**
 * Arch face after the pose. Row membership is base Y, clear of the median.
 * Each 2 mm world-x bin keeps verts within 2 mm of that bin's world max z.
 */
export function archFaceIndices(base: Float32Array, world: Float32Array): { upper: number[]; lower: number[] } {
  const count = base.length / 3;
  const ys: number[] = [];
  for (let vertex = 0; vertex < count; vertex += 1) ys.push(base[vertex * 3 + 1] ?? 0);
  const mid = median(ys);
  const upperRow: number[] = [];
  const lowerRow: number[] = [];
  for (let vertex = 0; vertex < count; vertex += 1) {
    const y = ys[vertex] ?? 0;
    if (y > mid + CLEAR_BAND_M) upperRow.push(vertex);
    else if (y < mid - CLEAR_BAND_M) lowerRow.push(vertex);
  }
  const face = (row: number[]): number[] => {
    const bins = new Map<number, number[]>();
    for (const vertex of row) {
      const bin = Math.floor((world[vertex * 3] ?? 0) / ARCH_BIN_M);
      const list = bins.get(bin);
      if (list) list.push(vertex);
      else bins.set(bin, [vertex]);
    }
    const out: number[] = [];
    for (const list of bins.values()) {
      let maxZ = -Infinity;
      for (const vertex of list) maxZ = Math.max(maxZ, world[vertex * 3 + 2] ?? 0);
      for (const vertex of list) {
        if ((world[vertex * 3 + 2] ?? 0) >= maxZ - ARCH_FACE_Z_M) out.push(vertex);
      }
    }
    return out;
  };
  return { upper: face(upperRow), lower: face(lowerRow) };
}

export function jawDescendantVertexMask(
  joints: ArrayLike<number>,
  weights: ArrayLike<number>,
  jointNodes: readonly GltfNode[],
): Uint8Array {
  const count = weights.length / 4;
  const mask = new Uint8Array(count);
  const jawish = jointNodes.map((node) => isJawDescendant(node));
  for (let vertex = 0; vertex < count; vertex += 1) {
    if (jawish[dominantJoint(joints, weights, vertex)]) mask[vertex] = 1;
  }
  return mask;
}

type LeadGrid = { body: Float32Array; buckets: Map<number, number[]> };

function buildLeadGrid(bodyWorld: Float32Array, allow: Uint8Array | null): LeadGrid {
  const buckets = new Map<number, number[]>();
  const key = (ix: number, iy: number) => ix * 73856093 + iy * 19349663;
  const count = bodyWorld.length / 3;
  for (let lip = 0; lip < count; lip += 1) {
    if (allow && allow[lip] === 0) continue;
    const ix = Math.floor((bodyWorld[lip * 3] ?? 0) / LEAD_WINDOW_M);
    const iy = Math.floor((bodyWorld[lip * 3 + 1] ?? 0) / LEAD_WINDOW_M);
    const bucketKey = key(ix, iy);
    const bucket = buckets.get(bucketKey);
    if (bucket) bucket.push(lip);
    else buckets.set(bucketKey, [lip]);
  }
  return { body: bodyWorld, buckets };
}

/** Tooth world z minus the max z of body verts within 6 mm in x and y. +Infinity when none. */
function leadAt(grid: LeadGrid, x: number, y: number, z: number): number {
  const ix = Math.floor(x / LEAD_WINDOW_M);
  const iy = Math.floor(y / LEAD_WINDOW_M);
  const key = (cx: number, cy: number) => cx * 73856093 + cy * 19349663;
  let skinZ = -Infinity;
  const body = grid.body;
  for (let ox = -1; ox <= 1; ox += 1) {
    for (let oy = -1; oy <= 1; oy += 1) {
      const bucket = grid.buckets.get(key(ix + ox, iy + oy));
      if (!bucket) continue;
      for (const lip of bucket) {
        if (Math.abs((body[lip * 3] ?? 0) - x) > LEAD_WINDOW_M) continue;
        if (Math.abs((body[lip * 3 + 1] ?? 0) - y) > LEAD_WINDOW_M) continue;
        const bz = body[lip * 3 + 2] ?? 0;
        if (bz > skinZ) skinZ = bz;
      }
    }
  }
  return skinZ === -Infinity ? Infinity : z - skinZ;
}

export type ArchLeadStats = {
  max: number;
  atAbsXM: number;
  count: number;
  missing: number;
  bands: { absXMm: string; max: number }[];
};

/** Max lead of an arch face. Bands are world |x| in 10 mm steps. */
export function archFaceLead(
  teethWorld: Float32Array,
  face: readonly number[],
  bodyWorld: Float32Array,
  allow: Uint8Array | null,
): ArchLeadStats {
  const grid = buildLeadGrid(bodyWorld, allow);
  const bandEdges = [0, 0.01, 0.02, 0.03, Infinity];
  const bandMax = bandEdges.slice(0, -1).map(() => -Infinity);
  let max = -Infinity;
  let atAbsXM = 0;
  let count = 0;
  let missing = 0;
  for (const vertex of face) {
    const x = teethWorld[vertex * 3] ?? 0;
    const y = teethWorld[vertex * 3 + 1] ?? 0;
    const z = teethWorld[vertex * 3 + 2] ?? 0;
    const lead = leadAt(grid, x, y, z);
    if (!Number.isFinite(lead)) {
      missing += 1;
      continue;
    }
    count += 1;
    const absX = Math.abs(x);
    for (let band = 0; band < bandMax.length; band += 1) {
      if (absX >= bandEdges[band]! && absX < bandEdges[band + 1]! && lead > bandMax[band]!) bandMax[band] = lead;
    }
    if (lead > max) {
      max = lead;
      atAbsXM = absX;
    }
  }
  const labels = ["0-10", "10-20", "20-30", "30+"];
  return {
    max,
    atAbsXM,
    count,
    missing,
    bands: labels.map((absXMm, index) => ({ absXMm, max: bandMax[index]! })),
  };
}

/** Half-width of the anterior lip rim in a world-Y slice. 0 when the slice is empty. */
function commissureHalfM(bodyWorld: Float32Array, allow: Uint8Array | null, yMin: number, yMax: number): number {
  const count = bodyWorld.length / 3;
  let maxZ = -Infinity;
  for (let lip = 0; lip < count; lip += 1) {
    if (allow && allow[lip] === 0) continue;
    const y = bodyWorld[lip * 3 + 1] ?? 0;
    if (y < yMin || y > yMax) continue;
    maxZ = Math.max(maxZ, bodyWorld[lip * 3 + 2] ?? 0);
  }
  if (maxZ === -Infinity) return 0;
  let half = 0;
  for (let lip = 0; lip < count; lip += 1) {
    if (allow && allow[lip] === 0) continue;
    const y = bodyWorld[lip * 3 + 1] ?? 0;
    if (y < yMin || y > yMax) continue;
    if ((bodyWorld[lip * 3 + 2] ?? 0) < maxZ - COMMISSURE_Z_BAND_M) continue;
    half = Math.max(half, Math.abs(bodyWorld[lip * 3] ?? 0));
  }
  return half;
}

function tuckAbsX(absX: number, outer: number, limit: number): number {
  if (absX <= FRONT_SHELL_ABS_X_M || absX <= limit || outer <= FRONT_SHELL_ABS_X_M) return absX;
  const span = outer - FRONT_SHELL_ABS_X_M;
  const t = Math.min(1, Math.max(0, (absX - FRONT_SHELL_ABS_X_M) / span));
  return FRONT_SHELL_ABS_X_M + t * Math.max(0, limit - FRONT_SHELL_ABS_X_M);
}

function solveShells(
  pose: Pose,
  jawWeighted: readonly number[],
  headWeighted: readonly number[],
  shells: { upper: number[]; lower: number[] },
  jawRadians: number,
  viseme: string,
  jawIndex: number,
  headIndex: number,
): { jawDelta: Vec3; headDelta: Vec3; delta: Float32Array; upperGapM: number; lowerGapM: number } {
  const bodyMorph = morphTarget(pose.bodySkinned);
  bodyMorph.morphTargetInfluences.fill(0);
  applyVisemeWeights(bodyMorph, { [viseme]: 1 });
  applyJawOpenToRoot(pose.root, jawRadians);
  const teethMats = boneMatrices(pose.root, pose.teethSkeleton);
  const bodyMats = boneMatrices(pose.root, pose.bodySkeleton);
  const bodyWorld = skinMesh(
    morphed(pose.bodyPos, pose.bodyTargets, bodyMorph.morphTargetInfluences),
    pose.bodyJoints,
    pose.bodyWeights,
    bodyMats,
  );
  const headInv = jointLinear(teethMats, headIndex).invert();
  const jawInv = jointLinear(teethMats, jawIndex).invert();
  const teethWorld = skinMesh(pose.teethPos, pose.teethJoints, pose.teethWeights, teethMats);
  const grid = buildBodyGrid(bodyWorld);
  const upperSolved = solveWorldOffset(teethWorld, shells.upper, grid);
  const lowerSolved = solveWorldOffset(teethWorld, shells.lower, grid);
  if (!gapInBand(upperSolved.gap) || !gapInBand(lowerSolved.gap)) {
    throw new Error(
      `${viseme} front shells stayed at ${(upperSolved.gap.meanM * 1000).toFixed(2)} mm upper / ${(lowerSolved.gap.meanM * 1000).toFixed(2)} mm lower`,
    );
  }
  const headDelta = applyLinear(headInv, upperSolved.offset);
  const jawDelta = applyLinear(jawInv, lowerSolved.offset);
  const count = pose.teethPos.length / 3;
  const jawSet = new Set(jawWeighted);
  const headSet = new Set(headWeighted);
  const worldOff = new Float32Array(count * 3);
  const rigidZ = new Float32Array(count);
  for (const vertex of jawWeighted) {
    worldOff[vertex * 3] = lowerSolved.offset[0];
    worldOff[vertex * 3 + 1] = lowerSolved.offset[1];
    worldOff[vertex * 3 + 2] = lowerSolved.offset[2];
    rigidZ[vertex] = lowerSolved.offset[2];
  }
  for (const vertex of headWeighted) {
    worldOff[vertex * 3] = upperSolved.offset[0];
    worldOff[vertex * 3 + 1] = upperSolved.offset[1];
    worldOff[vertex * 3 + 2] = upperSolved.offset[2];
    rigidZ[vertex] = upperSolved.offset[2];
  }
  const jawMask = jawDescendantVertexMask(pose.bodyJoints, pose.bodyWeights, pose.jointNodes);
  const jawLead = buildLeadGrid(bodyWorld, jawMask);
  const anyLead = buildLeadGrid(bodyWorld, null);
  const desiredX = new Float32Array(count);
  desiredX.fill(Number.NaN);

  const poseOff = (): Float32Array => {
    const local = new Float32Array(count * 3);
    for (let vertex = 0; vertex < count; vertex += 1) {
      const off: Vec3 = [worldOff[vertex * 3] ?? 0, worldOff[vertex * 3 + 1] ?? 0, worldOff[vertex * 3 + 2] ?? 0];
      const delta = jawSet.has(vertex) ? applyLinear(jawInv, off) : headSet.has(vertex) ? applyLinear(headInv, off) : ([0, 0, 0] as Vec3);
      local[vertex * 3] = delta[0];
      local[vertex * 3 + 1] = delta[1];
      local[vertex * 3 + 2] = delta[2];
    }
    const moved = new Float32Array(pose.teethPos.length);
    for (let i = 0; i < moved.length; i += 1) moved[i] = (pose.teethPos[i] ?? 0) + (local[i] ?? 0);
    return skinMesh(moved, pose.teethJoints, pose.teethWeights, teethMats);
  };

  const planTuck = (verts: readonly number[], posed: Float32Array, allow: Uint8Array | null): number => {
    if (verts.length === 0) return 0;
    let yMin = Infinity;
    let yMax = -Infinity;
    for (const vertex of verts) {
      const y = posed[vertex * 3 + 1] ?? 0;
      if (y < yMin) yMin = y;
      if (y > yMax) yMax = y;
    }
    const half = commissureHalfM(bodyWorld, allow, yMin - LEAD_WINDOW_M, yMax + LEAD_WINDOW_M);
    if (half <= 0) return 0;
    const limit = half - COMMISSURE_INSET_M;
    let outer = 0;
    for (const vertex of verts) {
      if (Math.abs(pose.teethPos[vertex * 3] ?? 0) <= FRONT_SHELL_ABS_X_M) continue;
      outer = Math.max(outer, Math.abs((teethWorld[vertex * 3] ?? 0) + (jawSet.has(vertex) ? lowerSolved.offset[0] : upperSolved.offset[0])));
    }
    let added = 0;
    for (const vertex of verts) {
      if (Number.isFinite(desiredX[vertex])) continue;
      if (Math.abs(pose.teethPos[vertex * 3] ?? 0) <= FRONT_SHELL_ABS_X_M) continue;
      const rigidX = (teethWorld[vertex * 3] ?? 0) + (jawSet.has(vertex) ? lowerSolved.offset[0] : upperSolved.offset[0]);
      const next = tuckAbsX(Math.abs(rigidX), outer, limit);
      if (next < Math.abs(rigidX) - 1e-6) {
        desiredX[vertex] = Math.sign(rigidX || (pose.teethPos[vertex * 3] ?? 0)) * next;
        added += 1;
      }
    }
    return added;
  };

  const applyDesiredX = (): void => {
    for (let vertex = 0; vertex < count; vertex += 1) {
      if (!Number.isFinite(desiredX[vertex])) continue;
      worldOff[vertex * 3] = (desiredX[vertex] ?? 0) - (teethWorld[vertex * 3] ?? 0);
    }
  };

  const retreat = (verts: readonly number[], posed: Float32Array, leadGrid: LeadGrid, targetLead: number, onlyIfAhead: boolean): number => {
    let moves = 0;
    for (const vertex of verts) {
      if (!jawSet.has(vertex) && !headSet.has(vertex)) continue;
      const lead = leadAt(leadGrid, posed[vertex * 3] ?? 0, posed[vertex * 3 + 1] ?? 0, posed[vertex * 3 + 2] ?? 0);
      if (!Number.isFinite(lead)) continue;
      if (onlyIfAhead ? lead < 0 : lead <= targetLead) continue;
      let nextOff = (worldOff[vertex * 3 + 2] ?? 0) + (targetLead - lead);
      const cap = rigidZ[vertex] ?? nextOff;
      if (nextOff > cap) nextOff = cap;
      if (nextOff < (worldOff[vertex * 3 + 2] ?? 0) - 1e-9) {
        worldOff[vertex * 3 + 2] = nextOff;
        moves += 1;
      }
    }
    return moves;
  };

  let posedNow = poseOff();
  planTuck(archFaceIndices(pose.teethPos, posedNow).lower, posedNow, jawMask);
  planTuck(archFaceIndices(pose.teethPos, posedNow).upper, posedNow, null);
  for (let iter = 0; iter < 12; iter += 1) {
    applyDesiredX();
    posedNow = poseOff();
    const face = archFaceIndices(pose.teethPos, posedNow);
    const added = planTuck(face.lower, posedNow, jawMask) + planTuck(face.upper, posedNow, null);
    applyDesiredX();
    posedNow = poseOff();
    const seated = archFaceIndices(pose.teethPos, posedNow);
    const moves =
      retreat(seated.lower, posedNow, jawLead, -FRONT_SHELL_GAP_MIN_M - LEAD_PAST_M, false) +
      retreat(seated.upper, posedNow, anyLead, -LEAD_PAST_M, true);
    if (added === 0 && moves === 0) break;
  }
  // Retreating arch-face crowns that already sit in the front shell widens the
  // mean nearest-body gap. Pull other lower-shell crowns forward, stopping at
  // the lead limit, until that mean is back inside 0.5–2 mm. Upper Z never
  // moves forward of the rigid seat.
  const lowerLeadTarget = -FRONT_SHELL_GAP_MIN_M - LEAD_PAST_M;
  const shiftLowerShell = (posed: Float32Array): number => {
    const shell = shells.lower;
    const gap = frontShellMeanGap(posed, shell, bodyWorld);
    const tooFar = gap.meanM > FRONT_SHELL_GAP_MAX_M;
    const tooClose = gap.meanM < FRONT_SHELL_GAP_MIN_M || gap.dirM[2] <= 0;
    if (!tooFar && !tooClose) return 0;
    const error = tooFar ? gap.meanM - FRONT_SHELL_GAP_AIM_M : FRONT_SHELL_GAP_AIM_M - gap.meanM;
    const room = new Map<number, number>();
    for (const vertex of shell) {
      if (!jawSet.has(vertex)) continue;
      const lead = leadAt(jawLead, posed[vertex * 3] ?? 0, posed[vertex * 3 + 1] ?? 0, posed[vertex * 3 + 2] ?? 0);
      if (tooFar) {
        if (!Number.isFinite(lead)) continue;
        const forward = lowerLeadTarget - lead;
        if (forward > 1e-6) room.set(vertex, forward);
      } else {
        room.set(vertex, error);
      }
    }
    if (room.size === 0) return 0;
    const step = error * (shell.length / room.size);
    let moves = 0;
    for (const [vertex, available] of room) {
      const dz = Math.min(step, available);
      if (dz <= 1e-6) continue;
      const sign = tooFar ? 1 : -1;
      worldOff[vertex * 3 + 2] = (worldOff[vertex * 3 + 2] ?? 0) + sign * dz;
      moves += 1;
    }
    return moves;
  };
  for (let pass = 0; pass < 6; pass += 1) {
    posedNow = poseOff();
    const shifted = shiftLowerShell(posedNow);
    if (shifted === 0) break;
    posedNow = poseOff();
    const seated = archFaceIndices(pose.teethPos, posedNow);
    retreat(seated.lower, posedNow, jawLead, lowerLeadTarget, false);
    retreat(seated.upper, posedNow, anyLead, -LEAD_PAST_M, true);
  }
  posedNow = poseOff();
  const upper = frontShellMeanGap(posedNow, shells.upper, bodyWorld);
  const lower = frontShellMeanGap(posedNow, shells.lower, bodyWorld);
  if (!gapInBand(upper) || !gapInBand(lower)) {
    throw new Error(
      `${viseme} per-vertex front shells stayed at ${(upper.meanM * 1000).toFixed(2)} mm upper / ${(lower.meanM * 1000).toFixed(2)} mm lower`,
    );
  }
  const seated = archFaceIndices(pose.teethPos, posedNow);
  const lowerLead = archFaceLead(posedNow, seated.lower, bodyWorld, jawMask);
  const upperLead = archFaceLead(posedNow, seated.upper, bodyWorld, null);
  if (!(lowerLead.max <= -FRONT_SHELL_GAP_MIN_M)) {
    throw new Error(`${viseme} lower arch lead ${(lowerLead.max * 1000).toFixed(2)} mm`);
  }
  if (!(upperLead.max < 0)) {
    throw new Error(`${viseme} upper arch lead ${(upperLead.max * 1000).toFixed(2)} mm`);
  }
  const local = new Float32Array(count * 3);
  for (let vertex = 0; vertex < count; vertex += 1) {
    const off: Vec3 = [worldOff[vertex * 3] ?? 0, worldOff[vertex * 3 + 1] ?? 0, worldOff[vertex * 3 + 2] ?? 0];
    const delta = jawSet.has(vertex) ? applyLinear(jawInv, off) : headSet.has(vertex) ? applyLinear(headInv, off) : ([0, 0, 0] as Vec3);
    local[vertex * 3] = delta[0];
    local[vertex * 3 + 1] = delta[1];
    local[vertex * 3 + 2] = delta[2];
  }
  return { jawDelta, headDelta, delta: local, upperGapM: upper.meanM, lowerGapM: lower.meanM };
}

/** Per-vertex teeth deltas for every opening body viseme. Closed visemes with a landmark write zeros. */
export async function planTeethVisemeTargets(glbPath: string): Promise<{
  teethName: string;
  targets: TeethVisemeTarget[];
  jawWeighted: number[];
  headWeighted: number[];
  teethCount: number;
  restUpperM: number;
  restLowerM: number;
  upperCount: number;
  lowerCount: number;
}> {
  const doc = await new NodeIO().read(glbPath);
  const meshes = doc.getRoot().listMeshes();
  const teeth = meshes.find((mesh) => /fitted_teeth/i.test(mesh.getName()));
  if (!teeth) throw new Error(`no fitted teeth mesh in ${glbPath}`);
  const body = meshes.find((mesh) => /_body$/i.test(mesh.getName()));
  if (!body) throw new Error(`no body mesh in ${glbPath}`);
  const bodyPrim = body.listPrimitives()[0];
  const teethPrim = teeth.listPrimitives()[0];
  if (!bodyPrim || !teethPrim) throw new Error("missing primitive 0");
  const names = (body.getExtras() as { targetNames?: string[] } | null)?.targetNames ?? [];
  const pose = buildPose(doc);
  const teethJointsNodes = doc.getRoot().listNodes().find((node) => node.getMesh() === teeth)?.getSkin()?.listJoints() ?? [];
  const jawIndex = teethJointsNodes.findIndex((joint) => joint.getName() === "jaw");
  const headIndex = teethJointsNodes.findIndex((joint) => joint.getName() === "head");
  if (jawIndex < 0) throw new Error("teeth skin has no jaw joint");
  if (headIndex < 0) throw new Error("teeth skin has no head joint");
  const jawWeighted: number[] = [];
  const headWeighted: number[] = [];
  for (let vertex = 0; vertex < pose.teethPos.length / 3; vertex += 1) {
    const jawWeight = jawWeightSum(pose.teethJoints, pose.teethWeights, vertex, jawIndex);
    if (jawWeight >= JAW_WEIGHT_MIN) jawWeighted.push(vertex);
    else if (jawWeightSum(pose.teethJoints, pose.teethWeights, vertex, headIndex) >= JAW_WEIGHT_MIN) headWeighted.push(vertex);
  }
  const shells = frontShellIndices(pose.teethPos);
  const jawSet = new Set(jawWeighted);
  const headSet = new Set(headWeighted);
  if (shells.upper.length === 0 || shells.lower.length === 0) throw new Error("front shell is empty");
  if (!shells.upper.every((vertex) => headSet.has(vertex))) throw new Error("upper front shell is not entirely head-weighted");
  if (!shells.lower.every((vertex) => jawSet.has(vertex))) throw new Error("lower front shell is not entirely jaw-weighted");

  const restTeeth = skinMesh(pose.teethPos, pose.teethJoints, pose.teethWeights, boneMatrices(pose.root, pose.teethSkeleton));
  const restBody = skinMesh(pose.bodyPos, pose.bodyJoints, pose.bodyWeights, boneMatrices(pose.root, pose.bodySkeleton));
  const restUpper = frontShellMeanGap(restTeeth, shells.upper, restBody);
  const restLower = frontShellMeanGap(restTeeth, shells.lower, restBody);
  const restUpperM = restUpper.meanM;
  const restLowerM = restLower.meanM;


  const targets: TeethVisemeTarget[] = [];
  for (const name of names) {
    if (!name.toLowerCase().startsWith("viseme_")) continue;
    const target = bodyPrim.listTargets()[names.indexOf(name)];
    const accessor = target?.getAttribute("POSITION");
    if (!accessor) continue;
    const landmark = lowerLipLandmark(pose.bodyPos, floatArray(accessor), pose.bodyJoints, pose.bodyWeights, pose.jointNodes);
    const jawRadians = jawOpenRadiansForPhoneme(name.replace(/^viseme_/i, ""));
    // Opening shapes are solved from the front-shell gap. The landmark count
    // only gates a closed viseme (PP writes zeros; sil stays off the teeth).
    if (jawRadians > 1e-8) {
      const started = Date.now();
      const solved = solveShells(pose, jawWeighted, headWeighted, shells, jawRadians, name, jawIndex, headIndex);
      if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
        process.stderr.write(
          `${name} ${(solved.upperGapM * 1000).toFixed(2)}/${(solved.lowerGapM * 1000).toFixed(2)} mm ${((Date.now() - started) / 1000).toFixed(1)}s\n`,
        );
      }
      targets.push({ name, landmarkCount: landmark.length, ...solved });
      continue;
    }
    if (landmark.length < LOWER_LIP_MIN_VERTS) continue;
    if (jawRadians <= 1e-8) {
      const bodyMorph = morphTarget(pose.bodySkinned);
      bodyMorph.morphTargetInfluences.fill(0);
      applyVisemeWeights(bodyMorph, { [name]: 1 });
      applyJawOpenToRoot(pose.root, 0);
      const teethWorld = skinMesh(pose.teethPos, pose.teethJoints, pose.teethWeights, boneMatrices(pose.root, pose.teethSkeleton));
      const bodyWorld = skinMesh(
        morphed(pose.bodyPos, pose.bodyTargets, bodyMorph.morphTargetInfluences),
        pose.bodyJoints,
        pose.bodyWeights,
        boneMatrices(pose.root, pose.bodySkeleton),
      );
      targets.push({
        name,
        landmarkCount: landmark.length,
        jawDelta: [0, 0, 0],
        headDelta: [0, 0, 0],
        delta: new Float32Array(pose.teethPos.length),
        upperGapM: frontShellMeanGap(teethWorld, shells.upper, bodyWorld).meanM,
        lowerGapM: frontShellMeanGap(teethWorld, shells.lower, bodyWorld).meanM,
      });
    }
  }
  return {
    teethName: teeth.getName(),
    targets,
    jawWeighted,
    headWeighted,
    teethCount: pose.teethPos.length / 3,
    restUpperM,
    restLowerM,
    upperCount: shells.upper.length,
    lowerCount: shells.lower.length,
  };
}

function bounds(values: Float32Array): { min: Vec3; max: Vec3 } {
  const min: Vec3 = [Infinity, Infinity, Infinity];
  const max: Vec3 = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < values.length; i += 3) {
    for (let axis = 0; axis < 3; axis += 1) {
      const value = values[i + axis] ?? 0;
      if (value < min[axis]) min[axis] = value;
      if (value > max[axis]) max[axis] = value;
    }
  }
  return { min, max };
}

type GlbJson = {
  buffers: { byteLength: number }[];
  bufferViews: { buffer: number; byteOffset: number; byteLength: number; target?: number }[];
  accessors: Record<string, unknown>[];
  meshes: {
    name?: string;
    extras?: { targetNames?: string[] };
    primitives: { targets?: { POSITION: number }[] }[];
  }[];
};

function appendTargetBytes(
  json: GlbJson,
  bin: Buffer,
  values: Float32Array,
  count: number,
): { bin: Buffer; accessor: number } {
  let next = bin;
  if (next.length % 4 !== 0) next = Buffer.concat([next, Buffer.alloc(4 - (next.length % 4))]);
  const bytes = Buffer.from(values.buffer, values.byteOffset, values.byteLength);
  const { min, max } = bounds(values);
  const view = json.bufferViews.length;
  json.bufferViews.push({ buffer: 0, byteOffset: next.length, byteLength: bytes.length, target: ARRAY_BUFFER });
  const accessor = json.accessors.length;
  json.accessors.push({
    bufferView: view,
    byteOffset: 0,
    componentType: FLOAT,
    count,
    type: "VEC3",
    min,
    max,
  });
  return { bin: Buffer.concat([next, bytes]), accessor };
}

function writeTargetBytes(json: GlbJson, bin: Buffer, accessorIndex: number, values: Float32Array, count: number): void {
  const accessor = json.accessors[accessorIndex] as {
    bufferView: number;
    byteOffset?: number;
    count: number;
    componentType: number;
    type: string;
    min?: Vec3;
    max?: Vec3;
  };
  if (!accessor || accessor.componentType !== FLOAT || accessor.type !== "VEC3" || accessor.count !== count) {
    throw new Error(`teeth target accessor ${accessorIndex} is not a float VEC3 of ${count}`);
  }
  const view = json.bufferViews[accessor.bufferView];
  if (!view) throw new Error(`teeth target accessor ${accessorIndex} has no buffer view`);
  const start = (view.byteOffset ?? 0) + (accessor.byteOffset ?? 0);
  const bytes = Buffer.from(values.buffer, values.byteOffset, values.byteLength);
  if (view.byteLength < bytes.length || start + bytes.length > bin.length) {
    throw new Error(`teeth target accessor ${accessorIndex} does not fit the buffer`);
  }
  bytes.copy(bin, start);
  const { min, max } = bounds(values);
  accessor.min = min;
  accessor.max = max;
}

function writeGlb(json: GlbJson, bin: Buffer, glbPath: string): void {
  const jsonBytes = Buffer.from(JSON.stringify(json));
  const jsonPad = (4 - (jsonBytes.length % 4)) % 4;
  const jsonChunk = Buffer.concat([jsonBytes, Buffer.alloc(jsonPad, 0x20)]);
  const binPad = (4 - (bin.length % 4)) % 4;
  const binChunk = binPad === 0 ? bin : Buffer.concat([bin, Buffer.alloc(binPad)]);
  const total = 12 + 8 + jsonChunk.length + 8 + binChunk.length;
  const out = Buffer.alloc(total);
  out.writeUInt32LE(GLB_MAGIC, 0);
  out.writeUInt32LE(2, 4);
  out.writeUInt32LE(total, 8);
  out.writeUInt32LE(jsonChunk.length, 12);
  out.writeUInt32LE(GLB_JSON, 16);
  jsonChunk.copy(out, 20);
  const binAt = 20 + jsonChunk.length;
  out.writeUInt32LE(binChunk.length, binAt);
  out.writeUInt32LE(GLB_BIN, binAt + 4);
  binChunk.copy(out, binAt + 8);
  writeFileSync(glbPath, out);
}

/** Write solved teeth viseme morphs. Existing targets with the same names are overwritten in place. */
export async function coupleFittedTeethToLipViseme(glbPath: string): Promise<TeethVisemeTarget[]> {
  const plan = await planTeethVisemeTargets(glbPath);
  if (plan.targets.length === 0) throw new Error(`no teeth viseme target was solved for ${glbPath}`);
  if (plan.targets.some((target) => target.name === "mouth-open")) {
    throw new Error("refusing to add a mouth-open teeth target");
  }

  const file = readFileSync(glbPath);
  if (file.readUInt32LE(0) !== GLB_MAGIC) throw new Error("not a glb");
  const jsonLength = file.readUInt32LE(12);
  if (file.readUInt32LE(16) !== GLB_JSON) throw new Error("missing JSON chunk");
  const json = JSON.parse(file.subarray(20, 20 + jsonLength).toString("utf8")) as GlbJson;
  const binHeader = 20 + jsonLength;
  if (file.readUInt32LE(binHeader + 4) !== GLB_BIN) throw new Error("missing BIN chunk");
  const binLength = json.buffers[0]?.byteLength;
  if (typeof binLength !== "number") throw new Error("missing buffer length");
  let bin = Buffer.from(file.subarray(binHeader + 8, binHeader + 8 + binLength));

  const teeth = json.meshes.find((mesh) => mesh.name === plan.teethName);
  const primitive = teeth?.primitives[0];
  if (!teeth || !primitive) throw new Error(`teeth mesh ${plan.teethName} missing from JSON`);
  const existing = teeth.extras?.targetNames ?? [];
  if (existing.some((name) => name.toLowerCase() === "mouth-open")) {
    throw new Error("refusing to keep a mouth-open teeth target");
  }
  const plannedNames = plan.targets.map((target) => target.name);
  for (const name of existing) {
    if (!plannedNames.includes(name)) throw new Error(`refusing to drop teeth target ${name}`);
  }
  const existingIndex = new Map(existing.map((name, index) => [name, index]));
  const targets: { POSITION: number }[] = [];
  for (const planned of plan.targets) {
    const values = planned.delta;
    if (values.length !== plan.teethCount * 3) throw new Error(`${planned.name} delta length ${values.length}`);
    const prior = existingIndex.get(planned.name);
    if (prior !== undefined) {
      const accessorIndex = primitive.targets?.[prior]?.POSITION;
      if (typeof accessorIndex !== "number") throw new Error(`missing POSITION on ${planned.name}`);
      writeTargetBytes(json, bin, accessorIndex, values, plan.teethCount);
      targets.push({ POSITION: accessorIndex });
    } else {
      const appended = appendTargetBytes(json, bin, values, plan.teethCount);
      // Buffer.concat's generic is wider than Buffer.from's. The bytes are the same buffer.
      bin = appended.bin as typeof bin;
      targets.push({ POSITION: appended.accessor });
    }
  }
  primitive.targets = targets;
  teeth.extras = { ...(teeth.extras ?? {}), targetNames: plannedNames };
  json.buffers[0]!.byteLength = bin.length;

  writeGlb(json, bin, glbPath);
  return plan.targets;
}

function planSummary(plan: Awaited<ReturnType<typeof planTeethVisemeTargets>>) {
  const mm = (value: number) => Math.round(value * 1e6) / 1e3;
  return {
    restUpperM: plan.restUpperM,
    restLowerM: plan.restLowerM,
    restUpperMm: mm(plan.restUpperM),
    restLowerMm: mm(plan.restLowerM),
    upperCount: plan.upperCount,
    lowerCount: plan.lowerCount,
    targets: plan.targets.map((target) => ({
      name: target.name,
      landmarkCount: target.landmarkCount,
      jawMm: target.jawDelta.map(mm),
      headMm: target.headDelta.map(mm),
      upperMm: mm(target.upperGapM),
      lowerMm: mm(target.lowerGapM),
    })),
  };
}

function measureSummary(measured: Awaited<ReturnType<typeof measureTeethVisemeGaps>>) {
  const mm = (value: number) => Math.round(value * 1e6) / 1e3;
  const rows = measured.rows.map((row) => ({
    name: row.name,
    jawFraction: row.jawFraction,
    jawOpenRadians: row.jawOpenRadians,
    teethTargetApplied: row.teethTargetApplied,
    landmarkCount: row.landmarkCount,
    upperM: row.upperM,
    lowerM: row.lowerM,
    upperMm: mm(row.upperM),
    lowerMm: mm(row.lowerM),
    shellMeanM: (row.upperM + row.lowerM) / 2,
    shellMeanMm: mm((row.upperM + row.lowerM) / 2),
  }));
  return {
    teethName: measured.teethName,
    teethTargets: measured.teethTargets,
    restUpperM: measured.restUpperM,
    restLowerM: measured.restLowerM,
    restUpperMm: mm(measured.restUpperM),
    restLowerMm: mm(measured.restLowerM),
    rows,
    openingMeanM: measured.openingMeanM,
    openingMeanMm: mm(measured.openingMeanM),
  };
}

async function main(): Promise<void> {
  const dry = process.argv.includes("--dry");
  const measure = process.argv.includes("--measure");
  const outFlag = process.argv.indexOf("--out");
  const outPath = outFlag >= 0 ? process.argv[outFlag + 1] : undefined;
  const glbPath = process.argv.slice(2).find((arg) => !arg.startsWith("--") && arg !== outPath);
  if (!glbPath) throw new Error("usage: couple-fitted-teeth-to-lip-viseme.ts <glb> [--dry|--measure] [--out file]");
  if (measure) {
    const measured = measureSummary(await measureTeethVisemeGaps(glbPath));
    const text = `${JSON.stringify(measured, null, 2)}\n`;
    if (outPath) writeFileSync(outPath, text);
    process.stdout.write(text);
    return;
  }
  if (dry) {
    const plan = await planTeethVisemeTargets(glbPath);
    process.stdout.write(`${JSON.stringify(planSummary(plan), null, 2)}\n`);
    return;
  }
  const targets = await coupleFittedTeethToLipViseme(glbPath);
  process.stdout.write(`${JSON.stringify({ glbPath, targets: targets.map((target) => target.name) }, null, 2)}\n`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  });
}
