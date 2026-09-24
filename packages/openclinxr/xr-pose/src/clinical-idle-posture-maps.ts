/**
 * Idle-arm-hang data tables and the MPFB2 bind-relative forearm helper, split out of
 * `clinical-idle-posture.ts` to clear that file's 500-line budget. Behaviour is unchanged: same
 * maps, same values, only the module boundary moved.
 */

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
