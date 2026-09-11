import { minimumJerkFall } from "../trajectory/minimum-jerk-fall.js";
import { scaleRotation, signCanonical } from "./quaternion-scale.js";
import type { Quat, SolvedArmPose } from "../ik/solve-chain.js";
import type { ContactKey } from "../contact/contact-window-schedule.js";

/** Seed jitter on the contact release amplitude: bounded variation that cannot move the hold. */
export const CONTACT_VARIATION_JITTER = 0.12;
/** How much of the hold-amplitude seed scale the release retains. */
export const CONTACT_RELEASE_VARIATION_GAIN = 0.5;

/**
 * Release keys past the last contact key: the window schedule emits one settle key, which the
 * LINEAR sampler would reach in a single straight step. Intermediate keys sample the shared
 * minimum-jerk release between the window end and the settle, so the fall eases out of the
 * hold at rest velocity. Inserted keys carry no pose of their own — values are interpolated
 * from the surrounding schedule keys below — so the schedule's refusal semantics are unchanged.
 */
export function planContactReleaseKeys(keys: readonly ContactKey[]): ContactKey[] {
  let lastPoint = -1;
  let lastSettle = -1;
  for (const [i, key] of keys.entries()) {
    if (key.pose.kind === "point") lastPoint = i;
    if (key.pose.kind === "settle") lastSettle = i;
  }
  if (lastPoint < 0 || lastSettle < 0 || lastSettle <= lastPoint) return [];
  const fromKey = keys[lastPoint];
  const toKey = keys[lastSettle];
  if (fromKey === undefined || toKey === undefined) return [];
  const from = fromKey.fraction;
  const to = toKey.fraction;
  if (!(to > from)) return [];
  const out: ContactKey[] = [];
  for (const p of [0.25, 0.5, 0.75]) {
    const fraction = from + (to - from) * p;
    if (fraction > from + 1e-9 && fraction < to - 1e-9) out.push({ fraction, pose: { kind: "settle" } });
  }
  return out;
}

export function contactReleaseValue(
  key: ContactKey,
  windowEnd: number,
  settleFraction: number,
  held: Quat,
  retention: number,
  amp: number,
): Quat | null {
  if (key.pose.kind !== "settle" || key.fraction <= windowEnd + 1e-9) return null;
  if (!(settleFraction > windowEnd)) return null;
  const progress = (key.fraction - windowEnd) / (settleFraction - windowEnd);
  // Slerp between the unit held pose and its unit retention-scaled settle on the shared
  // minimum-jerk envelope: every release key stays on the unit sphere, eases out of the
  // hold at rest velocity, and lands on the retention settle the schedule freezes.
  const p = Math.min(1, Math.max(0, progress));
  const fall = minimumJerkFall(p);
  const target = scaleRotation(held, retention * (1 + (amp - 1) * CONTACT_RELEASE_VARIATION_GAIN));
  const dot = held.x * target.x + held.y * target.y + held.z * target.z + held.w * target.w;
  const end = dot < 0
    ? { x: -target.x, y: -target.y, z: -target.z, w: -target.w }
    : target;
  const clamped = Math.min(1, Math.max(-1, Math.abs(dot)));
  if (clamped > 0.9995) {
    const lerped = {
      x: held.x + (end.x - held.x) * (1 - fall),
      y: held.y + (end.y - held.y) * (1 - fall),
      z: held.z + (end.z - held.z) * (1 - fall),
      w: held.w + (end.w - held.w) * (1 - fall),
    };
    const n = Math.hypot(lerped.x, lerped.y, lerped.z, lerped.w) || 1;
    return { x: lerped.x / n, y: lerped.y / n, z: lerped.z / n, w: lerped.w / n };
  }
  const theta = Math.acos(clamped);
  const sin = Math.sin(theta);
  const wa = Math.sin(fall * theta) / sin;
  const wb = Math.sin((1 - fall) * theta) / sin;
  return {
    x: held.x * wa + end.x * wb,
    y: held.y * wa + end.y * wb,
    z: held.z * wa + end.z * wb,
    w: held.w * wa + end.w * wb,
  };
}

/** The last held pose on one driven bone: the window schedule's hold, memoized per window. */
export function lastHeldPose(
  poseForWindow: (window: number) => SolvedArmPose,
  keys: readonly ContactKey[],
  boneName: string,
): Quat | undefined {
  let held: Quat | undefined;
  for (const key of keys) {
    if (key.pose.kind === "point") {
      const pose = poseForWindow(key.pose.window);
      held = boneName === pose.shoulderBone
        ? pose.shoulderLocal
        : boneName === pose.elbowBone
          ? pose.elbowLocal
          : pose.wristLocal;
    }
  }
  return held;
}

/** The previous emitted value, sign-aligned from bind: continuity without rereading the schedule. */
export function prevOf(values: readonly (readonly [number, number, number, number])[], bind: Quat): Quat {
  const last = values[values.length - 1];
  if (last === undefined) return signCanonical(bind);
  return { x: last[0], y: last[1], z: last[2], w: last[3] };
}
