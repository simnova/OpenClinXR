/**
 * Idle-arm-hang data tables and the MPFB2 bind-relative forearm helper, split out of
 * `clinical-idle-posture.ts` to clear that file's 500-line budget. Behaviour is unchanged: same
 * maps, same values, only the module boundary moved.
 */

import type { Object3D } from "three";
import { Quaternion } from "three";
import { sanitiseBoneName } from "./pose-bone-runtime.js";

export type EulerPartial = { x?: number; y?: number; z?: number; absolute?: boolean };

/** Pristine bind quaternion captured at the load-time call (see clinical-idle-posture.ts). */
export type MpfbBindQuaternion = { x: number; y: number; z: number; w: number };

// Module-local scratch (same discipline as clinical-idle-posture.ts: no per-frame allocation).
const _scratchBind = new Quaternion();
const _scratchDelta = new Quaternion();

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
 * (clause (2): 0.55 x smallest shipped bind 36.0 deg = 19.8 deg, above the clause floor
 * of half the smallest bind).
 *
 * The fraction is derived, not fitted: 0.55 is the largest k that keeps every
 * shipped bind's idle bend inside the rest-elbow 5-25 deg window the arms slice
 * bands (physician 26.9 x 0.55/0.6 = 24.6, child 27.1 -> 24.8, nurse 23.6 ->
 * 21.6; measured 2026-10-19 off SC-05 arrived frames) while every shipped bind
 * clears the half-smallest-bind floor.
 */
export const MPFB_IDLE_FORELARM_BEND_FRACTION = 0.55;

/** MPFB2 idle forearm euler for a given bind — absolute X bend in the bind's own direction. */
export function mpfbForearmIdleEuler(
  bind: { x: number; y: number; z: number; w: number },
): EulerPartial {
  const bindBend = 2 * Math.atan2(bind.x, bind.w);
  return { x: MPFB_IDLE_FORELARM_BEND_FRACTION * bindBend, absolute: true };
}

/**
 * Bind-relative MPFB2 upper-arm idle deltas (arms slice, 2026-10-19).
 *
 * The old absolute map euler (`upper_arm z = -+1.12`) hung the physician at
 * +10 deg but the child at -8 deg abduction: the two rigs' `upperarm01`
 * binds diverge (physician local (4.8, -1.1, -21.0) deg vs child
 * (8.0, 21.2, -1.0) deg, measured off the shipped bytes), so one absolute
 * write cannot hang both. These deltas compose ONTO the pristine bind
 * (`local = bind * delta`, same store/guarantee as the forearms), so every
 * A-pose bind lowers to the same hang: offline FK on the shipped bytes
 * reads rest abduction 13.7 (physician) / 14.6 (nurse) / 11.7 (child).
 *
 * Each delta = physicianBind^-1 * desiredAbsolute, with desiredAbsolute the
 * old map euler eased out to z = -+1.05 (x = -0.22, y = +-0.06 kept): +3-4
 * deg over the old hang, the minimum that clears the garment capsule with
 * +0.01 m at the elbow (arms-meter, dressed).
 */
export const MPFB_UPPER_ARM_IDLE_DELTA_L = { x: -0.140001, y: -0.068845, z: -0.334197, w: 0.929501 };
export const MPFB_UPPER_ARM_IDLE_DELTA_R = { x: -0.140001, y: 0.068845, z: 0.334197, w: 0.929501 };

function upperArmDeltaFor(sanitised: string): MpfbBindQuaternion {
  return sanitised.endsWith("R") ? MPFB_UPPER_ARM_IDLE_DELTA_R : MPFB_UPPER_ARM_IDLE_DELTA_L;
}

/**
 * Target local quaternion for an MPFB2 upper-arm bone under ownership blend
 * (arms slice): `bind * delta`. Null when the bind was never captured (the
 * caller leaves the bone to the mixer, same as the forearm path).
 */
export function mpfbUpperArmIdleTarget(
  object: Object3D,
  bindStore: Map<string, MpfbBindQuaternion>,
): Quaternion | null {
  const sanitised = sanitiseBoneName(object.name);
  const bind = bindStore.get(sanitised);
  if (!bind) return null;
  const delta = upperArmDeltaFor(sanitised);
  return new Quaternion(bind.x, bind.y, bind.z, bind.w).multiply(
    new Quaternion(delta.x, delta.y, delta.z, delta.w),
  );
}

/**
 * Apply bind-relative idle hang to an MPFB2 upper-arm bone (arms slice).
 *
 * Same pristine-bind store and first-untouched-sight guarantee as the
 * forearm helper above (the load-time call runs before mixer.update).
 * Writes `bind * delta` as the local quaternion directly (an euler
 * decompose would reintroduce the order/bind ambiguity the delta removes).
 */
export function applyMpfbUpperArmIdle(
  object: Object3D,
  bindStore: Map<string, MpfbBindQuaternion>,
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
  const delta = upperArmDeltaFor(sanitised);
  _scratchBind.set(bind.x, bind.y, bind.z, bind.w);
  _scratchDelta.set(delta.x, delta.y, delta.z, delta.w);
  object.quaternion.copy(_scratchBind.multiply(_scratchDelta));
  object.rotation.setFromQuaternion(object.quaternion);
  object.userData.openClinXrClinicalIdlePosture = "relaxed_arms_scenario_conversation_pose";
  if (!bonesTouched.includes(object.name)) bonesTouched.push(object.name);
}

/**
 * issue-#0 — MPFB2 rail. Hand / head reuse the Anny eulers (they are what
 * ships today and clear the hang contracts); the forearm entries are DELIBERATELY
 * absent — MPFB2 forearms are bind-relative (`mpfbForearmIdleEuler`), applied from the
 * bone's pristine bind rotation captured at the load-time call. The upper-arm
 * entries are DELIBERATELY absent for the same reason (arms slice, 2026-10-19):
 * the old absolute `z = -+1.12` hung the physician at +10 deg but the child at
 * -8 deg abduction off divergent binds (measured offline FK on the shipped
 * bytes); MPFB2 upper arms are bind-relative deltas
 * (`MPFB_UPPER_ARM_IDLE_DELTA_L/R` below) applied from the
 * same pristine-bind store.
 */
export const MPFB_CLINICAL_IDLE_ARM_HANG = new Map<string, EulerPartial>([
  ["handL", { x: 0.04, y: 0.06, z: -0.06, absolute: true }],
  ["handR", { x: 0.04, y: -0.06, z: 0.06, absolute: true }],
  ["head", { x: -0.04, absolute: true }],
  ["hand.L", { x: 0.04, y: 0.06, z: -0.06, absolute: true }],
  ["hand.R", { x: 0.04, y: -0.06, z: 0.06, absolute: true }],
]);
