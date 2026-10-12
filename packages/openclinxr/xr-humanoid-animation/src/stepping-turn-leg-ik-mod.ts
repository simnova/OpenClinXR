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
 * WHY THE HINGE (`solveSteppingLegHinge`, below) AND NOT CCD FOR THE SHIPPED PATH.
 * CCD's four ball joints hold the pelvis fixed (slot) while folding the knee: measured on
 * the physician bake, hold flexion L/R 9/29 deg with all 91 frames back-bowed up to
 * 87 mm — a crouch, graded FAIL against the upright reference. The hinge freezes the
 * intermediates at rest (STEP-1-proven harmless) and solves the exact two-bone triangle
 * in the pole plane with twist-free minimal arcs: non-iterative, so no redundant crouch
 * to fall into and no limit cycle to stall in. (An alternating hip-aim/knee-hinge
 * iteration was tried first and diverged into 70-120 deg folds on displaced targets.)
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
    // Parent WORLD QUATERNION, not setFromRotationMatrix(parent.matrixWorld): the slot
    // carries 0.86 scale and setFromRotationMatrix assumes an unscaled basis, which
    // skews the axis and injects shear (measured: a hinge rotation landed 0.03 off its
    // own exact target). getWorldQuaternion decomposes properly.
    joint.parent?.updateMatrixWorld(true);
    const parentQ = new Quaternion();
    if (joint.parent) joint.parent.getWorldQuaternion(parentQ);
    else parentQ.identity();
    // World-axis rotation -> joint-local delta, so the heel aims without twisting the foot:
    // only the four leg joints rotate; heel/toe orientation is whatever the mixer wrote.
    delta.setFromAxisAngle(axis.clone().applyQuaternion(parentQ.clone().invert()), Math.acos(cos));
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
 *
 * STATIC USE ONLY (probes, single shots). Per-frame callers MUST use
 * `heelTargetForToeTargetStable` below: re-reading the live offset every frame feeds the
 * solved leg orientation back into the next target — measured 120 deg of offset swing
 * and 11 cm of heel overshoot on the physician bake, where the swing heel converged
 * exactly and still read 72 deg of flexion against a 34 deg geometric demand.
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

/**
 * Yaw-stable heel target for per-frame callers. The entry offset (toe minus heel,
 * captured once) rotates with the slot yaw ONLY — never with the solved leg — so the
 * target cannot chase the solver's own output frame to frame. Residual error is bounded
 * by the walk clip's own ankle motion (mm-scale), never accumulating.
 */
export function heelTargetForToeTargetStable(input: {
  toeTargetWorld: { x: number; y: number; z: number };
  slotYawRadians: number;
  offsetEntry: { x: number; y: number; z: number };
  offsetYawRadians: number;
}): { x: number; y: number; z: number } {
  const dyaw = input.slotYawRadians - input.offsetYawRadians;
  const cos = Math.cos(dyaw);
  const sin = Math.sin(dyaw);
  const ox = input.offsetEntry.x;
  const oz = input.offsetEntry.z;
  return {
    x: input.toeTargetWorld.x - (ox * cos + oz * sin),
    y: input.toeTargetWorld.y - input.offsetEntry.y,
    z: input.toeTargetWorld.z - (-ox * sin + oz * cos),
  };
}

export type HingeQuat = { x: number; y: number; z: number; w: number };

function quatInParentFrame(joint: Object3D, worldDelta: Quaternion): Quaternion {
  const parentQ = new Quaternion();
  if (joint.parent) joint.parent.getWorldQuaternion(parentQ);
  else parentQ.identity();
  return new Quaternion()
    .copy(parentQ)
    .invert()
    .multiply(worldDelta)
    .multiply(parentQ);
}

/**
 * Hinge-constrained leg solve: the shipped production path.
 *
 * Freezes both intermediate joints at their rest orientations (STEP-1-proven: they run
 * within 3.8 mm of straight, so nothing is lost), computes the knee position from the
 * cosine rule in the pole plane, and orients thigh then shin onto it with twist-free
 * minimal arcs — analytic and non-iterative, so unlike CCD there is no redundant
 * crouch to fall into and no limit cycle to stall in: the leg takes the straightest
 * shape that reaches the target, pelvis rides at full height, knees stay forward.
 *
 * Twist discipline: both orientations are minimal arcs (no twist component by
 * construction); intermediates are frozen, so upper-leg twist cannot change inside
 * this solve. Each frame starts from the mixer's pose, so nothing accumulates frame
 * to frame either.
 */
type SteppingLegHingeDiag = {
  /** Hip-to-target distance over leg length (thigh + shin); >1 is oversaturated. */
  reachRatio: number;
  /** Which branch produced the bend plane: raw, previous-plane, hold, or none. */
  planeSource: "computed" | "reused" | "held" | "none";
  /** Angle between this frame's and last frame's plane normal, null if either is null. */
  planeAngleDeg: number | null;
  /** Sign of the knee-side direction against the pole (+1 forward, -1 back, 0 unknown). */
  kneeSideSign: number;
  /** Solver passes run (0: analytic, non-iterative). */
  iterations: number;
  /** Achieved heel miss in meters (same as missM). */
  residualM: number;
  /** True when the solve was skipped/held (early return, bones untouched). */
  skipped: boolean;
};

