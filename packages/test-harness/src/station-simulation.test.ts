import { describe, expect, it } from "vitest";
import { runEdChestPainSimulation } from "./index.js";

describe("ED chest pain deterministic simulation", () => {
  it("runs from fixture to review packet without cloud services", () => {
    const result = runEdChestPainSimulation();

    expect(result.stationRunId).toContain("ed_chest_pain_priority_v1");
    expect(result.eventCount).toBeGreaterThanOrEqual(9);
    expect(result.reviewPacket.missingRequiredTraceTags).toEqual([]);
    expect(result.providerHealth).toEqual({
      model: { providerId: "mock-model", status: "ready" },
      voice: { providerId: "mock-voice", status: "ready" },
      localModel: { providerId: "local-model", status: "not_configured" },
      localVoice: { providerId: "local-voice", status: "not_configured" },
    });
  });
});

