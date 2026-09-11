import type { Quat } from "../ik/solve-chain.js";

export const signCanonical = (q: Quat): Quat => {
  if (q.w !== 0) return q.w > 0 ? q : { x: -q.x, y: -q.y, z: -q.z, w: -q.w };
  if (q.x !== 0) return q.x > 0 ? q : { x: -q.x, y: -q.y, z: -q.z, w: -q.w };
  if (q.y !== 0) return q.y > 0 ? q : { x: -q.x, y: -q.y, z: -q.z, w: -q.w };
  return q.z >= 0 ? q : { x: -q.x, y: -q.y, z: -q.z, w: -q.w };
};

export const signMatch = (q: Quat, ref: Quat): Quat => {
  const dot = q.x * ref.x + q.y * ref.y + q.z * ref.z + q.w * ref.w;
  return dot < 0 ? { x: -q.x, y: -q.y, z: -q.z, w: -q.w } : q;
};

/** The rotation `q` scaled to `fraction` of its angle, same axis. */
export function scaleRotation(q: Quat, fraction: number): Quat {
  const vn = Math.hypot(q.x, q.y, q.z);
  if (vn < 1e-12) return { x: 0, y: 0, z: 0, w: 1 };
  const sign = q.w < 0 ? -1 : 1;
  const angle = 2 * Math.atan2(vn, Math.abs(q.w));
  const axis = { x: (q.x / vn) * sign, y: (q.y / vn) * sign, z: (q.z / vn) * sign };
  const half = (fraction * angle) / 2;
  return { x: axis.x * Math.sin(half), y: axis.y * Math.sin(half), z: axis.z * Math.sin(half), w: Math.cos(half) };
}
