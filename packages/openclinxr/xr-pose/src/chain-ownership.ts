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
 */
export type OwnedChain = {
  /** Who claimed the chain. Two executors must not claim the same bone; the caller decides. */
  ownerId: string;
  /** Exact bone names, as they appear on the rig. No patterns, no prefixes. */
  boneNames: readonly string[];
};

/** True when `boneName` appears verbatim in any declared chain. */
export function boneIsOwned(owned: readonly OwnedChain[], boneName: string): boolean {
  return owned.some((chain) => chain.boneNames.includes(boneName));
}
