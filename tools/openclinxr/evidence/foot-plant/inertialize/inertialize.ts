/**
 * Inertialized transitions + inertialized foot contact lock, ported — not redesigned.
 *
 * Licence of the ported pieces: MIT, github.com/orangeduck/Motion-Matching
 * (Daniel Holden; GDC-2018 Bollo inertialization lineage). See per-symbol PORT notes.
 *
 * WHAT THIS PORTS (D1: proven code, new file, not wired into the runtime):
 * - `halflife_to_damping`, `decay_spring_damper_exact` (float/vec3/quat),
 *   `inertialize_transition` / `inertialize_update` (vec3 and quat versions) from `spring.h`.
 * - `contact_reset` / `contact_update` (per-foot lock state machine: pin the contact foot's
 *   world position while its label is on, inertialize the release when it turns off,
 *   `unlock_radius` force-unlock) from `controller.cpp`.
 * - Analytic two-bone leg IK in the style of `controller.cpp` `ik_two_bone`
 *   (cosine-rule root/mid angle deltas about the hinge axis plus aim term, clamped to max
 *   extension). Chain choice (upperleg01 -> lowerleg01 -> foot, toe as end effector) follows
 *   the repo's existing `packages/openclinxr/xr-humanoid-animation/src/stance-lock-ik.ts`
 *   `solveTwoBoneIK`; the math here is matrix/quaternion code against this file's own types
 *   because tools files cannot import package src (shrink-only freeze on cross-boundary
 *   path imports). Orientation fix-up (`ik_look_at` for heel/toe) is NOT ported: the cagematch
 *   pins position only and keeps the blended orientation. Stated once, here.
 *
 * SIMPLIFICATIONS vs the reference (behavioural deltas, all conservative):
 * - Velocities are finite differences of the resampled clip tracks, not database velocities.
 * - The root is inertialized as a world-space offset like every other bone; the reference's
 *   animation-space root remap (`inertialize_pose_transition` transition src/dst frames plus
 *   `inertialize_root_adjust`) is replaced by pre-aligning the stop take's root XZ to the walk
 *   root XZ at the switch frame (the same alignment the production stop clone performs), so
 *   the root offset starts near zero by construction.
 * - `fast_negexpf` is `Math.exp(-x)`: exact, deterministic, no approximation table.
 *
 * claimScope: headless deterministic (fixed dt, no RNG) transition math over resampled glTF
 * local-pose tracks, plus the world-space toe tracks its own FK produces.
 * notEvidenceFor: runtime display, visual quality, Quest performance, clinical plausibility.
 */

export type Vec3 = [number, number, number];
/** Quaternion as [x, y, z, w]. */
export type Quat = [number, number, number, number];

export const LN2 = Math.LN2;

/* ---------------------------------------------------------------- quaternions */

export function quatNormalize(q: Quat): Quat {
  const l = Math.hypot(q[0], q[1], q[2], q[3]) || 1;
  return [q[0] / l, q[1] / l, q[2] / l, q[3] / l];
}

/** PORT spring.h `quat_abs`: force the shortest-path hemisphere (w >= 0). */
export function quatAbs(q: Quat): Quat {
  return q[3] < 0 ? [-q[0], -q[1], -q[2], -q[3]] : [q[0], q[1], q[2], q[3]];
}

/** PORT spring.h `quat_mul`. */
export function quatMul(a: Quat, b: Quat): Quat {
  return [
    a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1],
    a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0],
    a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3],
    a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2],
  ];
}

/** PORT spring.h `quat_inv` (unit-quaternion conjugate). */
export function quatInv(q: Quat): Quat {
  return [-q[0], -q[1], -q[2], q[3]];
}

/** PORT spring.h `quat_mul_vec3`. */
export function quatMulVec3(q: Quat, v: Vec3): Vec3 {
  const [x, y, z, w] = q;
  const [vx, vy, vz] = v;
  // t = 2 * cross(q.xyz, v)
  const tx = 2 * (y * vz - z * vy);
  const ty = 2 * (z * vx - x * vz);
  const tz = 2 * (x * vy - y * vx);
  // v + w * t + cross(q.xyz, t)
  return [
    vx + w * tx + (y * tz - z * ty),
    vy + w * ty + (z * tx - x * tz),
    vz + w * tz + (x * ty - y * tx),
  ];
}

