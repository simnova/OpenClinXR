import type { CompiledMotionFragment, CompiledMotionTrack, PrimitiveRequest } from "../canonical-motion-contract.js";
import { REGION_ANCHOR_SPACE } from "../plant-motion-regions.js";
import { resolvePoseBone } from "../../../asset-registry/src/pose-bone-resolver.js";
import { solveArmChain, type ChainJoint, type Quat } from "../ik/solve-chain.js";

/**
 * `guard_body_region` — the arm chain drives the effector hand to a MOTION REGION anchor and
 * holds the guarded posture there.
 *
 * Owned by M2 (tsk_744eea9a35614caf). The registry seam (tsk_51ffcc3e1a8fdea8) resolves
 * `guard_body_region` to this module's `compile` through the ownership slot at
 * `src/guard-body-region.ts`, which redirects here — the slot's body is replaced, never the
 * registry.
 *
 * BEHAVIOUR: a guard is a GEOMETRY solve, not a pose table. The request's target is a MOTION
 * REGION id (`{ kind: "body_region", id }`); the primitive resolves it to a bind-world anchor on
 * THIS rig (`profile.regionAnchors`), resolves the right-arm chain through
 * `resolvePoseBone` (identity-then-alias across the 23-bone / MPFB2 / mixamorig families,
 * ancestor-verified), and asks the `src/ik/solve-chain.ts` seam for shoulder + elbow rotations
 * that put the wrist on the anchor plus a rig-derived wrist pronation. The clip is a 3-keyframe
 * neutral -> peak -> settle shape whose PEAK is the solved pose, so the fragment's FK reaches the
 * anchor at the frame the guard plant measures.
 *
 * REFUSALS — never a silent default:
 *   - a profile that DECLARES an anchor space this module does not implement throws (the plant's
 *     clause (0b): a misread frame solves cleanly and puts the hand somewhere else on the body);
 *   - a target id with no anchor on this rig throws (the anchor map is the data, there is no
 *     per-target pose table);
 *   - an arm chain the alias map cannot resolve or that disagrees with the rig's own parent links
 *     throws.
 *
 * A profile that carries NO anchor space at all predates the anchor contract (the registry seam's
 * own fixture) and cannot express a reach; it gets the canonical EMPTY fragment the seam's contract
 * blesses, so the registry-level tests stay live.
 *
 * notEvidenceFor: clinical_validity, biomechanical_validity, production_animation_quality,
 * exam_equivalence, scoring, learner_readiness. Whether the pose LOOKS like guarding is a pixel
 * grade, deliberately outside this module.
 */

type Vec3 = { x: number; y: number; z: number };

const DEFAULT_DURATION_MS = 900;
const DEFAULT_INTENSITY = 0.6;
/** The peak keyframe sits here, as a fraction of the clip duration. */
const PEAK_FRACTION = 0.45;
/** How much of the peak rotation the settle keyframe retains (tied to the action intensity). */
const SETTLE_RETENTION = { min: 0.1, max: 0.4, perIntensity: 0.3 };

type ProfileView = {
  rigFingerprint?: unknown;
  effectorBone?: unknown;
  joints?: unknown;
  regionAnchorSpace?: unknown;
  regionAnchors?: unknown;
};

function isVec3(v: unknown): v is Vec3 {
  if (typeof v !== "object" || v === null) return false;
  const p = v as { x?: unknown; y?: unknown; z?: unknown };
  return typeof p.x === "number" && Number.isFinite(p.x)
    && typeof p.y === "number" && Number.isFinite(p.y)
    && typeof p.z === "number" && Number.isFinite(p.z);
}

function readActionId(request: PrimitiveRequest): string {
  const actionId = (request.action as { actionId?: unknown }).actionId;
  if (typeof actionId !== "string" || actionId.length === 0) {
    throw new Error("guard_body_region requires a request whose action carries a string actionId");
  }
  return actionId;
}

