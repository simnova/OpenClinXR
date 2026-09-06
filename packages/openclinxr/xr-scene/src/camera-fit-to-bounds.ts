/**
 * Shared camera fit-to-bounds framing (#315).
 *
 * Extracted from the isolated-subject-lab (formerly module-private there) so the
 * full-scene comparator captures can frame the NAMED actor with the same
 * no-authored-numbers solve: take a `Box3`, derive centre and size, and iterate
 * distance until the subject occupies `PACK_FRAME_TARGET` of the frame.
 *
 * #315: the parent/nurse comparator captures hardcoded `camera.position.set(0,1.05,2.55)`
 * at camera-construction time — before any humanoid exists — and photographed the patient
 * (the origin is nearest the patient). The reverted hand-fixes are recorded in the planted
 * contract header. This module is the D1 reuse: one proven solve, both consumers.
 *
 * Parent-awareness: `camera.position` is LOCAL to the camera's parent. The comparator
 * capture mounts the camera under the locomotion rig (`openclinxrPortalStart=encounter`
 * translates it to z=-0.62), so the solve runs in camera-local space by subtracting the
 * parent's world position from the subject bounds. Legacy/isolated-lab cameras have no
 * parent, so the subtraction is a no-op and behavior is unchanged.
 */

import type { Object3D, PerspectiveCamera } from "three";
import { Box3, Mesh, Vector3 } from "three";

/** Unit-ish camera direction per pack view: [dx, dz] on the XZ plane (front = +Z). */
export type CaptureView =
  | "front"
  | "side"
  | "three_quarter_left"
  | "three_quarter_right"
  | "back";

/** World-space AABB of a mesh-bearing object, using each mesh's matrixWorld. */
export function computeMeshBounds(root: Object3D): Box3 {
  const bounds = new Box3();
  const point = new Vector3();
  root.updateMatrixWorld(true);
  root.traverse((object) => {
    if (!(object instanceof Mesh)) return;
    const position = object.geometry.getAttribute("position");
    if (!position) return;
    for (let i = 0; i < position.count; i += 1) {
      point.fromBufferAttribute(position, i).applyMatrix4(object.matrixWorld);
      bounds.expandByPoint(point);
    }
  });
  return bounds;
}

/** Unit-ish camera direction per pack view: [dx, dz] on the XZ plane (front = +Z). */
const VIEW_DIRECTIONS: Record<CaptureView, [number, number]> = {
  front: [0, 1],
  back: [0, -1],
  side: [1, 0],
  three_quarter_left: [Math.SQRT1_2, Math.SQRT1_2],
  three_quarter_right: [-Math.SQRT1_2, Math.SQRT1_2],
};

/**
 * #270: pack views frame the subject to this fraction of the square frame's
 * dimension (the larger projected AABB extent / frame dimension).
 */
const PACK_FRAME_TARGET = 0.8;

const UP_AXIS = new Vector3(0, 1, 0);

const AABB_CORNER_SIGNS: ReadonlyArray<readonly [boolean, boolean, boolean]> = [
  [false, false, false],
  [false, false, true],
  [false, true, false],
  [false, true, true],
  [true, false, false],
  [true, false, true],
  [true, true, false],
  [true, true, true],
];

/**
 * Frame the camera for a subject. Legacy subjects keep the old framing exactly.
 *
 * #270 pack views: solve for the camera distance at which the subject's projected
 * bounding box spans PACK_FRAME_TARGET of the square frame's dimension, instead of
 * the old `radius * 2.4` (with a 0.4 m floor on radius). Same camera angles
 * (VIEW_DIRECTIONS), same 5 views, same subject-only rule.
 *
 * Returns the achieved span fraction (larger projected extent / frame dimension)
 * for pack views, or null for legacy framing — recorded in the evidence so the
 * 70-85% target is auditable, not just the pixel-coverage floor.
 */
