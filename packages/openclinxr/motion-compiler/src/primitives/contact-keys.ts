import { scaleRotation, signCanonical, signMatch } from "./quaternion-scale.js";
import type { Quat } from "../ik/solve-chain.js";
import type { ContactKey } from "../contact/contact-window-schedule.js";
import type { QuatTuple } from "../canonical-motion-contract.js";

/**
 * Values for one bone across a CONTACT schedule: the identical solved pose across each hold
 * run, bind at rest, and the retention-scaled settle. Release keys inserted by compile sample
 * the shared minimum-jerk envelope out of the hold. Sign-aligned per key so the emitted
 * track satisfies the canonical sign-continuity rule.
 */
export function contactKeyValues(
  keys: readonly ContactKey[],
  bindLocalQuaternion: Quat,
  poseOf: (window: number) => Quat,
  retention: number,
): readonly QuatTuple[] {
  let prev = signCanonical(bindLocalQuaternion);
  let lastHeld: Quat | undefined;
  let lastPose: Quat | undefined;
  let lastWindow = -1;
  const values: QuatTuple[] = [];
  for (const key of keys) {
    if (key.pose.kind === "point") {
      // Hold keys stay the identical solved pose: the interpolated effector never drifts off
      // the contact (contact guard, contactWindow schedule). Seed variation moves amplitudes
      // only through the release path in compile, never the hold. Memoize the pose: two keys
      // for the same window must be byte-identical, whatever the solver recomputes.
      if (lastWindow !== key.pose.window || lastPose === undefined) {
        lastPose = poseOf(key.pose.window);
        lastWindow = key.pose.window;
        lastHeld = lastPose;
      }
      const q = signMatch(lastPose, prev);
      prev = q;
      values.push([q.x, q.y, q.z, q.w]);
      continue;
    }
    let raw: Quat;
    if (key.pose.kind === "bind") {
      raw = bindLocalQuaternion;
    } else if (lastHeld !== undefined) {
      raw = scaleRotation(lastHeld, retention);
    } else {
      raw = bindLocalQuaternion;
    }
    const q = signMatch(raw, prev);
    prev = q;
    values.push([q.x, q.y, q.z, q.w]);
  }
  return values;
}
