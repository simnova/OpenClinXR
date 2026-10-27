/** Garment-to-support correction via correct affine skin mapping.
 * world = matrixWorld * bindMatrixInverse * SUM(w_i * bone.matrixWorld * boneInverses[i]) * bindMatrix.
 * Magnitude-preserving: corrected WORLD POINT mapped through inverse(total) to local POSITION.
 * Clones geometry per mesh; baseline rest in WeakMap; recompute-from-rest each frame.
 */
import { Matrix4, type Object3D, type SkinnedMesh, Vector3 } from "three";

export type GarmentSupportPlane = {
  origin: Vector3;
  normal: Vector3;
  contains?: (world: Vector3) => boolean;
};

export type GarmentSupportResult = {
  mesh: string;
  correctedVertices: number;
  skippedOutsideFootprint: number;
  maxLiftMeters: number;
  status: "corrected" | "clear" | "infeasible";
  refusal?: string;
};

const BASELINE = new WeakMap<object, Float32Array>();
const CLONED = new WeakSet<object>();

export const GARMENT_PREFIX = "openclinxr_real_garment_";
export const GARMENT_TAG = "openclinxr:garment";
export const MAX_LIFT_METERS = 0.25;
export const MIN_GAP_METERS = 0.002;

function ensureCloned(mesh: SkinnedMesh): void {
  if (CLONED.has(mesh)) return;
  mesh.geometry = mesh.geometry.clone();
  CLONED.add(mesh);
}

function baseline(mesh: SkinnedMesh): Float32Array | null {
  const pos = mesh.geometry.getAttribute("position");
  if (!pos) return null;
  const hit = BASELINE.get(mesh);
  if (hit && hit.length === pos.count * 3) return hit;
  const rest = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i += 1) {
    rest[i * 3] = pos.getX(i); rest[i * 3 + 1] = pos.getY(i); rest[i * 3 + 2] = pos.getZ(i);
  }
  BASELINE.set(mesh, rest);
  return rest;
}

function restore(mesh: SkinnedMesh, rest: Float32Array): void {
  const pos = mesh.geometry.getAttribute("position");
  for (let i = 0; i < pos.count; i += 1) pos.setXYZ(i, rest[i * 3]!, rest[i * 3 + 1]!, rest[i * 3 + 2]!);
  pos.needsUpdate = true;
  mesh.geometry.computeVertexNormals();
  mesh.geometry.computeBoundingSphere();
  mesh.geometry.computeBoundingBox();
}

function correctionFinite(v: Vector3): boolean {
  return Number.isFinite(v.x) && Number.isFinite(v.y) && Number.isFinite(v.z) && v.length() < 10;
}

/** Independent oracle: actual Three skinned world position. */
export function skinnedWorldOracle(mesh: SkinnedMesh, index: number, out: Vector3): Vector3 {
  const m = mesh as SkinnedMesh & { getVertexPosition?: (i: number, t: Vector3) => Vector3 };
  if (typeof m.getVertexPosition !== "function") throw new Error("getVertexPosition unavailable");
  const local = new Vector3();
  m.getVertexPosition(index, local);
  return out.copy(local).applyMatrix4(mesh.matrixWorld);
}

/** Refuse any active position morph influence: the true field is mesh.morphTargetInfluences. */
function activeMorphRefusal(mesh: SkinnedMesh): string | null {
  const geo = mesh.geometry as unknown as {
    morphAttributes?: { position?: unknown[] };
    morphTargetsRelative?: boolean;
  };
  const positions = geo.morphAttributes?.position;
  if (Array.isArray(positions) && positions.length > 0) {
    const live = (mesh as unknown as { morphTargetInfluences?: unknown }).morphTargetInfluences;
    if (Array.isArray(live) && live.some((v) => typeof v === "number" && (Math.abs(v) > 1e-9 || !Number.isFinite(v)))) {
      return "active position morph influence unsupported; rest restored";
    }
  }
  const mat = (mesh as unknown as { material?: { morphTargets?: boolean; morphNormals?: boolean } }).material;
  void mat;
  return null;
}

/** Correct total skin matrix: M * bindMatrixInverse * S * bindMatrix, S = SUM(w * boneWorld * boneInverse).
 * R2: Three applies RAW skin weights (no normalization). Require finite nonnegative weights,
 * integer indices in [0, boneCount), and sum ≈ 1 (tolerance 1e-3: exporter quantization slack).
 * Any violation refuses; rest is restored by the caller. */