export function frameCamera(camera: PerspectiveCamera, bounds: Box3, view?: CaptureView): number | null {
  const center = bounds.getCenter(new Vector3());
  const size = bounds.getSize(new Vector3());
  const radius = Math.max(size.x, size.y, size.z, 0.4);
  // #315: solve in camera-LOCAL space. camera.position is relative to its parent
  // (the comparator capture mounts the camera under a translated locomotion rig).
  const parentWorldPosition = new Vector3();
  if (camera.parent) {
    camera.parent.updateWorldMatrix(true, false);
    camera.parent.getWorldPosition(parentWorldPosition);
  }
  const minLocal = new Vector3().subVectors(bounds.min, parentWorldPosition);
  const maxLocal = new Vector3().subVectors(bounds.max, parentWorldPosition);
  if (!view) {
    // Legacy framing — unchanged for furniture/posture subjects.
    const distance = radius * 2.4;
    camera.position.set(
      minLocal.x + (maxLocal.x - minLocal.x) / 2 + distance * 0.55,
      minLocal.y + (maxLocal.y - minLocal.y) / 2 + radius * 0.35,
      minLocal.z + (maxLocal.z - minLocal.z) / 2 + distance * 0.85,
    );
    camera.lookAt(center.x, center.y + size.y * 0.05, center.z);
    camera.near = 0.01;
    camera.far = Math.max(50, distance * 4);
    camera.updateProjectionMatrix();
    return null;
  }

  const [dx, dz] = VIEW_DIRECTIONS[view];
  const horiz = new Vector3(dx, 0, dz);
  // Proportional elevation (size.y, not the floored radius) — identical to the
  // old `radius * 0.35` for tall subjects, sane for small plates.
  const elevation = new Vector3(0, size.y * 0.35, 0);
  const centerLocal = new Vector3(center.x - parentWorldPosition.x, center.y - parentWorldPosition.y, center.z - parentWorldPosition.z);
  // The solve runs in camera-local space (pos, corners, target all local);
  // lookAt receives the WORLD target — three.js converts it to local internally.
  const targetLocal = new Vector3(centerLocal.x, centerLocal.y + size.y * 0.05, centerLocal.z);
  const targetWorld = new Vector3(center.x, center.y + size.y * 0.05, center.z);

  const tanHalf = Math.tan((camera.fov * Math.PI) / 360);
  const frameSpan = 2 * tanHalf;
  const wantSpan = frameSpan * PACK_FRAME_TARGET;

  // Iterate: the projected span is ~k / distance, so scaling distance by
  // span / wantSpan converges in a few steps even with perspective foreshortening.
  let distance = radius * 2.4;
  let spanFraction = PACK_FRAME_TARGET;
  for (let i = 0; i < 8; i += 1) {
    const pos = new Vector3(
      centerLocal.x + horiz.x * distance + elevation.x,
      centerLocal.y + elevation.y,
      centerLocal.z + horiz.z * distance + elevation.z,
    );
    const fwd = new Vector3().subVectors(targetLocal, pos).normalize();
    const right = new Vector3().crossVectors(fwd, UP_AXIS).normalize();
    const up = new Vector3().crossVectors(right, fwd).normalize();

    let minSx = Infinity;
    let maxSx = -Infinity;
    let minSy = Infinity;
    let maxSy = -Infinity;
    for (const [mx, my, mz] of AABB_CORNER_SIGNS) {
      const px = mx ? maxLocal.x : minLocal.x;
      const py = my ? maxLocal.y : minLocal.y;
      const pz = mz ? maxLocal.z : minLocal.z;
      const vx = px - pos.x;
      const vy = py - pos.y;
      const vz = pz - pos.z;
      const depth = vx * fwd.x + vy * fwd.y + vz * fwd.z;
      if (depth < 1e-4) continue;
      const sx = (vx * right.x + vy * right.y + vz * right.z) / depth;
      const sy = (vx * up.x + vy * up.y + vz * up.z) / depth;
      if (sx < minSx) minSx = sx;
      if (sx > maxSx) maxSx = sx;
      if (sy < minSy) minSy = sy;
      if (sy > maxSy) maxSy = sy;
    }
    const span = Math.max(maxSx - minSx, maxSy - minSy);
    if (!Number.isFinite(span) || span < 1e-6) break;
    spanFraction = span / frameSpan;
    const next = distance * (span / wantSpan);
    if (Math.abs(next - distance) < Math.max(distance * 1e-4, 1e-6)) {
      distance = next;
      break;
    }
    distance = next;
  }

  camera.position.set(
    centerLocal.x + horiz.x * distance,
    centerLocal.y + elevation.y,
    centerLocal.z + horiz.z * distance,
  );
  camera.lookAt(targetWorld);
  camera.near = 0.01;
  camera.far = Math.max(50, distance * 4);
  camera.updateProjectionMatrix();
  return spanFraction;
}
