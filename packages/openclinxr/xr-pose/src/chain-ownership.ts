/**
 * Which bone chains a motion executor OWNS for the duration of a performance.
 *
 * WHY. The frame loop writes posture to every bone every frame
 * (xr-humanoid-animation/src/animation-loop.ts, applyIdlePosture / applyRolePosture), so any pose
 * an executor produces is overwritten before it can be seen. Three carve-outs already exist and
 * work — sourceComparatorFreezeEnabled at animation-loop.ts:92, the supine and seated userData
 * checks at :114-119, and seatedClipPerforming at :120 with its policy in
 * seated-role-clip-policy.ts:56. This is a FOURTH of the same kind, and it is a seam rather than
 * an executor: nothing here plays a clip or solves a chain.
 *
 * OWNERSHIP IS DECLARED, NEVER INFERRED. The caller passes the bones it claims. A bone whose name
 * merely RESEMBLES an owned one is not owned: a name-pattern rule would silently capture
 * `upper_armR` the day someone renames a chain, and the whole point of the carve-out is that the
 * unowned neighbour keeps moving.
 *
 * EFFECTOR RESIDUAL IS NOT AN ACCEPTANCE MEASURE ANYWHERE NEAR THIS SEAM, by measurement rather
 * than preference: the recorded bake-off (tools/openclinxr/evidence/motion-backend-bakeoff/report.json:67)
 * returned verdict "other" because the CCDIKSolver reported a wristR residual of 0.0000 m for a
 * chain that rendered the right arm ABSENT through a torn shoulder. Chain integrity — every bone
 * in the chain, not just its effector — is what a carve-out has to preserve.
 *
 * ## CHANGED: Added optional `weight` in [0,1] for crossfade between clip-driven and idle posture.
 * When weight < 1, the posture pass writes slerp(idleRotation, mixerRotation, weight) so the
 * transition is smooth. Default is 1 (full ownership, skip posture write entirely).
 */
export type OwnedChain = {
  /** Who claimed the chain. Two executors must not claim the same bone; the caller decides. */
  ownerId: string;
  /** Exact bone names, as they appear on the rig. No patterns, no prefixes. */
  boneNames: readonly string[];
  /** Blend weight in [0,1]. 1 = full ownership (posture skips bone). <1 = crossfade with idle. */
  weight?: number;
  /**
   * Live handle of the claiming action. A claim whose action is no longer scheduled
   * (finished-and-released, faded out, or explicitly stopped — stop() emits no
   * `finished` event) is expired; the next hold frame prunes it so bones settle.
   */
  action?: { isScheduled(): boolean };
  /**
   * Rest-relative overlay reference: bone name → the clip's first-keyframe quaternion
   * for that bone's track, in bone-local space. The hold composes
   * qFinal = qPlanted * inverse(qRef) * qAnimated so a zero-response frame is the
   * identity delta and the planted pose survives. Pruned with the chain.
   */
  reference?: Record<string, readonly [number, number, number, number]>;
};

/** True when `boneName` appears verbatim in any declared chain. */
export function boneIsOwned(owned: readonly OwnedChain[], boneName: string): boolean {
  return owned.some((chain) => chain.boneNames.includes(boneName));
}

/**
 * One-shot motion overlay seam (generic; no per-response literal here).
 *
 * WHY. The frame loop runs mixer.update THEN the support hold
 * (xr-humanoid-animation/src/animation-loop.ts, supine path), so a one-shot clip's
 * bone writes are overwritten before they render. The caller declares the clip's driven
 * bones as owned; the support hold then skips exactly those bones while floor, root,
 * head-support and incline keeps hold the rest. Ownership is released when the clip
 * finishes, so the next hold frame settles the bones back onto support.
 *
 * The claim rides on the driven root's userData, same host the idle-posture pass reads.
 */
const RESPONSE_OVERLAY_KEY = "openClinXrOwnedBoneChains";

type OwnableRoot = { userData?: Record<string, unknown> };

function readChains(host: OwnableRoot): OwnedChain[] {
  const raw = host.userData?.[RESPONSE_OVERLAY_KEY];
  if (!Array.isArray(raw)) return [];
  const live = (raw as OwnedChain[]).filter((chain) => Array.isArray(chain?.boneNames));
  const pruned = live.filter((chain) => !chain.action || chain.action.isScheduled());
  if (pruned.length !== live.length && host.userData) {
    if (pruned.length === 0) delete host.userData[RESPONSE_OVERLAY_KEY];
    else host.userData[RESPONSE_OVERLAY_KEY] = pruned;
  }
  return pruned;
}

/** Claim `boneNames` for `ownerId`, replacing that owner's prior claim. Idempotent. */
function declareOwnedChains(
  host: OwnableRoot,
  ownerId: string,
  boneNames: readonly string[],
  action?: { isScheduled(): boolean },
  reference?: Record<string, readonly [number, number, number, number]>,
): OwnedChain[] {
  if (!host.userData) return [];
  const next = [...readChains(host).filter((chain) => chain.ownerId !== ownerId)];
  if (boneNames.length > 0) next.push({ ownerId, boneNames: [...boneNames], ...(action ? { action } : {}), ...(reference ? { reference } : {}) });
  host.userData[RESPONSE_OVERLAY_KEY] = next;
  return next;
}

/** Release `ownerId`'s claim. Bones fall back to the support hold on the next frame. */
function releaseOwnedChains(host: OwnableRoot, ownerId: string): OwnedChain[] {
  if (!host.userData) return [];
  const next = readChains(host).filter((chain) => chain.ownerId !== ownerId);
  if (next.length === 0) delete host.userData[RESPONSE_OVERLAY_KEY];
  else host.userData[RESPONSE_OVERLAY_KEY] = next;
  return next;
}

/**
 * True when `boneName` is owned on this driven root. Support-hold writers call this
 * before overwriting a bone so an active one-shot overlay survives mixer-then-hold order.
 */
export function boneIsOwnedOnRoot(host: OwnableRoot, boneName: string): boolean {
  return boneIsOwned(readChains(host), boneName);
}

/** Clip reference quaternion for an owned bone, when the claiming chain stored one. */
export function ownedReferenceQuaternionOnRoot(
  host: OwnableRoot,
  boneName: string,
): readonly [number, number, number, number] | undefined {
  for (const chain of readChains(host)) {
    const ref = chain.reference?.[boneName];
    if (ref) return ref;
  }
  return undefined;
}

/** Get the ownership weight for a bone (default 1 if owned, undefined if not owned). */
export function boneOwnershipWeight(owned: readonly OwnedChain[], boneName: string): number | undefined {
  for (const chain of owned) {
    if (chain.boneNames.includes(boneName)) {
      return chain.weight ?? 1;
    }
  }
  return undefined;
}
