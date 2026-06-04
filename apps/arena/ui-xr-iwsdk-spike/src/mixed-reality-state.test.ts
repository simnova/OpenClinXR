import { describe, expect, it } from "vitest";
import {
  buildMixedRealitySupportState,
  hasApprovedMixedRealityOperatorGate,
  mixedRealityOptionalFeatures,
} from "./mixed-reality-state.js";

describe("IWSDK sidecar Mixed Reality support state", () => {
  it("requires an explicit operator approval query gate before offering MR", () => {
    expect(hasApprovedMixedRealityOperatorGate("")).toBe(false);
    expect(hasApprovedMixedRealityOperatorGate("?mr=preview")).toBe(false);
    expect(hasApprovedMixedRealityOperatorGate("?mr=approved")).toBe(true);
  });

  it("keeps immersive-ar blocked when the approval gate is absent", () => {
    expect(buildMixedRealitySupportState({
      operatorApproved: false,
      webXrAvailable: true,
      immersiveArSupported: true,
    })).toEqual({
      mode: "immersive-ar",
      operatorApproved: false,
      status: "operator_gate_required",
      offerable: false,
      label: "MR requires ?mr=approved",
    });
  });

  it("models WebXR immersive-ar support separately from Full VR", () => {
    expect(buildMixedRealitySupportState({
      operatorApproved: true,
      webXrAvailable: true,
      immersiveArSupported: true,
    })).toMatchObject({
      mode: "immersive-ar",
      operatorApproved: true,
      status: "ready",
      offerable: true,
      label: "Mixed Reality ready",
    });

    expect(buildMixedRealitySupportState({
      operatorApproved: true,
      webXrAvailable: true,
      immersiveArSupported: false,
    })).toMatchObject({
      status: "unsupported",
      offerable: false,
      label: "Mixed Reality unavailable",
    });
  });

  it("uses passthrough-friendly immersive-ar optional features", () => {
    expect(mixedRealityOptionalFeatures).toContain("local-floor");
    expect(mixedRealityOptionalFeatures).toContain("hand-tracking");
    expect(mixedRealityOptionalFeatures).not.toContain("bounded-floor");
  });
});
