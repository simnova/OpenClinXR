/**
 * Body close-up focus derivations for isolated-subject-lab (st-vitbody r4).
 *
 * Extracted from isolated-subject-focus.ts when the forearm/neck-close kinds
 * pushed it over the zone budget — a pure move, no behaviour change. The
 * caller (resolveFocus) derives the head box and passes it in, so this module
 * imports nothing from its parent: no cycle.
 *
 * Both derivations read the ASSET at runtime (dominant skinning joints — the
 * same joint sets as the S1 texel probe and the B-mask carrier stage). Never
 * literal coordinates (D1). Unresolvable focus THROWS; the station never
 * degrades silently.
 */

import type { Object3D } from "three";
import { Box3, SkinnedMesh, Vector3 } from "three";

/** Lowerarm bones (dominant-joint match; raw GLB names via userData.name). */
const FOREARM_JOINT_RE = /^lowerarm/i;

function dominantJointName(object: SkinnedMesh, vertexIndex: number): string {
  const skeleton = object.skeleton;
  const skinIndex = object.geometry.getAttribute("skinIndex") as unknown as {
    getX(i: number): number; getY(i: number): number; getZ(i: number): number; getW(i: number): number;
  } | null;
  const skinWeight = object.geometry.getAttribute("skinWeight") as unknown as {
    getX(i: number): number; getY(i: number): number; getZ(i: number): number; getW(i: number): number;
  } | null;
  if (!skeleton || !skinIndex || !skinWeight) return "";
  const bones = skeleton.bones;
  let joint = -1;
  let best = 0;
  const w: Array<[number, number]> = [
    [skinIndex.getX(vertexIndex), skinWeight.getX(vertexIndex)],
    [skinIndex.getY(vertexIndex), skinWeight.getY(vertexIndex)],
    [skinIndex.getZ(vertexIndex), skinWeight.getZ(vertexIndex)],
    [skinIndex.getW(vertexIndex), skinWeight.getW(vertexIndex)],
  ];
  for (const [j, weight] of w) {
    if (weight > best) {
      best = weight;
      joint = j;
    }
  }
  if (joint < 0) return "";
  const bone = bones[joint] as unknown as { name?: string; userData?: { name?: unknown } };
  // GLTFLoader sanitizes bone.name (PropertyBinding reserved chars: dots go,
  // so "lowerarm01.L" becomes "lowerarm01L"); userData.name keeps the GLB
  // original — match the S1 texel / B-mask joint sets against the original.
  const raw = bone?.userData?.name;
  if (typeof raw === "string" && raw) return raw;
  return bone?.name ?? "";
}

/**
 * The world AABB of skinned-body verts whose DOMINANT joint is a lowerarm
 * bone. Both arms are collected; the viewer-left arm (smaller world-x
 * centroid — the front portrait camera sits at +Z looking -Z, so screen-left
 * is world -X, matching the bodyboxes.json convention) is framed so one arm
 * fills the portrait solve instead of both arms plus the torso gap. Refuses
 * when either side is missing.
 */
