import type { Object3D } from "three";
import { SkinnedMesh } from "three";

/** Rebind the lower half of a head-locked teeth mesh onto the jaw bone. */
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
