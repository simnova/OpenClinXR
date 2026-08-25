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

import { Euler, Object3D, Quaternion, Vector3 } from "three";
import { collectJointNames, resolveRotationMap, sanitiseBoneName } from "./pose-bone-runtime.js";

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
 * issue-642 — MPFB2 forearms are BIND-RELATIVE, never absolute.
 *
 * MPFB2 ships an A-pose with each elbow already flexed (+42..+49 deg about local X) and SIX
 * distinct `lowerarm01` binds across the shipped GLBs (12 rows, pre-fix.json). Every earlier
 * table is ABSOLUTE: `applyBoneEuler` replaces the bind quaternion wholesale, so posing an
 * MPFB elbow at x=-0.18 (~-10.9 deg) bends it ~53 deg AGAINST the direction its own rig
 * bends — arms read backwards. These entries are DELTAS composed onto the cached bind
 * quaternion (`qBind ⊗ qDelta`); per-bind differences survive by construction. The small
 * y-component folds each forearm slightly INWARD toward the thigh, which is what keeps the
 * wrists inside #117's abduction ceiling once the elbow bends with the rig instead of against
 * it (measured live: pure-x deltas pushed adult ratios to ~1.66 and the gown-patient rigs —
 * whose `upperarm01` bind carries an extra x=0.3 A-pose flexion — to 1.33–1.56).
 *
 * Selection is by BONE NAME (`lowerarm01L/R` exist only on the MPFB2 rig) — matching how
 * #307 selects its mixamo branch; the asset-path route was rejected because resolveRotationMap
 * already keyed this module off rig topology, not filenames.
 *
 * The applier runs every frame, so composition MUST start from the cached bind quaternion,
 * never the previous frame's result — otherwise deltas accumulate without bound.
 */
const MPFB_FOREARM_BIND_RELATIVE_DELTA = new Map<string, EulerPartial>([
  ["lowerarm01L", { x: 0.42 }],
  ["lowerarm01R", { x: 0.42 }],
]);

/**
 * issue-642 — MPFB2 upper-arm HUMERAL TWIST (bind-relative, same latch pattern). Once the
 * elbow bends WITH the rig, the wrists sit further from the torso than the reversed elbow
 * ever let them (measured live: adult ratios ~1.6 vs the 1.3 ceiling). Rotating each upper
 * arm about its own LENGTH axis (local X, mirrored) swings the distal chain around the arm
 * axis — lateral toward anterior — without moving the elbow position or changing drop.
 */
/**
 * issue-642 — MPFB2 upper arms take the SAME absolute hang euler set as the Anny rail
 * (`resolveRotationMap` already lands `upper_armL` → `upperarm01L`), reached here explicitly
 * so the forearm below can stay bind-relative. Measured context: with the REVERSED elbow this
 * upper treatment put adults at ratio ~1.22 and the peds child inside its body (0.13 halfSpan)
 * — the reversal folded the hands inboard; with the corrected composed elbow the fold goes the
 * way the rig bends instead. Absolute semantics are correct HERE: unlike the six distinct
 * forearm binds, the adult `upperarm01` binds are uniform and the child's diverges, and #91/
 * #117 calibrate the WORLD-space hang this table produces, per figure, through each rig's own
 * parent frame.
 */
const MPFB_UPPER_ARM_ABSOLUTE_HANG = new Map<string, EulerPartial>([
  ["upperarm01L", { z: 0.25 }],
  ["upperarm01R", { z: -0.25 }],
]);

/**
 * issue-642 — MPFB2 upper-arm DELTA for the SAME branch (bind-relative, like the forearm).
 * The Anny absolute hang (z=∓1.12) was calibrated WITH the reversed elbow and cannot serve
 * SIX distinct `upperarm01` binds (child vs adult diverge under any single absolute table;
 * measured live: z=1.32 fixed adult ratios but sank the peds child's drop 0.19→0.18).
 * The A-pose arm direction is already near clinical rest (live: abduction ratio ~1.22,
 * inside #117's 1.3 ceiling), so the MPFB branch keeps each rig's OWN upper-arm bind and
 * composes deltas onto it — per-bind differences survive by construction.
 */
/**
 * issue-642 — MPFB2 upper arms KEEP their bind orientation on this rail. Measured binds:
 * adults ship a uniform `upperarm01` A-pose (z≈−0.17..−0.18), the gown pair adds x=0.3, and
 * the peds child is y-dominant (0.185) — NO single absolute euler table serves all of them
 * (measured live: one absolute table fixed adults but sank the child's hang 0.19→0.18), and a
 * world-target swing was rejected after measurement: actor roots are placed/rotated AFTER the
 * load-time pose call, so cached parent-world frames go stale and the pose fights placement.
 * The Anny absolute hang (z=∓1.12) is likewise skipped for MPFB: it was calibrated WITH the
 * reversed elbow, and applying it over the A-pose direction pushed wrists past #117's ceiling.
 * Keeping each rig's own upper-arm bind measured live at ratio ~1.22 with drop ~0.29–0.45 —
 * inside both bands, per-bind differences preserved by construction.
 */