export function quatSlerp(a: Quat, b: Quat, t: number): Quat {
  let [bx, by, bz, bw] = b;
  let dot = a[0] * bx + a[1] * by + a[2] * bz + a[3] * bw;
  if (dot < 0) {
    dot = -dot;
    bx = -bx; by = -by; bz = -bz; bw = -bw;
  }
  if (dot > 0.9995) {
    const out: Quat = [
      a[0] + (bx - a[0]) * t,
      a[1] + (by - a[1]) * t,
      a[2] + (bz - a[2]) * t,
      a[3] + (bw - a[3]) * t,
    ];
    return quatNormalize(out);
  }
  const theta = Math.acos(Math.min(1, dot));
  const s = Math.sin(theta);
  const wa = Math.sin((1 - t) * theta) / s;
  const wb = Math.sin(t * theta) / s;
  return [a[0] * wa + bx * wb, a[1] * wa + by * wb, a[2] * wa + bz * wb, a[3] * wa + bw * wb];
}

/** Angle between two unit quaternions, radians. */
export function quatAngleBetween(a: Quat, b: Quat): number {
  const dot = Math.min(
    1,
    Math.abs(a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3]),
  );
  return 2 * Math.acos(dot);
}

/** PORT spring.h `quat_to_scaled_angle_axis`: rotation as axis*angle vector. */
export function quatToScaledAngleAxis(q: Quat): Vec3 {
  const n = quatAbs(quatNormalize(q));
  const w = Math.min(1, Math.max(-1, n[3]));
  const angle = 2 * Math.acos(w);
  const s = Math.sqrt(Math.max(0, 1 - w * w));
  if (s < 1e-8) return [0, 0, 0];
  const k = angle / s;
  return [n[0] * k, n[1] * k, n[2] * k];
}

/** PORT spring.h `quat_from_scaled_angle_axis`. */
export function quatFromScaledAngleAxis(v: Vec3): Quat {
  const angle = Math.hypot(v[0], v[1], v[2]);
  if (angle < 1e-8) return [0, 0, 0, 1];
  const s = Math.sin(angle / 2) / angle;
  return quatNormalize([v[0] * s, v[1] * s, v[2] * s, Math.cos(angle / 2)]);
}

export function quatFromAxisAngle(axis: Vec3, angle: number): Quat {
  const l = Math.hypot(axis[0], axis[1], axis[2]) || 1;
  const s = Math.sin(angle / 2);
  return [axis[0] / l * s, axis[1] / l * s, axis[2] / l * s, Math.cos(angle / 2)];
}

/* ---------------------------------------------------------------- vectors */

