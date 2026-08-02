import type { ScenarioRuntimeActorTurn } from "@openclinxr/scenario-runtime";
import { describe, expect, it, vi } from "vitest";
import type { ApiPersistenceSink } from "./app.js";
import { createScenarioRuntimeDurableStoreFromApiPersistence } from "./runtime-durable-store.js";

describe("createScenarioRuntimeDurableStoreFromApiPersistence", () => {
  it("forwards saveReviewPacket and saveActorTurn to the API persistence sink", async () => {
    const saveReviewPacket = vi.fn();
    const saveActorTurn = vi.fn();
    const sink: ApiPersistenceSink = { saveReviewPacket, saveActorTurn };
    const store = createScenarioRuntimeDurableStoreFromApiPersistence(sink);

    const packet = {
      stationRunId: "run_001",
      scenarioId: "ed_chest_pain_priority_v1",
      traceQuality: { eventCount: 3 },
    } as Parameters<NonNullable<ApiPersistenceSink["saveReviewPacket"]>>[1];

    const turn: ScenarioRuntimeActorTurn = {
      turnId: "turn_1_patient_robert_hayes_v1_120",
      stationRunId: "run_001",
      actorId: "patient_robert_hayes_v1",
      atSecond: 120,
      conversationTurn: 1,
      learnerUtterance: "When did the pressure start?",
      responseText: "It started this morning.",
      responseKind: "direct_answer",
      traceContextTags: ["history_opqrst"],
      durableEventRef: "durable://station-runs/run_001/events/4",
      learnerEventSequence: 3,
      actorResponseEventSequence: 4,
    };

    await store.saveReviewPacket?.("run_001", packet);
    await store.saveActorTurn?.("run_001", turn);

    expect(saveReviewPacket).toHaveBeenCalledTimes(1);
    expect(saveReviewPacket).toHaveBeenCalledWith("run_001", packet);
    expect(saveActorTurn).toHaveBeenCalledTimes(1);
    expect(saveActorTurn).toHaveBeenCalledWith("run_001", turn);
  });

  it("no-ops when sink methods are unset", async () => {
    const store = createScenarioRuntimeDurableStoreFromApiPersistence({});
    // Sink methods optional → adapter returns void (undefined), not a Promise.
    await expect(Promise.resolve(store.saveReviewPacket?.("run_x", {} as never))).resolves.toBeUndefined();
    await expect(Promise.resolve(store.saveActorTurn?.("run_x", {} as never))).resolves.toBeUndefined();
  });
});
