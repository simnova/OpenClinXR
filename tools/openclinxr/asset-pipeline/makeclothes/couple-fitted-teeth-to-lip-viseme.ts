/**
 * Couple a fitted-teeth primitive to the body viseme targets.
 *
 * For each body `viseme_*` target whose lower-lip landmark has at least 20
 * vertices, write one POSITION morph on the teeth primitive. An opening viseme
 * (the shipped applier's jaw aperture for that name is above zero) gets one
 * rigid translation of the jaw-weighted vertices and one rigid translation of
 * the head-weighted vertices. The translations are solved so that, after the
 * jaw rotation `applyJawOpenToRoot` applies for that viseme, each front shell's
 * mean distance to the nearest body vertex is between 0.5 mm and 2 mm, with
 * the lip still in front of the crowns (+Z). A closed viseme (jaw aperture 0,
 * including viseme_PP) writes zeros — a rest-pose shove of the base mesh is
 * not the fix. No `mouth-open` target is added. Skin weights are not changed.
 *
 * Front shell: |x| <= 0.012, clear of the teeth median by 6 mm, and within
 * 4 mm of that row's max z, on the base POSITION accessor.
 *
 * Landmark, measured on the parent body primitive 0 before this morph existed:
 * |x| <= 0.03, y in [1.448, 1.488], morph delta y < -2 mm, and the dominant
 * joint is `jaw` or a descendant of `jaw`. The landmark only decides which
 * visemes get a target. It is not the translation.
 *
 * Run: pnpm exec tsx tools/openclinxr/asset-pipeline/makeclothes/couple-fitted-teeth-to-lip-viseme.ts <glb> [--dry]
 */
import { readFileSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { NodeIO, type Node as GltfNode } from "@gltf-transform/core";
import { Bone, BufferAttribute, BufferGeometry, Group, Matrix4, Skeleton, SkinnedMesh, Vector3 } from "three";
import { applyVisemeWeights, type MorphTargetLike } from "../../../../packages/openclinxr/xr-dialogue/src/viseme-morph-apply.ts";
import { applyJawOpenToRoot } from "../../../../packages/openclinxr/xr-dialogue/src/viseme-runtime-wire.ts";
import { jawOpenRadiansForPhoneme } from "../../../../packages/openclinxr/xr-dialogue/src/viseme-timeline-drive.ts";

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
  // The jaw hinge swings crowns back by about 15 mm. A 1 mm lattice over that
  // volume finds the basin; the finer lattice below pulls the mean into band.
  for (let z = -0.002; z <= 0.018; z += 0.001) {
    for (let y = -0.02; y <= 0.006; y += 0.001) {
      for (let x = -0.008; x <= 0.008; x += 0.001) {
        remember(teethWorld, shell, grid, [x, y, z], best);
      }
    }
  }
  considerOffsets(teethWorld, shell, grid, best.offset, 0.00025, 0.002, best);
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
  jawDelta: Vec3;
  headDelta: Vec3;
  /** Front-shell gaps after the solved deltas and the shipped jaw rotation, metres. */
  upperGapM: number;
  lowerGapM: number;
};

type Pose = {
  root: Group;
  teethPos: Float32Array;
  teethJoints: ArrayLike<number>;
  teethWeights: ArrayLike<number>;
  teethSkeleton: Skeleton;
  bodyPos: Float32Array;
  bodyJoints: ArrayLike<number>;
  bodyWeights: ArrayLike<number>;
  bodyTargets: Float32Array[];
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
    return { positions, jointArray, weightArray, targets, skinned, skeleton, jointNodes };
  };

  const teeth = attach(/fitted_teeth/i);
  const body = attach(/_body$/i);
  return {
    root,
    teethPos: teeth.positions,
    teethJoints: teeth.jointArray,
    teethWeights: teeth.weightArray,
    teethSkeleton: teeth.skeleton,
    bodyPos: body.positions,
    bodyJoints: body.jointArray,
    bodyWeights: body.weightArray,
    bodyTargets: body.targets,
    bodySkinned: body.skinned,
    bodySkeleton: body.skeleton,
    jointNodes: body.jointNodes,
  };
}

