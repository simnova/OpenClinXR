/**
 * Feedforward slot pivot for the stepping turn (settle-entry slice, stage 2).
 *
 * WHY THIS EXISTS. `advanceSteppingTurn` (`stepping-turn-execution-mod.ts`)
 * translated the slot every pass by the stance toe's live world residual
 * (`slot += target - toeWorld`). The toe is a descendant of the slot, so the
 * term re-read a world position it had moved the pass before: measured
 * per-frame gain up to 3.26 on a 0.2 mm seed, growing to 0.35 m by arrival.
 * This module replaces that feedback with a rigid pivot about a HELD anchor:
 * every input (anchor, slot-at-capture, yaw-at-capture, current plan yaw) is
 * either fixed plan geometry or a once-captured number, never a live world
 * read — so the slot path cannot amplify anything, by construction.
 *
 * PURE GEOMETRY: no three.js, no bones, no mixer. Same Y-rotation convention
 * as `pivotSlotAroundAnchor` (`stance-lock-ik.ts`): x' = x*cos + z*sin,
 * z' = -x*sin + z*cos.
 */

/** Toe height above the floor at which a planted window may capture its anchor. */
export const STEPPING_PIVOT_CAPTURE_HEIGHT_M = 0.03;

export type SteppingPivotAnchor = {
  /** Stance-toe world XZ, captured once when the window's foot was on the floor. */
  anchorXz: { x: number; z: number };
  /** Slot XZ on the capture frame. */
  slotXzAtCapture: { x: number; z: number };
  /** Plan slot yaw on the capture frame. */
  yawAtCaptureRadians: number;
  /** `stepIndex:stanceFoot` this anchor belongs to. */
  windowKey: string;
  /** Settling-frame index of the capture. */
  capturedAtFrame: number;
};

export function steppingPivotWindowKey(stepIndex: number, stanceFoot: string): string {
  return `${stepIndex}:${stanceFoot}`;
}

/** Rigid slot XZ for `yawNowRadians`, pivoted about the held anchor. */
export function pivotSlotXzForSteppingFrame(input: {
  anchor: SteppingPivotAnchor;
  yawNowRadians: number;
}): { x: number; z: number } {
  const yawDelta = input.yawNowRadians - input.anchor.yawAtCaptureRadians;
  const cos = Math.cos(yawDelta);
  const sin = Math.sin(yawDelta);
  const dx = input.anchor.slotXzAtCapture.x - input.anchor.anchorXz.x;
  const dz = input.anchor.slotXzAtCapture.z - input.anchor.anchorXz.z;
  return {
    x: input.anchor.anchorXz.x + dx * cos + dz * sin,
    z: input.anchor.anchorXz.z - dx * sin + dz * cos,
  };
}