export function solveSteppingLegHinge(input: {
  chain: SteppingLegChain;
  heelTargetWorld: { x: number; y: number; z: number };
  /** World-space forward the knee must bow toward (slot facing). */
  poleWorld: { x: number; y: number; z: number };
  /** Rest orientations for the frozen intermediates; null entries are left as-is. */
  midRestQuats?: { upper: HingeQuat | null; lower: HingeQuat | null } | null;
  /**
   * Last frame's bend-plane normal (world), for degeneracy hysteresis. Null on
   * the first solve: the plane tracks live until a previous one exists.
   */
  previousBendNormal?: { x: number; y: number; z: number } | null;
}): {
  converged: boolean;
  missM: number;
  bendNormal: { x: number; y: number; z: number } | null;
  diag: SteppingLegHingeDiag;
} {
  const { chain } = input;
  const target = new Vector3(input.heelTargetWorld.x, input.heelTargetWorld.y, input.heelTargetWorld.z);
  const pole = new Vector3(input.poleWorld.x, input.poleWorld.y, input.poleWorld.z).normalize();
  const hold = input.midRestQuats ?? null;
  if (hold?.upper) chain.upperMid.quaternion.set(hold.upper.x, hold.upper.y, hold.upper.z, hold.upper.w);
  if (hold?.lower) chain.lowerMid.quaternion.set(hold.lower.x, hold.lower.y, hold.lower.z, hold.lower.w);
  chain.hip.updateMatrixWorld(true);
  chain.knee.updateMatrixWorld(true);
  chain.heel.updateMatrixWorld(true);
  const hipW0 = chain.hip.getWorldPosition(new Vector3());
  const kneeW0 = chain.knee.getWorldPosition(new Vector3());
  const heelW0 = chain.heel.getWorldPosition(new Vector3());
  const thighLen = hipW0.distanceTo(kneeW0);
  const shinLen = kneeW0.distanceTo(heelW0);
  const prevIn = input.previousBendNormal ?? null;
  const prevNormal =
    prevIn !== null && Number.isFinite(prevIn.x + prevIn.y + prevIn.z)
      ? new Vector3(prevIn.x, prevIn.y, prevIn.z)
      : null;
  const prevOut = (n: Vector3 | null): { x: number; y: number; z: number } | null =>
    n === null ? null : { x: n.x, y: n.y, z: n.z };
  const planeAngleDeg = (n: Vector3 | null): number | null => {
    if (n === null || prevNormal === null) return null;
    const dot = Math.min(1, Math.max(-1, n.clone().normalize().dot(prevNormal.clone().normalize())));
    return (Math.acos(dot) * 180) / Math.PI;
  };
  if (thighLen < 1e-6 || shinLen < 1e-6) {
    const missM = heelW0.distanceTo(target);
    return {
      converged: false,
      missM,
      bendNormal: prevOut(prevNormal),
      diag: {
        reachRatio: 0,
        planeSource: "none",
        planeAngleDeg: null,
        kneeSideSign: 0,
        iterations: 0,
        residualM: missM,
        skipped: true,
      },
    };
  }
  // Already placed: touch nothing (exact no-ops stay exact; no churn near convergence).
  if (heelW0.distanceTo(target) < 0.002) {
    const missM = heelW0.distanceTo(target);
    return {
      converged: true,
      missM,
      bendNormal: prevOut(prevNormal),
      diag: {
        reachRatio: missM / (thighLen + shinLen),
        planeSource: "held",
        planeAngleDeg: null,
        kneeSideSign: 0,
        iterations: 0,
        residualM: missM,
        skipped: true,
      },
    };
  }
  const toT = target.clone().sub(hipW0);
  const dist = Math.max(toT.length(), 1e-9);
  toT.divideScalar(dist);
  const rawNormal = new Vector3().crossVectors(toT, pole);
  const rawLen = rawNormal.length();
  /**
   * HYSTERESIS ACROSS THE DEGENERACY (settle-entry stage 2). When the reach
   * direction runs near-parallel to the pole, the raw plane's direction comes
   * from sub-mm input noise (idle sway on a near-straight leg) — measured
   * 64 deg one-frame upper-leg snaps at turn end on SC-05, bimodal across
   * identical-build runs. Inside the band the previous frame's plane is reused
   * (projected perpendicular to the current reach, so it stays a valid plane);
   * outside it the plane tracks live, so genuine yaw-driven plane rotation
   * across the turn is unaffected. Crossings are transient (the reach sweeps
   * through the pole direction); a persistently degenerate reach keeps the
   * last live plane rather than churning.
   */
  const HYSTERESIS_BAND = 0.15;
  let bendNormal: Vector3 | null = null;
  let planeSource: SteppingLegHingeDiag["planeSource"] = "none";
  const reachRatio = dist / (thighLen + shinLen);
  if (rawLen >= HYSTERESIS_BAND) {
    bendNormal = rawNormal.clone().divideScalar(rawLen);
    planeSource = "computed";
  } else if (prevNormal !== null) {
    // Same-frame continuity only: the previous plane, re-perpendicularized to
    // the current reach. Never the up-fallback here: crossed with the reach it
    // bows the knee toward the sky instead of pole-side (measured 84 deg
    // snaps), so without a previous plane the solve holds still for the frame.
    const projected = prevNormal.clone().addScaledVector(toT, -prevNormal.dot(toT));
    if (projected.lengthSq() >= 1e-12) {
      bendNormal = projected.normalize();
      planeSource = "reused";
    } else
      return {
        converged: false,
        missM: heelW0.distanceTo(target),
        bendNormal: prevOut(prevNormal),
        diag: {
          reachRatio,
          planeSource: "held",
          planeAngleDeg: null,
          kneeSideSign: 0,
          iterations: 0,
          residualM: heelW0.distanceTo(target),
          skipped: true,
        },
      };
  } else {
    return {
      converged: false,
      missM: heelW0.distanceTo(target),
      bendNormal: null,
      diag: {
        reachRatio,
        planeSource: "none",
        planeAngleDeg: null,
        kneeSideSign: 0,
        iterations: 0,
        residualM: heelW0.distanceTo(target),
        skipped: true,
      },
    };
  }
  // Pole-side knee direction WITHOUT the old cancellation: `perpPole` used to
  // be `pole - toT * (pole . toT)` normalized, which subtracts near-equal
  // vectors exactly where the plane is degenerate — float noise becomes the
  // knee side. `(bendNormal x toT)` is the identical direction by the triple
  // product as long as the normal is pole-family (guaranteed above: raw or
  // previous-plane only, never the up axis), computed from two clean unit
  // vectors instead.
  const perpPole = new Vector3().crossVectors(bendNormal, toT);
  if (perpPole.lengthSq() < 1e-12)
    return {
      converged: false,
      missM: heelW0.distanceTo(target),
      bendNormal: prevOut(prevNormal),
      diag: {
        reachRatio,
        planeSource,
        planeAngleDeg: planeAngleDeg(bendNormal),
        kneeSideSign: 0,
        iterations: 0,
        residualM: heelW0.distanceTo(target),
        skipped: true,
      },
    };
  perpPole.normalize();
  const kneeSideSign = Math.sign(perpPole.dot(pole)) as -1 | 0 | 1;
  const reach = thighLen + shinLen;
  const clamped = Math.min(Math.max(dist, Math.abs(thighLen - shinLen) + 1e-6), reach - 0.001);
  const cosHip = (thighLen * thighLen + clamped * clamped - shinLen * shinLen) / (2 * thighLen * clamped);
  const hipAngle = Math.acos(Math.min(1, Math.max(-1, cosHip)));
  const kneeTarget = hipW0
    .clone()
    .addScaledVector(toT, Math.cos(hipAngle) * thighLen)
    .addScaledVector(perpPole, Math.sin(hipAngle) * thighLen);
  const thighDir0 = kneeW0.clone().sub(hipW0).normalize();
  const wantThighDir = kneeTarget.clone().sub(hipW0).normalize();
  chain.hip.quaternion.premultiply(
    quatInParentFrame(chain.hip, new Quaternion().setFromUnitVectors(thighDir0, wantThighDir)),
  );
  chain.hip.updateMatrixWorld(true);
  chain.knee.updateMatrixWorld(true);
  chain.heel.updateMatrixWorld(true);
  const shinDir0 = chain.heel
    .getWorldPosition(new Vector3())
    .sub(chain.knee.getWorldPosition(new Vector3()))
    .normalize();
  const wantShinDir = target.clone().sub(kneeTarget).normalize();
  chain.knee.quaternion.premultiply(
    quatInParentFrame(chain.knee, new Quaternion().setFromUnitVectors(shinDir0, wantShinDir)),
  );
  chain.hip.updateMatrixWorld(true);
  chain.knee.updateMatrixWorld(true);
  chain.heel.updateMatrixWorld(true);
  const missM = chain.heel.getWorldPosition(new Vector3()).distanceTo(target);
  return {
    converged: missM < 0.01,
    missM,
    bendNormal: { x: bendNormal.x, y: bendNormal.y, z: bendNormal.z },
    diag: {
      reachRatio,
      planeSource,
      planeAngleDeg: planeAngleDeg(bendNormal),
      kneeSideSign,
      iterations: 0,
      residualM: missM,
      skipped: false,
    },
  };
}
