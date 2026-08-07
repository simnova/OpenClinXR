/**
 * Clinical idle / conversation posture for generated humanoids (#91).
 *
 * Extracted from main.ts (shrink-only ratchet). Owns standing arm hang so role-specific
 * maps cannot leave wrists level with the shoulder (T-pose plank).
 *
 * Pre-fix live dump (`.openclinxr/evidence/idle-arm-hang/pre-fix.json`) established:
 *   - Runtime bone names are UNDOTTED (`upper_armL`, not `upper_arm.L`)
 *   - Euler writes survive the mixer (rotation matches what was written; quaternions agree)
 *   - Role-specific maps ran AFTER clinical idle and overwrote hang with weaker arm eulers
 *   - Family-class actors failed world drop < 0.25 m; patient large Z abduction splayed arms
 *
 * Decisions (#91):
 *   - Collapse dual dotted/undotted maps into alias-based lookup (dotted half was dead)
 *   - Quaternion write after Euler (same pattern as seated-pose.ts:188-202) for mixer safety
 *   - Clinical idle owns arm hang; role-specific paths must not re-plank the arms
 *   - Hang margin: world wrist Y at least 0.25 m below shoulder (contract), calibrated from dump
 *
 * claimScope: standing arm hang in the running ui-xr scene.
 * notEvidenceFor: clinical posture appropriateness, hand articulation, Quest readiness.
 */

import type { Object3D } from "three";

export type EulerPartial = { x?: number; y?: number; z?: number; absolute?: boolean };

/**
 * Standing idle arm hang — world-space goal is wrist ≥0.25 m below shoulder with hands
 * clear of the torso mid-line. Calibrated from pre-fix live dump on this armature:
 *
 *   role map (pre-fix)     upper_armL xyz              drop    lateral
 *   patient                 (-0.34, 0.08, -0.74)        0.46 m  0.43 m  ← best hang
 *   nurse                   (-0.28, 0.14, -0.2)         0.30 m  0.64 m  plank splay
 *   family                  (-0.30, 0.16, -0.2)         0.23 m  0.58 m  FAIL drop
 *   clinical idle x=-1.12   (-1.12, 0.06, -0.18)        0.18 m  0.50 m  WORSE — rejected
 *
 * Decision: SSOT is the patient-map eulers that already cleared world drop on this rig.
 * Apply them to every standing role so family/nurse stop overwriting with weaker hang.
 * Not a threshold search — values already shipped on the patient path; unified only.
 */
const CLINICAL_IDLE_ARM_HANG = new Map<string, EulerPartial>([
  // Canonical undotted runtime names (pre-fix: scene graph reports upper_armL not upper_arm.L).
  ["upper_armL", { x: -0.34, y: 0.08, z: -0.74, absolute: true }],
  ["forearmL", { x: -0.24, y: -0.12, z: 0.36, absolute: true }],
  ["handL", { x: 0.06, y: 0.08, z: -0.08, absolute: true }],
  ["upper_armR", { x: -0.34, y: -0.08, z: 0.74, absolute: true }],
  ["forearmR", { x: -0.24, y: 0.12, z: -0.36, absolute: true }],
  ["handR", { x: 0.06, y: -0.08, z: 0.08, absolute: true }],
  ["head", { x: -0.04, absolute: true }],
  // Dotted file-side aliases (dead on current GLBs; kept so a dotted load still hangs).
  ["upper_arm.L", { x: -0.34, y: 0.08, z: -0.74, absolute: true }],
  ["forearm.L", { x: -0.24, y: -0.12, z: 0.36, absolute: true }],
  ["hand.L", { x: 0.06, y: 0.08, z: -0.08, absolute: true }],
  ["upper_arm.R", { x: -0.34, y: -0.08, z: 0.74, absolute: true }],
  ["forearm.R", { x: -0.24, y: 0.12, z: -0.36, absolute: true }],
  ["hand.R", { x: 0.06, y: -0.08, z: 0.08, absolute: true }],
]);

/** Alias tokens for bones that may arrive under Mixamo / alternate naming. */
const ARM_JOINT_ALIASES = new Map<string, string[]>([
  ["upper_armL", ["upper_arml", "upperarm_l", "leftarm", "left_arm", "leftupperarm", "left_upper_arm", "mixamorigleftarm"]],
  ["forearmL", ["forearml", "forearm_l", "leftforearm", "left_forearm", "leftlowerarm", "left_lower_arm", "mixamorigleftforearm"]],
  ["handL", ["handl", "hand_l", "lefthand", "left_hand", "mixamoriglefthand"]],
  ["upper_armR", ["upper_armr", "upperarm_r", "rightarm", "right_arm", "rightupperarm", "right_upper_arm", "mixamorigrightarm"]],
  ["forearmR", ["forearmr", "forearm_r", "rightforearm", "right_forearm", "rightlowerarm", "right_lower_arm", "mixamorigrightforearm"]],
  ["handR", ["handr", "hand_r", "righthand", "right_hand", "mixamorigrighthand"]],
  ["head", ["head", "neck"]],
]);

