/**
 * MPFB2-rail seated leg fold (#447).
 *
 * The 137-joint MPFB2 GLBs (upperleg01/02.L, lowerleg01/02.L) carry a baked
 * non-identity rest — the 23-bone Anny-frame absolute eulers in seated-pose.ts
 * warp them into a crushed mass (measured 2026-08-19: skin 0.31..0.74 on
 * mpfb-street-adult-male.glb). On this rail the GLB's own rest renders the trunk
 * upright, so the seated fold touches ONLY the leg bones: each bone's world +Y
 * axis is aligned to a seated target (thigh ~4° above horizontal, shin tucked
 * 48° back under the chair). Composition is done in quaternion space via the
 * parent chain, so chain scale (slot 0.88, breathing 1.01) cannot corrupt the
 * extraction. Idempotent: once a bone's +Y points at its target the delta is
 * identity, so the per-frame re-apply in the runtime loop is a no-op.
 *
 * Calibration (live, mpfb-street-adult-male.glb, 2026-08-19): knee ≈ 0.45 m
 * (hip level), lowest skinned vertex ≈ 0.03-0.07 m (floor band), head ≈ 1.20 m,
 * mesh height ≈ 1.16-1.18 m — Δh vs the floor-standing family peer ≈ 0.28 m.
 *
 * claimScope: runtime seated leg placement on the MPFB2 rail only.
 * notEvidenceFor: clinical sitting realism, mocap quality, Quest readiness.
 */

import { Quaternion, Vector3, type Object3D } from "three";
import { SEATED_CLIP_NAME } from "@openclinxr/asset-registry";

/** Seated shin tuck (radians) — 48° back under the chair. */
const MPFB2_SHIN_TUCK_RAD = (48 * Math.PI) / 180;
/** Thigh rise above horizontal (radians) — keeps hip flexion ≈ 92°, under the 95° ceiling. */
const MPFB2_THIGH_RISE_RAD = (4 * Math.PI) / 180;

type BoneLike = Object3D & { isBone?: boolean; type?: string };

function isBoneNode(object: Object3D): boolean {
  return (object as BoneLike).isBone === true || (object as BoneLike).type === "Bone";
}

/**
 * MPFB2 rail detection: the 137-joint rig names its leg chains upperleg01/02.L and
 * lowerleg01/02.L (sanitised upperleg01L / lowerleg01L after three.js strips dots —
 * the trailing L keeps its case, matching the asset-registry alias table).
 */
export function isMpfb2Rig(jointNames: ReadonlySet<string>): boolean {
  return jointNames.has("upperleg01L") || jointNames.has("lowerleg01L");
}

/**
 * Fold the MPFB2 rail's legs into a seated configuration. The trunk is NOT touched —
 * the baked rest already renders it upright. Writes both the scene-graph bones and
 * skeleton.bones so the skinned meshes see the fold either way the loader attached them.
 */
export function applyMpfb2SeatedFold(humanoidRoot: Object3D, bonesTouched: string[]): void {
  const forward = new Vector3(0, Math.sin(MPFB2_THIGH_RISE_RAD), Math.cos(MPFB2_THIGH_RISE_RAD));
  const shinTarget = new Vector3(0, -Math.cos(MPFB2_SHIN_TUCK_RAD), -Math.sin(MPFB2_SHIN_TUCK_RAD));

  /** World quaternion of a bone by composing the live parent chain (no matrices). */
  const worldQuat = (object: Object3D): Quaternion => {
    if (object.parent) {
      return worldQuat(object.parent).multiply(object.quaternion);
    }
    return object.quaternion.clone();
  };

  const align = (bone: Object3D, target: Vector3): void => {
    const worldQ = worldQuat(bone);
    const currentY = new Vector3(0, 1, 0).applyQuaternion(worldQ).normalize();
    const delta = new Quaternion().setFromUnitVectors(currentY, target);
    if (delta.lengthSq() < 1e-12) return;
    const newWorldQ = delta.multiply(worldQ);
    const parentQ = bone.parent ? worldQuat(bone.parent) : new Quaternion();
    bone.quaternion.copy(parentQ.invert().multiply(newWorldQ)).normalize();
    bone.userData.openClinXrSeatedPose = SEATED_CLIP_NAME;
    if (!bonesTouched.includes(bone.name)) bonesTouched.push(bone.name);
  };

  humanoidRoot.traverse((object) => {
    if (!isBoneNode(object)) return;
    const name = object.name ?? "";
    const lower = name.toLowerCase();
    const isThigh = lower.startsWith("upperleg01") || lower.startsWith("upperleg02");
    const isShin = lower.startsWith("lowerleg01") || lower.startsWith("lowerleg02");
    if (isThigh) align(object, forward);
    if (isShin) align(object, shinTarget);
  });

  // Mirror onto skeleton.bones in case the skinned mesh holds the authoritative list.
  humanoidRoot.traverse((object) => {
    const skinned = object as Object3D & {
      isSkinnedMesh?: boolean;
      skeleton?: { bones: Object3D[]; update?: () => void };
    };
    if (!skinned.isSkinnedMesh || !skinned.skeleton?.bones) return;
    for (const bone of skinned.skeleton.bones) {
      const lower = (bone.name ?? "").toLowerCase();
      const isThigh = lower.startsWith("upperleg01") || lower.startsWith("upperleg02");
      const isShin = lower.startsWith("lowerleg01") || lower.startsWith("lowerleg02");
      if (isThigh || isShin) align(bone, isThigh ? forward : shinTarget);
    }
    skinned.skeleton.update?.();
  });
}
