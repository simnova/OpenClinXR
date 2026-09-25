import { describe, expect, it } from "vitest";
import {
  computeTurnQuality,
  STANCE_TOE_STEP_PER_FRAME_FLAG_METERS,
  type TurnQualityInput,
} from "./turn-quality-metrics.js";

/**
 * `stanceToeStepPerFrameM` is a defect FLAG, not a pass/fail gate: it names a single-frame XZ move
 * of the foot LABELLED STANCE — a planted foot has no clip rotation driving it and should not move
 * at all frame to frame. `maxToeStepPerFrameM` (whole-foot, 0.08 m floor) cannot distinguish this
 * from a healthy swing step: measured on a real capture, walking-phase swing steps of 0.06-0.10
 * m/frame are NORMAL (a swing foot peaks around 3 m/s) and must not flag, while a stance-labelled
 * foot moving 0.18 m in one frame (measured: main's capture, sample 79, settling, stanceFoot=right)
 * is the actual defect this metric exists to catch.
 *
 * claimScope: the metric's own arithmetic over synthetic frame fixtures.
 * notEvidenceFor: browser captures, gait realism, clinical plausibility.
 */

function walkingSwingStepFrames(): TurnQualityInput["frames"] {
  // Two frames, stanceFoot=left both times: the swing (right) foot takes a normal 0.09 m step,
  // the stance (left) foot does not move. This must NOT flag.
  return [
    {
      sample: 0,
      tMs: 0,
      phase: "walking",
      left: { x: -0.05, y: 0.001, z: 0.0 },
      right: { x: 0.1, y: 0.02, z: 0.0 },
      stanceFoot: "left",
    },
    {
      sample: 1,
      tMs: 33,
      phase: "walking",
      left: { x: -0.05, y: 0.001, z: 0.0 },
      right: { x: 0.19, y: 0.02, z: 0.0 },
      stanceFoot: "left",
    },
  ];
}

function stancePlantJumpFrames(): TurnQualityInput["frames"] {
  // Two frames, stanceFoot=right both times: the stance (right) foot jumps 0.18 m in one frame —
  // the measured plant defect (main capture, sample 79). Must flag.
  return [
    {
      sample: 78,
      tMs: 0,
      phase: "settling",
      left: { x: -0.05, y: 0.02, z: 0.0 },
      right: { x: 0.1, y: 0.001, z: 0.0 },
      stanceFoot: "right",
    },
    {
      sample: 79,
      tMs: 33,
      phase: "settling",
      left: { x: -0.05, y: 0.02, z: 0.0 },
      right: { x: 0.28, y: 0.001, z: 0.0 },
      stanceFoot: "right",
    },
  ];
}

describe("stanceToeStepPerFrameM", () => {
  it("does not flag a normal walking swing step on the non-stance foot", () => {
    const quality = computeTurnQuality({ frames: walkingSwingStepFrames() });
    // The stance foot itself did not move, so the metric sees no stance-labelled displacement.
    expect(quality.stanceToeStepPerFrameM).toBe(0);
    expect(quality.stanceToeStepPerFrameFlagged).toBe(false);
  });

  it("flags a 0.18 m one-frame jump of the foot labelled stance", () => {
    const quality = computeTurnQuality({ frames: stancePlantJumpFrames() });
    expect(quality.stanceToeStepPerFrameM).not.toBeNull();
    expect(quality.stanceToeStepPerFrameM as number).toBeCloseTo(0.18, 5);
    expect(quality.stanceToeStepPerFrameM as number).toBeGreaterThan(STANCE_TOE_STEP_PER_FRAME_FLAG_METERS);
    expect(quality.stanceToeStepPerFrameFlagged).toBe(true);
  });

  it("checks either foot across a stance-switch boundary", () => {
    // Frame 0: stance=left. Frame 1: stance=right (switched). The LEFT foot (stance in frame 0)
    // jumps 0.15 m even though it is not "stance" in frame 1 — the switch boundary must still
    // catch this, since the label just flipped and either foot could be the one that planted.
    const frames: TurnQualityInput["frames"] = [
      {
        sample: 0,
        tMs: 0,
        phase: "settling",
        left: { x: -0.05, y: 0.001, z: 0.0 },
        right: { x: 0.1, y: 0.02, z: 0.0 },
        stanceFoot: "left",
      },
      {
        sample: 1,
        tMs: 33,
        phase: "settling",
        left: { x: 0.1, y: 0.001, z: 0.0 },
        right: { x: 0.1, y: 0.001, z: 0.0 },
        stanceFoot: "right",
      },
    ];
    const quality = computeTurnQuality({ frames });
    expect(quality.stanceToeStepPerFrameM).not.toBeNull();
    expect(quality.stanceToeStepPerFrameM as number).toBeCloseTo(0.15, 5);
    expect(quality.stanceToeStepPerFrameFlagged).toBe(true);
  });

  it("reports null when no frame pair carries a stance label on both sides", () => {
    const quality = computeTurnQuality({
      frames: [{ sample: 0, tMs: 0, phase: "walking", left: null, right: null, stanceFoot: null }],
    });
    expect(quality.stanceToeStepPerFrameM).toBeNull();
    expect(quality.stanceToeStepPerFrameFlagged).toBeNull();
  });
});
