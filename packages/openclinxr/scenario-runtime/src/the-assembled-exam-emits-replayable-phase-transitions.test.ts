import { describe, expect, it } from "vitest";
import { runAssembledExam } from "./exam-run-bridge.js";
import {
  durableEventRef,
  REPLAYABLE_PHASE_TRANSITION_TYPES,
} from "./trace.js";

/**
 * The assembled-exam bridge used to start a runtime session and immediately
 * `advanceExamFormRunStation({ phase: "complete" })` — so review/replay consumers
 * never saw encounter or note phases, nor why a station advanced.
 *
 * Known-good: `exam-run-bridge.test.ts` already proves assembled order, one real
 * session per station, and unknown-id refusal. This file is the counterweight:
 * presence of `station.started` is not enough; the ordered encounter→note→advance
 * traces with durable, scenario-bound identity must be returned.
 */
describe("the assembled exam emits replayable phase transitions", () => {
  it("walks encounter then note then complete per station, with ordered durable traces", async () => {
    const result = await runAssembledExam({
      learnerId: "learner_phase_001",
      scenarioIds: ["ed_chest_pain_priority_v1", "peds_asthma_parent_anxiety_v1"],
    });

    expect(result.formRunStatus).toBe("complete");
    expect(result.stations.map((station) => station.scenarioId)).toEqual([
      "ed_chest_pain_priority_v1",
      "peds_asthma_parent_anxiety_v1",
    ]);
    expect(result.stations[0]?.advanceReason).toBe("patient_note_submitted_advancing");
    expect(result.stations[1]?.advanceReason).toBe("last_station_note_submitted_exam_complete");
    expect(result.stations.map((station) => station.advanceReason)).not.toContain(
      "station_runtime_session_started",
    );

    for (const [index, station] of result.stations.entries()) {
      expect(station.stationOrder).toBe(index + 1);
      expect(station.traceEventTypes).toEqual(
        expect.arrayContaining(["station.started", ...REPLAYABLE_PHASE_TRANSITION_TYPES]),
      );
      expect(station.phaseTransitions.map((event) => event.eventType)).toEqual([
        ...REPLAYABLE_PHASE_TRANSITION_TYPES,
      ]);

      const sequences = station.phaseTransitions.map((event) => event.sequence);
      expect(new Set(sequences).size).toBe(sequences.length);

      for (const event of station.phaseTransitions) {
        expect(event.stationRunId).toBe(station.stationRunId);
        expect(event.payload["scenarioId"]).toBe(station.scenarioId);
        expect(event.payload["examRunId"]).toBe(result.examRunId);
        expect(event.payload["stationOrder"]).toBe(station.stationOrder);
        expect(typeof event.payload["formAtSecond"]).toBe("number");
        expect(event.payload["durableEventRef"]).toBe(
          durableEventRef(station.stationRunId, event.sequence),
        );
      }

      const advanced = station.phaseTransitions.find((event) => event.eventType === "station.advanced");
      expect(advanced?.payload["advanceReason"]).toBe(station.advanceReason);
      expect(advanced?.payload["phase"]).toBe("complete");
    }
  });

  it("still refuses an unknown scenario id instead of silently falling back", async () => {
    await expect(
      runAssembledExam({ learnerId: "l1", scenarioIds: ["no_such_scenario_v9"] }),
    ).rejects.toThrow(/no_such_scenario_v9/);
  });
});