const SKIN_WEIGHT_SUM_TOLERANCE = 1e-3;
function totalMatrix(mesh: SkinnedMesh, index: number): Matrix4 | null {
  const skinIndex = mesh.geometry.getAttribute("skinIndex") as unknown as { getX(i: number): number; getY(i: number): number; getZ(i: number): number; getW(i: number): number } | undefined;
  const skinWeight = mesh.geometry.getAttribute("skinWeight") as unknown as { getX(i: number): number; getY(i: number): number; getZ(i: number): number; getW(i: number): number } | undefined;
  const skel = mesh.skeleton;
  if (!skinIndex || !skinWeight || !skel || !skel.boneInverses) return null;
  const boneCount = skel.bones.length;
  let wSum = 0;
  const w: number[] = [0, 0, 0, 0];
  const b: number[] = [0, 0, 0, 0];
  for (let lane = 0; lane < 4; lane += 1) {
    const wt = lane === 0 ? skinWeight.getX(index) : lane === 1 ? skinWeight.getY(index) : lane === 2 ? skinWeight.getZ(index) : skinWeight.getW(index);
    const raw = lane === 0 ? skinIndex.getX(index) : lane === 1 ? skinIndex.getY(index) : lane === 2 ? skinIndex.getZ(index) : skinIndex.getW(index);
    if (!Number.isFinite(wt) || wt < 0 || !Number.isFinite(raw) || !Number.isInteger(raw) || raw < 0 || raw >= boneCount) return null;
    w[lane] = wt; b[lane] = raw; wSum += wt;
  }
  if (!Number.isFinite(wSum) || Math.abs(wSum - 1) > SKIN_WEIGHT_SUM_TOLERANCE) return null;
  const acc = new Matrix4();
  let first = true;
  const term = new Matrix4();
  for (let lane = 0; lane < 4; lane += 1) {
    const weight = w[lane]!;
    if (weight === 0) continue;
    const bone = skel.bones[b[lane]!];
    const inv = skel.boneInverses[b[lane]!];
    if (!bone || !inv) return null;
    term.copy(inv).premultiply(bone.matrixWorld);
    term.multiplyScalar(weight);
    if (first) { acc.copy(term); first = false; }
    else for (let e = 0; e < 16; e += 1) acc.elements[e]! += term.elements[e]!;
  }
  if (first) return null;
  // total = M * bindMatrixInverse * acc * bindMatrix
  return new Matrix4().copy(mesh.bindMatrix).premultiply(acc).premultiply(mesh.bindMatrixInverse).premultiply(mesh.matrixWorld);
}

export function isGarmentMesh(o: Object3D): o is SkinnedMesh {
  if ((o as SkinnedMesh).isSkinnedMesh !== true) return false;
  if (typeof o.name === "string" && o.name.startsWith(GARMENT_PREFIX)) return true;
  const tag = (o as { userData?: Record<string, unknown> }).userData?.[GARMENT_TAG];
  return tag === true;
}

/** Shared per-actor garment registration: bed reference + finite planes. Rebuilt per frame. */
type GarmentRegistration = { bed: Object3D; planes: GarmentSupportPlane[]; buildPlanes?: (bed: Object3D) => GarmentSupportPlane[] };
const REGISTRY = new WeakMap<Object3D, GarmentRegistration>();

export function registerGarmentSupport(root: Object3D, bed: Object3D, planes: GarmentSupportPlane[], buildPlanes?: (bed: Object3D) => GarmentSupportPlane[]): void {
  REGISTRY.set(root, { bed, planes: planes.map((p) => ({ ...p, origin: p.origin.clone(), normal: p.normal.clone() })), ...(buildPlanes ? { buildPlanes } : {}) });
}

export function registeredGarmentSupport(root: Object3D): GarmentRegistration | undefined {
  return REGISTRY.get(root);
}

/** One-argument per-frame reapply: rebuilds current finite planes internally via stored factory. No-op unless registered. */
export function reapplyStoredGarmentSupport(root: Object3D): void {
  const reg = REGISTRY.get(root);
  if (!reg || !reg.buildPlanes) return;
  reapplyGarmentSupport(root, reg.buildPlanes);
}

