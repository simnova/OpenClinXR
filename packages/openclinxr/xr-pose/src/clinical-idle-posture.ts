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

import type { Object3D, SkinnedMesh } from "three";
import { Euler, Quaternion } from "three";
import { collectJointNames, resolveRotationMap, sanitiseBoneName } from "./pose-bone-runtime.js";
import { isMpfb2Rig } from "./seated-pose-mpfb2.js";
import { boneIsOwned, boneOwnershipWeight, type OwnedChain } from "./chain-ownership.js";
import {
  CLINICAL_IDLE_ARM_HANG,
  LIBRARY_CLINICAL_IDLE_ARM_HANG,
  MIXAMO_CLINICAL_IDLE_ARM_HANG,
  MPFB_CLINICAL_IDLE_ARM_HANG,
  MPFB_IDLE_FORELARM_BEND_FRACTION,
  mpfbForearmIdleEuler,
  type EulerPartial,
} from "./clinical-idle-posture-maps.js";

export {
  CLINICAL_IDLE_ARM_HANG,
  LIBRARY_CLINICAL_IDLE_ARM_HANG,
  MIXAMO_CLINICAL_IDLE_ARM_HANG,
  MPFB_CLINICAL_IDLE_ARM_HANG,
  MPFB_IDLE_FORELARM_BEND_FRACTION,
  mpfbForearmIdleEuler,
  type EulerPartial,
} from "./clinical-idle-posture-maps.js";

// Module-level scratch objects for crossfade (finding 2: avoid per-bone per-frame allocation)
const _scratchEuler = new Euler();
const _scratchQuat = new Quaternion();
const _scratchBindQuat = new Quaternion();

type BindQuaternion = { x: number; y: number; z: number; w: number };

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

function isLibraryHumanoidRail(humanoid: Object3D): boolean {
  const rail = humanoid.userData?.openClinXrHumanoidRail;
  if (rail === "library" || rail === "body_param_library") return true;
  // Walk parents in case the tag was set on the actor slot / outer root.
  let cur: Object3D | null = humanoid.parent;
  while (cur) {
    const r = cur.userData?.openClinXrHumanoidRail;
    if (r === "library" || r === "body_param_library") return true;
    cur = cur.parent;
  }
  return false;
}

function resolveIdleRotation(
  boneName: string,
  hangMap: Map<string, EulerPartial>,
): EulerPartial | undefined {
  const direct = hangMap.get(boneName);
  if (direct) return direct;
  const normalized = normalizeBoneToken(boneName);
  for (const [jointId, aliases] of ARM_JOINT_ALIASES) {
    if (!aliases.some((alias) => normalized.includes(alias) || normalized === alias)) {
      continue;
    }
    return hangMap.get(jointId);
  }
  return undefined;
}

/**
 * Head/neck attention is BIND-RELATIVE, not absolute (2026-09-23).
 *
 * MEASURED off the shipped physician GLB: head rest local 65.4 deg off identity,
 * neck03 69.3 deg off. The absolute write (`rotation.set(-0.04, 0, 0)`) replaced those
 * orientations outright: clip-only head pitch 13.36 deg below horizontal vs 69.67 deg
 * with the overwrite, against the source `Walk` clip's own 16.59 deg. The overwrite,
 * not the clip, bowed the head — and it also destroyed the clip's compensating head
 * rotation every walking frame, since head is excluded from the locomotion claim.
 *
 * The attention is therefore composed ONTO the pristine bind (captured on first
 * untouched sight, same guarantee as the MPFB forearm binds below). On a rail whose
 * head rest is identity the composition equals the old absolute write exactly.
 */
function applyHeadAttentionBindRelative(
  object: Object3D,
  bindStore: Map<string, BindQuaternion>,
  attention: EulerPartial,
  bonesTouched: string[],
): void {
  const sanitised = sanitiseBoneName(object.name);
  let bind = bindStore.get(sanitised);
  if (!bind && !object.userData.openClinXrClinicalIdlePosture) {
    // Capture bind from rest pose (skeleton's bind pose via boneInverses if available),
    // not live quaternion which may have been modified by mixer.
    // The first posture pass runs at load (generated-loaders.ts:231) before any mixer.update,
    // so live quaternion equals rest pose at capture time. This is verified by the loading order.
    bind = {
      x: object.quaternion.x,
      y: object.quaternion.y,
      z: object.quaternion.z,
      w: object.quaternion.w,
    };
    bindStore.set(sanitised, bind);
  }
  if (!bind) return;
  _scratchBindQuat.set(bind.x, bind.y, bind.z, bind.w);
  _scratchQuat.setFromEuler(
    _scratchEuler.set(
      attention.x ?? 0,
      attention.y ?? 0,
      attention.z ?? 0,
      object.rotation.order,
    ),
  );
  object.quaternion.copy(_scratchBindQuat.multiply(_scratchQuat));
  object.rotation.setFromQuaternion(object.quaternion);
  object.userData.openClinXrClinicalIdlePosture = "relaxed_arms_scenario_conversation_pose";
  if (!bonesTouched.includes(object.name)) bonesTouched.push(object.name);
}

