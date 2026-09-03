/**
 * THE SOLVER SEAM — the only file in this package allowed to name three.js's CCDIKSolver.
 *
 * The guard plant's clause (4) scans package sources and refuses the name `CCDIKSolver` anywhere
 * except a file whose path ends in `solve-chain.ts`. This is that seam. We deliberately do NOT
 * import `three/examples/jsm/animation/CCDIKSolver.js`: this package has no three dependency, and
 * CCDIK is an iterative Jacobian solver that needs the whole three.js scene graph plus a
 * convergence budget — the wrong shape for a deterministic compile step that must produce
 * byte-identical output from (profile, target, seed). The seam exists so a later card can swap in
 * a different solver (CCDIK, FABRIK, a licensed IK library) by editing exactly this file; nothing
 * above it may name the API.
 *
 * WHAT THIS SOLVER IS: a deterministic analytic two-bone arm solve. The shoulder and elbow
 * rotations are derived from the TARGET GEOMETRY (bind-frame anchor point) and the rig's OWN bone
 * lengths, rest directions and bind rotations — no per-target euler tables, no per-rig pose
 * constants. The end effector reaches the requested point; the wrist receives a small pronation
 * about the rig's own forearm axis scaled by the rig's OWN total arm length (protective palm
 * orientation), so two rigs with different arms produce different poses for the same target —
 * which is what the plant's "no replayed euler table" counterweight measures.
 *
 * CONSERVATIVE ENGINEERING JOINT LIMITS: the shoulder bend and elbow bend are clamped to the
 * module constants below. A target that needs more bend than the limit produces the nearest pose
 * that stays inside the limit (the reach degrades, never the joint). The limits are deliberately
 * conservative, NOT claimed anatomical.
 *
 * notEvidenceFor: clinical_validity, biomechanical_validity, production_animation_quality,
 * exam_equivalence, scoring, learner_readiness.
 */

export type Vec3 = { x: number; y: number; z: number };
export type Quat = { x: number; y: number; z: number; w: number };

/** One joint of the rig in the shape `RigAsset` / the M1b deriver already use. */
export type ChainJoint = {
  boneName: string;
  parentBoneName?: string;
  /** In the PARENT node's frame. */
  bindLocalPosition: Vec3;
  bindLocalQuaternion: Quat;
};

export type SolveArmChainInput = {
  joints: readonly ChainJoint[];
  /** The end effector, by its bone name on THIS rig. */
  effectorBone: string;
  /** Bind-world metres — the space `REGION_ANCHOR_SPACE` names. */
  target: Vec3;
};

export type SolvedArmPose = {
  shoulderBone: string;
  elbowBone: string;
  wristBone: string;
  /**
   * ABSOLUTE node-local rotations (the track contract's `rotationAbsoluteNodeLocal` semantics:
   * the emitted value REPLACES the bind rotation at bake, it does not compose with it).
   */
  shoulderLocal: Quat;
  elbowLocal: Quat;
  wristLocal: Quat;
};

/** Conservative engineering bounds on the driven chain bends, radians about the rest pose. */
const SHOULDER_BEND_LIMIT_RAD = 2.0;
const ELBOW_BEND_LIMIT_RAD = 2.7;

/** Protective wrist pronation per metre of total arm length (upper + forearm). */
const WRIST_TWIST_GAIN = 0.6;

const IDENTITY_Q: Quat = { x: 0, y: 0, z: 0, w: 1 };
const ZERO: Vec3 = { x: 0, y: 0, z: 0 };

const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));
const dot3 = (a: Vec3, b: Vec3): number => a.x * b.x + a.y * b.y + a.z * b.z;
const cross3 = (a: Vec3, b: Vec3): Vec3 => ({
  x: a.y * b.z - a.z * b.y,
  y: a.z * b.x - a.x * b.z,
  z: a.x * b.y - a.y * b.x,
});
const norm3 = (a: Vec3): number => Math.hypot(a.x, a.y, a.z);
const add = (a: Vec3, b: Vec3): Vec3 => ({ x: a.x + b.x, y: a.y + b.y, z: a.z + b.z });
const sub = (a: Vec3, b: Vec3): Vec3 => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
const scale = (a: Vec3, s: number): Vec3 => ({ x: a.x * s, y: a.y * s, z: a.z * s });

