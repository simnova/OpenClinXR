import { edChestPainScenario } from "@openclinxr/scenario-fixtures";
import { describe, expect, it } from "vitest";
import { createDefaultScenarioRuntime } from "./index.js";

describe("scenario runtime", () => {
  it("starts an ED station with provider and asset readiness visible", async () => {
    const runtime = createDefaultScenarioRuntime();
    const session = await runtime.startSession({ learnerId: "learner_001", consentAccepted: true });

    expect(session.stationRunId).toBe("run_ed_chest_pain_priority_v1_learner_001");
    expect(session.phase).toBe("doorway");
    expect(session.scenarioId).toBe(edChestPainScenario.scenarioId);
    expect(runtime.traceEvents(session.stationRunId).map((trace) => trace.eventType)).toEqual(["station.started", "consent.accepted"]);
    expect(await runtime.providerHealth()).toEqual({
      model: { providerId: "mock-model", status: "ready" },
      voice: { providerId: "mock-voice", status: "ready" },
      localModel: { providerId: "local-model", status: "not_configured" },
      localVoice: { providerId: "local-voice", status: "not_configured" },
    });
    expect(runtime.assetReadiness()).toMatchObject({
      scenarioId: edChestPainScenario.scenarioId,
      productionReady: true,
      missingRequiredAssetIds: [],
      blockedAssets: [],
    });
  });

  it("requires consent before creating a station session and starts encounter explicitly", async () => {
    const runtime = createDefaultScenarioRuntime();

    await expect(runtime.startSession({ learnerId: "learner_001", consentAccepted: false })).rejects.toThrow("Consent is required");

    const session = await runtime.startSession({ learnerId: "learner_001", consentAccepted: true });
    const encounter = runtime.startEncounter(session.stationRunId, { atSecond: 60 });

    expect(encounter.phase).toBe("encounter");
    expect(runtime.traceEvents(session.stationRunId).map((trace) => trace.eventType)).toEqual([
      "station.started",
      "consent.accepted",
      "encounter.started",
    ]);
  });

  it("records learner events and patient note into a review packet", async () => {
    const runtime = createDefaultScenarioRuntime();
    const session = await runtime.startSession({ learnerId: "learner_001", consentAccepted: true });
    runtime.startEncounter(session.stationRunId, { atSecond: 60 });

    const event = runtime.appendLearnerEvent(session.stationRunId, {
      eventType: "learner.order",
      atSecond: 480,
      tag: "ecg_request",
      actorId: "nurse_maria_alvarez_v1",
    });
    expect(event.sequence).toBe(3);

    const note = runtime.submitNote(session.stationRunId, {
      atSecond: 1260,
      text: "Concern for ACS. ECG requested.",
    });
    expect(note.phase).toBe("review");
    expect(runtime.traceEvents(session.stationRunId).map((trace) => trace.eventType)).toEqual([
      "station.started",
      "consent.accepted",
      "encounter.started",
      "learner.order",
      "encounter.ended",
      "note.submitted",
    ]);

    const packet = runtime.reviewPacket(session.stationRunId);
    expect(packet.observedTraceTags).toEqual(["ecg_request", "patient_note_submitted"]);
    expect(packet.missingRequiredTraceTags).toContain("team_communication");
    expect(packet.missingRequiredTraceTags).not.toContain("patient_note_submitted");
  });

  it("rejects trace and review operations for unknown sessions", () => {
    const runtime = createDefaultScenarioRuntime();

    expect(() =>
      runtime.appendLearnerEvent("missing-run", {
        eventType: "learner.order",
        atSecond: 10,
        tag: "ecg_request",
      }),
    ).toThrow("Session not found");
    expect(() => runtime.reviewPacket("missing-run")).toThrow("Session not found");
  });
});
