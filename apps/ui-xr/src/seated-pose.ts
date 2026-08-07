/**
 * Procedural seated pose on the existing 23-bone runtime subset (#81).
 *
 * Rotation-only (matches automate_blender clinical clips). Seated height is owned by
 * verticalOffsetMeters + chair seatHeightMeters — not by clip root translation.
 *
 * Why procedural, not Mesh2Motion 66→23 retarget as the shipping path:
 * Sitting_Idle carries 198 channels including pelvis/root translation; rest/axis
 * alignment against Anny/canonical is non-mechanical. This module lands a visible sit
 * for data-flow + room capture. Mesh2Motion library evaluation is recorded separately
 * in the slice report (cagematch residual).
 *
 * claimScope: runtime pose apply for seated posture binding.
 * notEvidenceFor: clinical sitting realism, mocap quality, Mesh2Motion retarget success.
 */

import type { Object3D } from "three";
import {
  SEATED_CLIP_NAME,
  STANDING_CLIP_NAME,
  type ActorPosture,
  clipBindingForPosture,
} from "@openclinxr/asset-registry";

/** Degrees → radians helper. */
const d2r = (deg: number) => (deg * Math.PI) / 180;

/**
 * Exact bone names (match clinical-idle style in main.ts) + Euler XYZ for a sit.
 * Hip flex ~-80°, knee flex ~+85° — engineering defaults, not mocap.
 */
// Runtime GLBs use undotted bone names (thighL, upper_armL) — same as clinical-idle aliases.
const SEATED_BONE_EULERS = new Map<string, { x?: number; y?: number; z?: number }>([
  ["pelvis", { x: d2r(-6) }],
  ["spine", { x: d2r(8) }],
  ["chest", { x: d2r(4) }],
  ["thighL", { x: d2r(-80), y: d2r(4) }],
  ["thighR", { x: d2r(-80), y: d2r(-4) }],
  ["shinL", { x: d2r(85) }],
  ["shinR", { x: d2r(85) }],
  ["footL", { x: d2r(-6) }],
  ["footR", { x: d2r(-6) }],
  ["upper_armL", { x: d2r(-30), z: d2r(12) }],
  ["upper_armR", { x: d2r(-30), z: d2r(-12) }],
  ["forearmL", { x: d2r(35) }],
  ["forearmR", { x: d2r(35) }],
  // Dotted aliases if a future export keeps them:
  ["thigh.L", { x: d2r(-80), y: d2r(4) }],
  ["thigh.R", { x: d2r(-80), y: d2r(-4) }],
  ["shin.L", { x: d2r(85) }],
  ["shin.R", { x: d2r(85) }],
]);

export type ApplySeatedPoseResult = {
  applied: boolean;
  clipName: string;
  bonesTouched: string[];
  posture: ActorPosture;
};

/**
 * Apply procedural sit rotations to skinned bones under a loaded humanoid root.
 * Same Euler write path as applyGeneratedHumanoidClinicalIdlePosture (main.ts).
 * Records clip binding userData for evidence.
 */
export function applyPosturePose(
  humanoidRoot: Object3D,
  posture: ActorPosture,
): ApplySeatedPoseResult {
  const binding = clipBindingForPosture(posture);
  humanoidRoot.userData.openClinXrActorPosture = posture;
  humanoidRoot.userData.openClinXrPostureClipName = binding.clipName;
  humanoidRoot.userData.openClinXrPostureClipSource = binding.source;
  humanoidRoot.userData.openClinXrSeatedHeightOwner = "verticalOffsetMeters_and_chair_seatHeightMeters";
  humanoidRoot.userData.openClinXrClipRootTranslation = "stripped_not_applied";

  if (posture !== "seated") {
    return {
      applied: false,
      clipName: binding.clipName,
      bonesTouched: [],
      posture,
    };
  }

  const bonesTouched: string[] = [];
  const applyEuler = (object: Object3D, rotation: { x?: number; y?: number; z?: number }) => {
    if (rotation.x !== undefined) object.rotation.x = rotation.x;
    if (rotation.y !== undefined) object.rotation.y = rotation.y;
    if (rotation.z !== undefined) object.rotation.z = rotation.z;
    object.userData.openClinXrSeatedPose = SEATED_CLIP_NAME;
    if (!bonesTouched.includes(object.name)) bonesTouched.push(object.name);
  };

  // Scene-graph bones (isBone nodes).
  humanoidRoot.traverse((object) => {
    const rotation = SEATED_BONE_EULERS.get(object.name);
    if (!rotation) return;
    applyEuler(object, rotation);
  });

  // Also write skeleton.bones in case the skinned mesh holds the authoritative list.
  humanoidRoot.traverse((object) => {
    const skinned = object as Object3D & {
      isSkinnedMesh?: boolean;
      skeleton?: { bones: Object3D[] };
    };
    if (!skinned.isSkinnedMesh || !skinned.skeleton?.bones) return;
    for (const bone of skinned.skeleton.bones) {
      const rotation = SEATED_BONE_EULERS.get(bone.name);
      if (!rotation) continue;
      applyEuler(bone, rotation);
    }
  });

  humanoidRoot.userData.openClinXrSeatedPoseBones = bonesTouched;
  humanoidRoot.userData.openClinXrActiveRoleAnimationClipName = SEATED_CLIP_NAME;

  return {
    applied: bonesTouched.length > 0,
    clipName: SEATED_CLIP_NAME,
    bonesTouched,
    posture,
  };
}

export { SEATED_CLIP_NAME, STANDING_CLIP_NAME };
