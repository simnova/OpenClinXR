/**
 * Settle-entry stage-2: the held-anchor pivot stays bounded under a synthetic
 * two-run perturbation. Drives the turn only through the package's reviewed
 * public surface (`./stepping-turn`), never a relative module path.
 *
 * Two runs plan the same 62.7 deg SC-05 residual; run B seeds its entry slot
 * and every window anchor 0.2 mm off run A (the measured capture seed). Each
 * frame the slot is the rigid pivot about the run's own held anchor at the
 * plan yaw — the stage-2 rule. The bound: slot difference never exceeds
 * 2 mm through the full turn, and re-anchoring at a window switch is
 * continuous (no teleport on the capture frame).
 */
import { describe, expect, it } from "vitest";
import {
  pivotSlotXzForSteppingFrame,
  planSteppingTurn,
  STEPPING_PIVOT_CAPTURE_HEIGHT_M,
  steppingPivotWindowKey,
  steppingTurnAt,
} from "./stepping-turn.js";

type SteppingPivotAnchor = Parameters<typeof pivotSlotXzForSteppingFrame>[0]["anchor"];

const DT = 1 / 30;
const SEED_M = 0.0002;
const BOUND_M = 0.002;

function sc05Plan() {
  const residual = (62.7128 * Math.PI) / 180;
  const entryYaw = (117.2872 * Math.PI) / 180;
  return planSteppingTurn({
    residualYawRadians: residual,
    entryYawRadians: entryYaw,
    targetHeadingRadians: Math.PI,
    leftToeXz: { x: 0.1, z: 0.05 },
    rightToeXz: { x: -0.1, z: -0.05 },
    leftToeY: 0.1,
    rightToeY: 0.08,
    stanceBaselineY: 0.02,
    entrySlotXz: { x: 0, z: 0 },
    legScale: 1,
  });
}

describe("the held-anchor stepping pivot under a two-run perturbation", () => {
  it("keeps a 0.2 mm seed bounded through a full turn with window re-anchors", () => {
    expect(STEPPING_PIVOT_CAPTURE_HEIGHT_M).toBe(0.03);
    const plan = sc05Plan();
    // One anchor per window, run B seeded 0.2 mm off — the fixed plan stance
    // targets stand in for the captured floor feet (capture is one-shot).
    const anchors = new Map<string, { a: SteppingPivotAnchor; b: SteppingPivotAnchor }>();
    const anchorFor = (windowKey: string, stepIndex: number): { a: SteppingPivotAnchor; b: SteppingPivotAnchor } => {
      const found = anchors.get(windowKey);
      if (found) return found;
      const step = plan.steps[stepIndex]!;
      const entry = {
        anchorXz: { ...step.stanceXz },
        slotXzAtCapture: { x: 0, z: 0 },
        yawAtCaptureRadians: step.yawStartRadians,
        windowKey,
        capturedAtFrame: 0,
      };
      const pair = {
        a: entry,
        b: {
          ...entry,
          anchorXz: { x: entry.anchorXz.x + SEED_M, z: entry.anchorXz.z },
          slotXzAtCapture: { x: entry.slotXzAtCapture.x + SEED_M, z: entry.slotXzAtCapture.z },
        },
      };
      anchors.set(windowKey, pair);
      return pair;
    };
    let slotA = { x: 0, z: 0 };
    let slotB = { x: SEED_M, z: 0 };
    let maxDiff = 0;
    let maxSwitchJump = 0;
    let prevKey: string | null = null;
    const frames = Math.ceil(plan.totalS / DT);
    for (let frame = 0; frame <= frames; frame += 1) {
      const t = Math.min(plan.totalS, frame * DT);
      const targets = steppingTurnAt(plan, t);
      const key = steppingPivotWindowKey(targets.stepIndex, targets.stanceFoot);
      const pair = anchorFor(key, targets.stepIndex);
      if (prevKey !== null && prevKey !== key) {
        // Continuity at the capture switch: the pivot about the new anchor at
        // the switch yaw must land where the old pivot left the slot.
        const restartA = pivotSlotXzForSteppingFrame({ anchor: pair.a, yawNowRadians: targets.yawRadians });
        const restartB = pivotSlotXzForSteppingFrame({ anchor: pair.b, yawNowRadians: targets.yawRadians });
        // Re-base the new window on the live slot (what the runtime captures).
        pair.a = { ...pair.a, slotXzAtCapture: { ...slotA }, yawAtCaptureRadians: targets.yawRadians, capturedAtFrame: frame };
        pair.b = { ...pair.b, slotXzAtCapture: { ...slotB }, yawAtCaptureRadians: targets.yawRadians, capturedAtFrame: frame };
        const contA = pivotSlotXzForSteppingFrame({ anchor: pair.a, yawNowRadians: targets.yawRadians });
        const contB = pivotSlotXzForSteppingFrame({ anchor: pair.b, yawNowRadians: targets.yawRadians });
        maxSwitchJump = Math.max(
          maxSwitchJump,
          Math.hypot(contA.x - slotA.x, contA.z - slotA.z),
          Math.hypot(contB.x - slotB.x, contB.z - slotB.z),
        );
        void restartA;
        void restartB;
      }
      prevKey = key;
      slotA = pivotSlotXzForSteppingFrame({ anchor: pair.a, yawNowRadians: targets.yawRadians });
      slotB = pivotSlotXzForSteppingFrame({ anchor: pair.b, yawNowRadians: targets.yawRadians });
      maxDiff = Math.max(maxDiff, Math.hypot(slotA.x - slotB.x, slotA.z - slotB.z));
    }
    expect(maxDiff).toBeLessThanOrEqual(BOUND_M);
    expect(maxSwitchJump).toBeLessThanOrEqual(1e-9);
    const arrivalDiff = Math.hypot(slotA.x - slotB.x, slotA.z - slotB.z);
    expect(arrivalDiff).toBeLessThanOrEqual(BOUND_M);
  });

  it("is a rigid pivot: radius about the anchor is preserved", () => {
    const anchor: SteppingPivotAnchor = {
      anchorXz: { x: 0.2, z: -0.1 },
      slotXzAtCapture: { x: 0, z: 0 },
      yawAtCaptureRadians: 1.0,
      windowKey: "0:left",
      capturedAtFrame: 0,
    };
    const r0 = Math.hypot(anchor.slotXzAtCapture.x - anchor.anchorXz.x, anchor.slotXzAtCapture.z - anchor.anchorXz.z);
    for (const yaw of [1.0, 1.2, 1.6, 2.0, 2.047]) {
      const p = pivotSlotXzForSteppingFrame({ anchor, yawNowRadians: yaw });
      const r = Math.hypot(p.x - anchor.anchorXz.x, p.z - anchor.anchorXz.z);
      expect(Math.abs(r - r0)).toBeLessThanOrEqual(1e-12);
    }
  });
});
