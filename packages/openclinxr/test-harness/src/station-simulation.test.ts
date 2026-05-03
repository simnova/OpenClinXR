import { describe, expect, it } from "vitest";
import { runEdChestPainSimulation } from "./index.js";

describe("ED chest pain deterministic simulation", () => {
  it("runs from fixture to review packet without cloud services", async () => {
    const result = await runEdChestPainSimulation();

    expect(result.stationRunId).toContain("ed_chest_pain_priority_v1");
    expect(result.eventCount).toBeGreaterThanOrEqual(9);
    expect(result.actorResponseCount).toBe(2);
    expect(result.voiceAudioEventCount).toBe(1);
    expect(result.reviewPacket.missingRequiredTraceTags).toEqual([]);
    expect(result.reviewPacket.traceQuality.modelGeneratedEventCount).toBe(2);
    expect(result.reviewPacket.traceQuality.blockedGuardrailCount).toBe(1);
    expect(result.reviewPacket.timeline.some((entry) => entry.eventType === "voice.audio.generated")).toBe(true);
    expect(JSON.stringify(result.reviewPacket)).not.toContain("Father died of myocardial infarction");
    expect(result.providerHealth).toEqual({
      model: { providerId: "mock-model", status: "ready" },
      voice: { providerId: "mock-voice", status: "ready" },
      localModel: { providerId: "local-model", status: "not_configured", blockers: ["local_model_runtime_not_configured"] },
      localVoice: { providerId: "local-voice", status: "not_configured", blockers: ["local_voice_runtime_not_configured"] },
    });
  });
});