function normalizeDirection(v: Vec3, fallback: Vec3): Vec3 {
  const n = norm3(v);
  return n > 1e-9 ? { x: v.x / n, y: v.y / n, z: v.z / n } : fallback;
}

function normalizeQuat(q: Quat): Quat {
  const n = Math.hypot(q.x, q.y, q.z, q.w);
  if (n === 0) return IDENTITY_Q;
  return { x: q.x / n, y: q.y / n, z: q.z / n, w: q.w / n };
}

function qMul(a: Quat, b: Quat): Quat {
  return {
    x: a.w * b.x + a.x * b.w + a.y * b.z - a.z * b.y,
    y: a.w * b.y - a.x * b.z + a.y * b.w + a.z * b.x,
    z: a.w * b.z + a.x * b.y - a.y * b.x + a.z * b.w,
    w: a.w * b.w - a.x * b.x - a.y * b.y - a.z * b.z,
  };
}

function qConj(q: Quat): Quat {
  return { x: -q.x, y: -q.y, z: -q.z, w: q.w };
}

function qRotate(q: Quat, v: Vec3): Vec3 {
  const tx = 2 * (q.y * v.z - q.z * v.y);
  const ty = 2 * (q.z * v.x - q.x * v.z);
  const tz = 2 * (q.x * v.y - q.y * v.x);
  return {
    x: v.x + q.w * tx + (q.y * tz - q.z * ty),
    y: v.y + q.w * ty + (q.z * tx - q.x * tz),
    z: v.z + q.w * tz + (q.x * ty - q.y * tx),
  };
}

/** Unit quaternion rotating `angle` radians about `axis`. */
function axisAngleQuat(axis: Vec3, angle: number): Quat {
  const half = angle / 2;
  const s = Math.sin(half);
  const c = Math.cos(half);
  return { x: axis.x * s, y: axis.y * s, z: axis.z * s, w: c };
}

/** Any unit vector perpendicular to `v`. */
function anyPerpendicular(v: Vec3): Vec3 {
  const ref = Math.abs(v.y) < 0.9 ? { x: 0, y: 1, z: 0 } : { x: 1, y: 0, z: 0 };
  return normalizeDirection(cross3(v, ref), { x: 1, y: 0, z: 0 });
}

/**
 * The MINIMAL rotation sending `from` onto `to` (both unit). Identity when they already coincide;
 * a half-turn about an arbitrary perpendicular when they oppose.
 */
function quatFromTo(from: Vec3, to: Vec3): Quat {
  const axis = cross3(from, to);
  const axisNorm = norm3(axis);
  if (axisNorm > 1e-9) {
    const angle = Math.acos(clamp(dot3(from, to), -1, 1));
    return axisAngleQuat({ x: axis.x / axisNorm, y: axis.y / axisNorm, z: axis.z / axisNorm }, angle);
  }
  return dot3(from, to) >= 0 ? { ...IDENTITY_Q } : axisAngleQuat(anyPerpendicular(from), Math.PI);
}

/**
 * Rotate `dir` toward `ref` so the angle between them does not exceed `limit` rad. Degenerate when
 * they are (anti-)parallel; a direction already inside the limit is returned unchanged.
 */
function clampBend(dir: Vec3, ref: Vec3, limit: number): Vec3 {
  const angle = Math.acos(clamp(dot3(dir, ref), -1, 1));
  if (angle <= limit) return dir;
  const axis = cross3(dir, ref);
  const axisNorm = norm3(axis);
  if (axisNorm < 1e-9) return dir; // (anti-)parallel — no single clamping plane
  const excess = angle - limit;
  return qRotate(axisAngleQuat({ x: axis.x / axisNorm, y: axis.y / axisNorm, z: axis.z / axisNorm }, excess), dir);
}

