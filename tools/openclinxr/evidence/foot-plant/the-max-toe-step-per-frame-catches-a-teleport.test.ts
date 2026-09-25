import { describe, expect, it } from "vitest";
import {
  computeTurnQuality,
  MAX_TOE_STEP_PER_FRAME_FLAG_METERS,
  type TurnQualityInput,
} from "./turn-quality-metrics.js";

/**
 * `maxToeStepPerFrameM` is a defect FLAG, not a pass/fail gate: it names a single-frame XZ toe
 * jump that real clip rotations at capture frame rate cannot produce — the signature of a toe
 * teleported by writing its local position directly rather than by the clip's own bone rotations
 * (the trap named explicitly in this slice's brief). A normal capture with small per-frame steps
 * must NOT flag; an injected 0.3 m one-frame jump — well over `MAX_TOE_STEP_PER_FRAME_FLAG_METERS`
 * (0.08 m) — must.
 *
 * claimScope: the metric's own arithmetic over synthetic frame fixtures.
 * notEvidenceFor: browser captures, gait realism, clinical plausibility.
 */

function normalCaptureFrames(): TurnQualityInput["frames"] {
  const frames: TurnQualityInput["frames"] = [];
  for (let i = 0; i <= 20; i += 1) {
    const t = (i / 20) * 0.6;
    frames.push({
      sample: i,
      tMs: t * 1000,
      phase: i < 2 ? "walking" : i < 18 ? "settling" : "arrived",
      // A few centimetres per frame, well under the teleport floor.
      left: { x: -0.05 + i * 0.002, y: i % 2 === 0 ? 0.001 : 0.02, z: 0.0 + i * 0.003 },
      right: { x: 0.05 - i * 0.002, y: i % 2 === 1 ? 0.001 : 0.02, z: 0.0 - i * 0.003 },
      stanceFoot: i % 2 === 0 ? "left" : "right",
      slotYawRadians: (i / 20) * (Math.PI / 4),
      headYawWorldRadians: (i / 20) * (Math.PI / 4),
    });
  }
  return frames;
}

describe("maxToeStepPerFrameM", () => {
  it("does not flag a capture whose steps are all a few centimetres", () => {
    const quality = computeTurnQuality({ frames: normalCaptureFrames() });
    expect(quality.maxToeStepPerFrameM).not.toBeNull();
    expect(quality.maxToeStepPerFrameM as number).toBeLessThan(MAX_TOE_STEP_PER_FRAME_FLAG_METERS);
    expect(quality.maxToeStepPerFrameFlagged).toBe(false);
  });

  it("flags an injected 0.3 m one-frame jump", () => {
    const frames = normalCaptureFrames();
    const teleportFrame = frames[10];
    if (teleportFrame === undefined || teleportFrame.left === null) throw new Error("fixture frame missing");
    frames[10] = { ...teleportFrame, left: { ...teleportFrame.left, x: teleportFrame.left.x + 0.3 } };
    const quality = computeTurnQuality({ frames });
    expect(quality.maxToeStepPerFrameM).not.toBeNull();
    expect(quality.maxToeStepPerFrameM as number).toBeGreaterThanOrEqual(0.3);
    expect(quality.maxToeStepPerFrameFlagged).toBe(true);
  });

  it("reports null (not a fabricated zero) when fewer than two frames carry a toe", () => {
    const quality = computeTurnQuality({
      frames: [
        { sample: 0, tMs: 0, phase: "walking", left: null, right: null, stanceFoot: null },
      ],
    });
    expect(quality.maxToeStepPerFrameM).toBeNull();
    expect(quality.maxToeStepPerFrameFlagged).toBeNull();
  });
});
