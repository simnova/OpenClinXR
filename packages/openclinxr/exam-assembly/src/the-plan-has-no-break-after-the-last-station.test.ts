import { readFileSync } from "node:fs";
import { edChestPainScenario } from "@openclinxr/scenario-fixtures";
import * as sharedSchemas from "@openclinxr/shared-schemas";
import { describe, expect, it } from "vitest";
import { createDefaultClinicalSkillsBlueprint, createExamTimingPlan } from "./index.js";

// C56 RED: the plan agrees with the synced server that no break follows the last station.
const STATION_SECONDS = 60 + 900 + 600;

function blueprintWith(stationCount: number, breakAfterStationOrders: number[], breakSeconds: number) {
  const scenarios = Array.from({ length: stationCount }, () => edChestPainScenario);
  const base = createDefaultClinicalSkillsBlueprint(scenarios, { stationCount });
  return { ...base, timing: { ...base.timing, breakAfterStationOrders, breakSeconds } };
}

describe("the plan has no break after the last station", () => {
  it("2-station form, break after 2, breakSeconds 120 -> no break window, total 3120", () => {
    const plan = createExamTimingPlan(blueprintWith(2, [2], 120));
    expect(plan.breakWindows).toEqual([]);
    expect(plan.totalBreakTimeSeconds).toBe(0);
    expect(plan.totalFormTimeSeconds).toBe(2 * STATION_SECONDS);
    expect(plan.totalFormTimeSeconds).toBe(3120);
  });

  it("CW1: the plan calls the shared function and keeps no length - 1 rule of its own", () => {
    expect(typeof (sharedSchemas as Record<string, unknown>)["effectiveBreakAfterStationOrders"]).toBe("function");
    const source = readFileSync(new URL("./exam-form-breaks.ts", import.meta.url), "utf8");
    expect(source).toMatch(/import\s*\{[^}]*\beffectiveBreakAfterStationOrders\b[^}]*\}\s*from\s*"@openclinxr\/shared-schemas"/);
    expect(source).not.toMatch(/length\s*-\s*1/);
  });

  it("CW2: a break after 1 on a 3-station form keeps exact windows and totals", () => {
    const plan = createExamTimingPlan(blueprintWith(3, [1], 120));
    expect(plan.breakWindows).toEqual([
      { afterStationOrder: 1, startsAtSecond: STATION_SECONDS, endsAtSecond: STATION_SECONDS + 120, durationSeconds: 120, phase: "break" },
    ]);
    expect(plan.stationWindows[1]?.doorway.startsAtSecond).toBe(STATION_SECONDS + 120);
    expect(plan.totalFormTimeSeconds).toBe(3 * STATION_SECONDS + 120);
  });

  it("CW2b: breaks after 1 and 3 on a 3-station form keep only the break after 1", () => {
    const plan = createExamTimingPlan(blueprintWith(3, [1, 3], 120));
    expect(plan.breakWindows.map((window) => window.afterStationOrder)).toEqual([1]);
    expect(plan.totalFormTimeSeconds).toBe(3 * STATION_SECONDS + 120);
  });
});
