/**
 * THE TRAJECTORY LAYER — the minimum-jerk shape and the seeded variation every M4 primitive shares.
 *
 * Card tsk_ccc9fb8c7f0def8b (M4). The primitive-registry plant's clause (3) measures
 * `minimumJerkProfile` directly and bounds the SHAPE, not two endpoints: the analytic peak-to-mean
 * velocity ratio 1.875 = 15/8 of the quintic x(t) = 10t³ − 15t⁴ + 6t⁵ discriminates it from a
 * raised-cosine ease (π/2 ≈ 1.571) and a linear ramp (1.0), both of which share its zero endpoint
 * velocity and mid-motion peak. So this module's contract is the quintic itself, sampled.
 *
 * The rest of the file is the shared machinery the four primitives consume:
 *
 *   - the seeded PRNG (FNV-1a hash + mulberry32) that makes a seed STRING name a deterministic
 *     variation stream. Clause (2) of the plant is the load-bearing half of the determinism
 *     contract: one seed must reproduce byte-identically AND a different seed must change the
 *     motion. A compile is a pure function of (request, seed) — no Date, no Math.random, no
 *     ambient state — which is what makes both halves hold at once.
 *   - the approach/hold/release envelope that segments the minimum-jerk profile into the
 *     three-phase structure the action's contact constraints describe (approach to the target,
 *     hold while contact is required, release back to rest).
 *   - the axis-angle quaternion builder, so rotation tracks stay on the unit sphere with a
 *     canonical sign (w > 0 for |angle| < π) — the properties `violationsInTracks` enforces.
 */

/** x(t) = 10t³ − 15t⁴ + 6t⁵, the minimum-jerk quintic on [0, 1]. */
export function minimumJerkSample(t: number): number {
  const p = t < 0 ? 0 : t > 1 ? 1 : t;
  return 10 * p ** 3 - 15 * p ** 4 + 6 * p ** 5;
}

/**
 * The minimum-jerk profile as a sampled array over [0, 1], endpoints inclusive. `samples - 1`
 * intervals, so the first sample is 0 (rest) and the last is 1 (arrival).
 */
export function minimumJerkProfile(options: { samples: number }): number[] {
  const { samples } = options;
  if (samples <= 0) return [];
  const out = new Array<number>(samples);
  for (let i = 0; i < samples; i += 1) {
    out[i] = samples === 1 ? 0 : minimumJerkSample(i / (samples - 1));
  }
  return out;
}

/**
 * FNV-1a 32-bit. A stable string→uint32 hash, so a seed string names a deterministic stream
 * rather than depending on a runtime hash seed.
 */
export function hashSeed(seed: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < seed.length; i += 1) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/**
 * mulberry32 — a tiny deterministic PRNG. Seeded from `hashSeed`, it is the only source of
 * variation in a primitive compile, so reproducibility and seed sensitivity are the same property.
 */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * A seeded amplitude scale in [1 − jitter, 1 + jitter]. `salt` distinguishes the variation
 * streams of different tracks within one primitive, so a seed does not move every track in lockstep.
 */
export function seededScale(seed: string, salt: number, jitter: number): number {
  const rand = mulberry32(hashSeed(`${seed}:${salt}`));
  return 1 + (rand() * 2 - 1) * jitter;
}

/**
 * The approach/hold/release envelope: a minimum-jerk rise from 0 to 1 over `[0, holdStart]`, a
 * flat hold at 1 over `[holdStart, holdEnd]`, and a minimum-jerk fall back to 0 over
 * `[holdEnd, 1]`. Velocity is zero at every segment boundary, so the phases join smoothly.
 */
export function approachHoldRelease(
  u: number,
  hold: { holdStart: number; holdEnd: number },
): number {
  if (u <= hold.holdStart) {
    return hold.holdStart <= 0 ? 0 : minimumJerkSample(u / hold.holdStart);
  }
  const span = 1 - hold.holdEnd;
  if (u >= hold.holdEnd) {
    return span <= 0 ? 0 : 1 - minimumJerkSample((u - hold.holdEnd) / span);
  }
  return 1;
}

/**
 * A unit quaternion rotating `angle` radians about `axis`. With |angle| < π the w component is
 * strictly positive, which keeps every sample sign-canonical and adjacent samples sign-continuous
 * — the two rotation properties `violationsInTracks` refuses to weaken.
 */
export function axisAngleQuaternion(
  axis: readonly [number, number, number],
  angle: number,
): [number, number, number, number] {
  const half = angle / 2;
  const s = Math.sin(half);
  const c = Math.cos(half);
  return [axis[0] * s, axis[1] * s, axis[2] * s, c];
}
