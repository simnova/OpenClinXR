import { describe, expect, it } from "vitest";

/**
 * waitForHeadDeck polls the head/deck read until headCenterY and deckHeadEndZ are finite,
 * instead of a fixed sleep. Fake Page only; no browser. Timing is injected (pollMs, clock, sleep).
 */

type WaitFn = (
  page: unknown,
  label: string,
  timeoutMs: number,
  timing: { pollMs: number; now: () => number; sleep: (ms: number) => Promise<void> },
  settle?: SettleOptions,
) => Promise<{ deck: Record<string, unknown>; waitMs: number; outcome: string; rafTicks: number; polls: number }>;

/** Flat-read settle (super-ceo-cap9 ruling 2026-11-10): rAF ticks first, then a state check, not a count. */
type SettleOptions = {
  targetInclineDegrees: number;
  rafTicks: number;
  frames: (page: unknown, ticks: number) => Promise<void>;
};

const load = async () =>
  import("../../../../../../tools/openclinxr/evidence/shipped-head-of-bed-incline.js") as Promise<Record<string, unknown>>;

const emptyRow = {
  inclineDegrees: 0,
  headCenterY: Number.NaN,
  headCenterZ: Number.NaN,
  deckTopY: 0.55,
  deckHeadEndZ: Number.NaN,
  headInboardOfDeckEndMeters: Number.NaN,
  pillowTopY: null,
  supine: true,
  headFound: false,
  stretcher: true,
};
const finiteRow = {
  ...emptyRow,
  headCenterY: 1.1,
  headCenterZ: -0.4,
  deckHeadEndZ: -0.9,
  headInboardOfDeckEndMeters: 0.5,
  headFound: true,
};

function fakeClock() {
  let t = 0;
  return {
    now: () => t,
    sleep: async (ms: number) => {
      t += ms;
    },
  };
}

describe("waitForHeadDeck", () => {
  it("returns the finite row once the head appears, recording waitMs and outcome", async () => {
    const mod = await load();
    const waitForHeadDeck = mod["waitForHeadDeck"] as WaitFn;
    expect(typeof waitForHeadDeck).toBe("function");
    const clock = fakeClock();
    let calls = 0;
    const page = {
      evaluate: async () => {
        calls += 1;
        return calls < 4 ? emptyRow : finiteRow;
      },
    };
    const result = await waitForHeadDeck(page, "flat_baseline", 30_000, { pollMs: 200, ...clock });
    expect(calls).toBe(4);
    expect(result.deck["headCenterY"]).toBe(1.1);
    expect(result.deck["deckHeadEndZ"]).toBe(-0.9);
    expect(result.outcome).toBe("finite");
    expect(result.waitMs).toBe(600);
  });

  it("throws HEAD_DECK_NOT_FOUND naming the three flags within timeout plus one poll", async () => {
    const mod = await load();
    const waitForHeadDeck = mod["waitForHeadDeck"] as WaitFn;
    expect(typeof waitForHeadDeck).toBe("function");
    const clock = fakeClock();
    const page = { evaluate: async () => ({ ...emptyRow, supine: true, headFound: false, stretcher: false }) };
    let message = "";
    try {
      await waitForHeadDeck(page, "shipped_angle", 1_000, { pollMs: 200, ...clock });
    } catch (error) {
      message = (error as Error).message;
    }
    expect(message).toMatch(/^HEAD_DECK_NOT_FOUND shipped_angle after \d+ms: supine=true headFound=false stretcher=false$/);
    expect(clock.now()).toBeLessThanOrEqual(1_000 + 200);
    expect(clock.now()).toBeGreaterThanOrEqual(1_000);
  });

});

/**
 * Settle mode for the flat_baseline read. forceStretcherInclineOnPage sets the incline in userData at
 * once, and the body re-flattens on later animation frames. So the first read after the force is finite,
 * carries incline 0, and still holds the RAISED head height. Row values are illustrative, not spec.
 */
