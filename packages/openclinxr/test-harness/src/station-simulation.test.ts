import { describe, expect, it } from "vitest";
import { runEdChestPainSimulation } from "./index.js";

describe("ED chest pain deterministic simulation", () => {
  it("runs from fixture to review packet without cloud services", async () => {
    const result = await runEdChestPainSimulation();

    expect(result.stationRunId).toContain("ed_chest_pain_priority_v1");
    expect(result.eventCount).toBeGreaterThanOrEqual(9);
    expect(result.actorResponseCount).toBe(3);
    expect(result.routedActorResponseCount).toBe(1);
    expect(result.clinicalActionEventCount).toBe(1);
    expect(result.voiceAudioEventCount).toBe(1);
    expect(result.reviewPacket.missingRequiredTraceTags).toEqual([]);
    expect(result.reviewPacket.traceQuality.modelGeneratedEventCount).toBe(3);
    expect(result.reviewPacket.traceQuality.blockedGuardrailCount).toBe(1);
    expect(result.reviewPacket.timeline).toContainEqual(expect.objectContaining({
      eventType: "clinical.action.recorded",
      actorId: "nurse_maria_alvarez_v1",
      tag: "ecg_request",
      source: "session-state",
    }));
    expect(result.reviewPacket.timeline).toContainEqual(expect.objectContaining({
      eventType: "actor.interaction.routed",
      actorId: "nurse_maria_alvarez_v1",
      tag: "team_communication",
      source: "session-state",
    }));
    expect(result.reviewPacket.timeline.some((entry) => entry.eventType === "voice.audio.generated")).toBe(true);
    expect(JSON.stringify(result.reviewPacket)).not.toContain("Father died of myocardial infarction");
    expect(JSON.stringify(result.reviewPacket)).not.toContain("Repeat blood pressure is falling");
    expect(result.providerHealth).toEqual({
      model: { providerId: "mock-model", status: "ready" },
      voice: { providerId: "mock-voice", status: "ready" },
      localModel: { providerId: "local-model", status: "not_configured", blockers: ["local_model_runtime_not_configured"] },
      localVoice: { providerId: "local-voice", status: "not_configured", blockers: ["local_voice_runtime_not_configured"] },
    });
  });
});
