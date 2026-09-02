/**
 * Shared HOB / seat contact metrics (#159/#171).
 * Used by plant (settle + step table) and articulating-hob-measure (contracts).
 *
 * claimScope: staging geometry gaps only.
 * notEvidenceFor: clinical positioning, multi-joint bed fidelity.
 */

import { Box3, type Object3D, Vector3 } from "three";
import { STRETCHER_DECK_TOP_METERS } from "./station-stretcher.js";

/**
 * Signed gap: body back surface vs back-section top plane.
 * Positive = floating above deck; negative = penetrating.
 * Instrument matches #159 land (4e5d520) — bind verts × matrixWorld with skeleton update.
 */
export function measureBackToDeckGap(humanoid: Object3D, stretcher: Object3D): number {
  stretcher.updateMatrixWorld(true);
  humanoid.updateMatrixWorld(true);

  const { origin, normal } = readBackSectionPlane(stretcher);

  let minSigned: number | null = null;
  humanoid.traverse((object) => {
    const skinned = object as Object3D & {
      isSkinnedMesh?: boolean;
      geometry?: {
        attributes?: {
          position?: {
            count: number;
            getX: (i: number) => number;
            getY: (i: number) => number;
            getZ: (i: number) => number;
          };
        };
      };
      matrixWorld?: { elements: number[] };
      skeleton?: { update?: () => void };
    };
    if (!skinned.isSkinnedMesh || !skinned.geometry?.attributes?.position) return;
    skinned.skeleton?.update?.();
    const pos = skinned.geometry.attributes.position;
    const e = skinned.matrixWorld?.elements;
    if (!e) return;
    const stride = Math.max(1, Math.floor(pos.count / 2500));
    for (let i = 0; i < pos.count; i += stride) {
      const vx = pos.getX(i);
      const vy = pos.getY(i);
      const vz = pos.getZ(i);
      const w = 1 / (e[3] * vx + e[7] * vy + e[11] * vz + e[15] || 1);
      const wx = (e[0] * vx + e[4] * vy + e[8] * vz + e[12]) * w;
      const wy = (e[1] * vx + e[5] * vy + e[9] * vz + e[13]) * w;
      const wz = (e[2] * vx + e[6] * vy + e[10] * vz + e[14]) * w;
      if (wx > 0.15) continue;
      if (Math.abs(wz) > 0.35) continue;
      const signed = normal.dot(new Vector3(wx - origin.x, wy - origin.y, wz - origin.z));
      if (minSigned === null || signed < minSigned) minSigned = signed;
    }
  });
  return minSigned ?? 0;
}

export function measurePelvisOnSeat(humanoid: Object3D, seatTopY: number): boolean {
  humanoid.updateMatrixWorld(true);
  let pelvisY: number | null = null;
  const consider = (object: Object3D) => {
    if (pelvisY !== null) return;
    if (!/^(pelvis|hips)$/i.test(object.name ?? "")) return;
    const isBone = (object as Object3D & { isBone?: boolean }).isBone === true
      || (object as Object3D & { type?: string }).type === "Bone";
    if (!isBone) return;
    object.updateWorldMatrix?.(true, false);
    pelvisY = object.matrixWorld.elements[13] ?? null;
  };
  humanoid.traverse(consider);
  humanoid.traverse((object) => {
    const skinned = object as Object3D & {
      isSkinnedMesh?: boolean;
      skeleton?: { bones: Object3D[]; update?: () => void };
    };
    if (!skinned.isSkinnedMesh || !skinned.skeleton?.bones) return;
    for (const bone of skinned.skeleton.bones) consider(bone);
  });
  if (pelvisY === null) return false;
  const clearance = pelvisY - seatTopY;
  return clearance > 0.05 && clearance < 0.55;
}

/** Apply 4×4 column-major mat to point (w=1). */
function mulMat4Point(
  e: ArrayLike<number>,
  x: number,
  y: number,
  z: number,
): [number, number, number] {
  // Non-null: Matrix4.elements is a length-16 Float32Array (same pattern as mulMat4 below).
  const w = e[3]! * x + e[7]! * y + e[11]! * z + e[15]! || 1;
  return [
    (e[0]! * x + e[4]! * y + e[8]! * z + e[12]!) / w,
    (e[1]! * x + e[5]! * y + e[9]! * z + e[13]!) / w,
    (e[2]! * x + e[6]! * y + e[10]! * z + e[14]!) / w,
  ];
}

