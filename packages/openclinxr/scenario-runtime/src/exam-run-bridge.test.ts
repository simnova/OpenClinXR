import { describe, expect, it } from "vitest";
import { runAssembledExam } from "./exam-run-bridge.js";

/**
 * The gap between assembly and runtime.
 *
 * `@openclinxr/exam-assembly` has a complete form-run state machine — createExamFormRun,
 * startExamFormRun, advanceExamFormRunStation — and NOTHING under apps/ consumes it. The scenario
 * runtime can load any scenario by id since 30f0dd0. So an exam can be assembled, and a scenario can
 * be run, and no code path takes the stations an assembly produced and runs them in order.
 *
 * That is the product residual behind "author many scenarios, then assemble them into an exam":
 * the assembly has nothing to hand off TO.
 */
describe("assembled exam runs its stations through the runtime", () => {
  it("runs two different scenarios in the assembled order, one session each", async () => {
    const result = await runAssembledExam({
      learnerId: "learner_001",
      scenarioIds: ["ed_chest_pain_priority_v1", "peds_asthma_parent_anxiety_v1"],
    });

    expect(result.stations).toHaveLength(2);
    // Order is the assembly's, not the fixture registry's.
    expect(result.stations.map((s) => s.scenarioId)).toEqual([
      "ed_chest_pain_priority_v1",
      "peds_asthma_parent_anxiety_v1",
    ]);
    // Each station is a real session, not a placeholder: distinct run ids, real trace events.
    const runIds = result.stations.map((s) => s.stationRunId);
    expect(new Set(runIds).size).toBe(2);
    for (const station of result.stations) {
      expect(station.traceEventTypes).toContain("station.started");
    }
  });

  it("refuses an unknown scenario id instead of silently falling back to the default", async () => {
    await expect(
      runAssembledExam({ learnerId: "l1", scenarioIds: ["no_such_scenario_v9"] }),
    ).rejects.toThrow(/no_such_scenario_v9/);
  });
});