/**
 * Write Euler then force quaternion.setFromEuler so the pose survives mixer.update
 * (see seated-pose.ts). Absolute replaces full XYZ; non-absolute only provided axes.
 */
export function applyBoneEuler(
  object: Object3D,
  rotation: EulerPartial,
): void {
  const x = rotation.x !== undefined ? rotation.x : object.rotation.x;
  const y = rotation.y !== undefined ? rotation.y : (rotation.absolute ? 0 : object.rotation.y);
  const z = rotation.z !== undefined ? rotation.z : (rotation.absolute ? 0 : object.rotation.z);
  object.rotation.set(x, y, z, object.rotation.order);
  object.quaternion.setFromEuler(object.rotation);
}

function normalizeBoneToken(name: string): string {
  return name.toLowerCase().replaceAll(/[^a-z0-9_]+/g, "");
}

function resolveIdleRotation(boneName: string): EulerPartial | undefined {
  const direct = CLINICAL_IDLE_ARM_HANG.get(boneName);
  if (direct) return direct;
  const normalized = normalizeBoneToken(boneName);
  for (const [jointId, aliases] of ARM_JOINT_ALIASES) {
    if (!aliases.some((alias) => normalized.includes(alias) || normalized === alias)) {
      continue;
    }
    return CLINICAL_IDLE_ARM_HANG.get(jointId);
  }
  return undefined;
}

/**
 * Apply relaxed standing arm hang + head attention to a loaded humanoid root.
 * Called on load and every frame after mixer.update (main.ts animation loop).
 */
export function applyGeneratedHumanoidClinicalIdlePosture(humanoid: Object3D): void {
  const bonesTouched: string[] = [];

  const tryApply = (object: Object3D) => {
    const rotation = resolveIdleRotation(object.name);
    if (!rotation) return;
    applyBoneEuler(object, rotation);
    object.userData.openClinXrClinicalIdlePosture = "relaxed_arms_scenario_conversation_pose";
    if (!bonesTouched.includes(object.name)) bonesTouched.push(object.name);
  };

  humanoid.traverse((object) => {
    tryApply(object);
  });

  // Skeleton bones in case a skinned mesh holds the authoritative list (same as seated-pose).
  humanoid.traverse((object) => {
    const skinned = object as Object3D & {
      isSkinnedMesh?: boolean;
      skeleton?: { bones: Object3D[]; update?: () => void };
    };
    if (!skinned.isSkinnedMesh || !skinned.skeleton?.bones) return;
    for (const bone of skinned.skeleton.bones) {
      tryApply(bone);
    }
    skinned.skeleton.update?.();
  });

  humanoid.userData.openClinXrClinicalIdlePostureCueIds = [
    "relaxed_upper_arm_pose_cue",
    "bent_forearm_conversation_pose_cue",
    "head_attention_posture_cue",
    "arms_lowered_from_generator_bind_pose_cue",
  ];
  humanoid.userData.openClinXrClinicalIdleBonesTouched = bonesTouched;
}

/**
 * Apply a role-specific joint map with alias matching + quaternion write.
 * Callers that must preserve arm hang should omit upper_arm/forearm/hand entries.
 */
export function applyHumanoidJointRotationsByAlias(
  humanoid: Object3D,
  rotations: Map<string, EulerPartial>,
  poseId: string,
): void {
  humanoid.traverse((object) => {
    const normalizedName = normalizeBoneToken(object.name);
    for (const [jointId, aliases] of ARM_JOINT_ALIASES) {
      if (!aliases.some((alias) => normalizedName.includes(alias))) {
        continue;
      }
      const rotation = rotations.get(jointId);
      if (!rotation) continue;
      applyBoneEuler(object, { ...rotation, absolute: rotation.absolute ?? true });
      object.userData.openClinXrRoleSpecificPose = poseId;
      break;
    }
    // Exact name match for undotted keys not covered by alias include (e.g. head).
    const exact = rotations.get(object.name);
    if (exact && !object.userData.openClinXrRoleSpecificPose) {
      applyBoneEuler(object, { ...exact, absolute: exact.absolute ?? true });
      object.userData.openClinXrRoleSpecificPose = poseId;
    }
  });
}