function mulMat4(a: ArrayLike<number>, b: ArrayLike<number>): number[] {
  const te = new Array<number>(16);
  const a11 = a[0]!, a12 = a[4]!, a13 = a[8]!, a14 = a[12]!;
  const a21 = a[1]!, a22 = a[5]!, a23 = a[9]!, a24 = a[13]!;
  const a31 = a[2]!, a32 = a[6]!, a33 = a[10]!, a34 = a[14]!;
  const a41 = a[3]!, a42 = a[7]!, a43 = a[11]!, a44 = a[15]!;
  const b11 = b[0]!, b12 = b[4]!, b13 = b[8]!, b14 = b[12]!;
  const b21 = b[1]!, b22 = b[5]!, b23 = b[9]!, b24 = b[13]!;
  const b31 = b[2]!, b32 = b[6]!, b33 = b[10]!, b34 = b[14]!;
  const b41 = b[3]!, b42 = b[7]!, b43 = b[11]!, b44 = b[15]!;
  te[0] = a11 * b11 + a12 * b21 + a13 * b31 + a14 * b41;
  te[4] = a11 * b12 + a12 * b22 + a13 * b32 + a14 * b42;
  te[8] = a11 * b13 + a12 * b23 + a13 * b33 + a14 * b43;
  te[12] = a11 * b14 + a12 * b24 + a13 * b34 + a14 * b44;
  te[1] = a21 * b11 + a22 * b21 + a23 * b31 + a24 * b41;
  te[5] = a21 * b12 + a22 * b22 + a23 * b32 + a24 * b42;
  te[9] = a21 * b13 + a22 * b23 + a23 * b33 + a24 * b43;
  te[13] = a21 * b14 + a22 * b24 + a23 * b34 + a24 * b44;
  te[2] = a31 * b11 + a32 * b21 + a33 * b31 + a34 * b41;
  te[6] = a31 * b12 + a32 * b22 + a33 * b32 + a34 * b42;
  te[10] = a31 * b13 + a32 * b23 + a33 * b33 + a34 * b43;
  te[14] = a31 * b14 + a32 * b24 + a33 * b34 + a34 * b44;
  te[3] = a41 * b11 + a42 * b21 + a43 * b31 + a44 * b41;
  te[7] = a41 * b12 + a42 * b22 + a43 * b32 + a44 * b42;
  te[11] = a41 * b13 + a42 * b23 + a43 * b33 + a44 * b43;
  te[15] = a41 * b14 + a42 * b24 + a43 * b34 + a44 * b44;
  return te;
}

/**
 * Seat-plane clearance via true skinned verts (#150 skinnedWorldAabb family).
 * Bind verts × matrixWorld alone ignore bone flex — knee/hip flex looked like a no-op.
 *
 * `sampleDivisor` matches the contract instrument density (supine-patient-on-deck.ts uses
 * count/4000; the plant's lift/flex logic uses count/3000). The #620 float settle passes 4000
 * so it lands the body where the CONTRACT reads it, not where a coarser sample does.
 */
