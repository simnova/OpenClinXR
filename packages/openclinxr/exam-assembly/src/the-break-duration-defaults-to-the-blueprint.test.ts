import { describe, expect, it } from "vitest";
import { createExamTimingPlan, createStep2CsStyleSeedBlueprint } from "./index.js";

// C54 RED (tsk_3e4ec430ac0f498e). After C53 the blueprint carries timing.breakSeconds and the synced rotation pauses for
// it, but buildExamTimingPlan's break duration still comes from ExamFormTimingOptions only (exam-form-breaks.ts
// breakDurationFor: map[order] ?? breakDurationSeconds ?? 0), and no caller outside exam-assembly passes either option.
// Contract, precedence highest first: options.breakDurationsByAfterStationOrder[order] > options.breakDurationSeconds >
// blueprint.timing.breakSeconds > 0. Exact window numbers only, never "duration > 0".
// Planted clause is `it.fails`; flip it to `it(` when the fallback lands (`live:` requires 0 remaining). The plain `it(`
// blocks are counterweights and pass on base.
// Fixture timing (60/600/300 s, one 960 s station) and the 120/30/45 s break values are illustrative, not product values.

const PHASES = { doorwaySeconds: 60, encounterSeconds: 600, noteSeconds: 300 };
const STATION_SECONDS = 960; // 60 + 600 + 300

type Blueprint = ReturnType<typeof createStep2CsStyleSeedBlueprint>;

function twoStation(timing: Record<string, unknown>): Blueprint {
  const seed = createStep2CsStyleSeedBlueprint();
  const slots = [...seed.stationSlots].sort((a, b) => a.order - b.order).slice(0, 2).map((slot, i) => ({ ...slot, order: i + 1 }));
  // timing.breakSeconds is C53's schema field; cast so this file compiles before and after it lands.
  return { ...seed, stationSlots: slots, timing: { ...PHASES, ...timing } } as unknown as Blueprint;
}

const breaks = (plan: ReturnType<typeof createExamTimingPlan>) =>
  plan.breakWindows.map((w) => [w.afterStationOrder, w.startsAtSecond, w.endsAtSecond, w.durationSeconds]);
const secondDoorway = (plan: ReturnType<typeof createExamTimingPlan>) => plan.stationWindows[1]?.doorway.startsAtSecond;

describe("the break duration defaults to the blueprint's timing.breakSeconds (C54)", () => {
  it.fails("breakAfterStationOrders [1], breakSeconds 120, no options: one 120 s break at 960..1080 and station 2 opens at 1080", () => {
    const plan = createExamTimingPlan(twoStation({ breakAfterStationOrders: [1], breakSeconds: 120 }));
    expect(breaks(plan)).toEqual([[1, STATION_SECONDS, STATION_SECONDS + 120, 120]]);
    expect(secondDoorway(plan)).toBe(STATION_SECONDS + 120);
    expect([plan.totalBreakTimeSeconds, plan.totalFormTimeSeconds]).toEqual([120, 2 * STATION_SECONDS + 120]);
  });

  it("counterweight: breakSeconds absent gives the base plan, a 0 s break and station 2 at 960", () => {
    const plan = createExamTimingPlan(twoStation({ breakAfterStationOrders: [1] }));
    expect(breaks(plan)).toEqual([[1, STATION_SECONDS, STATION_SECONDS, 0]]);
    expect(secondDoorway(plan)).toBe(STATION_SECONDS);
  });

  it("counterweight: options.breakDurationSeconds 30 outranks timing.breakSeconds 120", () => {
    const plan = createExamTimingPlan(twoStation({ breakAfterStationOrders: [1], breakSeconds: 120 }), { breakDurationSeconds: 30 });
    expect(breaks(plan)).toEqual([[1, STATION_SECONDS, STATION_SECONDS + 30, 30]]);
  });

  it("counterweight: a per-position map {1: 45} outranks timing.breakSeconds 120", () => {
    const plan = createExamTimingPlan(twoStation({ breakAfterStationOrders: [1], breakSeconds: 120 }), { breakDurationsByAfterStationOrder: { 1: 45 } });
    expect(breaks(plan)).toEqual([[1, STATION_SECONDS, STATION_SECONDS + 45, 45]]);
  });

  it("counterweight: breakSeconds 120 with breakAfterStationOrders [] adds no break window", () => {
    const plan = createExamTimingPlan(twoStation({ breakAfterStationOrders: [], breakSeconds: 120 }));
    expect(breaks(plan)).toEqual([]);
    expect(secondDoorway(plan)).toBe(STATION_SECONDS);
  });
});
