/**
 * Runtime humanoid load guard (#67).
 *
 * A generator fix with no consumer is this project's most repeated failure class.
 * After load, refuse a humanoid whose armature root carries a non-identity rotation
 * (the #58 leftover +90° X that hung six of seven shipped assets head-down).
 *
 * claimScope: armature root rotation identity only.
 * notEvidenceFor: face/garment quality, clinical validity, production readiness.
 */

import type { Object3D } from "three";
import { SkinnedMesh } from "three";

export const CANONICAL_HUMANOID_ARMATURE_NAME = "openclinxr_canonical_humanoid_armature";

const IDENTITY_EPS = 1e-3;

type QuatLike = { x: number; y: number; z: number; w: number };

type NodeLike = {
  name?: string;
  quaternion?: QuatLike;
  children?: readonly NodeLike[];
};

function isIdentityQuat(q: QuatLike, eps = IDENTITY_EPS): boolean {
  return (
    Math.abs(q.x) < eps &&
    Math.abs(q.y) < eps &&
    Math.abs(q.z) < eps &&
    Math.abs(Math.abs(q.w) - 1) < eps
  );
}

function findArmatureRoot(node: NodeLike): NodeLike | null {
  const name = node.name ?? "";
  if (
    name === CANONICAL_HUMANOID_ARMATURE_NAME ||
    name.includes("canonical_humanoid_armature")
  ) {
    return node;
  }
  for (const child of node.children ?? []) {
    const found = findArmatureRoot(child);
    if (found) return found;
  }
  return null;
}

/**
 * Throw if the loaded humanoid scene has an armature root whose quaternion is
 * not identity. Call after GLTFLoader resolves, before the figure is shown.
 */
export function assertHumanoidRootUpright(scene: unknown): void {
  if (scene == null || typeof scene !== "object") {
    throw new Error("assertHumanoidRootUpright: scene is missing");
  }
  const root = scene as NodeLike;
  const arm = findArmatureRoot(root);
  if (!arm) {
    // No canonical armature — nothing to refuse. Neutral/variant assets may not
    // carry this name; the guard is specific to the factory humanoid path.
    return;
  }
  const q = arm.quaternion;
  if (!q || typeof q.x !== "number") {
    throw new Error(
      `assertHumanoidRootUpright: armature "${arm.name ?? "?"}" has no quaternion`,
    );
  }
  if (!isIdentityQuat(q)) {
    throw new Error(
      `assertHumanoidRootUpright: armature root rotation is not identity ` +
        `(got ${q.x.toFixed(4)},${q.y.toFixed(4)},${q.z.toFixed(4)},${q.w.toFixed(4)}); ` +
        `refusing #58-class off-axis humanoid (see issue #67)`,
    );
  }
}

/**
 * Rebind the lower half of a head-locked teeth mesh onto the jaw bone.
 * Upper half stays on head. Lab-side twin of the xr-asset-loading rebind
 * (kept local: xr-asset-loading already depends on xr-scene).
 */
export function rebindHeadLockedTeeth(root: Object3D): void {
  const meshes: SkinnedMesh[] = [];
  root.traverse((o) => {
    if (o instanceof SkinnedMesh && /teeth/i.test(o.name)) meshes.push(o);
  });
  for (const mesh of meshes) {
    const skeleton = mesh.skeleton;
    if (!skeleton) continue;
    const jawIndex = skeleton.bones.findIndex((b) => /^jaw$/i.test(b.name ?? ""));
    if (jawIndex < 0) continue;
    const skinIndex = mesh.geometry.attributes.skinIndex;
    const skinWeight = mesh.geometry.attributes.skinWeight;
    const position = mesh.geometry.attributes.position;
    if (!skinIndex || !skinWeight || !position) continue;
    let alreadyJaw = false;
    for (let v = 0; v < position.count; v++) {
      let bi = skinIndex.getX(v);
      let bw = skinWeight.getX(v);
      if (skinWeight.getY(v) > bw) { bi = skinIndex.getY(v); bw = skinWeight.getY(v); }
      if (skinWeight.getZ(v) > bw) { bi = skinIndex.getZ(v); bw = skinWeight.getZ(v); }
      if (skinWeight.getW(v) > bw) { bi = skinIndex.getW(v); }
      if (skeleton.bones[bi] && /^jaw$/i.test(skeleton.bones[bi]!.name ?? "")) {
        alreadyJaw = true;
        break;
      }
    }
    if (alreadyJaw) continue;
    const ys: number[] = [];
    for (let v = 0; v < position.count; v++) ys.push(position.getY(v));
    const sorted = [...ys].sort((a, b) => a - b);
    const median = sorted[Math.floor(sorted.length / 2)]!;
    for (let v = 0; v < position.count; v++) {
      if (position.getY(v) < median) {
        skinIndex.setXYZW(v, jawIndex, 0, 0, 0);
        skinWeight.setXYZW(v, 1, 0, 0, 0);
      }
    }
    skinIndex.needsUpdate = true;
    skinWeight.needsUpdate = true;
  }
}
