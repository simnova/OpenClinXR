import { describe, expect, it } from "vitest";
import { createDefaultScenarioRuntime } from "./default-runtime-factory.js";
import { durableEventRef, REPLAYABLE_PHASE_TRANSITION_TYPES } from "./trace.js";
import type { AssembledStationContext } from "./runtime-types.js";

const assembled: AssembledStationContext = {
  examRunId: "exam_run_api_canonical_001",
  scenarioId: "ed_chest_pain_priority_v1",
  stationOrder: 1,
  formTiming: {
    doorway: { startsAtSecond: 0, endsAtSecond: 60 },
    encounter: { startsAtSecond: 60, endsAtSecond: 960 },
    note: { startsAtSecond: 960, endsAtSecond: 1560 },
  },
};

describe("api canonical phase session", () => {
  it("emits canonical replayable payloads on encounter/end-note/advance when assembled context is present", async () => {
    const runtime = createDefaultScenarioRuntime();
    const session = await runtime.startSession({
      learnerId: "learner_canonical_001",
      consentAccepted: true,
      assembledStation: assembled,
    });
    runtime.startEncounter(session.stationRunId, { atSecond: 60 });
    runtime.submitNote(session.stationRunId, {
      atSecond: 1560,
      text: "Chest pain workup documented.",
      advanceReason: "patient_note_submitted_advancing",
    });

    const events = runtime.traceEvents(session.stationRunId);
    const phases = events.filter((event) =>
      (REPLAYABLE_PHASE_TRANSITION_TYPES as readonly string[]).includes(event.eventType),
    );
    expect(phases.map((event) => event.eventType)).toEqual([...REPLAYABLE_PHASE_TRANSITION_TYPES]);
    for (const event of phases) {
      expect(event.payload["examRunId"]).toBe(assembled.examRunId);
      expect(event.payload["scenarioId"]).toBe(assembled.scenarioId);
      expect(event.payload["stationOrder"]).toBe(1);
      expect(event.payload["durableEventRef"]).toBe(durableEventRef(session.stationRunId, event.sequence));
      expect(typeof event.payload["formAtSecond"]).toBe("number");
    }
    expect(phases[0]?.payload["phase"]).toBe("encounter");
    expect(phases[4]?.payload["phase"]).toBe("complete");
    expect(phases[4]?.payload["advanceReason"]).toBe("patient_note_submitted_advancing");
  });

  it("keeps standalone sessions identity-less on encounter.started", async () => {
    const runtime = createDefaultScenarioRuntime();
    const session = await runtime.startSession({ learnerId: "learner_standalone_001", consentAccepted: true });
    runtime.startEncounter(session.stationRunId, { atSecond: 60 });
    const started = runtime.traceEvents(session.stationRunId).find((event) => event.eventType === "encounter.started");
    expect(started).toBeDefined();
    expect(started?.payload["examRunId"]).toBeUndefined();
    expect(started?.payload["durableEventRef"]).toBeUndefined();
  });

  it("refuses partial assembled context and cross-scenario identity", async () => {
    const runtime = createDefaultScenarioRuntime();
    await expect(
      runtime.startSession({
        learnerId: "learner_partial_001",
        consentAccepted: true,
        assembledStation: {
          examRunId: "exam_run_partial",
          scenarioId: "ed_chest_pain_priority_v1",
          stationOrder: 1,
          formTiming: {
            encounter: { startsAtSecond: 60, endsAtSecond: 960 },
            note: { startsAtSecond: Number.NaN, endsAtSecond: 1560 },
          },
        },
      }),
    ).rejects.toThrow(/incomplete assembled-station context/);

    await expect(
      runtime.startSession({
        learnerId: "learner_order_001",
        consentAccepted: true,
        assembledStation: { ...assembled, stationOrder: 0 },
      }),
    ).rejects.toThrow(/positive integer/);

    await expect(
      runtime.startSession({
        learnerId: "learner_cross_001",
        consentAccepted: true,
        assembledStation: { ...assembled, scenarioId: "peds_asthma_parent_anxiety_v1" },
      }),
    ).rejects.toThrow(/assembled-station scenario mismatch/);
  });
});