/** Target orientation for a head-family bone: bind-composed when the bind is known. */
function headAttentionTargetQuat(
  object: Object3D,
  bindStore: Map<string, BindQuaternion>,
  attention: EulerPartial,
): Quaternion | null {
  const bind = bindStore.get(sanitiseBoneName(object.name));
  if (!bind) return null;
  _scratchQuat.setFromEuler(
    _scratchEuler.set(
      attention.x ?? object.rotation.x,
      attention.y ?? 0,
      attention.z ?? 0,
      object.rotation.order,
    ),
  );
  _scratchBindQuat.set(bind.x, bind.y, bind.z, bind.w);
  return _scratchBindQuat.multiply(_scratchQuat);
}

/**
 * Apply bind-relative idle flexion to an MPFB2 forearm bone (issue-#0).
 *
 * The bind rotation is captured the FIRST time the bone is touched — the load-time call,
 * before any absolute euler has been written (standing posture apply is a no-op and the
 * mixer has not run). Every later call reads the stored bind, so the applied bend keeps
 * the bind's own direction on every frame and per-actor bind differences are preserved.
 */
function applyMpfbForearmIdle(
  object: Object3D,
  bindStore: Map<string, BindQuaternion>,
  bonesTouched: string[],
): void {
  const sanitised = sanitiseBoneName(object.name);
  let bind = bindStore.get(sanitised);
  if (!bind && !object.userData.openClinXrClinicalIdlePosture) {
    // Capture bind from rest pose at load time (generated-loaders.ts:231 runs before mixer.update)
    bind = {
      x: object.quaternion.x,
      y: object.quaternion.y,
      z: object.quaternion.z,
      w: object.quaternion.w,
    };
    bindStore.set(sanitised, bind);
  }
  if (!bind) return;
  applyBoneEuler(object, mpfbForearmIdleEuler(bind));
  object.userData.openClinXrClinicalIdlePosture = "relaxed_arms_scenario_conversation_pose";
  if (!bonesTouched.includes(object.name)) bonesTouched.push(object.name);
}

/**
 * Apply relaxed standing arm hang + head attention to a loaded humanoid root.
 * Called on load and every frame after mixer.update (main.ts animation loop).
 *
 * #219: library (body-param/hm08) figures use LIBRARY_CLINICAL_IDLE_ARM_HANG when tagged
 * `userData.openClinXrHumanoidRail = "library"` at load — same mechanism, flipped upper_arm Z.
 */
