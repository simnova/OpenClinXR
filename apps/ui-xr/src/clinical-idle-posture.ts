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
import { collectJointNames, resolveRotationMap, sanitiseBoneName } from "./pose-bone-runtime.js";
import { isMpfb2Rig } from "./seated-pose-mpfb2.js";

export type EulerPartial = { x?: number; y?: number; z?: number; absolute?: boolean };

/**
 * Standing idle arm hang — world-space goals (#91 hang + #117 abduction ceiling):
 *   - wrist ≥0.25 m below shoulder (drop floor)
 *   - wrist lateral ≤ 1.3 × half live shoulder span (abduction ceiling; NOT calibrated on pose)
 *   - wrist lateral ≥ 0.5 × half span (not through the torso)
 *
 * #91 chose patient-map eulers (z≈±0.74) that cleared drop but left ratio ~2.1–2.3
 * (lateral 0.31–0.45 m ≈ 1.5–2× half-span). On this T-pose bind, upper_arm local Z is the
 * primary lower-from-horizontal axis: nurse z≈±0.2 → plank splay 0.64 m; patient z≈±0.74 →
 * better hang 0.43 m. Rest hang needs ~π/2 from T-pose horizontal, not A-pose (~0.5–0.8).
 *
 * Decision (#117): raise |z| toward a true side hang (~1.12 rad; z=1.25 overshot inward) and keep
 * mild elbow flexion so the arm is not a straight stick. Seated figures are NOT re-mapped here —
 * telehealth seated still uses seated-pose (pre-fix ~0.63–0.66 m lateral; left as residual).
 *
 * Pre-fix (#117): standing ratio 2.14–2.29; halfSpan 0.141–0.201; k=1.3 from shoulder geometry.
 */
export const CLINICAL_IDLE_ARM_HANG = new Map<string, EulerPartial>([
  // Canonical undotted runtime names (pre-fix: scene graph reports upper_armL not upper_arm.L).
  // #117: |z| 0.74 → ~1.12 (hang-from-T toward side rest; trial z=1.25 sat ratio~0.8, slightly
  // inside half-span; 1.12 targets ratio ~1.0–1.2 without calibrating k). Mild elbow flexion kept.
  ["upper_armL", { x: -0.22, y: 0.06, z: -1.12, absolute: true }],
  ["forearmL", { x: -0.18, y: -0.10, z: 0.22, absolute: true }],
  ["handL", { x: 0.04, y: 0.06, z: -0.06, absolute: true }],
  ["upper_armR", { x: -0.22, y: -0.06, z: 1.12, absolute: true }],
  ["forearmR", { x: -0.18, y: 0.10, z: -0.22, absolute: true }],
  ["handR", { x: 0.04, y: -0.06, z: 0.06, absolute: true }],
  ["head", { x: -0.04, absolute: true }],
  // Dotted file-side aliases (dead on current GLBs; kept so a dotted load still hangs).
  ["upper_arm.L", { x: -0.22, y: 0.06, z: -1.12, absolute: true }],
  ["forearm.L", { x: -0.18, y: -0.10, z: 0.22, absolute: true }],
  ["hand.L", { x: 0.04, y: 0.06, z: -0.06, absolute: true }],
  ["upper_arm.R", { x: -0.22, y: -0.06, z: 1.12, absolute: true }],
  ["forearm.R", { x: -0.18, y: 0.10, z: -0.22, absolute: true }],
  ["hand.R", { x: 0.04, y: -0.06, z: 0.06, absolute: true }],
]);

/**
 * #219 — body-param / hm08 library armature uses the opposite upper_arm local Z sense from Anny.
 * Pre-fix (issue-219): same Anny eulers applied → library wrist lateral 0.81 m vs nurse 0.24 m
 * while local upper_armL matched exactly (−0.22, 0.06, −1.12). Live probe: flip upper_arm Z sign
 * → lateral 0.337 m ≈ Anny median 0.340 m. Not a name mismatch (§6v already ruled that out).
 */
export const LIBRARY_CLINICAL_IDLE_ARM_HANG = new Map<string, EulerPartial>([
  ["upper_armL", { x: -0.22, y: 0.06, z: 1.12, absolute: true }],
  ["forearmL", { x: -0.18, y: -0.10, z: 0.22, absolute: true }],
  ["handL", { x: 0.04, y: 0.06, z: -0.06, absolute: true }],
  ["upper_armR", { x: -0.22, y: -0.06, z: -1.12, absolute: true }],
  ["forearmR", { x: -0.18, y: 0.10, z: -0.22, absolute: true }],
  ["handR", { x: 0.04, y: -0.06, z: 0.06, absolute: true }],
  ["head", { x: -0.04, absolute: true }],
  ["upper_arm.L", { x: -0.22, y: 0.06, z: 1.12, absolute: true }],
  ["forearm.L", { x: -0.18, y: -0.10, z: 0.22, absolute: true }],
  ["hand.L", { x: 0.04, y: 0.06, z: -0.06, absolute: true }],
  ["upper_arm.R", { x: -0.22, y: -0.06, z: -1.12, absolute: true }],
  ["forearm.R", { x: -0.18, y: 0.10, z: -0.22, absolute: true }],
  ["hand.R", { x: 0.04, y: -0.06, z: 0.06, absolute: true }],
]);