export function measureSeatClearanceMeters(
  humanoid: Object3D,
  deckTopY: number,
  sampleDivisor = 3000,
): number {
  humanoid.updateMatrixWorld(true);
  let minY: number | null = null;
  humanoid.traverse((object) => {
    const mesh = object as Object3D & {
      isSkinnedMesh?: boolean;
      geometry?: {
        attributes?: {
          position?: {
            count: number;
            getX: (i: number) => number;
            getY: (i: number) => number;
            getZ: (i: number) => number;
          };
          skinIndex?: {
            getX: (i: number) => number;
            getY: (i: number) => number;
            getZ: (i: number) => number;
            getW?: (i: number) => number;
          };
          skinWeight?: {
            getX: (i: number) => number;
            getY: (i: number) => number;
            getZ: (i: number) => number;
            getW?: (i: number) => number;
          };
        };
      };
      matrixWorld?: { elements: number[] };
      skeleton?: {
        update?: () => void;
        bones: Array<Object3D & { matrixWorld?: { elements: number[] } }>;
        boneInverses: Array<{ elements: number[] }>;
      };
      bindMatrix?: { elements: number[] };
      bindMatrixInverse?: { elements: number[] };
    };
    if (!mesh.isSkinnedMesh || !mesh.geometry?.attributes?.position) return;
    mesh.skeleton?.update?.();
    const pos = mesh.geometry.attributes.position;
    const skinIndex = mesh.geometry.attributes.skinIndex;
    const skinWeight = mesh.geometry.attributes.skinWeight;
    const skeleton = mesh.skeleton;
    const bindMatrix = mesh.bindMatrix?.elements;
    const bindMatrixInverse = mesh.bindMatrixInverse?.elements;
    const meshMw = mesh.matrixWorld?.elements;
    if (!meshMw) return;
    const stride = Math.max(1, Math.floor(pos.count / sampleDivisor));
    const useSkin =
      Boolean(skinIndex && skinWeight && skeleton?.bones?.length && bindMatrix && bindMatrixInverse);

    for (let i = 0; i < pos.count; i += stride) {
      const vx = pos.getX(i);
      const vy = pos.getY(i);
      const vz = pos.getZ(i);
      let wy: number;
      if (useSkin && skinIndex && skinWeight && skeleton && bindMatrix && bindMatrixInverse) {
        const bound = mulMat4Point(bindMatrix, vx, vy, vz);
        let sx = 0;
        let sy = 0;
        let sz = 0;
        let wSum = 0;
        for (let k = 0; k < 4; k += 1) {
          const weight =
            k === 0 ? skinWeight.getX(i)
              : k === 1 ? skinWeight.getY(i)
                : k === 2 ? skinWeight.getZ(i)
                  : (skinWeight.getW?.(i) ?? 0);
          if (weight === 0) continue;
          const boneIdx =
            k === 0 ? skinIndex.getX(i)
              : k === 1 ? skinIndex.getY(i)
                : k === 2 ? skinIndex.getZ(i)
                  : (skinIndex.getW?.(i) ?? 0);
          const bone = skeleton.bones[boneIdx];
          const inv = skeleton.boneInverses[boneIdx];
          if (!bone?.matrixWorld?.elements || !inv?.elements) continue;
          const boneMat = mulMat4(bone.matrixWorld.elements, inv.elements);
          const p = mulMat4Point(boneMat, bound[0], bound[1], bound[2]);
          sx += p[0] * weight;
          sy += p[1] * weight;
          sz += p[2] * weight;
          wSum += weight;
        }
        if (wSum < 1e-6) {
          wy = mulMat4Point(meshMw, vx, vy, vz)[1];
        } else {
          const invP = mulMat4Point(bindMatrixInverse, sx, sy, sz);
          wy = mulMat4Point(meshMw, invP[0], invP[1], invP[2])[1];
        }
      } else {
        wy = mulMat4Point(meshMw, vx, vy, vz)[1];
      }
      if (minY === null || wy < minY) minY = wy;
    }
  });
  if (minY === null) return 0;
  return minY - deckTopY;
}

/**
 * Close back-plane float by sliding in XZ only (pelvis Y / seat plant preserved).
 * Full normal settle sinks the body by n_y·gap and reopens the seat penetration trade.
 * At incline θ, n_x ≈ sin(θ): δx = −gap/n_x zeros the gap without moving Y.
 * Returns residual gap after the slide (near target when |n_x| is usable).
 */
export function settleSupineOntoBackSectionPreservingSeat(
  humanoidRoot: Object3D,
  stretcher: Object3D,
  targetGapMeters = 0.02,
): number {
  let totalDx = 0;
  for (let pass = 0; pass < 5; pass += 1) {
    const gap = measureBackToDeckGap(humanoidRoot, stretcher);
    const excess = gap - targetGapMeters;
    if (!Number.isFinite(excess) || Math.abs(excess) < 1e-4) break;
    const { normal } = readBackSectionPlane(stretcher);
    const nx = normal.x;
    // Near-flat: horizontal component vanishes — leave residual for spine flex (#181).
    if (Math.abs(nx) < 0.12) break;
    const dx = -excess / nx;
    // Bound a single pass so head-align cannot shoot the figure off the stretcher.
    const clamped = Math.max(-0.35, Math.min(0.35, dx));
    humanoidRoot.position.x += clamped;
    totalDx += clamped;
    humanoidRoot.updateMatrixWorld?.(true);
  }
  humanoidRoot.userData.openClinXrSupineBackSettleDx = totalDx;
  return measureBackToDeckGap(humanoidRoot, stretcher);
}