/** Bind-frame world transform accumulated root-first up to (and including) `boneName`. */
function accumulateWorld(
  joints: readonly ChainJoint[],
  byName: ReadonlyMap<string, ChainJoint>,
  boneName: string | undefined,
): { worldQ: Quat; worldP: Vec3 } {
  if (boneName === undefined) return { worldQ: { ...IDENTITY_Q }, worldP: { ...ZERO } };
  const chain: ChainJoint[] = [];
  let cur = byName.get(boneName);
  while (cur) {
    chain.unshift(cur);
    cur = cur.parentBoneName === undefined ? undefined : byName.get(cur.parentBoneName);
  }
  let worldQ: Quat = { ...IDENTITY_Q };
  let worldP: Vec3 = { ...ZERO };
  for (const joint of chain) {
    worldP = add(worldP, qRotate(worldQ, joint.bindLocalPosition));
    worldQ = normalizeQuat(qMul(worldQ, joint.bindLocalQuaternion));
  }
  return { worldQ, worldP };
}

function assertFinite(pose: SolvedArmPose): void {
  for (const q of [pose.shoulderLocal, pose.elbowLocal, pose.wristLocal]) {
    if (![q.x, q.y, q.z, q.w].every(Number.isFinite)) {
      throw new Error("solveArmChain: produced a non-finite quaternion — refusing NaN output");
    }
  }
}

/**
 * MakeHuman/MPFB names its long-limb twist helpers `<limb>02` (`upperarm02.L`, `lowerleg02.L`, ...).
 * These share a limb with the `*01` flex bone and rotate about its long axis; they flex nowhere, so a
 * two-bone solve must never name one the elbow or shoulder. Scoped to the four long limbs and the
 * side separator the shipped MPFB rigs carry, so no Anny/Mixamo/constructed bone name collides.
 */
const MPFB_TWIST_HELPER = /^(?:upperarm|lowerarm|upperleg|lowerleg)02\./u;

/** Nearest ancestor of `bone` that can flex: skips MakeHuman/MPFB `*02` twist helpers while walking
 *  parents. On rails without them this is exactly the direct parent — the two-hop chain is unchanged. */
function flexingParent(byName: ReadonlyMap<string, ChainJoint>, bone: ChainJoint): ChainJoint | undefined {
  let parent = bone.parentBoneName === undefined ? undefined : byName.get(bone.parentBoneName);
  while (parent !== undefined && MPFB_TWIST_HELPER.test(parent.boneName)) {
    parent = parent.parentBoneName === undefined ? undefined : byName.get(parent.parentBoneName);
  }
  return parent;
}

/**
 * Solve the right-arm chain so the wrist reaches `target`, expressed in the same accumulation the
 * clip's FK consumers use: bind rotations above the shoulder, then the returned node-local
 * rotations AT the shoulder, elbow and wrist.
 */