/** Per-frame reapply: rebuild finite planes from CURRENT bed reference, then correct. */
export function reapplyGarmentSupport(root: Object3D, buildPlanes: (bed: Object3D) => GarmentSupportPlane[]): void {
  const reg = REGISTRY.get(root);
  if (!reg) return;
  const planes = buildPlanes(reg.bed);
  reg.planes = planes;
  root.updateMatrixWorld(true);
  root.traverse((object) => {
    if (isGarmentMesh(object)) correctGarmentAgainstSupport(object, planes);
  });
}

export function correctGarmentAgainstSupport(
  garment: SkinnedMesh,
  planes: GarmentSupportPlane[],
  options?: { minGapMeters?: number; maxLiftMeters?: number },
): GarmentSupportResult {
  const minGap = options?.minGapMeters ?? MIN_GAP_METERS;
  const maxLift = options?.maxLiftMeters ?? MAX_LIFT_METERS;
  const base: GarmentSupportResult = { mesh: garment.name, correctedVertices: 0, skippedOutsideFootprint: 0, maxLiftMeters: 0, status: "clear" };
  const position = garment.geometry.getAttribute("position");
  if (!position) return base;
  ensureCloned(garment);
  const rest = baseline(garment);
  if (!rest) return base;
  restore(garment, rest);
  garment.updateMatrixWorld(true);
  garment.skeleton?.update?.();
  const morphRefusal = activeMorphRefusal(garment);
  if (morphRefusal) return { ...base, status: "infeasible", refusal: morphRefusal };
  const mdet = new Matrix4().copy(garment.matrixWorld).determinant();
  if (!Number.isFinite(mdet) || Math.abs(mdet) < 1e-12) {
    return { ...base, status: "infeasible", refusal: "singular garment matrixWorld; rest restored" };
  }
  const world = new Vector3();
  const pending: Array<{ index: number; lift: number; plane: GarmentSupportPlane }> = [];
  for (let i = 0; i < position.count; i += 1) {
    try { skinnedWorldOracle(garment, i, world); } catch { return { ...base, status: "infeasible", refusal: "getVertexPosition unavailable; rest restored" }; }
    let matched = false;
    for (const plane of planes) {
      if (plane.contains && !plane.contains(world)) continue;
      matched = true;
      const gap = plane.normal.dot(world.clone().sub(plane.origin));
      if (gap < minGap) pending.push({ index: i, lift: minGap - gap, plane });
      break;
    }
    if (!matched) base.skippedOutsideFootprint += 1;
  }
  if (pending.length === 0) { garment.updateMatrixWorld(true); return base; }
  let worst = -Infinity;
  for (const p of pending) if (p.lift > worst) worst = p.lift;
  base.maxLiftMeters = worst;
  if (worst > maxLift) {
    restore(garment, rest);
    garment.updateMatrixWorld(true);
    return { ...base, status: "infeasible", refusal: `required lift ${worst.toFixed(4)} m exceeds budget ${maxLift.toFixed(4)} m; rest restored` };
  }
  const posAttr = garment.geometry.getAttribute("position");
  const tmp = new Vector3();
  for (const row of pending) {
    const total = totalMatrix(garment, row.index);
    if (!total) {
      restore(garment, rest);
      garment.updateMatrixWorld(true);
      return { ...base, status: "infeasible", refusal: `unsupported skin weights at vertex ${row.index}; rest restored` };
    }
    const det = total.determinant();
    if (!Number.isFinite(det) || Math.abs(det) < 1e-12) {
      restore(garment, rest);
      garment.updateMatrixWorld(true);
      return { ...base, status: "infeasible", refusal: `singular skin transform at vertex ${row.index}; rest restored` };
    }
    skinnedWorldOracle(garment, row.index, tmp);
    const target = tmp.addScaledVector(row.plane.normal, row.lift);
    total.invert();
    // applyMatrix4 on a POSITION preserves magnitude; never transformDirection a displacement.
    const local = target.applyMatrix4(total);
    if (!correctionFinite(local)) {
      restore(garment, rest);
      garment.updateMatrixWorld(true);
      return { ...base, status: "infeasible", refusal: `non-finite correction at vertex ${row.index}; rest restored` };
    }
    posAttr.setXYZ(row.index, local.x, local.y, local.z);
  }
  posAttr.needsUpdate = true;
  garment.updateMatrixWorld(true);
  garment.geometry.computeVertexNormals();
  garment.geometry.computeBoundingSphere();
  garment.geometry.computeBoundingBox();
  return { ...base, correctedVertices: pending.length, status: "corrected" };
}