function readDurationMs(action: unknown): number {
  const durationMs = (action as { timing?: { durationMs?: unknown } }).timing?.durationMs;
  return typeof durationMs === "number" && Number.isFinite(durationMs) && durationMs > 0
    ? durationMs
    : DEFAULT_DURATION_MS;
}

function readIntensity(action: unknown): number {
  const intensity = (action as { intensity?: unknown }).intensity;
  return typeof intensity === "number" && Number.isFinite(intensity) ? intensity : DEFAULT_INTENSITY;
}

function readTarget(action: unknown): { kind: "body_region"; id: string } {
  const target = (action as { target?: unknown }).target as { kind?: unknown; id?: unknown } | undefined;
  if (target?.kind !== "body_region" || typeof target.id !== "string" || target.id.length === 0) {
    throw new Error("guard_body_region requires a target of kind body_region with a string id");
  }
  return { kind: "body_region", id: target.id };
}

/** Resolve the right-arm chain on this rig: alias-resolved wrist, then ancestor-verified. */
function resolveArmChain(profile: ProfileView): { shoulderName: string; elbowName: string; wristName: string } {
  const joints = profile.joints as readonly ChainJoint[] | undefined;
  if (!Array.isArray(joints) || joints.length === 0) {
    throw new Error("guard_body_region: profile carries no joints — no arm to solve");
  }
  const jointSet = new Set(joints.map((j) => j.boneName));
  const effector = profile.effectorBone;
  if (typeof effector !== "string" || effector.length === 0) {
    throw new Error("guard_body_region: profile carries no effectorBone — the wrist cannot be named");
  }

  const wristName = resolvePoseBone(effector, jointSet);
  if (wristName === null) {
    throw new Error(`guard_body_region: effector "${effector}" does not resolve to a bone on this rig`);
  }
  const byName = new Map(joints.map((j) => [j.boneName, j]));
  const wrist = byName.get(wristName);
  const elbow = wrist?.parentBoneName === undefined ? undefined : byName.get(wrist.parentBoneName);
  const shoulder = elbow?.parentBoneName === undefined ? undefined : byName.get(elbow.parentBoneName);
  if (!wrist || !elbow || !shoulder) {
    throw new Error(`guard_body_region: arm chain broken above ${wristName} — a guard needs shoulder -> elbow -> wrist`);
  }

  // CROSS-CHECK against the alias map: the resolved canonical landmarks must name the SAME chain
  // the rig's own parent links do. A rig where they disagree is refused, never guessed.
  const aliasShoulder = resolvePoseBone("upper_armR", jointSet);
  const aliasElbow = resolvePoseBone("forearmR", jointSet);
  if (aliasShoulder !== shoulder.boneName || aliasElbow !== elbow.boneName) {
    throw new Error(
      "guard_body_region: resolved arm chain disagrees with the pose-bone alias map — refused rather than guessed",
    );
  }
  return { shoulderName: shoulder.boneName, elbowName: elbow.boneName, wristName: wrist.boneName };
}

const signCanonical = (q: Quat): Quat => {
  if (q.w !== 0) return q.w > 0 ? q : { x: -q.x, y: -q.y, z: -q.z, w: -q.w };
  if (q.x !== 0) return q.x > 0 ? q : { x: -q.x, y: -q.y, z: -q.z, w: -q.w };
  if (q.y !== 0) return q.y > 0 ? q : { x: -q.x, y: -q.y, z: -q.z, w: -q.w };
  return q.z >= 0 ? q : { x: -q.x, y: -q.y, z: -q.z, w: -q.w };
};

const signMatch = (q: Quat, ref: Quat): Quat => {
  const dot = q.x * ref.x + q.y * ref.y + q.z * ref.z + q.w * ref.w;
  return dot < 0 ? { x: -q.x, y: -q.y, z: -q.z, w: -q.w } : q;
};