describe("waitForHeadDeck settle mode (flat_baseline)", () => {
  // Each frame advances the fake clock by one 60 Hz frame so timeouts can elapse in settle mode.
  function fakeFrames(clock: { now: () => number; sleep: (ms: number) => Promise<void> }) {
    const log: number[] = [];
    return {
      log,
      ticks: () => log.reduce((a, b) => a + b, 0),
      frames: async (_page: unknown, ticks: number) => {
        log.push(ticks);
        await clock.sleep(ticks * 16);
      },
    };
  }
  const raisedPoseRow = { ...finiteRow, inclineDegrees: 0, headCenterY: 0.95 };
  const flatRow = { ...finiteRow, inclineDegrees: 0, headCenterY: 0.72 };

  it("does not resolve on the stale raised pose that the first read returns after the force", async () => {
    const mod = await load();
    const waitForHeadDeck = mod["waitForHeadDeck"] as WaitFn;
    const clock = fakeClock();
    const f = fakeFrames(clock);
    const rows = [raisedPoseRow, flatRow, flatRow];
    let calls = 0;
    const page = { evaluate: async () => rows[Math.min(calls++, rows.length - 1)] };
    const result = await waitForHeadDeck(page, "flat_baseline", 30_000, { pollMs: 200, ...clock }, {
      targetInclineDegrees: 0,
      rafTicks: 2,
      frames: f.frames,
    });
    expect(result.deck["headCenterY"]).toBe(0.72);
    expect(result.outcome).toBe("finite");
    expect(result.polls).toBe(3);
    // 2 settle ticks before the first read, then exactly one tick between consecutive reads.
    expect(f.log).toEqual([2, 1, 1]);
    expect(result.rafTicks).toBe(4);
  });

  it("does not accept a stable head while the read's incline is off target by more than 1e-3", async () => {
    const mod = await load();
    const waitForHeadDeck = mod["waitForHeadDeck"] as WaitFn;
    const clock = fakeClock();
    const f = fakeFrames(clock);
    const tilted = { ...flatRow, inclineDegrees: 0.01 };
    const rows = [tilted, tilted, tilted, flatRow, flatRow];
    let calls = 0;
    const page = { evaluate: async () => rows[Math.min(calls++, rows.length - 1)] };
    const result = await waitForHeadDeck(page, "flat_baseline", 30_000, { pollMs: 200, ...clock }, {
      targetInclineDegrees: 0,
      rafTicks: 2,
      frames: f.frames,
    });
    expect(result.deck["inclineDegrees"]).toBe(0);
    expect(result.polls).toBe(5);
  });

  it("rejects an off-target read even when the read before it was on target and the head held still", async () => {
    const mod = await load();
    const waitForHeadDeck = mod["waitForHeadDeck"] as WaitFn;
    const clock = fakeClock();
    const f = fakeFrames(clock);
    const tilted = { ...flatRow, inclineDegrees: 0.01 };
    const rows = [flatRow, tilted, flatRow, flatRow];
    let calls = 0;
    const page = { evaluate: async () => rows[Math.min(calls++, rows.length - 1)] };
    const result = await waitForHeadDeck(page, "flat_baseline", 30_000, { pollMs: 200, ...clock }, {
      targetInclineDegrees: 0,
      rafTicks: 2,
      frames: f.frames,
    });
    expect(result.deck["inclineDegrees"]).toBe(0);
    expect(result.polls).toBe(4);
  });

  it("throws HEAD_DECK_NOT_SETTLED when the head never holds still within the timeout", async () => {
    const mod = await load();
    const waitForHeadDeck = mod["waitForHeadDeck"] as WaitFn;
    const clock = fakeClock();
    const f = fakeFrames(clock);
    let calls = 0;
    const page = { evaluate: async () => ((calls++ % 2) === 0 ? raisedPoseRow : flatRow) };
    let message = "";
    try {
      await waitForHeadDeck(page, "flat_baseline", 1_000, { pollMs: 200, ...clock }, {
        targetInclineDegrees: 0,
        rafTicks: 2,
        frames: f.frames,
      });
    } catch (error) {
      message = (error as Error).message;
    }
    expect(message).toMatch(/^HEAD_DECK_NOT_SETTLED flat_baseline after \d+ms: /);
    expect(clock.now()).toBeLessThanOrEqual(1_000 + 16);
    expect(clock.now()).toBeGreaterThanOrEqual(1_000);
  });
});
