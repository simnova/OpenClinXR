import type { Object3D } from "three";
import { Quaternion, Vector3 } from "three";
import { findBonesBySanitisedName, sanitiseBoneName } from "@openclinxr/xr-pose";
import { findStanceChain } from "./stance-lock-ik.js";
import type { StanceFoot } from "./stance-lock-mod.js";

/**
 * Four-joint leg CCD for the procedural stepping turn (2026-10-11).
 *
 * WHY CCD AND NOT THE SHARED TWO-BONE SOLVE. The shipped leg chain is four segments
 * hip-to-ankle (upperleg01 -> upperleg02 -> lowerleg01 -> lowerleg02 -> foot), and the
 * shared `solveTwoBoneIK` (stance-lock-ik.ts) drives only upperleg01 + lowerleg01: measured
 * on shipped bytes under the shipped walk clip (tools/.../stepping-turn/ik-noop-probe.ts),
 * it misses a no-op heel target by 0.045-0.40 m across 3 rigs x 2 sides x 5 clip times.
 * Straightening the intermediates to bind is bit-identical (they already run near-straight,
 * chord-vs-true <= 3.8 mm), so the miss is the two-bone math on this rig, not chain length.
 * CCD over all four joints hits 0.0000 m on the no-op and 0.0001 m worst-case on a
 * reachable 0.2 m step target, all rigs; on an unreachable lateral target its residual
 * equals the reach gap exactly (it converges to the reach limit, not past it).
 *
 * SCOPE: stepping-turn execution only, behind its default-off flag. The walking stance
 * lock and the clip-driven settling turn keep their own solvers untouched.
 */

export type SteppingLegChain = {
  hip: Object3D;
  upperMid: Object3D;
  knee: Object3D;
  lowerMid: Object3D;
  heel: Object3D;
  toe: Object3D;
};

/** Resolve the full four-joint leg chain; null on a rig without one (headless markers). */
export function findSteppingLegChain(actorSlot: Object3D, stanceFoot: StanceFoot): SteppingLegChain | null {
  const base = findStanceChain(actorSlot, stanceFoot);
  if (base === null) return null;
  const side = stanceFoot === "left" ? "L" : "R";
  const uppers = findBonesBySanitisedName(actorSlot, sanitiseBoneName(`upperleg02.${side}`));
  const lowers = findBonesBySanitisedName(actorSlot, sanitiseBoneName(`lowerleg02.${side}`));
  const upperMid = uppers[0];
  const lowerMid = lowers[0];
  if (!upperMid || !lowerMid) return null;
  return { hip: base.hip, upperMid, knee: base.knee, lowerMid, heel: base.heel, toe: base.toe };
}

function ccdSweep(joints: Object3D[], end: Object3D, target: Vector3): number {
  const endPos = new Vector3();
  const jointPos = new Vector3();
  const toEnd = new Vector3();
  const toTarget = new Vector3();
  const axis = new Vector3();
  const delta = new Quaternion();
  const parentQuat = new Quaternion();
  for (let j = joints.length - 1; j >= 0; j -= 1) {
    const joint = joints[j];
    if (!joint) continue;
    joint.updateMatrixWorld(true);
    end.updateMatrixWorld(true);
    endPos.setFromMatrixPosition(end.matrixWorld);
    if (endPos.distanceTo(target) < 1e-4) return endPos.distanceTo(target);
    jointPos.setFromMatrixPosition(joint.matrixWorld);
    toEnd.subVectors(endPos, jointPos).normalize();
    toTarget.subVectors(target, jointPos).normalize();
    const cos = Math.min(1, Math.max(-1, toEnd.dot(toTarget)));
    if (cos > 1 - 1e-9) continue;
    axis.crossVectors(toEnd, toTarget);
    if (axis.lengthSq() < 1e-12) continue;
    axis.normalize();
    joint.parent?.updateMatrixWorld(true);
    if (joint.parent) parentQuat.setFromRotationMatrix(joint.parent.matrixWorld);
    else parentQuat.identity();
    // World-axis rotation -> joint-local delta, so the heel aims without twisting the foot:
    // only the four leg joints rotate; heel/toe orientation is whatever the mixer wrote.
    delta.setFromAxisAngle(axis.clone().applyQuaternion(parentQuat.clone().invert()), Math.acos(cos));
    joint.quaternion.premultiply(delta);
    joint.updateMatrixWorld(true);
  }
  end.updateMatrixWorld(true);
  return endPos.setFromMatrixPosition(end.matrixWorld).distanceTo(target);
}

/**
 * Drive the leg's heel to `heelTargetWorld` with CCD over hip + both intermediates + knee.
 * Rotates leg joints only; the heel/toe bones keep the mixer's orientation, so the foot
 * stays rigid while the knee flexes to place it. Returns the achieved miss in meters.
 */
export function solveSteppingLegCcd(input: {
  chain: SteppingLegChain;
  heelTargetWorld: { x: number; y: number; z: number };
  maxIterations?: number;
}): { converged: boolean; missM: number } {
  const { chain } = input;
  const target = new Vector3(input.heelTargetWorld.x, input.heelTargetWorld.y, input.heelTargetWorld.z);
  const joints = [chain.hip, chain.upperMid, chain.knee, chain.lowerMid];
  const maxIterations = input.maxIterations ?? 64;
  for (let iter = 0; iter < maxIterations; iter += 1) {
    if (ccdSweep(joints, chain.heel, target) < 1e-4) {
      chain.heel.updateMatrixWorld(true);
      return { converged: true, missM: chain.heel.getWorldPosition(new Vector3()).distanceTo(target) };
    }
  }
  // Elbow-flip stall from a straight-leg start: perturb the intermediates and continue.
  const perturb = new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), 0.35);
  chain.upperMid.quaternion.premultiply(perturb);
  chain.lowerMid.quaternion.premultiply(perturb);
  for (let iter = 0; iter < maxIterations; iter += 1) {
    if (ccdSweep(joints, chain.heel, target) < 1e-4) {
      chain.heel.updateMatrixWorld(true);
      return { converged: true, missM: chain.heel.getWorldPosition(new Vector3()).distanceTo(target) };
    }
  }
  chain.heel.updateMatrixWorld(true);
  return { converged: false, missM: chain.heel.getWorldPosition(new Vector3()).distanceTo(target) };
}

/**
 * Heel target for a desired TOE placement, preserving the foot's CURRENT heel-to-toe
 * offset — the closed-loop construction `applyStanceToeXzPin` uses, so a small mismatch
 * between the anchor-time offset and the target self-corrects instead of accumulating.
 */
export function heelTargetForToeTarget(input: {
  chain: SteppingLegChain;
  toeTargetWorld: { x: number; y: number; z: number };
}): { x: number; y: number; z: number } {
  const { chain } = input;
  chain.heel.updateMatrixWorld(true);
  chain.toe.updateMatrixWorld(true);
  const heelWorld = chain.heel.getWorldPosition(new Vector3());
  const toeWorld = chain.toe.getWorldPosition(new Vector3());
  return {
    x: input.toeTargetWorld.x - (toeWorld.x - heelWorld.x),
    y: input.toeTargetWorld.y - (toeWorld.y - heelWorld.y),
    z: input.toeTargetWorld.z - (toeWorld.z - heelWorld.z),
  };
}