/**
 * issue-307 — the library rail now rides the MPFB mixamo_unity rig (64 bones, shipped CC0
 * weights). The mixamo bone axes differ from the AABB 23-bone armature's: the swing axis
 * is local X, not Z — the #219 z-flip lifts the arm to the shoulder (measured in the
 * exact three.js parent-frame convention on the exported GLB: hand at 0.55 m lateral,
 * ABOVE the shoulder). These eulers were calibrated against the exported GLB with a
 * chain-walk that replicates `applyBoneEuler` (rotation replaces the rest quaternion in
 * the parent frame): LeftArm (1.4, 0.55, −0.3) lands the hand bone at 0.34 m lateral,
 * 0.42 m below the shoulder — inside the #219 finish-parity band (0.22–0.46 m), same as
 * the Anny median. Right side mirrored (−y, +z).
 */
export const MIXAMO_CLINICAL_IDLE_ARM_HANG = new Map<string, EulerPartial>([
  ["upper_armL", { x: 1.4, y: 0.55, z: -0.3, absolute: true }],
  ["forearmL", { x: 0, y: 0.6, z: 0, absolute: true }],
  ["handL", { x: 0.04, y: 0.06, z: -0.06, absolute: true }],
  ["upper_armR", { x: 1.4, y: -0.55, z: 0.3, absolute: true }],
  ["forearmR", { x: 0, y: -0.6, z: 0, absolute: true }],
  ["handR", { x: 0.04, y: -0.06, z: 0.06, absolute: true }],
  ["head", { x: -0.04, absolute: true }],
]);

/**
 * issue-#0 — MPFB2 idle elbow flexion is BIND-RELATIVE, not absolute.
 *
 * MPFB2 ships an A-pose bind with the elbow already flexed about local X (the bind is
 * X-dominant: +36..+48.7 deg on all 22 shipped MPFB forearm bones). The Anny map above
 * REPLACES that bend with `forearmL.x = -0.18` — roughly 55 deg OPPOSITE to the rig's own
 * bend direction (the planted contract measured it). A fourth absolute euler table would
 * erase the per-actor bind differences (six distinct `lowerarm01.L` binds among the
 * shipped GLBs); instead the idle bend is a FRACTION of the rig's own bind bend, so the
 * SIGN always matches the bind (clause (1)) and the magnitude scales with the actor
 * (clause (2): 0.6 x smallest shipped bind 36.0 deg = 21.7 deg, above the clause floor
 * of half the smallest bind).
 *
 * The fraction is derived, not fitted: 0.6 is the largest k that keeps the idle bend a
 * visibly relaxed relaxation of the A-pose bind (21.7-29.2 deg across the population)
 * while every shipped bind clears the half-smallest-bind floor with ~3.6 deg margin.
 */
export const MPFB_IDLE_FORELARM_BEND_FRACTION = 0.6;

/** MPFB2 idle forearm euler for a given bind — absolute X bend in the bind's own direction. */
export function mpfbForearmIdleEuler(
  bind: { x: number; y: number; z: number; w: number },
): EulerPartial {
  const bindBend = 2 * Math.atan2(bind.x, bind.w);
  return { x: MPFB_IDLE_FORELARM_BEND_FRACTION * bindBend, absolute: true };
}

/**
 * issue-#0 — MPFB2 rail. Upper arm / hand / head reuse the Anny eulers (they are what
 * ships today and clear the hang contracts); the forearm entries are DELIBERATELY
 * absent — MPFB2 forearms are bind-relative (`mpfbForearmIdleEuler`), applied from the
 * bone's pristine bind rotation captured at the load-time call.
 */
export const MPFB_CLINICAL_IDLE_ARM_HANG = new Map<string, EulerPartial>([
  ["upper_armL", { x: -0.22, y: 0.06, z: -1.12, absolute: true }],
  ["handL", { x: 0.04, y: 0.06, z: -0.06, absolute: true }],
  ["upper_armR", { x: -0.22, y: -0.06, z: 1.12, absolute: true }],
  ["handR", { x: 0.04, y: -0.06, z: 0.06, absolute: true }],
  ["head", { x: -0.04, absolute: true }],
  ["upper_arm.L", { x: -0.22, y: 0.06, z: -1.12, absolute: true }],
  ["hand.L", { x: 0.04, y: 0.06, z: -0.06, absolute: true }],
  ["upper_arm.R", { x: -0.22, y: -0.06, z: 1.12, absolute: true }],
  ["hand.R", { x: 0.04, y: -0.06, z: 0.06, absolute: true }],
]);

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

  const tryApply = (object: Object3D) => {
    if (isMpfbRig) {
      const sanitised = sanitiseBoneName(object.name);
      if (sanitised.startsWith("lowerarm01")) {
        applyMpfbForearmIdle(object, mpfbForearmBinds, bonesTouched);
        return;
      }
    }
    const rotation = resolvedHangMap.get(sanitiseBoneName(object.name))
      ?? resolveIdleRotation(object.name, hangMap);
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
  humanoid.traverse((object) => {
    const resolved = resolvedRotations.get(sanitiseBoneName(object.name));
    if (resolved) {
      applyBoneEuler(object, { ...resolved, absolute: resolved.absolute ?? true });
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
