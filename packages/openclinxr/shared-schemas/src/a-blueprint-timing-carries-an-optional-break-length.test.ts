import { describe, expect, it } from "vitest";
import { validateExamBlueprint } from "./validators.js";

// C53: ExamBlueprintTimingSchema carries an optional break length in whole seconds beside the other phase seconds.
// Absent stays valid, so every existing blueprint still validates; a negative or fractional length does not.
function blueprint(timing: Record<string, unknown>): unknown {
  return {
    blueprintId: "bp-fixture-c53",
    title: "Fixture form",
    stationSlots: [{ slotId: "slot-a", order: 1, label: "A", requiredEnvironmentIds: [], requiredTraceTags: [] }],
    timing: { doorwaySeconds: 60, encounterSeconds: 900, noteSeconds: 600, breakAfterStationOrders: [1], ...timing },
    requiredTraceTags: [],
    requiredSafetyCriticalTraceTags: [],
  };
}

describe("a blueprint timing carries an optional break length (C53)", () => {
  it("accepts breakSeconds 0 and 300, and a blueprint without it", () => {
    expect(validateExamBlueprint(blueprint({ breakSeconds: 0 })).ok).toBe(true);
    expect(validateExamBlueprint(blueprint({ breakSeconds: 300 })).ok).toBe(true);
    expect(validateExamBlueprint(blueprint({})).ok).toBe(true);
  });

  it("refuses a negative, fractional or non-numeric breakSeconds", () => {
    expect(validateExamBlueprint(blueprint({ breakSeconds: -1 })).ok).toBe(false);
    expect(validateExamBlueprint(blueprint({ breakSeconds: 1.5 })).ok).toBe(false);
    expect(validateExamBlueprint(blueprint({ breakSeconds: "300" })).ok).toBe(false);
  });
});