export function measureHeadPillowGapMeters(
  humanoid: Object3D,
  pillowWorld: { x: number; y: number; z: number } | null,
): { dist: number; dx: number; dy: number; dz: number } | null {
  if (!pillowWorld) return null;
  humanoid.updateMatrixWorld(true);
  let headX: number | null = null;
  let headY: number | null = null;
  let headZ: number | null = null;
  const consider = (object: Object3D) => {
    if (headX !== null) return;
    if (object.name !== "head" && object.name !== "Head") return;
    const isBone = (object as Object3D & { isBone?: boolean }).isBone === true
      || (object as Object3D & { type?: string }).type === "Bone";
    if (!isBone && object.name !== "head") return;
    object.updateWorldMatrix?.(true, false);
    const e = object.matrixWorld?.elements;
    if (!e) return;
    headX = e[12] ?? 0;
    headY = e[13] ?? 0;
    headZ = e[14] ?? 0;
  };
  humanoid.traverse(consider);
  humanoid.traverse((object) => {
    const skinned = object as Object3D & {
      isSkinnedMesh?: boolean;
      skeleton?: { bones: Object3D[]; update?: () => void };
    };
    if (!skinned.isSkinnedMesh || !skinned.skeleton?.bones) return;
    skinned.skeleton.update?.();
    for (const bone of skinned.skeleton.bones) consider(bone);
  });
  if (headX === null || headY === null || headZ === null) return null;
  const dx = headX - pillowWorld.x;
  const dy = headY - pillowWorld.y;
  const dz = headZ - pillowWorld.z;
  return { dist: Math.hypot(dx, dy, dz), dx, dy, dz };
}

/** World normal of the back section top (outward from mattress). */
export function readBackSectionPlane(stretcher: Object3D): {
  origin: Vector3;
  normal: Vector3;
} {
  stretcher.updateMatrixWorld(true);
  const found: Object3D[] = [];
  stretcher.traverse((obj) => {
    if (obj.userData?.openClinXrDeckSection === "back") found.push(obj);
  });
  const backPivot = found[0];
  if (!backPivot) {
    return {
      origin: new Vector3(0, STRETCHER_DECK_TOP_METERS, 0),
      normal: new Vector3(0, 1, 0),
    };
  }
  backPivot.updateWorldMatrix?.(true, false);
  const origin = new Vector3().setFromMatrixPosition(backPivot.matrixWorld);
  const e = backPivot.matrixWorld.elements;
  const normal = new Vector3(e[4], e[5], e[6]).normalize();
  return { origin, normal };
}

/**
 * Translate the body along the back-section normal so the mesh rests on the raised mattress.
 * Positive gap = floating; move opposite the outward normal.
 */
export function settleSupineOntoBackSection(
  humanoidRoot: Object3D,
  stretcher: Object3D,
  targetGapMeters = 0.02,
): number {
  // Multi-pass half-steps avoid overshoot (single full correction sank into the deck).
  let total = 0;
  for (let pass = 0; pass < 4; pass += 1) {
    const gap = measureBackToDeckGap(humanoidRoot, stretcher);
    const delta = (gap - targetGapMeters) * 0.55;
    if (!Number.isFinite(delta) || Math.abs(delta) < 1e-4) break;
    const { normal } = readBackSectionPlane(stretcher);
    humanoidRoot.position.x -= normal.x * delta;
    humanoidRoot.position.y -= normal.y * delta;
    humanoidRoot.position.z -= normal.z * delta;
    humanoidRoot.updateMatrixWorld?.(true);
    total += delta;
  }
  humanoidRoot.userData.openClinXrSupineBackSettleMeters = total;
  return total;
}
