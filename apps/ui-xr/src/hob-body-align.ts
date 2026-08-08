/**
 * Supine body lift / head-align / plant hold (#150/#153/#171).
 * Split from supine-deck-plant.ts for the zone line budget.
 */

import { Box3, type Object3D } from "three";

/**
 * Raise the root if skinned world AABB minY is below deckTop + minClearance.
 * Prevents an inclined tip from leaving extremities 10cm+ through the seat plane
 * (same instrument family as #150's skinnedWorldAabb clearance).
 */
export function liftSupineBodyAboveDeck(
  humanoidRoot: Object3D,
  deckTopWorldY: number,
  minClearanceMeters = -0.02,
): number {
  humanoidRoot.updateMatrixWorld?.(true);
  humanoidRoot.traverse((object) => {
    const skinned = object as Object3D & {
      isSkinnedMesh?: boolean;
      skeleton?: { update?: () => void };
    };
    if (skinned.isSkinnedMesh) skinned.skeleton?.update?.();
  });
  const box = new Box3();
  let any = false;
  humanoidRoot.traverse((object) => {
    const skinned = object as Object3D & { isSkinnedMesh?: boolean };
    if (!skinned.isSkinnedMesh) return;
    const meshBox = new Box3().setFromObject(object);
    if (meshBox.isEmpty()) return;
    if (!any) {
      box.copy(meshBox);
      any = true;
    } else {
      box.union(meshBox);
    }
  });
  if (!any || !Number.isFinite(box.min.y)) return 0;
  const target = deckTopWorldY + minClearanceMeters;
  if (box.min.y >= target - 1e-4) return 0;
  const delta = target - box.min.y;
  humanoidRoot.position.y += delta;
  humanoidRoot.updateMatrixWorld?.(true);
  humanoidRoot.userData.openClinXrSupineSinkLiftMeters = delta;
  return delta;
}

/**
 * Shift root XZ so the head bone sits on the pillow rest point (staging, not anatomy).
 * Call after centerSupineBodyOnDeck; re-plant Y afterwards.
 */
export function alignSupineHeadToPillow(
  humanoidRoot: Object3D,
  pillowWorld: { x: number; z: number },
): { deltaX: number; deltaZ: number } {
  const full = alignSupineHeadToPillowWorld(humanoidRoot, {
    x: pillowWorld.x,
    y: readHeadWorld(humanoidRoot)?.y ?? 0,
    z: pillowWorld.z,
  });
  return { deltaX: full.deltaX, deltaZ: full.deltaZ };
}

/**
 * Match head bone to the live pillow in world XYZ (#171 inclined HOB).
 * XZ-only left the head ~0.3–0.4 m above a raised pillow after tip + sink lift.
 */
export function alignSupineHeadToPillowWorld(
  humanoidRoot: Object3D,
  pillowWorld: { x: number; y: number; z: number },
): { deltaX: number; deltaY: number; deltaZ: number } {
  return alignSupineHeadToPillowSoft(humanoidRoot, pillowWorld, 1);
}

/**
 * Head→pillow with optional Y blend. yBlend=1 is full XYZ; yBlend=0 is XZ-only.
 * Rigid whole-body tip cannot put head on pillow AND keep feet on the seat; blend trades both.
 */
export function alignSupineHeadToPillowSoft(
  humanoidRoot: Object3D,
  pillowWorld: { x: number; y: number; z: number },
  yBlend: number,
): { deltaX: number; deltaY: number; deltaZ: number } {
  const head = readHeadWorld(humanoidRoot);
  if (!head) return { deltaX: 0, deltaY: 0, deltaZ: 0 };
  const blend = Math.max(0, Math.min(1, yBlend));
  const deltaX = pillowWorld.x - head.x;
  const deltaY = (pillowWorld.y - head.y) * blend;
  const deltaZ = pillowWorld.z - head.z;
  if (Math.abs(deltaX) < 1e-4 && Math.abs(deltaY) < 1e-4 && Math.abs(deltaZ) < 1e-4) {
    return { deltaX: 0, deltaY: 0, deltaZ: 0 };
  }
  humanoidRoot.position.x += deltaX;
  humanoidRoot.position.y += deltaY;
  humanoidRoot.position.z += deltaZ;
  humanoidRoot.updateMatrixWorld?.(true);
  return { deltaX, deltaY, deltaZ };
}

