/**
 * C1 — Fixed step.
 *
 * Physics accumulator at fixed dt (60 Hz nominal, dt = 1/60 exactly as a f64 literal).
 * Render frame rate is decoupled and must never be an input to the step count.
 * No `deltaTime` from `requestAnimationFrame` reaches the solver.
 */

/** Fixed physics dt = 1/60 exactly as an f64 literal (C1). */
export const FIXED_DT: number = 1 / 60;

/** Accumulator state for fixed-step physics stepping. */
export type FixedStepAccumulator = {
  /** Remaining fractional time from the last frame that has not yet been stepped. */
  accumulator: number;
  /** The current physics tick index (monotonic integer). */
  currentTick: number;
};

/**
 * Create a new fixed-step accumulator starting at tick 0.
 */
export function createFixedStepAccumulator(): FixedStepAccumulator {
  return { accumulator: 0, currentTick: 0 };
}

/**
 * Advance the accumulator by `frameDt` seconds of render time.
 * Returns the number of physics ticks that should be stepped this frame.
 * The caller must then call `consumeTicks` for each tick.
 *
 * This decouples render dt from solver dt (C1).
 */
export function accumulateFrameTime(
  acc: FixedStepAccumulator,
  frameDt: number,
): number {
  acc.accumulator += frameDt;
  let steps = 0;
  while (acc.accumulator >= FIXED_DT) {
    acc.accumulator -= FIXED_DT;
    steps++;
  }
  return steps;
}

/**
 * Consume one physics tick, advancing the tick counter.
 * Returns the tick index that was just stepped.
 */
export function consumeTick(acc: FixedStepAccumulator): number {
  return acc.currentTick++;
}

/**
 * Get the current tick without advancing.
 */
export function currentTick(acc: FixedStepAccumulator): number {
  return acc.currentTick;
}
