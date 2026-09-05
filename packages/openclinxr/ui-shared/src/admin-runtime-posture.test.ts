import { describe, expect, it } from "vitest";
import type {
  AdminRealtimeVoicePosture,
  AdminRuntimeProtocolPosture,
  AdminRuntimeProviderReadiness,
} from "./admin-runtime-posture.js";

describe("admin runtime posture types", () => {
  it("accepts a provider readiness surface", () => {
    const readiness: AdminRuntimeProviderReadiness = {
      source: "runtime-provider-readiness",
      claimBoundary: "metadata_only",
      surfaces: [],
    };
    expect(readiness.surfaces).toEqual([]);
  });

  it("accepts protocol and voice posture shapes", () => {
    const protocol: AdminRuntimeProtocolPosture = {
      primaryRuntimeTarget: "bun-hono",
      localFallbackRuntimeTarget: "node-hono",
      azureRuntimeTarget: "azure",
      protocols: [],
    };
    const voice: AdminRealtimeVoicePosture["policy"] = {
      cloudApisUsed: false,
      paidApisUsed: false,
      modelDownloadsPerformed: false,
      productionUseAllowed: false,
    };
    expect(protocol.protocols).toEqual([]);
    expect(voice.cloudApisUsed).toBe(false);
  });
});
