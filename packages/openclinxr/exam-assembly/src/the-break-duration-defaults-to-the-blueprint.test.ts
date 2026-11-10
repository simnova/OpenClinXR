import { edChestPainScenario } from "@openclinxr/scenario-fixtures";
import { describe, expect, it } from "vitest";
import { createDefaultClinicalSkillsBlueprint, createExamTimingPlan } from "./index.js";

const STATION_SECONDS = 60 + 900 + 600;

function blueprintWith(timing: { breakAfterStationOrders: number[]; breakSeconds?: number }) {
  const scenarios = [edChestPainScenario, edChestPainScenario];
  const base = createDefaultClinicalSkillsBlueprint(scenarios, { stationCount: 2 });
  const { breakSeconds: _drop, ...baseTiming } = base.timing as typeof base.timing & { breakSeconds?: number };
  return { ...base, timing: { ...baseTiming, ...timing } };
}

describe("break duration defaults to the blueprint", () => {
  it("uses timing.breakSeconds when no option is given, and shifts later stations by exactly that", () => {
    const plan = createExamTimingPlan(blueprintWith({ breakAfterStationOrders: [1], breakSeconds: 120 }));
    expect(plan.breakWindows).toHaveLength(1);
    expect(plan.breakWindows[0]).toMatchObject({
      afterStationOrder: 1,
      startsAtSecond: STATION_SECONDS,
      endsAtSecond: STATION_SECONDS + 120,
      durationSeconds: 120,
    });
    expect(plan.totalBreakTimeSeconds).toBe(120);
    expect(plan.totalFormTimeSeconds).toBe(2 * STATION_SECONDS + 120);
  });

  it("EXACT SHIFT: station 2 doorway starts at station 1 note end + 120", () => {
    const plan = createExamTimingPlan(blueprintWith({ breakAfterStationOrders: [1], breakSeconds: 120 }));
    expect(plan.stationWindows[0]?.note.endsAtSecond).toBe(STATION_SECONDS);
    expect(plan.stationWindows[1]?.doorway.startsAtSecond).toBe(STATION_SECONDS + 120);
  });

  it("CW1: options.breakDurationSeconds beats breakSeconds", () => {
    const plan = createExamTimingPlan(blueprintWith({ breakAfterStationOrders: [1], breakSeconds: 120 }), { breakDurationSeconds: 30 });
    expect(plan.breakWindows[0]?.durationSeconds).toBe(30);
    expect(plan.stationWindows[1]?.doorway.startsAtSecond).toBe(STATION_SECONDS + 30);
  });

  it("CW2: the per-order map beats breakSeconds", () => {
    const plan = createExamTimingPlan(blueprintWith({ breakAfterStationOrders: [1], breakSeconds: 120 }), { breakDurationsByAfterStationOrder: { 1: 45 } });
    expect(plan.breakWindows[0]?.durationSeconds).toBe(45);
    expect(plan.stationWindows[1]?.doorway.startsAtSecond).toBe(STATION_SECONDS + 45);
  });

  it("CW3: absent breakSeconds yields a zero-length break, as before", () => {
    const plan = createExamTimingPlan(blueprintWith({ breakAfterStationOrders: [1] }));
    expect(plan.breakWindows).toEqual([
      { afterStationOrder: 1, startsAtSecond: STATION_SECONDS, endsAtSecond: STATION_SECONDS, durationSeconds: 0, phase: "break" },
    ]);
    expect(plan.stationWindows[1]?.doorway.startsAtSecond).toBe(STATION_SECONDS);
    expect(plan.totalFormTimeSeconds).toBe(2 * STATION_SECONDS);
  });

  it("CW4: breakSeconds with no break orders emits no windows", () => {
    const plan = createExamTimingPlan(blueprintWith({ breakAfterStationOrders: [], breakSeconds: 120 }));
    expect(plan.breakWindows).toEqual([]);
    expect(plan.totalFormTimeSeconds).toBe(2 * STATION_SECONDS);
  });

  it("CW5a: explicit options.breakDurationSeconds 0 beats breakSeconds", () => {
    const plan = createExamTimingPlan(blueprintWith({ breakAfterStationOrders: [1], breakSeconds: 120 }), { breakDurationSeconds: 0 });
    expect(plan.breakWindows[0]?.durationSeconds).toBe(0);
    expect(plan.stationWindows[1]?.doorway.startsAtSecond).toBe(STATION_SECONDS);
  });

  it("CW5b: explicit map entry 0 beats breakSeconds", () => {
    const plan = createExamTimingPlan(blueprintWith({ breakAfterStationOrders: [1], breakSeconds: 120 }), { breakDurationsByAfterStationOrder: { 1: 0 } });
    expect(plan.breakWindows[0]?.durationSeconds).toBe(0);
    expect(plan.stationWindows[1]?.doorway.startsAtSecond).toBe(STATION_SECONDS);
  });
});
