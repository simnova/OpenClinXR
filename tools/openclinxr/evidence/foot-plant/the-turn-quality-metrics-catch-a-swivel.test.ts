import { describe, expect, it } from "vitest";
import {
  computeTurnQuality,
  FLOOR_PENETRATION_MIN_METERS,
  PLANTED_SLIDE_MAX_METERS,
  RESIDUAL_TURN_MAX_DEG,
  STEP_LIFT_MIN_METERS,
  type TurnQualityInput,
} from "./turn-quality-metrics.js";

/**
 * The turn-quality metrics pass a natural stepping turn and fail a swivel — the defect this card
 * exists to fix: both shoes rotating on the floor while the body spins, with no visible steps.
 *
 * claimScope: the six metric definitions over synthetic frames fixtures.
 * notEvidenceFor: browser captures, gait realism, clinical plausibility.
 */

const TARGET_HEADING_RADIANS = Math.PI / 2; // 90 deg, matching the measured pre-fix defect.

/** A settling phase where both toes stay near the floor and slide as the body rotates: no lift. */
function swivelTurn(): TurnQualityInput {
  const frames: TurnQualityInput["frames"] = [];
  // Last walking frame: slot already close to the travel heading, well short of target (the
  // pre-fix defect: an instant ~90 deg turn-in-place, all of it left for settling).
  frames.push({
    sample: 0,
    tMs: 0,
    phase: "walking",
    left: { x: -0.05, y: 0.0, z: 0.0 },
    right: { x: 0.05, y: 0.0, z: 0.0 },
    stanceFoot: "left",
    slotYawRadians: 0,
    headYawWorldRadians: 0,
  });
  // 40 settling frames over 1.29 s (matching the measured pre-fix settle time), rotating both
  // toes about the slot without ever lifting either one off the floor — the measured 0.028 m /
  // 0.009 m lift against a slide of 0.33 m / 0.49 m. The "stance" label holds for a whole quarter
  // of the sweep (as the real settling-step-turn state does between swaps) while the toe it
  // names keeps sliding through the radius: a labelled stance that does not stay put.
  const settleFrames = 40;
  for (let i = 1; i <= settleFrames; i += 1) {
    const u = i / settleFrames;
    const yaw = u * TARGET_HEADING_RADIANS;
    const radius = 0.1;
    frames.push({
      sample: i,
      tMs: (i / settleFrames) * 1290,
      phase: "settling",
      left: {
        x: radius * Math.cos(Math.PI + yaw),
        y: 0.001, // never lifts
        z: radius * Math.sin(Math.PI + yaw),
      },
      right: {
        x: radius * Math.cos(yaw),
        y: -0.001, // never lifts, briefly dips
        z: radius * Math.sin(yaw),
      },
      // Held for a whole quarter-sweep, not swapped every frame — the toe it names slides the
      // entire time it is "planted".
      stanceFoot: Math.floor((i - 1) / (settleFrames / 2)) % 2 === 0 ? "left" : "right",
      slotYawRadians: yaw,
      headYawWorldRadians: yaw,
    });
  }
  frames.push({
    sample: settleFrames + 1,
    tMs: 1290,
    phase: "arrived",
    left: { x: -0.1, y: 0.0, z: 0.0 },
    right: { x: 0.1, y: 0.0, z: 0.0 },
    stanceFoot: "left",
    slotYawRadians: TARGET_HEADING_RADIANS,
    headYawWorldRadians: TARGET_HEADING_RADIANS,
  });
  return { frames, walkDiagnostics: { targetHeadingRadians: TARGET_HEADING_RADIANS } };
}