export const vecAdd = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const vecSub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const vecScale = (a: Vec3, s: number): Vec3 => [a[0] * s, a[1] * s, a[2] * s];
export const vecDot = (a: Vec3, b: Vec3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const vecLen = (a: Vec3): number => Math.hypot(a[0], a[1], a[2]);
export const vecNorm = (a: Vec3): Vec3 => {
  const l = vecLen(a) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
};
export const vecCross = (a: Vec3, b: Vec3): Vec3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
export const vecDist = (a: Vec3, b: Vec3): number => vecLen(vecSub(a, b));
export const vecDistXZ = (a: Vec3, b: Vec3): number =>
  Math.hypot(a[0] - b[0], a[2] - b[2]);

/* ---------------------------------------------------------------- springs */

/** PORT spring.h `halflife_to_damping`. Critically damped: y = zeta branch below. */
export function halflifeToDamping(halflife: number, eps = 1e-5): number {
  return (4 * LN2) / (halflife + eps);
}

/**
 * PORT spring.h `decay_spring_damper_exact` (vec3 overload): exact critically-damped decay
 * of an offset (x, v) toward zero. `x`/`v` are mutated in place, mirroring the C++ refs.
 */
export function decaySpringVec(x: Vec3, v: Vec3, halflife: number, dt: number): void {
  const y = halflifeToDamping(halflife) / 2;
  const j1: Vec3 = vecAdd(v, vecScale(x, y));
  const e = Math.exp(-y * dt);
  const xNew = vecScale(vecAdd(x, vecScale(j1, dt)), e);
  const vNew = vecScale(vecSub(v, vecScale(j1, y * dt)), e);
  x[0] = xNew[0]; x[1] = xNew[1]; x[2] = xNew[2];
  v[0] = vNew[0]; v[1] = vNew[1]; v[2] = vNew[2];
}

/**
 * PORT spring.h `decay_spring_damper_exact` (quat overload): the offset quaternion is
 * converted to scaled angle-axis, decayed as a vec3, converted back.
 */
export function decaySpringQuat(x: Quat, v: Vec3, halflife: number, dt: number): void {
  const y = halflifeToDamping(halflife) / 2;
  const j0 = quatToScaledAngleAxis(x);
  const j1: Vec3 = vecAdd(v, vecScale(j0, y));
  const e = Math.exp(-y * dt);
  const xNew = quatFromScaledAngleAxis(vecScale(vecAdd(j0, vecScale(j1, dt)), e));
  const vNew = vecScale(vecSub(v, vecScale(j1, y * dt)), e);
  x[0] = xNew[0]; x[1] = xNew[1]; x[2] = xNew[2]; x[3] = xNew[3];
  v[0] = vNew[0]; v[1] = vNew[1]; v[2] = vNew[2];
}

/* ---------------------------------------------------------------- inertialize */

/**
 * PORT spring.h `inertialize_transition` (vec3): capture the source-minus-destination
 * offset (plus prior offset) at the switch frame.
 */
export function inertializeTransitionVec(
  offX: Vec3, offV: Vec3, srcX: Vec3, srcV: Vec3, dstX: Vec3, dstV: Vec3,
): void {
  const x = vecSub(vecAdd(srcX, offX), dstX);
  const v = vecSub(vecAdd(srcV, offV), dstV);
  offX[0] = x[0]; offX[1] = x[1]; offX[2] = x[2];
  offV[0] = v[0]; offV[1] = v[1]; offV[2] = v[2];
}

/** PORT spring.h `inertialize_update` (vec3): decay the offset, output input + offset. */
export function inertializeUpdateVec(
  offX: Vec3, offV: Vec3, inX: Vec3, inV: Vec3, halflife: number, dt: number,
): { outX: Vec3; outV: Vec3 } {
  decaySpringVec(offX, offV, halflife, dt);
  return { outX: vecAdd(inX, offX), outV: vecAdd(inV, offV) };
}

/**
 * PORT spring.h `inertialize_transition` (quat): offset rotation is the shortest-path
 * source-relative-to-destination rotation composed with the prior offset.
 */
export function inertializeTransitionQuat(
  offX: Quat, offV: Vec3, srcX: Quat, srcV: Vec3, dstX: Quat, dstV: Vec3,
): void {
  const x = quatAbs(quatMul(quatMul(offX, srcX), quatInv(dstX)));
  const v = vecSub(vecAdd(offV, srcV), dstV);
  offX[0] = x[0]; offX[1] = x[1]; offX[2] = x[2]; offX[3] = x[3];
  offV[0] = v[0]; offV[1] = v[1]; offV[2] = v[2];
}

/** PORT spring.h `inertialize_update` (quat): out = off * in, angular velocity rotated. */
export function inertializeUpdateQuat(
  offX: Quat, offV: Vec3, inX: Quat, inV: Vec3, halflife: number, dt: number,
): { outX: Quat; outV: Vec3 } {
  decaySpringQuat(offX, offV, halflife, dt);
  return { outX: quatMul(offX, inX), outV: vecAdd(offV, quatMulVec3(offX, inV)) };
}

/* ---------------------------------------------------------------- contact lock */

/** PORT controller.cpp contact state bundle (one per foot). */
export type ContactLockState = {
  contactState: boolean;
  contactLock: boolean;
  contactPosition: Vec3;
  contactVelocity: Vec3;
  contactPoint: Vec3;
  contactTarget: Vec3;
  contactOffsetPosition: Vec3;
  contactOffsetVelocity: Vec3;
};

/** PORT controller.cpp `contact_reset`. */
export function contactReset(
  inputPosition: Vec3, inputVelocity: Vec3,
): ContactLockState {
  return {
    contactState: false,
    contactLock: false,
    contactPosition: [...inputPosition] as Vec3,
    contactVelocity: [...inputVelocity] as Vec3,
    contactPoint: [...inputPosition] as Vec3,
    contactTarget: [...inputPosition] as Vec3,
    contactOffsetPosition: [0, 0, 0],
    contactOffsetVelocity: [0, 0, 0],
  };
}

/**
 * PORT controller.cpp `contact_update`: while the label is on, the inertializer is fed the
 * pinned contact point (plus zero velocity) so the output converges to the pin; when the
 * label turns off (or the pin drifts past `unlockRadius`), an `inertialize_transition`
 * releases back to the raw animation without a pop. Ground projection (`contact_point.y =
 * foot_height`) from the reference is kept: callers pass the rig's measured foot height.
 */
export function contactUpdate(
  s: ContactLockState,
  inputPosition: Vec3,
  inputContactState: boolean,
  unlockRadius: number,
  footHeight: number,
  halflife: number,
  dt: number,
): { outX: Vec3; outV: Vec3 } {
  const eps = 1e-8;
  const inputVelocity: Vec3 = vecScale(vecSub(inputPosition, s.contactTarget), 1 / (dt + eps));
  s.contactTarget = [...inputPosition] as Vec3;

  const updated = inertializeUpdateVec(
    s.contactOffsetPosition,
    s.contactOffsetVelocity,
    s.contactLock ? s.contactPoint : inputPosition,
    s.contactLock ? [0, 0, 0] : inputVelocity,
    halflife,
    dt,
  );
  s.contactPosition = updated.outX;
  s.contactVelocity = updated.outV;

  const unlockContact =
    s.contactLock && vecDist(s.contactPoint, inputPosition) > unlockRadius;

  if (!s.contactState && inputContactState) {
    s.contactLock = true;
    s.contactPoint = [...s.contactPosition] as Vec3;
    s.contactPoint[1] = footHeight;
    inertializeTransitionVec(
      s.contactOffsetPosition,
      s.contactOffsetVelocity,
      inputPosition,
      inputVelocity,
      s.contactPoint,
      [0, 0, 0],
    );
  } else if ((s.contactLock && s.contactState && !inputContactState) || unlockContact) {
    s.contactLock = false;
    inertializeTransitionVec(
      s.contactOffsetPosition,
      s.contactOffsetVelocity,
      s.contactPoint,
      [0, 0, 0],
      inputPosition,
      inputVelocity,
    );
  }

  s.contactState = inputContactState;
  return updated;
}

/* ---------------------------------------------------------------- two-bone IK */

/** Minimal-arc rotation taking unit vector u to unit vector v (no twist). */
export function quatFromTo(u: Vec3, v: Vec3): Quat {
  const a = vecNorm(u);
  const b = vecNorm(v);
  const d = Math.min(1, Math.max(-1, vecDot(a, b)));
  if (d > 1 - 1e-8) return [0, 0, 0, 1];
  const axis = vecCross(a, b);
  if (vecLen(axis) < 1e-8) {
    // Opposite vectors: rotate PI about any perpendicular axis.
    const perp = Math.abs(a[0]) < 0.9 ? vecCross(a, [1, 0, 0]) : vecCross(a, [0, 1, 0]);
    return quatFromAxisAngle(vecNorm(perp), Math.PI);
  }
  return quatFromAxisAngle(vecNorm(axis), Math.acos(d));
}

/**
 * Analytic two-bone IK in the style of controller.cpp `ik_two_bone`
 * (theorangeduck.com "simple two-joint" cosine-rule construction), formulated with
 * minimal-arc rotations so the correction direction is exact rather than sign-dependent
 * on the hinge-axis convention: the desired knee position comes from the cosine rule in
 * the bend plane defined by the CURRENT knee (continuity by construction — the knee
 * bends toward where it already bends), the hip takes the minimal arc to the desired
 * upper-leg direction, and the knee takes the minimal arc to the desired lower-leg
 * direction (rotation about the plane normal, so no twist). The target is clamped to max
 * extension minus a buffer, as in the reference.
 *
 * Operates on world-space positions/rotations and returns LOCAL-space replacements for
 * the root (hip) and mid (knee) bones, converted through the supplied parent world
 * rotation. Chain convention follows the repo's `stance-lock-ik.ts` `findStanceChain`:
 * hip = upperleg01.S, mid = lowerleg01.S, end = foot.S (heel), target derived from the
 * toe pin. The reference's `ik_look_at` orientation fix-up is deliberately not ported
 * (position pin only).
 */
export function solveTwoBoneIKWorld(input: {
  hipPos: Vec3;
  kneePos: Vec3;
  heelPos: Vec3;
  hipWorldQuat: Quat;
  kneeWorldQuat: Quat;
  hipParentWorldQuat: Quat;
  /**
   * Current world orientation of the knee's DIRECT parent. The MPFB rig carries
   * intermediate segment nodes (upperleg02 between upperleg01 and lowerleg01,
   * lowerleg02 between lowerleg01 and foot), so the knee local must be converted
   * through its direct parent's post-rotation world orientation, not the hip's.
   * Untouched intermediates rotate rigidly with the hip, which the conversion below
   * accounts for exactly.
   */
  kneeParentWorldQuat: Quat;
  heelTarget: Vec3;
  /** Pole/bend-plane reference, e.g. the character forward direction. */
  forward: Vec3;
  maxExtensionBuffer: number;
}): { hipLocal: Quat; kneeLocal: Quat } {
  const { hipPos: a, kneePos: b, heelPos: c } = input;
  const upperLen = vecDist(a, b);
  const lowerLen = vecDist(b, c);
  const maxExtension = upperLen + lowerLen - input.maxExtensionBuffer;
  let t = input.heelTarget;
  if (vecDist(t, a) > maxExtension) {
    t = vecAdd(a, vecScale(vecNorm(vecSub(t, a)), maxExtension));
  }
  void input.forward;

  const dirAT = vecNorm(vecSub(t, a));
  const distAT = Math.max(vecDist(t, a), 1e-8);
  // Cosine rule: angle at the hip between hip->target and hip->desired-knee.
  const cosA = Math.min(
    1,
    Math.max(-1, (upperLen * upperLen + distAT * distAT - lowerLen * lowerLen) / (2 * upperLen * distAT)),
  );
  const sinA = Math.sqrt(Math.max(0, 1 - cosA * cosA));
  // Bend-plane perpendicular: the current knee's component orthogonal to hip->target,
  // so the desired knee stays on the side the knee already bends toward.
  const along = vecSub(b, a);
  const parallel = vecScale(dirAT, vecDot(along, dirAT));
  let perp = vecSub(along, parallel);
  if (vecLen(perp) < 1e-8) {
    perp = vecCross(dirAT, [0, 1, 0]);
    if (vecLen(perp) < 1e-8) perp = vecCross(dirAT, [1, 0, 0]);
  }
  perp = vecNorm(perp);
  const desiredKnee = vecAdd(a, vecScale(vecAdd(vecScale(dirAT, cosA), vecScale(perp, sinA)), upperLen));

  // Hip: minimal arc from current upper-leg direction to desired.
  const rHip = quatFromTo(vecNorm(vecSub(b, a)), vecNorm(vecSub(desiredKnee, a)));
  const hipWorldNew = quatMul(rHip, input.hipWorldQuat);
  // Knee: after the hip rotation the knee sits at desiredKnee; minimal arc from the
  // (hip-rotated) lower-leg direction to desiredKnee->target. Minimal-arc axis is the
  // plane normal, so the joint takes pure flexion with no twist.
  const lowerNow = quatMulVec3(rHip, vecNorm(vecSub(c, b)));
  const lowerWant = vecNorm(vecSub(t, desiredKnee));
  const rKnee = quatFromTo(lowerNow, lowerWant);
  const kneeWorldNew = quatMul(rKnee, quatMul(rHip, input.kneeWorldQuat));

  const hipLocal = quatMul(quatInv(input.hipParentWorldQuat), hipWorldNew);
  // Knee direct-parent world orientation AFTER the hip rotation: untouched intermediate
  // segment nodes rotate rigidly with the hip, so their product with the hip is preserved.
  const intermediate = quatMul(quatInv(input.hipWorldQuat), input.kneeParentWorldQuat);
  const kneeParentWorldNew = quatMul(hipWorldNew, intermediate);
  const kneeLocal = quatMul(quatInv(kneeParentWorldNew), kneeWorldNew);
  return { hipLocal: quatNormalize(hipLocal), kneeLocal: quatNormalize(kneeLocal) };
}
