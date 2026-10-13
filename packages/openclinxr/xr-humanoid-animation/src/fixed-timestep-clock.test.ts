import { describe, expect, it } from "vitest";
import {
  clampFrameDtSeconds,
  consumeFrameTime,
  contactAtClipTime,
  createFixedTimestepClock,
  FIXED_SUBSTEP_SECONDS,
  interpolateSimScalar,
  isSingleSupportContact,
  MAX_SUBSTEPS_PER_FRAME,
  substepsForSchedule,
} from "./index.js";

/**
 * Fixed-timestep actor-simulation clock, through the public entrypoint.
 *
 * The accumulator yields identical substep totals for frame schedules covering
 * the same wall time; interpolation between a frame's entry/exit sim states is
 * continuous (no reversal, bounded second difference); the contact read names
 * single-support windows including wrap-around.
 */

type ConsumeDt = Parameters<typeof consumeFrameTime>[1];

function consumeAll(dts: ReadonlyArray<ConsumeDt>): { total: number; alphas: number[] } {
  const clock = createFixedTimestepClock();
  let total = 0;
  const alphas: number[] = [];
  for (const dt of dts) {
    const consumed = consumeFrameTime(clock, dt);
    total += consumed.substeps;
    alphas.push(consumed.alpha);
  }
  return { total, alphas };
}

function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let mixed = state;
    mixed = Math.imul(mixed ^ (mixed >>> 15), mixed | 1);
    mixed ^= mixed + Math.imul(mixed ^ (mixed >>> 7), mixed | 61);
    return ((mixed ^ (mixed >>> 14)) >>> 0) / 4294967296;
  };
}

const LABELS = {
  cycleSeconds: 1,
  atMs: [0, 100, 200, 300, 400, 500, 600, 700, 800, 900],
  left: [true, true, true, true, false, false, false, false, false, true],
  right: [false, false, false, false, false, true, true, true, true, true],
};

describe("fixed-timestep clock", () => {
  it("yields identical substep totals for schedules covering the same wall time", () => {
    const uniform60 = Array.from({ length: 60 }, () => 1 / 60);
    const uniform30 = Array.from({ length: 30 }, () => 1 / 30);
    const uniform90 = Array.from({ length: 90 }, () => 1 / 90);
    const draw = mulberry32(20261012);
    const jittered: number[] = [];
    let covered = 0;
    while (covered < 1) {
      const dt = 1 / 90 + draw() * (1 / 45 - 1 / 90);
      jittered.push(dt);
      covered += dt;
    }
    expect(substepsForSchedule(uniform60)).toBe(60);
    expect(substepsForSchedule(uniform30)).toBe(60);
    expect(substepsForSchedule(uniform90)).toBe(90);
    // Jitter covers >= 1 s of wall time, so it simulates at least the 60 whole
    // substeps the uniform schedules agree on; the partial tail stays queued.
    expect(substepsForSchedule(jittered)).toBeGreaterThanOrEqual(60);
    expect(consumeAll(uniform60).total).toBe(consumeAll(uniform30).total);
  });

  it("is deterministic: the same schedule replays the same per-frame sequence", () => {
    const draw = mulberry32(7);
    const schedule = Array.from({ length: 200 }, () => 1 / 90 + draw() * (1 / 45 - 1 / 90));
    const first = consumeAll(schedule);
    const second = consumeAll(schedule);
    expect(second.total).toBe(first.total);
    expect(second.alphas).toEqual(first.alphas);
  });

  it("clamps frame dt and caps substeps per frame", () => {
    expect(clampFrameDtSeconds(1)).toBe(0.05);
    expect(clampFrameDtSeconds(-0.5)).toBe(0);
    const clock = createFixedTimestepClock();
    const consumed = consumeFrameTime(clock, 10);
    expect(consumed.substeps).toBe(MAX_SUBSTEPS_PER_FRAME);
    expect(consumed.leftoverSeconds).toBeGreaterThan(0);
  });

  it("renders the current sim state on exact consumes (capture-clock thin case)", () => {
    const clock = createFixedTimestepClock();
    for (let frame = 0; frame < 10; frame += 1) {
      const consumed = consumeFrameTime(clock, FIXED_SUBSTEP_SECONDS);
      expect(consumed.substeps).toBe(1);
      expect(consumed.alpha).toBe(1);
    }
  });

  it("interpolation across display frames never reverses and stays smooth", () => {
    // Monotone sim (11 mm/substep walk advance) stepped under a jittered
    // display schedule; rendered = entry/exit lerp per frame.
    const draw = mulberry32(20261012);
    const schedule = Array.from({ length: 240 }, () => 1 / 90 + draw() * (1 / 45 - 1 / 90));
    const clock = createFixedTimestepClock();
    const advance = 0.011;
    let sim = 0;
    const rendered: number[] = [];
    for (const dt of schedule) {
      const consumed = consumeFrameTime(clock, dt);
      const prev = sim;
      sim += consumed.substeps * advance;
      rendered.push(interpolateSimScalar(prev, sim, consumed.alpha));
    }
    for (let k = 1; k < rendered.length; k += 1) {
      expect(rendered[k]! - rendered[k - 1]!).toBeGreaterThanOrEqual(-1e-9);
    }
    let maxSecond = 0;
    for (let k = 1; k + 1 < rendered.length; k += 1) {
      const second = Math.abs(rendered[k + 1]! - 2 * rendered[k]! + rendered[k - 1]!);
      if (second > maxSecond) maxSecond = second;
    }
    expect(maxSecond).toBeLessThanOrEqual(2 * advance + 1e-9);
  });

  it("reads single-support contact windows including wrap-around", () => {
    expect(contactAtClipTime(LABELS, 0.05)).toEqual({ left: true, right: false });
    expect(contactAtClipTime(LABELS, 0.65)).toEqual({ left: false, right: true });
    expect(isSingleSupportContact(contactAtClipTime(LABELS, 0.05))).toBe(true);
    expect(isSingleSupportContact(contactAtClipTime(LABELS, 0.65))).toBe(true);
    // Negative and over-cycle times wrap to the same samples.
    expect(contactAtClipTime(LABELS, -0.35)).toEqual(contactAtClipTime(LABELS, 0.65));
    expect(contactAtClipTime(LABELS, 1.05)).toEqual(contactAtClipTime(LABELS, 0.05));
    expect(contactAtClipTime({ cycleSeconds: 0, atMs: [], left: [], right: [] }, 0.1)).toEqual({
      left: false,
      right: false,
    });
  });
});