/** A settling phase with real alternating steps: the swing foot visibly lifts and the plant holds. */
function steppingTurn(): TurnQualityInput {
  const frames: TurnQualityInput["frames"] = [];
  frames.push({
    sample: 0,
    tMs: -400,
    phase: "walking",
    left: { x: -0.05, y: 0.0, z: 0.0 },
    right: { x: 0.05, y: 0.0, z: 0.0 },
    stanceFoot: "left",
    // The anticipatory turn has already closed most of the gap by the time settling begins.
    slotYawRadians: TARGET_HEADING_RADIANS * 0.6,
    // The head led the body there well before this frame.
    headYawWorldRadians: TARGET_HEADING_RADIANS,
  });
  const plantLeftXz = { x: -0.05, z: 0.0 };
  const plantRightXz = { x: 0.05, z: 0.0 };
  const framesPerSwing = 10;
  const swingCount = 2;
  const stepFrames = framesPerSwing * swingCount;
  let yaw = TARGET_HEADING_RADIANS * 0.6;
  const yawStep = (TARGET_HEADING_RADIANS - yaw) / stepFrames;
  for (let i = 1; i <= stepFrames; i += 1) {
    yaw += yawStep;
    const swingIndex = Math.floor((i - 1) / framesPerSwing);
    const swingLeft = swingIndex % 2 === 0;
    // A full rise-then-fall triangle across each swing's own window: 0 at the episode's first and
    // last frame, peaking at 0.03 m at its midpoint.
    const withinEpisode = (i - 1) % framesPerSwing;
    const progress = withinEpisode / (framesPerSwing - 1);
    const lift = 0.03 * (progress <= 0.5 ? progress * 2 : (1 - progress) * 2);
    frames.push({
      sample: i,
      tMs: (i / stepFrames) * 1290,
      phase: "settling",
      left: swingLeft ? { x: plantLeftXz.x, y: lift, z: plantLeftXz.z } : { x: plantLeftXz.x, y: 0, z: plantLeftXz.z },
      right: !swingLeft
        ? { x: plantRightXz.x, y: lift, z: plantRightXz.z }
        : { x: plantRightXz.x, y: 0, z: plantRightXz.z },
      stanceFoot: swingLeft ? "right" : "left",
      slotYawRadians: yaw,
      headYawWorldRadians: TARGET_HEADING_RADIANS,
    });
  }
  frames.push({
    sample: stepFrames + 1,
    tMs: 1290,
    phase: "arrived",
    left: { x: -0.05, y: 0.0, z: 0.0 },
    right: { x: 0.05, y: 0.0, z: 0.0 },
    stanceFoot: "left",
    slotYawRadians: TARGET_HEADING_RADIANS,
    headYawWorldRadians: TARGET_HEADING_RADIANS,
  });
  return { frames, walkDiagnostics: { targetHeadingRadians: TARGET_HEADING_RADIANS } };
}

describe("turn quality metrics", () => {
  it("fails a swivel: no swing lift and a sliding plant, even though residual turn and head lead pass", () => {
    const quality = computeTurnQuality(swivelTurn());
    expect(quality.stepLiftPass).toBe(false);
    expect(quality.minStepLiftM).not.toBeNull();
    expect(quality.minStepLiftM!).toBeLessThan(STEP_LIFT_MIN_METERS);
    expect(quality.plantedSlidePass).toBe(false);
    expect(quality.plantedSlideM).not.toBeNull();
    expect(quality.plantedSlideM!).toBeGreaterThan(PLANTED_SLIDE_MAX_METERS);
    expect(quality.allPass).toBe(false);
  });

  it("passes a natural stepping turn on every metric", () => {
    const quality = computeTurnQuality(steppingTurn());
    expect(quality.residualTurnDeg).not.toBeNull();
    expect(quality.residualTurnDeg!).toBeLessThanOrEqual(RESIDUAL_TURN_MAX_DEG);
    expect(quality.floorPenetrationM).not.toBeNull();
    expect(quality.floorPenetrationM!).toBeGreaterThanOrEqual(FLOOR_PENETRATION_MIN_METERS);
    expect(quality.stepLiftPass).toBe(true);
    expect(quality.plantedSlidePass).toBe(true);
    expect(quality.headLeadSeconds).not.toBeNull();
    expect(quality.headLeadSeconds!).toBeGreaterThan(0);
    expect(quality.allPass).toBe(true);
  });

  it("reports a metric it cannot compute as not-recorded (null) rather than a fabricated number", () => {
    const quality = computeTurnQuality({
      frames: [
        { sample: 0, tMs: 0, phase: "walking", left: null, right: null, stanceFoot: null },
      ],
      walkDiagnostics: { targetHeadingRadians: null },
    });
    expect(quality.residualTurnDeg).toBeNull();
    expect(quality.residualTurnPass).toBeNull();
    expect(quality.headLeadSeconds).toBeNull();
    expect(quality.headLeadPass).toBeNull();
  });
});
