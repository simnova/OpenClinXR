/**
 * Fixed-timestep actor-simulation clock (fixed-clock slice, stage 1).
 *
 * All simulation that moves actors advances in fixed 1/60 s substeps from an
 * accumulator fed by the display frame's real dt. The rendered transform is
 * interpolated between the frame's entry and exit sim states so motion stays
 * smooth at 72/90/120 Hz. The deterministic capture clock (frame dt exactly
 * 1/60) is a thin case of the same path: one substep, zero leftover.
 *
 * Pure math only: no three.js import, so xr-runtime-state-style consumers can
 * mirror it without a dependency. Frame-loop wiring lives in the composition
 * root (apps/ui-xr/src/main.ts); per-substep simulation stays in the existing
 * modules, which keep their signatures.
 */

/** One simulator step, in seconds. Matches the legacy deterministic dt. */
export const FIXED_SUBSTEP_SECONDS = 1 / 60;

/**
 * Cap on substeps consumed per display frame. Frame dt is clamped to
 * FRAME_DT_CLAMP_SECONDS first, so 4 covers 66 ms of wall time and the cap
 * only binds after a multi-frame stall, when spinning up is worse than
 * briefly running sim time behind wall time.
 */
export const MAX_SUBSTEPS_PER_FRAME = 4;

/** Upper clamp on a display frame's dt, in seconds. Same value main.ts used. */
export const FRAME_DT_CLAMP_SECONDS = 0.05;

export type FixedTimestepClock = {
  accumulatorSeconds: number;
};

/** Fresh clock: empty accumulator, sim time anchored on first consume. */
export function createFixedTimestepClock(): FixedTimestepClock {
  return { accumulatorSeconds: 0 };
}

/** Clamp a raw display-frame dt into [0, FRAME_DT_CLAMP_SECONDS]. */
export function clampFrameDtSeconds(frameDtSeconds: number): number {
  if (!(frameDtSeconds > 0)) return 0;
  return Math.min(frameDtSeconds, FRAME_DT_CLAMP_SECONDS);
}

export type ConsumedFrameTime = {
  /** Substeps the frame must simulate, in order, at FIXED_SUBSTEP_SECONDS. */
  substeps: number;
  /**
   * Render interpolation factor in [0, 1] between the frame's entry sim state
   * (0) and exit sim state (1). Exactly 1 when the frame consumed at least one
   * substep and left no remainder, so the deterministic capture clock renders
   * the current sim state with no lag; fractional otherwise.
   */
  alpha: number;
  /** Sim seconds carried into the next frame, always below one substep. */
  leftoverSeconds: number;
};

/**
 * Feed one display frame's dt through the accumulator. Deterministic: the same
 * dt sequence yields the same substep sequence, so two frame schedules covering
 * the same wall time simulate the same substeps up to the final partial step.
 */
export function consumeFrameTime(
  clock: FixedTimestepClock,
  frameDtSeconds: number,
): ConsumedFrameTime {
  const clamped = clampFrameDtSeconds(frameDtSeconds);
  const total = clock.accumulatorSeconds + clamped;
  const substeps = Math.min(
    Math.floor(total / FIXED_SUBSTEP_SECONDS),
    MAX_SUBSTEPS_PER_FRAME,
  );
  const leftoverSeconds = total - substeps * FIXED_SUBSTEP_SECONDS;
  clock.accumulatorSeconds = leftoverSeconds;
  const alpha =
    substeps > 0 && leftoverSeconds <= 1e-12
      ? 1
      : Math.min(1, Math.max(0, leftoverSeconds / FIXED_SUBSTEP_SECONDS));
  return { substeps, alpha, leftoverSeconds };
}

/** Total whole substeps a wall-time dt sequence simulates (test/report helper). */
export function substepsForSchedule(frameDtSeconds: ReadonlyArray<number>): number {
  const clock = createFixedTimestepClock();
  let total = 0;
  for (const dt of frameDtSeconds) total += consumeFrameTime(clock, dt).substeps;
  return total;
}

/** Linear interpolation between two sim scalars for the rendered transform. */
export function interpolateSimScalar(
  previousValue: number,
  currentValue: number,
  alpha: number,
): number {
  return previousValue + (currentValue - previousValue) * alpha;
}

/**
 * Nearest-sample stance read at a clip time, mirroring stanceAtTime
 * (locomotion-stance-labels.ts) without importing it, so packages below
 * xr-humanoid-animation in the dependency order can share the definition.
 */
export function contactAtClipTime(
  labels: {
    cycleSeconds: number;
    atMs: ReadonlyArray<number>;
    left: ReadonlyArray<boolean>;
    right: ReadonlyArray<boolean>;
  },
  clipTimeSeconds: number,
): { left: boolean; right: boolean } {
  const count = labels.atMs.length;
  if (count === 0 || !(labels.cycleSeconds > 0)) return { left: false, right: false };
  const wrapped =
    ((clipTimeSeconds % labels.cycleSeconds) + labels.cycleSeconds) % labels.cycleSeconds;
  let best = 0;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (let index = 0; index < count; index += 1) {
    const sampleTime = (labels.atMs[index] ?? 0) / 1000;
    const direct = Math.abs(sampleTime - wrapped);
    const distance = Math.min(direct, labels.cycleSeconds - direct);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = index;
    }
  }
  return { left: labels.left[best] ?? false, right: labels.right[best] ?? false };
}

/**
 * The walk-exit contact window: single support on exactly one foot. A
 * double-support exit leaves the settling turn's pivot foot ambiguous, which
 * is the planted-foot variation the control shows; a swing exit (neither foot
 * labelled) plants nothing. Single support names the pivot deterministically.
 */
export function isSingleSupportContact(contact: { left: boolean; right: boolean }): boolean {
  return contact.left !== contact.right;
}