export function deriveForearmFocusBounds(root: Object3D): {
  kind: "forearm_box";
  box: Box3;
  side: string;
  matchedJointNames: string[];
  matchedVertexCount: number;
} {
  const perSide = new Map<string, { box: Box3; joints: Set<string>; count: number; centroidX: number }>();
  const point = new Vector3();
  root.updateMatrixWorld(true);
  root.traverse((object) => {
    if (!(object instanceof SkinnedMesh)) return;
    const position = object.geometry.getAttribute("position");
    if (!position) return;
    for (let i = 0; i < position.count; i += 1) {
      const jointName = dominantJointName(object, i);
      if (!FOREARM_JOINT_RE.test(jointName)) continue;
      const side = jointName.endsWith(".L") ? "L" : jointName.endsWith(".R") ? "R" : "?";
      let entry = perSide.get(side);
      if (!entry) {
        entry = { box: new Box3(), joints: new Set(), count: 0, centroidX: 0 };
        perSide.set(side, entry);
      }
      point.fromBufferAttribute(position, i).applyMatrix4(object.matrixWorld);
      entry.box.expandByPoint(point);
      entry.joints.add(jointName);
      entry.count += 1;
      entry.centroidX += point.x;
    }
  });
  const left = perSide.get("L");
  const right = perSide.get("R");
  if (!left || !right || left.count === 0 || right.count === 0) {
    throw new Error(
      `focus=forearm unresolvable: lowerarm verts L=${left?.count ?? 0} R=${right?.count ?? 0} — refusing rather than falling back (st-vitbody r4)`,
    );
  }
  const picked = left.centroidX / left.count <= right.centroidX / right.count ? { entry: left, side: "L" } : { entry: right, side: "R" };
  return {
    kind: "forearm_box",
    box: picked.entry.box,
    side: picked.side,
    matchedJointNames: [...picked.entry.joints].sort(),
    matchedVertexCount: picked.entry.count,
  };
}

/**
 * The union of the neck-joint verts (neck01-03, the B=255 body side) and the
 * jaw band of head-joint verts (the B=0 face side), so the portrait solve
 * frames ACROSS the body-mask boundary at the jaw/neck and the mix edge is
 * in frame. The jaw band is the bottom 35% of the above-neck head height —
 * a framing heuristic over derived quantities, never a literal coordinate.
 * The caller derives the head box (same derivation resolveFocus uses for
 * focus=head) and passes it in. Refuses when neck or head verts are missing.
 */
const NECK_JOINT_RE = /^neck/i;

export function deriveNeckCloseFocusBounds(root: Object3D, headBox: Box3): {
  kind: "neck_close_box";
  box: Box3;
  neckJointNames: string[];
  headVertexCount: number;
  neckVertexCount: number;
} {
  const neckBox = new Box3();
  const neckJoints = new Set<string>();
  let neckCount = 0;
  const point = new Vector3();
  root.updateMatrixWorld(true);
  root.traverse((object) => {
    if (!(object instanceof SkinnedMesh)) return;
    const position = object.geometry.getAttribute("position");
    if (!position) return;
    for (let i = 0; i < position.count; i += 1) {
      const jointName = dominantJointName(object, i);
      if (!NECK_JOINT_RE.test(jointName)) continue;
      point.fromBufferAttribute(position, i).applyMatrix4(object.matrixWorld);
      neckBox.expandByPoint(point);
      neckJoints.add(jointName);
      neckCount += 1;
    }
  });
  if (neckCount === 0 || !Number.isFinite(neckBox.min.x)) {
    throw new Error("focus=neck unresolvable: no neck-joint verts — refusing rather than falling back (st-vitbody r4)");
  }
  const jawBandTop = neckBox.max.y + 0.35 * Math.max(headBox.max.y - neckBox.max.y, 1e-4);
  const box = neckBox.clone();
  let headCount = 0;
  root.traverse((object) => {
    if (!(object instanceof SkinnedMesh)) return;
    const position = object.geometry.getAttribute("position");
    if (!position) return;
    for (let i = 0; i < position.count; i += 1) {
      const jointName = dominantJointName(object, i);
      if (jointName !== "head") continue;
      point.fromBufferAttribute(position, i).applyMatrix4(object.matrixWorld);
      if (point.y > jawBandTop) continue;
      box.expandByPoint(point);
      headCount += 1;
    }
  });
  if (headCount === 0) {
    throw new Error("focus=neck unresolvable: no head-joint verts in the jaw band — refusing rather than falling back (st-vitbody r4)");
  }
  return {
    kind: "neck_close_box",
    box,
    neckJointNames: [...neckJoints].sort(),
    headVertexCount: headCount,
    neckVertexCount: neckCount,
  };
}
