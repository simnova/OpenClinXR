import type { Object3D } from "three";

/**
 * Small toe-local-pose primitives shared by `settling-step-turn-mod.ts` and
 * `arrival-stance-close-mod.ts`. Split into its own module so neither of those two files needs to
 * import the other (which would create a cycle) for these — both import from here instead.
 */

export type Vec3 = { x: number; y: number; z: number };

export function copyVec(node: Object3D): Vec3 {
  return { x: node.position.x, y: node.position.y, z: node.position.z };
}

export function applyLocal(node: Object3D, local: Vec3): void {
  node.position.set(local.x, local.y, local.z);
}

export function toeWorld(node: Object3D): { x: number; y: number; z: number } {
  const e = node.matrixWorld.elements;
  return { x: e[12] ?? 0, y: e[13] ?? 0, z: e[14] ?? 0 };
}

/** Per-frame toe travel cap during settling/arrived: a close-up, never a snap. */
export const ARRIVAL_CLOSE_MAX_STEP_METERS = 0.03;

/**
 * Write a toe local so the toe's WORLD step stays under maxStepMeters.
 * Slot-yaw motion during the turn still moves toes; the clamp covers the write only.
 */
export function writeToeLocalClamped(input: {
  actorSlot: Object3D;
  toe: Object3D;
  desired: Vec3;
  maxStepMeters?: number;
}): number {
  const maxStep = input.maxStepMeters ?? ARRIVAL_CLOSE_MAX_STEP_METERS;
  const { actorSlot, toe } = input;
  const prevLocal = copyVec(toe);
  const before = toeWorld(toe);
  applyLocal(toe, input.desired);
  actorSlot.updateMatrixWorld(true);
  const after = toeWorld(toe);
  const step = Math.hypot(after.x - before.x, after.y - before.y, after.z - before.z);
  if (step > maxStep && step > 0) {
    const scale = maxStep / step;
    applyLocal(toe, {
      x: prevLocal.x + (input.desired.x - prevLocal.x) * scale,
      y: prevLocal.y + (input.desired.y - prevLocal.y) * scale,
      z: prevLocal.z + (input.desired.z - prevLocal.z) * scale,
    });
    actorSlot.updateMatrixWorld(true);
    return maxStep;
  }
  return step;
}
