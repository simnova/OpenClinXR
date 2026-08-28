import { describe, expect, it } from "vitest";
import { ARMS, SAMPLER_PARAMETER_SHA256, decidePolicy } from "./trellis-conditioning-run.js";

const SHA256 = /^[a-f0-9]{64}$/;

describe("trellis-conditioning-run: arm definitions match the #697 planted contract", () => {
  it("declares the four arms with the planted ordered view sets, front first", () => {
    const expected: Record<string, readonly string[]> = {
      single_shared_front: ["front"],
      current_four: ["front", "right", "three_quarter_left", "three_quarter_right"],
      cardinal_four: ["front", "back", "left", "right"],
      cardinal_six: ["front", "back", "left", "right", "top", "bottom"],
    };
    expect(ARMS.map((a) => a.armId).sort()).toEqual(Object.keys(expected).sort());
    for (const arm of ARMS) {
      expect(arm.views).toEqual(expected[arm.armId]);
      expect(arm.views[0]).toBe("front");
    }
  });

  it("flags cardinal_six out-of-training-envelope and leaves the other arms inside it", () => {
    expect(ARMS.find((a) => a.armId === "cardinal_six")?.experimentalOutOfTrainingEnvelope).toBe(true);
    for (const arm of ARMS.filter((a) => a.armId !== "cardinal_six")) {
      expect(arm.experimentalOutOfTrainingEnvelope).toBe(false);
    }
  });

  it("uses one sampler hash across all arms (pipeline defaults, no overrides)", () => {
    expect(SAMPLER_PARAMETER_SHA256).toMatch(SHA256);
    const hashes = new Set(ARMS.map(() => SAMPLER_PARAMETER_SHA256));
    expect(hashes.size).toBe(1);
  });
});

describe("decidePolicy: deterministic conclusion from measured geometry", () => {
  const base = {
    samplerParameterSha256: SAMPLER_PARAMETER_SHA256,
    seed: 20260828,
    inputImages: [],
  };
  const controlGeo = {
    boundaryEdgeCount: 470269,
    isWatertight: false,
    weldedComponentCount: 14,
    largestComponentShare: 0.8,
    signedVolume: 0.05,
    surfaceArea: 5.3,
    rawTriangleCount: 994943,
    rawBytes: 40089412,
    wallClockSeconds: 1371,
  };

  it("retains single view when a multiview arm regresses boundary edges", () => {
    const arms = [
      { ...base, armId: "single_shared_front", status: "mesh_exported", geometry: controlGeo },
      { ...base, armId: "current_four", status: "mesh_exported", geometry: { ...controlGeo, boundaryEdgeCount: 547259 } },
      { ...base, armId: "cardinal_four", status: "mesh_exported", geometry: { ...controlGeo, boundaryEdgeCount: 460000 } },
      { ...base, armId: "cardinal_six", status: "mesh_exported", experimentalOutOfTrainingEnvelope: true, geometry: { ...controlGeo, boundaryEdgeCount: 450000 } },
    ];
    const policy = decidePolicy(arms);
    expect(policy.conclusion).toBe("retain_single_view");
    expect(policy.reason).toContain("boundaryEdgeCount");
  });

  it("rejects all when nothing exported a mesh", () => {
    const arms = [
      { ...base, armId: "single_shared_front", status: "failed_measured", failure: { reason: "blocked_build" } },
      { ...base, armId: "current_four", status: "failed_measured", failure: { reason: "blocked_build" } },
      { ...base, armId: "cardinal_four", status: "failed_measured", failure: { reason: "blocked_build" } },
      { ...base, armId: "cardinal_six", status: "failed_measured", experimentalOutOfTrainingEnvelope: true, failure: { reason: "blocked_build" } },
    ];
    const policy = decidePolicy(arms);
    expect(policy.conclusion).toBe("reject_all_measured");
  });

  it("adopts multiview only when every multiview arm is a clear measured improvement", () => {
    const arms = [
      { ...base, armId: "single_shared_front", status: "mesh_exported", geometry: controlGeo },
      { ...base, armId: "current_four", status: "mesh_exported", geometry: { ...controlGeo, boundaryEdgeCount: 400000, isWatertight: true, weldedComponentCount: 10 } },
      { ...base, armId: "cardinal_four", status: "mesh_exported", geometry: { ...controlGeo, boundaryEdgeCount: 410000, isWatertight: true, weldedComponentCount: 11 } },
      { ...base, armId: "cardinal_six", status: "mesh_exported", experimentalOutOfTrainingEnvelope: true, geometry: { ...controlGeo, boundaryEdgeCount: 390000, isWatertight: true, weldedComponentCount: 9 } },
    ];
    const policy = decidePolicy(arms);
    expect(policy.conclusion).toBe("adopt_multiview");
  });
});