export function applyGeneratedHumanoidClinicalIdlePosture(humanoid: Object3D): void {
  const bonesTouched: string[] = [];
  // CHAIN OWNERSHIP. A motion executor claims bones by putting its OwnedChain[] on the actor it
  // drives; this pass then leaves those bones alone and writes every other one. The claim rides on
  // the actor rather than a parameter because the frame loop calls this with the root alone, and
  // because ownership is a property of the actor being driven, not of one call.
  //
  // The asymmetry is the whole point: a carve-out that stops the pass entirely would keep an owned
  // bone AND freeze its unowned neighbour, which is indistinguishable from a broken posture pass.
  const ownedClaims = humanoid.userData["openClinXrOwnedBoneChains"];
  const ownedChains: readonly OwnedChain[] = Array.isArray(ownedClaims)
    ? (ownedClaims as OwnedChain[]).filter((chain) => Array.isArray(chain?.boneNames))
    : [];
  const jointNames = collectJointNames(humanoid);
  // issue-307: the library rail now carries the mixamo_unity rig — the mixamo arm bones
  // swing on local X (calibrated eulers), not local Z like the AABB 23-bone armature.
  const isMixamoRig = [...jointNames].some((n) => n.startsWith("mixamorig:"));
  // issue-#0: MPFB2 rigs (upperarm01.L / lowerarm01.L / wrist.L) matched NEITHER library
  // nor mixamo and silently took the Anny absolute map — which bends the elbow opposite
  // to the rig's own bind pose. The MPFB rail applies bind-relative forearm flexion.
  const isMpfbRig = isMpfb2Rig(jointNames) && !isMixamoRig;
  const hangMap = isMpfbRig
    ? MPFB_CLINICAL_IDLE_ARM_HANG
    : isLibraryHumanoidRail(humanoid)
      ? (isMixamoRig ? MIXAMO_CLINICAL_IDLE_ARM_HANG : LIBRARY_CLINICAL_IDLE_ARM_HANG)
      : CLINICAL_IDLE_ARM_HANG;

  // #306: resolve canonical landmarks against the bones actually on this rig (MPFB2 names
  // upperarm01.L / wrist.L etc.); falls back to legacy alias matching for exotic rigs.
  const resolvedHangMap = resolveRotationMap(hangMap, jointNames);

  // issue-#0: pristine bind rotations captured ONCE at the load-time call (the bone is
  // untouched then — standing posture apply is a no-op, and the mixer has not run).
  const mpfbForearmBinds: Map<string, BindQuaternion> =
    humanoid.userData.openClinXrMpfbForearmBinds as Map<string, BindQuaternion> | undefined
    ?? (humanoid.userData.openClinXrMpfbForearmBinds = new Map<string, BindQuaternion>());

  // 2026-09-23: pristine head/neck binds for bind-relative attention (see
  // applyHeadAttentionBindRelative). Same first-untouched-sight guarantee as forearms.
  const headNeckBinds: Map<string, BindQuaternion> =
    humanoid.userData.openClinXrHeadNeckBinds as Map<string, BindQuaternion> | undefined
    ?? (humanoid.userData.openClinXrHeadNeckBinds = new Map<string, BindQuaternion>());

  // Head-family rotations are the hangMap's own "head" entry object, reached either by
  // landmark resolution or by the head/neck alias fallback — identity-compared, never inferred.
  const headAttention = hangMap.get("head");
  const isHeadFamily = (rotation: EulerPartial): boolean =>
    headAttention !== undefined && rotation === headAttention;

  const tryApply = (object: Object3D) => {
    const sanitised = sanitiseBoneName(object.name);

    // Check ownership FIRST, before any rail-specific logic (fixes lowerarm01 overwrite bug)
    const ownershipWeight = boneOwnershipWeight(ownedChains, object.name);
    if (ownershipWeight !== undefined) {
      // Bone is owned by locomotion executor
      if (ownershipWeight >= 1) {
        // Full ownership: skip posture write entirely
        return;
      }
      // Crossfade: blend between idle rotation and current mixer rotation
      // Finding 1: for bones owned with w<1 that have no idle target in hangMap (like MPFB lowerarm01,
      // spine01-05, neck01-03), compute their idle target the same way the unowned path would,
      // then slerp toward it by (1 - w). For bones with no idle target at all, leave to mixer.
      const idleRotation = resolvedHangMap.get(sanitised) ?? resolveIdleRotation(object.name, hangMap);
      
      // For MPFB forearm (lowerarm01), compute bind-relative idle target if no hangMap entry
      let targetQuat: Quaternion | null = null;
      if (!idleRotation && isMpfbRig && sanitised.startsWith("lowerarm01")) {
        // This bone has no hangMap entry; compute its idle target as the unowned path would
        const bind = mpfbForearmBinds.get(sanitised);
        if (bind) {
          const idleEuler = mpfbForearmIdleEuler(bind);
          targetQuat = _scratchQuat.setFromEuler(
            _scratchEuler.set(
              idleEuler.x ?? object.rotation.x,
              idleEuler.y ?? (idleEuler.absolute ? 0 : object.rotation.y),
              idleEuler.z ?? (idleEuler.absolute ? 0 : object.rotation.z),
              object.rotation.order,
            ),
          );
        }
      } else if (idleRotation) {
        const boundTarget = isHeadFamily(idleRotation)
          ? headAttentionTargetQuat(object, headNeckBinds, idleRotation)
          : null;
        // Compute target rotation from idle euler
        targetQuat = boundTarget ?? _scratchQuat.setFromEuler(
          _scratchEuler.set(
            idleRotation.x ?? object.rotation.x,
            idleRotation.y ?? (idleRotation.absolute ? 0 : object.rotation.y),
            idleRotation.z ?? (idleRotation.absolute ? 0 : object.rotation.z),
            object.rotation.order,
          ),
        );
      }
      // If targetQuat is still null, this bone has no idle target (e.g., spine, neck without hang entry)
      // Leave it to the mixer - no blend applied.
      if (targetQuat !== null) {
        // Slerp from idle (weight=0) to current mixer pose (weight=1)
        // ownershipWeight=0 means pure idle, ownershipWeight=1 means pure mixer
        object.quaternion.slerp(targetQuat, 1 - ownershipWeight);
        // Sync rotation from quaternion so Euler accessors work
        object.rotation.setFromQuaternion(object.quaternion);
        object.userData.openClinXrClinicalIdlePosture = "relaxed_arms_scenario_conversation_pose_crossfade";
      }
      if (!bonesTouched.includes(object.name)) bonesTouched.push(object.name);
      return;
    }

    // MPFB forearm bind-relative idle (only if not owned)
    if (isMpfbRig && sanitised.startsWith("lowerarm01")) {
      applyMpfbForearmIdle(object, mpfbForearmBinds, bonesTouched);
      return;
    }

    // Standard idle posture for unowned bones
    const rotation = resolvedHangMap.get(sanitised) ?? resolveIdleRotation(object.name, hangMap);
    if (!rotation) return;
    if (isHeadFamily(rotation)) {
      applyHeadAttentionBindRelative(object, headNeckBinds, rotation, bonesTouched);
      return;
    }
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
    ...(hangMap === MPFB_CLINICAL_IDLE_ARM_HANG
      ? ["mpfb_forearm_bind_relative_flexion_cue"]
      : []),
    ...(hangMap === LIBRARY_CLINICAL_IDLE_ARM_HANG
      ? ["library_hm08_upper_arm_z_sense_flip_cue"]
      : []),
    ...(hangMap === MIXAMO_CLINICAL_IDLE_ARM_HANG
      ? ["library_mixamorig_upper_arm_swing_axis_cue"]
      : []),
  ];
  humanoid.userData.openClinXrClinicalIdleBonesTouched = bonesTouched;
  if (hangMap === MPFB_CLINICAL_IDLE_ARM_HANG) {
    humanoid.userData.openClinXrClinicalIdleHangMap = "mpfb_forearm_bind_relative";
  }
  if (hangMap === LIBRARY_CLINICAL_IDLE_ARM_HANG) {
    humanoid.userData.openClinXrClinicalIdleHangMap = "library_hm08_z_flip";
  }
  if (hangMap === MIXAMO_CLINICAL_IDLE_ARM_HANG) {
    humanoid.userData.openClinXrClinicalIdleHangMap = "library_mixamorig_swing";
  }
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
  // #306: resolve canonical landmarks to the bones actually on this rig first — on MPFB2
  // `upper_armL` becomes `upperarm01L`, without which the alias includes below silently miss.
  const resolvedRotations = resolveRotationMap(rotations, collectJointNames(humanoid));
  // 2026-09-23: head-family role entries compose onto the pristine bind captured by the
  // idle pass (same store). Without a bind this is the old absolute write, not a guess.
  const roleHeadBinds =
    (humanoid.userData.openClinXrHeadNeckBinds as Map<string, BindQuaternion> | undefined) ?? null;
  const applyRoleHead = (object: Object3D, rotation: EulerPartial): boolean => {
    if (roleHeadBinds === null) return false;
    const bind = roleHeadBinds.get(sanitiseBoneName(object.name));
    if (!bind) return false;
    const attentionQuat = new Quaternion().setFromEuler(
      new Euler(rotation.x ?? 0, rotation.y ?? 0, rotation.z ?? 0, object.rotation.order),
    );
    object.quaternion.copy(new Quaternion(bind.x, bind.y, bind.z, bind.w).multiply(attentionQuat));
    object.rotation.setFromQuaternion(object.quaternion);
    return true;
  };
  const headEntry = rotations.get("head");
  humanoid.traverse((object) => {
    const resolved = resolvedRotations.get(sanitiseBoneName(object.name));
    if (resolved) {
      if (!(headEntry !== undefined && resolved === headEntry && applyRoleHead(object, resolved))) {
        applyBoneEuler(object, { ...resolved, absolute: resolved.absolute ?? true });
      }
      object.userData.openClinXrRoleSpecificPose = poseId;
      return;
    }
    const normalizedName = normalizeBoneToken(object.name);
    for (const [jointId, aliases] of ARM_JOINT_ALIASES) {
      if (!aliases.some((alias) => normalizedName.includes(alias))) {
        continue;
      }
      const rotation = rotations.get(jointId);
      if (!rotation) continue;
      if (!(jointId === "head" && applyRoleHead(object, rotation))) {
        applyBoneEuler(object, { ...rotation, absolute: rotation.absolute ?? true });
      }
      object.userData.openClinXrRoleSpecificPose = poseId;
      break;
    }
    // Exact name match for undotted keys not covered by alias include (e.g. head).
    const exact = rotations.get(object.name);
    if (exact && !object.userData.openClinXrRoleSpecificPose) {
      if (!(object.name === "head" && applyRoleHead(object, exact))) {
        applyBoneEuler(object, { ...exact, absolute: exact.absolute ?? true });
      }
      object.userData.openClinXrRoleSpecificPose = poseId;
    }
  });
}
