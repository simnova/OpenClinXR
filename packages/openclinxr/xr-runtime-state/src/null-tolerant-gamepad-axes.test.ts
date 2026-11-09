import { describe, expect, it } from "vitest";
import { buildManualPerformanceInputEvidence } from "./index.js";

function rawAxesAfterRounding(axes: unknown[]): unknown[] {
  const evidence = buildManualPerformanceInputEvidence({
    handModelCount: 0,
    handModelStatus: "installed",
    handInputsObserved: 0,
    keyboardVector: { forward: 0, strafe: 0, turn: 0 },
    xrVector: { forward: 0, strafe: 0, turn: 0 },
    xrHandGestureVector: { forward: 0, strafe: 0, turn: 0 },
    xrInputSources: [],
    now: 10,
    previousLastInputObservedAtMs: null,
    previousLastLocomotionAtMs: null,
    previousRigPose: { x: 0, z: 0, yawRadians: 0 },
    rigPosition: { x: 0, z: 0 },
    rigYawRadians: 0,
    locomotionDiagnostics: {
      claimScope: "attempt_diagnostics_only",
      gamepadDeadzone: 0.18,
      handPinchThresholdMeters: 0.035,
      handGestureDeadzoneMeters: 0.045,
      handGestureTurnDeadzoneMeters: 0.055,
      gamepadSources: [
        {
          handedness: "left",
          rawAxes: axes as number[],
          selectedXAxisIndex: 2,
          selectedYAxisIndex: 3,
          xAxisAfterDeadzone: 0,
          yAxisAfterDeadzone: 0,
          activeAfterDeadzone: false,
          contribution: "move",
        },
      ],
      handGestureHands: [],
    },
  });
  return evidence.locomotionDiagnostics?.gamepadSources[0]?.rawAxes ?? [];
}

describe("gamepad rawAxes rounding tolerates null and undefined axes", () => {
  it("keeps the all-numeric output byte-equal to the pre-fix capture", () => {
    // Captured from main before the fix: JSON of rawAxes for [0.12345, -0.5, 0.2, 0.0004].
    expect(JSON.stringify(rawAxesAfterRounding([0.12345, -0.5, 0.2, 0.0004]))).toBe("[0.123,-0.5,0.2,0]");
  });

  it("does not throw, keeps the length, rounds numbers as before and maps null and undefined to 0", () => {
    let rounded: unknown[] = [];
    expect(() => {
      rounded = rawAxesAfterRounding([0.12345, null, undefined, -0.5]);
    }).not.toThrow();
    expect(rounded).toHaveLength(4);
    expect(JSON.stringify(rounded)).toBe("[0.123,0,0,-0.5]");
  });
});
