/** Shared quaternion metrics for the settle-entry analyzers (turn-leg-snaps). */

export type Quat4 = { x: number; y: number; z: number; w: number };

/** Quaternion norm; 1 for a clean rotation, off-unit while the solver drifts. */
export function quatNorm(q: Quat4): number {
  return Math.hypot(q.x, q.y, q.z, q.w);
}

/**
 * One-frame rotation between two quaternions in degrees, normalising first.
 * Measuring the raw dot mistook non-unit quaternions for motion (two identical
 * quaternions at norm 0.862 read 84 deg); normalised inputs read 0.
 */
export function quatStepDeg(a: Quat4, b: Quat4): number {
  const na = quatNorm(a);
  const nb = quatNorm(b);
  if (!(na > 0) || !(nb > 0)) return Number.NaN;
  const dot = Math.abs(
    (a.x * b.x + a.y * b.y + a.z * b.z + a.w * b.w) / (na * nb),
  );
  return (2 * Math.acos(Math.min(1, dot)) * 180) / Math.PI;
}

/** Running min/max norm accumulator over one bone's quaternions in a run. */
export type NormBand = { min: number; max: number };

export function normBandOf(quats: Array<Quat4 | null>): NormBand | null {
  let min = Number.POSITIVE_INFINITY;
  let max = Number.NEGATIVE_INFINITY;
  for (const q of quats) {
    if (q === null) continue;
    const n = quatNorm(q);
    if (n < min) min = n;
    if (n > max) max = n;
  }
  if (min === Number.POSITIVE_INFINITY) return null;
  return { min, max };
}