function groupsDelta(
  base: Float32Array,
  jawWeighted: readonly number[],
  jawDelta: Vec3,
  headWeighted: readonly number[],
  headDelta: Vec3,
): Float32Array {
  const out = new Float32Array(base);
  for (const vertex of jawWeighted) {
    out[vertex * 3] = (out[vertex * 3] ?? 0) + jawDelta[0];
    out[vertex * 3 + 1] = (out[vertex * 3 + 1] ?? 0) + jawDelta[1];
    out[vertex * 3 + 2] = (out[vertex * 3 + 2] ?? 0) + jawDelta[2];
  }
  for (const vertex of headWeighted) {
    out[vertex * 3] = (out[vertex * 3] ?? 0) + headDelta[0];
    out[vertex * 3 + 1] = (out[vertex * 3 + 1] ?? 0) + headDelta[1];
    out[vertex * 3 + 2] = (out[vertex * 3 + 2] ?? 0) + headDelta[2];
  }
  return out;
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
): { jawDelta: Vec3; headDelta: Vec3; upperGapM: number; lowerGapM: number } {
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
  const posed = skinMesh(
    groupsDelta(pose.teethPos, jawWeighted, jawDelta, headWeighted, headDelta),
    pose.teethJoints,
    pose.teethWeights,
    teethMats,
  );
  const upper = frontShellMeanGap(posed, shells.upper, bodyWorld);
  const lower = frontShellMeanGap(posed, shells.lower, bodyWorld);
  if (!gapInBand(upper) || !gapInBand(lower)) {
    throw new Error(
      `${viseme} skinned front shells stayed at ${(upper.meanM * 1000).toFixed(2)} mm upper / ${(lower.meanM * 1000).toFixed(2)} mm lower`,
    );
  }
  return { jawDelta, headDelta, upperGapM: upper.meanM, lowerGapM: lower.meanM };
}

/** Rigid head and jaw translations for every body viseme whose landmark is large enough. */
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
    if (landmark.length < LOWER_LIP_MIN_VERTS) continue;
    const jawRadians = jawOpenRadiansForPhoneme(name.replace(/^viseme_/i, ""));
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
        upperGapM: frontShellMeanGap(teethWorld, shells.upper, bodyWorld).meanM,
        lowerGapM: frontShellMeanGap(teethWorld, shells.lower, bodyWorld).meanM,
      });
      continue;
    }
    const solved = solveShells(pose, jawWeighted, headWeighted, shells, jawRadians, name, jawIndex, headIndex);
    targets.push({ name, landmarkCount: landmark.length, ...solved });
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

function teethDelta(
  count: number,
  jawWeighted: readonly number[],
  jawDelta: Vec3,
  headWeighted: readonly number[],
  headDelta: Vec3,
): Float32Array {
  const out = new Float32Array(count * 3);
  for (const vertex of jawWeighted) {
    out[vertex * 3] = jawDelta[0];
    out[vertex * 3 + 1] = jawDelta[1];
    out[vertex * 3 + 2] = jawDelta[2];
  }
  for (const vertex of headWeighted) {
    out[vertex * 3] = headDelta[0];
    out[vertex * 3 + 1] = headDelta[1];
    out[vertex * 3 + 2] = headDelta[2];
  }
  return out;
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
  if (plan.targets.length === 0) throw new Error(`no viseme landmark cleared ${LOWER_LIP_MIN_VERTS} verts in ${glbPath}`);
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
  if (existing.some((name) => name.toLowerCase().startsWith("viseme_"))) {
    if (existing.length !== plannedNames.length || existing.some((name, index) => name !== plannedNames[index])) {
      throw new Error(`refusing to rewrite ${plan.teethName}: target names differ from the plan`);
    }
    for (let index = 0; index < plan.targets.length; index += 1) {
      const planned = plan.targets[index]!;
      const accessorIndex = primitive.targets?.[index]?.POSITION;
      if (typeof accessorIndex !== "number") throw new Error(`missing POSITION on ${planned.name}`);
      writeTargetBytes(
        json,
        bin,
        accessorIndex,
        teethDelta(plan.teethCount, plan.jawWeighted, planned.jawDelta, plan.headWeighted, planned.headDelta),
        plan.teethCount,
      );
    }
  } else {
    if (bin.length % 4 !== 0) bin = Buffer.concat([bin, Buffer.alloc(4 - (bin.length % 4))]);
    const targets: { POSITION: number }[] = [];
    for (const planned of plan.targets) {
      const values = teethDelta(plan.teethCount, plan.jawWeighted, planned.jawDelta, plan.headWeighted, planned.headDelta);
      const bytes = Buffer.from(values.buffer, values.byteOffset, values.byteLength);
      const { min, max } = bounds(values);
      const view = json.bufferViews.length;
      json.bufferViews.push({ buffer: 0, byteOffset: bin.length, byteLength: bytes.length, target: ARRAY_BUFFER });
      const accessor = json.accessors.length;
      json.accessors.push({
        bufferView: view,
        byteOffset: 0,
        componentType: FLOAT,
        count: plan.teethCount,
        type: "VEC3",
        min,
        max,
      });
      targets.push({ POSITION: accessor });
      bin = Buffer.concat([bin, bytes]);
    }
    primitive.targets = targets;
    teeth.extras = { ...(teeth.extras ?? {}), targetNames: plannedNames };
    json.buffers[0]!.byteLength = bin.length;
  }

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

async function main(): Promise<void> {
  const dry = process.argv.includes("--dry");
  const glbPath = process.argv.slice(2).find((arg) => !arg.startsWith("--"));
  if (!glbPath) throw new Error("usage: couple-fitted-teeth-to-lip-viseme.ts <glb> [--dry]");
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