function readHeadWorld(humanoidRoot: Object3D): { x: number; y: number; z: number } | null {
  humanoidRoot.updateMatrixWorld?.(true);
  let found: { x: number; y: number; z: number } | null = null;
  const consider = (object: Object3D) => {
    if (found) return;
    if (object.name !== "head" && object.name !== "Head") return;
    const isBone = (object as Object3D & { isBone?: boolean }).isBone === true
      || (object as Object3D & { type?: string }).type === "Bone";
    if (!isBone && object.name !== "head") return;
    object.updateWorldMatrix?.(true, false);
    const e = object.matrixWorld?.elements;
    if (!e) return;
    found = { x: e[12] ?? 0, y: e[13] ?? 0, z: e[14] ?? 0 };
  };
  humanoidRoot.traverse(consider);
  humanoidRoot.traverse((object) => {
    const skinned = object as Object3D & {
      isSkinnedMesh?: boolean;
      skeleton?: { bones: Object3D[]; update?: () => void };
    };
    if (!skinned.isSkinnedMesh || !skinned.skeleton?.bones) return;
    skinned.skeleton.update?.();
    for (const bone of skinned.skeleton.bones) consider(bone);
  });
  return found;
}

/**
 * Per-frame plant hold: restore base XZ/Y with mild breathing; root Z owned by applySupinePose.
 */
export function holdSupinePlantFrame(
  root: Object3D,
  base: { x: number; y: number; z: number; scaleX: number; scaleY: number; scaleZ: number },
  breathing: number,
): void {
  root.position.y = base.y + breathing * 0.006;
  root.position.x = base.x;
  root.position.z = base.z;
  root.scale.x = base.scaleX;
  root.scale.y = base.scaleY + breathing * 0.006;
  root.scale.z = base.scaleZ;
}

/**
 * Center the recumbent body on the stretcher XZ and nudge so the head end sits
 * toward the pillow (−X). Call after applySupinePose + plant Y.
 */
export function centerSupineBodyOnDeck(
  humanoidRoot: Object3D,
  deckCenter: { x: number; z: number },
): { deltaX: number; deltaZ: number } {
  humanoidRoot.updateMatrixWorld?.(true);
  let minX = Infinity;
  let maxX = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  let any = false;
  humanoidRoot.traverse((object) => {
    const skinned = object as Object3D & {
      isSkinnedMesh?: boolean;
      geometry?: {
        attributes?: {
          position?: { count: number; getX: (i: number) => number; getY: (i: number) => number; getZ: (i: number) => number };
        };
      };
      matrixWorld?: { elements: number[] };
    };
    if (!skinned.isSkinnedMesh || !skinned.geometry?.attributes?.position) return;
    const pos = skinned.geometry.attributes.position;
    const e = skinned.matrixWorld?.elements;
    if (!e) return;
    any = true;
    const stride = Math.max(1, Math.floor(pos.count / 2000));
    for (let i = 0; i < pos.count; i += stride) {
      const vx = pos.getX(i);
      const vy = pos.getY(i);
      const vz = pos.getZ(i);
      const w = 1 / (e[3] * vx + e[7] * vy + e[11] * vz + e[15] || 1);
      const wx = (e[0] * vx + e[4] * vy + e[8] * vz + e[12]) * w;
      const wz = (e[2] * vx + e[6] * vy + e[10] * vz + e[14]) * w;
      if (wx < minX) minX = wx;
      if (wx > maxX) maxX = wx;
      if (wz < minZ) minZ = wz;
      if (wz > maxZ) maxZ = wz;
    }
  });
  if (!any) return { deltaX: 0, deltaZ: 0 };
  const bodyCx = (minX + maxX) / 2;
  const bodyCz = (minZ + maxZ) / 2;
  const deltaX = deckCenter.x - bodyCx;
  const deltaZ = deckCenter.z - bodyCz;
  humanoidRoot.position.x += deltaX;
  humanoidRoot.position.z += deltaZ;
  humanoidRoot.updateMatrixWorld?.(true);
  return { deltaX, deltaZ };
}