/** The rotation `q` scaled to `fraction` of its angle, same axis. */
function scaleRotation(q: Quat, fraction: number): Quat {
  const vn = Math.hypot(q.x, q.y, q.z);
  if (vn < 1e-12) return { x: 0, y: 0, z: 0, w: 1 };
  const sign = q.w < 0 ? -1 : 1;
  const angle = 2 * Math.atan2(vn, Math.abs(q.w));
  const axis = { x: (q.x / vn) * sign, y: (q.y / vn) * sign, z: (q.z / vn) * sign };
  const half = (fraction * angle) / 2;
  return { x: axis.x * Math.sin(half), y: axis.y * Math.sin(half), z: axis.z * Math.sin(half), w: Math.cos(half) };
}

type QuatTuple = readonly [number, number, number, number];

/** The 3-keyframe neutral -> peak -> settle values for one bone. */
function keyframes(bindLocalQuaternion: Quat, solved: Quat, retention: number): readonly QuatTuple[] {
  const q0 = signCanonical(bindLocalQuaternion);
  const q1 = signMatch(solved, q0);
  const q2 = signMatch(scaleRotation(q1, retention), q1);
  return [
    [q0.x, q0.y, q0.z, q0.w],
    [q1.x, q1.y, q1.z, q1.w],
    [q2.x, q2.y, q2.z, q2.w],
  ];
}

export function compile(request: PrimitiveRequest): CompiledMotionFragment {
  const actionId = readActionId(request);
  const profile = request.skeletonProfile as ProfileView;

  // A profile with NO anchor space predates the anchor contract (the registry seam's own fixture)
  // and cannot express a reach. Emit the canonical empty fragment the seam contract blesses.
  if (profile.regionAnchorSpace === undefined) {
    return { actionId, tracks: [] };
  }
  if (profile.regionAnchorSpace !== REGION_ANCHOR_SPACE) {
    throw new Error(
      `guard_body_region: the guard compiled anchors in a space it does not implement — ` +
        `"${String(profile.regionAnchorSpace)}" is not ${REGION_ANCHOR_SPACE}`,
    );
  }

  const target = readTarget(request.action);
  const anchors = profile.regionAnchors as Readonly<Record<string, unknown>> | undefined;
  if (typeof anchors !== "object" || anchors === null) {
    throw new Error(`guard_body_region: profile declares ${REGION_ANCHOR_SPACE} but carries no regionAnchors`);
  }
  const anchor = anchors[target.id];
  if (!isVec3(anchor)) {
    throw new Error(
      `guard_body_region: region "${target.id}" has no anchor on this rig — the anchor map is the data, there is no per-target pose table`,
    );
  }

  const chain = resolveArmChain(profile);
  const durationMs = readDurationMs(request.action);
  const retention = Math.min(
    SETTLE_RETENTION.max,
    Math.max(SETTLE_RETENTION.min, SETTLE_RETENTION.perIntensity * readIntensity(request.action)),
  );

  const joints = profile.joints as readonly ChainJoint[];
  const pose = solveArmChain({ joints, effectorBone: chain.wristName, target: anchor });

  const byName = new Map(joints.map((j) => [j.boneName, j]));
  const poseOf = (boneName: string): Quat => {
    switch (boneName) {
      case pose.shoulderBone: return pose.shoulderLocal;
      case pose.elbowBone: return pose.elbowLocal;
      default: return pose.wristLocal;
    }
  };

  const times = [0, durationMs * PEAK_FRACTION, durationMs];
  const tracks: CompiledMotionTrack[] = [pose.shoulderBone, pose.elbowBone, pose.wristBone].map((boneName) => {
    const bind = byName.get(boneName);
    if (!bind) throw new Error(`guard_body_region: solved bone "${boneName}" vanished from the joint table`);
    return {
      property: "rotationAbsoluteNodeLocal",
      boneName,
      canonicalLandmark: target.id,
      interpolation: "LINEAR",
      times,
      values: keyframes(bind.bindLocalQuaternion, poseOf(boneName), retention),
    };
  });

  return { actionId, tracks };
}
