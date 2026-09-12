import { describe, expect, it } from "vitest";
import { FOOT_CONTACT_HEIGHT_METERS } from "../../../../../../packages/openclinxr/asset-registry/src/approach-executor.js";
import { footSlideFinding, measureShippedApproach } from "./runtime-approach-measurement.js";

/**
 * DIAGNOSIS (immutable). Measured by measureShippedApproach() on the shipped physician rig and the
 * production approach consumers, 60 Hz node simulation, 2026-09-12 at repo revision a02f3b1b:
 *
 * | interval     | foot-slide | observed |
 * | walk         | SATISFIED  | both toes 0 m total and 0 m worst frame |
 * | STOP         | SATISFIED  | 0 m |
 * | TERMINAL TURN| VIOLATED   | left total 0.17512 m, right total 0.21127 m, right worst frame 0.03615 m |
 * | WHOLE RUN    | VIOLATED   | only because of the turn |
 *
 * Arrival 0.01474 m, heading error 0 degrees, stopped interval 7.183 s with no root travel.
 * Walk and stop already behave. The defect is confined to the terminal turn: locomotion drive is
 * zero, the root/slot XZ stance lock is disabled, and both rest-pose toes stay in the contact band
 * while the slot yaws, so a planted foot drags.
 *
 * ## FIXED (tsk_acc431bda6914e71)
 * The settle interval now releases one foot and replants the other. Slot XZ is not used as a second
 * translator. SC-00 limits are unchanged. Browser A08 foot-slide stays not_gradeable.
 */

const ARRIVAL_ERROR_MAX_METERS = 0.05;
const SETTLED_YAW_ERROR_MAX_DEGREES = 10;
const STOPPED_OBSERVATION_MIN_SECONDS = 2;
const ROOT_DRIFT_MAX_METERS = 0.005;

function stanceCoverage(
  samples: ReadonlyArray<{ position: { x: number; y: number; z: number } }>,
  floorOriginY: number,
  bandMeters: number,
): { contact: number; air: number; windows: number } {
  let contact = 0;
  let air = 0;
  let windows = 0;
  let previousDown = false;
  for (const sample of samples) {
    const down = sample.position.y - floorOriginY <= bandMeters;
    if (down) contact += 1;
    else air += 1;
    if (down && !previousDown) windows += 1;
    previousDown = down;
  }
  return { contact, air, windows };
}

describe("the terminal turn replants without drag", () => {
  it("both feet plant and swing through walk, turn, stop and whole run under unchanged SC-00 limits", async () => {
    const { grades, measurements } = await measureShippedApproach();
    const floorOriginY = measurements.settleTurn.floor?.originY;
    expect(floorOriginY, "the settle interval must keep the named floor frame").toEqual(expect.any(Number));
    const band = FOOT_CONTACT_HEIGHT_METERS;

    expect(grades.walkFootSlide.outcome).toBe("satisfied");
    expect(grades.settleTurnFootSlide.outcome).toBe("satisfied");
    expect(footSlideFinding(measurements.stop).outcome).toBe("satisfied");
    expect(grades.wholeRun.failedMetrics).not.toContain("foot-slide");

    expect(grades.walkFrames).toBeGreaterThan(0);
    expect(grades.settleFrames).toBeGreaterThan(0);

    for (const [label, measurement] of [
      ["walk", measurements.walk],
      ["turn", measurements.settleTurn],
      ["stop", measurements.stop],
    ] as const) {
      expect(measurement.contactTracks.map((track) => track.joint).sort()).toEqual(["toe1-1.L", "toe1-1.R"]);
      for (const track of measurement.contactTracks) {
        const coverage = stanceCoverage(track.samples, floorOriginY as number, band);
        expect(coverage.contact, `${label} ${track.joint} plant frames`).toBeGreaterThanOrEqual(3);
        if (label === "turn") {
          expect(coverage.air, `${track.joint} must actually swing, not stay planted through the yaw`).toBeGreaterThanOrEqual(3);
          expect(coverage.windows, `${track.joint} must replant, not skip the turn interval`).toBeGreaterThanOrEqual(1);
        }
      }
    }

    expect(grades.arrivalErrorMeters).toBeLessThanOrEqual(ARRIVAL_ERROR_MAX_METERS);
    expect(grades.settledYawErrorDegrees).toBeLessThanOrEqual(SETTLED_YAW_ERROR_MAX_DEGREES);
    expect(grades.stoppedSeconds).toBeGreaterThanOrEqual(STOPPED_OBSERVATION_MIN_SECONDS);
    expect(grades.stoppedRootTravelMeters).toBeLessThanOrEqual(ROOT_DRIFT_MAX_METERS);
  }, 300_000);
});
