import { resolvePoseBone } from "@openclinxr/asset-registry";

/**
 * Effector resolution for the BODY primitives — `clutch_body_region` and `guard_body_region`.
 *
 * The planted compiler-surface contract (clause 3) measured both primitives reading a scalar
 * `skeletonProfile.effectorBone` and never `action.effector`, so a left-hand response moved the
 * right hand. The IR's `MotionAction` carries the canonical effector (`handL` / `handR`), and the
 * profile's `effectorBone` is that rig's OWN wrist name — two different questions that used to be
 * one field.
 *
 * RESOLUTION ORDER, stated because precedence is the whole repair:
 *   1. `action.effector` — what the request actually asked for.
 *   2. `skeletonProfile.effectorBone` — legacy profiles / direct primitive callers that predate the
 *      action carrying an effector (the registry seam's own fixture dates from before M1's IR).
 *   3. a canonical default, so a request that names neither keeps the historic behaviour.
 *
 * The canonical name is then resolved against the rig's OWN joint table through
 * `resolvePoseBone` (identity-then-alias across the 23-bone / MPFB2 / mixamorig families), so a
 * profile that carries the bone under a family name still compiles. A profile with NO joint table
 * (the plant fixtures' `{ rigFingerprint, joints: {} }`) cannot express a rig-specific name and
 * keeps the canonical string itself.
 *
 * NOTHING HERE MUTATES THE PROFILE. `compileMotionProgram` hashes the whole profile into
 * `skeletonProfileHash`; the effector lives on the ACTION so two hands compile under one rig
 * identity (clause 3's counterweight refuses the `effectorBone`-on-profile fix for exactly this).
 */

const DEFAULT_EFFECTOR = "handR";

/** The effector string the request names: action first, profile legacy second, canonical default last. */
export function requestedEffector(request: { action: unknown; skeletonProfile: unknown }): string {
  const actionEffector = (request.action as { effector?: unknown }).effector;
  if (typeof actionEffector === "string" && actionEffector.length > 0) return actionEffector;
  const profileEffector = (request.skeletonProfile as { effectorBone?: unknown }).effectorBone;
  if (typeof profileEffector === "string" && profileEffector.length > 0) return profileEffector;
  return DEFAULT_EFFECTOR;
}

/**
 * The bone name to write tracks on: the requested effector resolved against the profile's own joint
 * table, or the requested string itself when the profile carries no joints to resolve against.
 */
export function effectorBoneOnRig(
  request: { action: unknown; skeletonProfile: unknown },
  requested: string,
): string {
  const joints = (request.skeletonProfile as { joints?: unknown }).joints;
  if (!Array.isArray(joints) || joints.length === 0) return requested;
  const jointSet = new Set<string>();
  for (const joint of joints) {
    const name = (joint as { boneName?: unknown }).boneName;
    if (typeof name === "string" && name.length > 0) jointSet.add(name);
  }
  const resolved = resolvePoseBone(requested, jointSet);
  if (resolved !== null) return resolved;
  throw new Error(
    `effector "${requested}" does not resolve to a bone on this rig — refusing to address a bone the rig does not carry`,
  );
}

/** True when a bone name is a LEFT-side bone (`handL`, `wristL`, `mixamorig:LeftHand`, ...). */
export function isLeftSideBone(boneName: string): boolean {
  return /\bLeft\b/u.test(boneName) || /(?<=[^A-Z])L$/u.test(boneName);
}