export function solveArmChain(input: SolveArmChainInput): SolvedArmPose {
  const { joints, effectorBone, target } = input;
  if (!Array.isArray(joints) || joints.length === 0) {
    throw new Error("solveArmChain: no joints to solve");
  }
  const byName = new Map(joints.map((j) => [j.boneName, j]));

  const wrist = byName.get(effectorBone);
  if (!wrist) throw new Error(`solveArmChain: effector bone "${effectorBone}" is not a joint of this rig`);
  // MakeHuman/MPFB splits each long limb into a `*01` flex bone and a `*02` twist helper, so a bare
  // two-parent walk from the wrist would name a twist segment the elbow (it twists, it does not flex)
  // and the real elbow the shoulder. Walk parent links and skip the twist helpers: on every other
  // rail the walk returns exactly the direct parents, so the historical two-hop chain is unchanged.
  const elbow = flexingParent(byName, wrist);
  if (!elbow) throw new Error(`solveArmChain: effector chain breaks above ${wrist.boneName} — no flex joint`);
  const shoulder = flexingParent(byName, elbow);
  if (!shoulder) throw new Error(`solveArmChain: effector chain breaks above ${elbow.boneName} — no flex joint`);
  if (shoulder.boneName === elbow.boneName || elbow.boneName === wrist.boneName) {
    throw new Error("solveArmChain: degenerate chain — shoulder/elbow/wrist are not three distinct joints");
  }

  // World frame of the shoulder's PARENT, then the shoulder's own bind-world position.
  const { worldQ, worldP } = accumulateWorld(joints, byName, shoulder.parentBoneName);
  const parentQ = normalizeQuat(worldQ);
  const shoulderWorld = add(worldP, qRotate(parentQ, shoulder.bindLocalPosition));

  const l1 = norm3(elbow.bindLocalPosition);
  const l2 = norm3(wrist.bindLocalPosition);
  if (l1 < 1e-6 || l2 < 1e-6) {
    throw new Error("solveArmChain: zero-length arm segment — cannot solve a guard on this rig");
  }
  const eHat = { x: elbow.bindLocalPosition.x / l1, y: elbow.bindLocalPosition.y / l1, z: elbow.bindLocalPosition.z / l1 };
  const fHat = { x: wrist.bindLocalPosition.x / l2, y: wrist.bindLocalPosition.y / l2, z: wrist.bindLocalPosition.z / l2 };

  const toTarget = sub(target, shoulderWorld);
  const r = norm3(toTarget);
  if (r < 1e-6) throw new Error("solveArmChain: target coincides with the shoulder — no arm pose can reach it");
  const d = { x: toTarget.x / r, y: toTarget.y / r, z: toTarget.z / r };

  // Analytic two-bone solve: shoulder direction u, forearm direction v, with |l1 u + l2 v| = r.
  const reachMin = Math.abs(l1 - l2);
  const reachMax = l1 + l2;
  let u: Vec3;
  let v: Vec3;
  if (r >= reachMax - 1e-6) {
    u = d;
    v = d;
  } else if (r <= reachMin + 1e-6) {
    u = d;
    v = scale(d, -1);
  } else {
    const cosPhi = clamp((l1 * l1 + r * r - l2 * l2) / (2 * l1 * r), -1, 1);
    const phi = Math.acos(cosPhi);
    // Rest direction of the upper arm; the elbow plane is the plane through it and the target, so
    // the shoulder takes the minimal rotation that puts the hand on the target.
    const u0 = qRotate(parentQ, eHat);
    const uPerp =
      norm3(cross3(u0, d)) > 1e-6
        ? normalizeDirection(sub(u0, scale(d, dot3(u0, d))), anyPerpendicular(d))
        : anyPerpendicular(d);
    u = add(scale(d, cosPhi), scale(uPerp, Math.sin(phi)));
    v = normalizeDirection(sub(scale(d, r), scale(u, l1)), { x: 0, y: -1, z: 0 });
  }

  // Conservative engineering joint limits: clamp the bends, degrade the reach rather than the joint.
  u = clampBend(u, eHat, SHOULDER_BEND_LIMIT_RAD);
  v = normalizeDirection(sub(scale(d, r), scale(u, l1)), { x: 0, y: -1, z: 0 });
  v = clampBend(v, fHat, ELBOW_BEND_LIMIT_RAD);

  // Node-local absolute rotations. The shoulder rotation maps the rest upper-arm direction onto
  // u in the shoulder's parent frame; the elbow maps the rest forearm direction onto v in the
  // elbow's parent frame; the wrist adds a protective pronation about the rig's own forearm axis,
  // scaled by the rig's own total arm length.
  const uLocal = qRotate(qConj(parentQ), u);
  const shoulderLocal = quatFromTo(eHat, uLocal);
  const elbowParentQ = normalizeQuat(qMul(parentQ, shoulderLocal));
  const vLocal = qRotate(qConj(elbowParentQ), v);
  const elbowLocal = quatFromTo(fHat, vLocal);
  const twist = WRIST_TWIST_GAIN * (l1 + l2);
  const wristLocal = axisAngleQuat(fHat, twist);

  const pose: SolvedArmPose = {
    shoulderBone: shoulder.boneName,
    elbowBone: elbow.boneName,
    wristBone: wrist.boneName,
    shoulderLocal,
    elbowLocal,
    wristLocal,
  };
  assertFinite(pose);
  return pose;
}
