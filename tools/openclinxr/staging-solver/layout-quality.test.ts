import { describe, expect, it } from "vitest";
import type { GateReading } from "../evidence/station-capture/gate-geometry.js";
import { scoreLayoutGate } from "./layout-quality.js";

function gate(overrides: Partial<GateReading>): GateReading {
  return {
    containedActors: 3,
    totalActors: 3,
    visibleActors: 3,
    crownChest: [],
    meanFacingDeg: 90,
    nearOcclusionFraction: 0.1,
    nearRayCount: 14,
    minMargin: 0,
    gatePass: true,
    ...overrides,
  };
}

describe("layout quality score", () => {
  it("scores a threshold-passing runtime layout at 100", () => {
    expect(scoreLayoutGate(gate({}))).toEqual({
      score: 100,
      gatePass: true,
      components: { containment: 40, visibility: 40, facing: 10, nearOcclusion: 10 },
    });
  });

  it("makes one missing actor in containment and visibility visible in the score", () => {
    expect(scoreLayoutGate(gate({ containedActors: 2, visibleActors: 2, gatePass: false })).score).toBe(73.33);
  });
});
