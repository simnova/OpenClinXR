import { describe, expect, it } from "vitest";
import {
  computeWalkQuality,
  type QualityInput,
} from "./walk-quality-metrics.js";

/**
 * The walk-quality metrics pass a clean walk and fail a lurching one.
 *
 * claimScope: the four metric definitions over synthetic frames fixtures.
 * notEvidenceFor: browser captures, gait realism, clinical plausibility.
 */

function cleanWalk(): QualityInput {
  // Two steps at 1.0 m/s: the midpoint strides straight, 1.0 m in 1.0 s.
  const frames: QualityInput["frames"] = [];
  for (let i = 0; i <= 30; i += 1) {
    const t = i / 30;
    frames.push({
      tMs: i * 1000 / 30,
      phase: "walking",
      left: { x: 0.1 * Math.sin(t * 2 * Math.PI), y: 0.01, z: t },
      right: { x: -0.1 * Math.sin(t * 2 * Math.PI), y: 0.02, z: t },
    });
  }
  return {
    frames,
    stanceWindows: [
      { foot: "left", pinnedFrames: 8, holdSlideMeters: 0.004 },
      { foot: "right", pinnedFrames: 8, holdSlideMeters: 0.006 },
      { foot: "left", pinnedFrames: 8, holdSlideMeters: 0.005 },
    ],
    walkDiagnostics: { executorPrescribedMps: 1.0 },
  };
}

function lurchingWalk(): QualityInput {
  // The same straight displacement, but the midpoint weaves back and forth:
  // each frame steps +0.10 m then -0.07 m along the route, so the path is ~5x
  // the displacement. Cadence and holds stay healthy so only lurch fails.
  const frames: QualityInput["frames"] = [];
  let z = 0;
  for (let i = 0; i <= 30; i += 1) {
    frames.push({
      tMs: i * 1000 / 30,
      phase: "walking",
      left: { x: 0.1, y: 0.01, z },
      right: { x: -0.1, y: 0.02, z },
    });
    z += i % 2 === 0 ? 0.1 : -0.07;
  }
  return {
    frames,
    stanceWindows: [
      { foot: "left", pinnedFrames: 8, holdSlideMeters: 0.004 },
      { foot: "right", pinnedFrames: 8, holdSlideMeters: 0.006 },
      { foot: "left", pinnedFrames: 8, holdSlideMeters: 0.005 },
    ],
    walkDiagnostics: { executorPrescribedMps: 0.3 },
  };
}

describe("walk quality metrics", () => {
  it("a clean walk passes all four metrics", () => {
    const quality = computeWalkQuality(cleanWalk());
    expect(quality.groundSpeedMps).toBeCloseTo(1.0, 2);
    expect(quality.lurch).toBeLessThanOrEqual(1.4);
    expect(quality.medianHoldSlideMeters).toBeLessThanOrEqual(0.02);
    expect(quality.cadencePerMinute).toBeGreaterThanOrEqual(90);
    expect(quality.cadencePerMinute).toBeLessThanOrEqual(125);
    expect(quality.allPass).toBe(true);
  });

  it("a midpoint that moves back and forth fails the lurch metric", () => {
    const quality = computeWalkQuality(lurchingWalk());
    expect(quality.lurch).toBeGreaterThan(1.4);
    expect(quality.lurchPass).toBe(false);
    expect(quality.allPass).toBe(false);
  });
});