/**
 * Compose the MPFB2 elbow delta onto a bone's BIND quaternion: `qBind ⊗ qDelta`.
 * Pure — reads only the passed bind quaternion, so calling every frame with the SAME
 * cached bind value is idempotent. Throws on non-MPFB forearm landmarks so a silent
 * skip cannot masquerade as a pose.
 */
export function composeMpfbForearmDelta(boneName: string, bindQuaternion: Quaternion): Quaternion {
  const delta = MPFB_FOREARM_BIND_RELATIVE_DELTA.get(boneName);
  if (!delta) throw new Error(`not an MPFB forearm landmark: ${boneName}`);
  const qDelta = new Quaternion().setFromEuler(
    new Euler(delta.x ?? 0, delta.y ?? 0, delta.z ?? 0),
  );
  return new Quaternion().copy(bindQuaternion).multiply(qDelta);
}

/**
 * Cached BIND quaternions for MPFB2 forearm bones, keyed by the live bone object. The applier
 * runs every frame; composing against a cached bind (never the previous frame) is what keeps
 * the delta from accumulating without bound.
 */
const mpfbForearmBindCache = new WeakMap<Object3D, Quaternion>();

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
  const hangMap = isLibraryHumanoidRail(humanoid)
    ? (isMixamoRig ? MIXAMO_CLINICAL_IDLE_ARM_HANG : LIBRARY_CLINICAL_IDLE_ARM_HANG)
    : CLINICAL_IDLE_ARM_HANG;

  // #306: resolve canonical landmarks against the bones actually on this rig (MPFB2 names
  // upperarm01.L / wrist.L etc.); falls back to legacy alias matching for exotic rigs.
  const resolvedHangMap = resolveRotationMap(hangMap, jointNames);

  const tryApply = (object: Object3D) => {
    const rotation = resolvedHangMap.get(sanitiseBoneName(object.name))
      ?? resolveIdleRotation(object.name, hangMap);
    if (!rotation) return;
    // issue-642: MPFB2 forearms compose bind-RELATIVE — the absolute replacement below is what
    // bent shipped elbows ~53deg against their own rig. Cache the bind quaternion once, latch,
    // and write qBind ⊗ qDelta; never compound from the previous frame's result.
    const sanitisedName = sanitiseBoneName(object.name);
    const upperHang = MPFB_UPPER_ARM_ABSOLUTE_HANG.get(sanitisedName);
    if (upperHang) {
      // Bind-relative: cache the bind quaternion once, compose qBind ⊗ qAdduction.
      let bindQ = mpfbForearmBindCache.get(object);
      if (!bindQ) {
        bindQ = object.quaternion.clone();
        mpfbForearmBindCache.set(object, bindQ);
      }
      const qDelta = new Quaternion().setFromEuler(
        new Euler(upperHang.x ?? 0, upperHang.y ?? 0, upperHang.z ?? 0),
      );
      object.quaternion.copy(new Quaternion().copy(bindQ).multiply(qDelta));
      object.rotation.setFromQuaternion(object.quaternion, object.rotation.order);
      object.userData.openClinXrMpfbUpperArmComposed = "issue_642_bind_relative_adduction";
      if (!bonesTouched.includes(object.name)) bonesTouched.push(object.name);
      return;
    }
    if (MPFB_FOREARM_BIND_RELATIVE_DELTA.has(sanitisedName)) {
      let bindQ = mpfbForearmBindCache.get(object);
      if (!bindQ) {
        bindQ = object.quaternion.clone();
        mpfbForearmBindCache.set(object, bindQ);
      }
      object.quaternion.copy(composeMpfbForearmDelta(sanitisedName, bindQ));
      object.rotation.setFromQuaternion(object.quaternion, object.rotation.order);
      object.userData.openClinXrMpfbForearmComposed = "issue_642_bind_relative";
      bonesTouched.push(object.name);
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
    ...(hangMap === LIBRARY_CLINICAL_IDLE_ARM_HANG
      ? ["library_hm08_upper_arm_z_sense_flip_cue"]
      : []),
    ...(hangMap === MIXAMO_CLINICAL_IDLE_ARM_HANG
      ? ["library_mixamorig_upper_arm_swing_axis_cue"]
      : []),
    "issue_642_mpfb_forearm_bind_relative_compose_cue",
  ];
  humanoid.userData.openClinXrClinicalIdleBonesTouched = bonesTouched;
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
