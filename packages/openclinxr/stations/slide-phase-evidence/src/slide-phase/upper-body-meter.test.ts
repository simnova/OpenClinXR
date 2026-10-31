import { describe, expect, it } from "vitest";
import {
  analyzeRun,
  armLegLag,
  cycleFramesAuto,
  elbowFlexionDeg,
  hipAxisYawDeg,
  hipObliquityDeg,
  type MeterFrame,
  obliquityFromMatrix,
  shoulderAngleDeg,
  smooth,
  trunkLeanDeg,
  wrapDeg,
  yawFromMatrix,
} from "../../../../../../tools/openclinxr/evidence/slide-phase/upper-body-meter.js";

const D2R = Math.PI / 180;

/** Column-major world matrix carrying only a yaw about Y (deg). */
function yawMatrix(yawDeg: number): number[] {
  const p = yawDeg * D2R;
  const c = Math.cos(p);
  const s = Math.sin(p);
  return [c, 0, -s, 0, 0, 1, 0, 0, s, 0, c, 0, 0, 0, 0, 1];
}

describe("matrix angle extraction", () => {
  it("reads yaw and zero obliquity off a pure-yaw matrix", () => {
    expect(yawFromMatrix(yawMatrix(10))).toBeCloseTo(10, 9);
    expect(obliquityFromMatrix(yawMatrix(10))).toBeCloseTo(0, 9);
  });

  it("reads obliquity off a rolled lateral axis", () => {
    // Lateral (local X) axis tilted 6 deg out of the horizontal.
    const c = Math.cos(6 * D2R);
    const s = Math.sin(6 * D2R);
    const e = [c, s, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
    expect(obliquityFromMatrix(e)).toBeCloseTo(6, 9);
  });

  it("cross-checks obliquity against the hip height difference", () => {
    expect(
      hipObliquityDeg({ x: -0.09, y: 1.0, z: 0 }, { x: 0.09, y: 0.99, z: 0 }),
    ).toBeCloseTo(Math.atan2(0.01, 0.18) / D2R, 9);
  });
});

describe("limb angles", () => {
  const up = { x: 0, y: 1, z: 0 };
  const fwd = { x: 0, z: 1 };

  it("reads 0 shoulder angle hanging, +90 arm forward horizontal", () => {
    expect(shoulderAngleDeg({ x: 0, y: 1.4, z: 0 }, { x: 0, y: 1.1, z: 0 }, up, fwd)).toBeCloseTo(0, 9);
    expect(shoulderAngleDeg({ x: 0, y: 1.4, z: 0 }, { x: 0, y: 1.4, z: 0.3 }, up, fwd)).toBeCloseTo(90, 9);
  });

  it("reads 0 elbow flexion straight, 90 folded square", () => {
    expect(elbowFlexionDeg({ x: 0, y: 1, z: 0 }, { x: 0, y: 0.5, z: 0 }, { x: 0, y: 0, z: 0 })).toBeCloseTo(0, 9);
    expect(elbowFlexionDeg({ x: 0, y: 1, z: 0 }, { x: 0, y: 0.5, z: 0 }, { x: 0, y: 0.5, z: 0.5 })).toBeCloseTo(90, 9);
  });

  it("reads trunk lean toward travel as positive", () => {
    expect(trunkLeanDeg({ x: 0, y: 1, z: 0 }, { x: 0, y: 1.5, z: 0.035 }, fwd)).toBeCloseTo(
      Math.atan2(0.035, 0.5) / D2R,
      9,
    );
  });
});

describe("cycle and phase helpers", () => {
  it("wraps degrees, smooths NaN-tolerantly, and finds the sine period", () => {
    expect(wrapDeg(190)).toBeCloseTo(-170, 9);
    expect(wrapDeg(-190)).toBeCloseTo(170, 9);
    expect(smooth([1, NaN, 3], 1)).toEqual([1, 2, 3]);
    const sine = Array.from({ length: 40 }, (_, i) => Math.sin((2 * Math.PI * i) / 20));
    expect(cycleFramesAuto(sine)).toBe(20);
    expect(cycleFramesAuto(new Array<number>(40).fill(1))).toBeNull();
    expect(cycleFramesAuto([1, 2, 3])).toBeNull();
  });

  it("reads zero lag for simultaneous opposition, null when too short", () => {
    const th = Array.from({ length: 60 }, (_, i) => 12 * Math.sin((2 * Math.PI * i) / 20));
    const sh = th.map((v) => -v * 1.25);
    expect(armLegLag(sh, th, 20)).toBeCloseTo(0, 1);
    expect(armLegLag(sh.slice(0, 10), th.slice(0, 10), 20)).toBeNull();
  });

  it("reads hip-axis yaw off the inter-hip vector", () => {
    expect(hipAxisYawDeg({ x: -0.09, y: 1, z: 0 }, { x: 0.09, y: 1, z: 0 })).toBeCloseTo(90, 9);
    expect(hipAxisYawDeg({ x: 0, y: 1, z: -0.09 }, { x: 0, y: 1, z: 0.09 })).toBeCloseTo(0, 9);
  });
});

/**
 * Synthetic 40-frame walk, one stride per foot. Shoulder swing is built
 * exactly anti-phase with the ipsilateral thigh (offset 0.5); pelvis
 * vertical excursion is 0.04 m peak-to-peak, hip-axis yaw 10 deg, obliquity
 * 8 deg, shoulder range 30 deg, elbow held at 20 deg flexion, trunk lean 4 deg.
 */
function syntheticFrames(): MeterFrame[] {
  const frames: MeterFrame[] = [];
  for (let i = 0; i < 40; i += 1) {
    const w = (2 * Math.PI * i) / 20;
    const thL = 12 * Math.sin(w);
    const thR = 12 * Math.sin(w + Math.PI);
    const shL = 15 * Math.sin(w + Math.PI);
    const shR = 15 * Math.sin(w);
    const armDir = (deg: number): { y: number; z: number } => {
      const a = deg * D2R;
      return { y: -Math.cos(a), z: Math.sin(a) };
    };
    const aL = armDir(shL);
    const aR = armDir(shR);
    const tL = armDir(thL);
    const tR = armDir(thR);
    const shPosL = { x: -0.2, y: 1.4, z: i * 0.025 };
    const shPosR = { x: 0.2, y: 1.4, z: i * 0.025 };
    const elPosL = { x: -0.2, y: 1.4 + 0.3 * aL.y, z: i * 0.025 + 0.3 * aL.z };
    const elPosR = { x: 0.2, y: 1.4 + 0.3 * aR.y, z: i * 0.025 + 0.3 * aR.z };
    // Wrist: constant 20 deg elbow flexion (fold toward the front).
    const bend = 160 * D2R;
    const wDir = (a: { y: number; z: number }): { y: number; z: number } => ({
      y: a.y * Math.cos(bend) - a.z * Math.sin(bend),
      z: a.y * Math.sin(bend) + a.z * Math.cos(bend),
    });
    const wL = wDir(aL);
    const wR = wDir(aR);
    // Lateral sway at stride frequency (one L-R-L oscillation per cycle).
    const sway = 0.02 * Math.sin(w);
    const pelvisY = 0.9 + 0.02 * Math.sin(w);
    // Pelvis yaw oscillation (5 deg) about the pelvis centre, plus a 4 deg
    // obliquity oscillation via the L/R height difference (8 deg range).
    const yaw = 5 * Math.sin(w) * D2R;
    const cy = Math.cos(yaw);
    const sy = Math.sin(yaw);
    const cz = i * 0.025;
    const h = 0.0063 * Math.sin(w);
    const pelvisL = { x: -0.09 * cy + sway, y: pelvisY + h, z: cz + 0.09 * sy };
    const pelvisR = { x: 0.09 * cy + sway, y: pelvisY - h, z: cz - 0.09 * sy };
    // Hip joint centres carry the same yaw/obliquity (the meter reads hips,
    // never the co-located pelvis halves); knees hang off the new hip base
    // (thigh angle is translation-invariant, so the signal is unchanged).
    const hipL = { x: -0.09 * cy, y: 0.9 + h, z: cz + 0.09 * sy };
    const hipR = { x: 0.09 * cy, y: 0.9 - h, z: cz - 0.09 * sy };
    // Left stance 0-9 + 20-29 (lifts at 10, 30); right stance 5-14 + 25-34.
    const leftContact = (i <= 9 || (i >= 20 && i <= 29));
    const rightContact = ((i >= 5 && i <= 14) || (i >= 25 && i <= 34));
    frames.push({
      phase: "walking",
      slot: { x: 0, y: 0, z: i * 0.025, yaw: 0 },
      leftToe: { x: -0.1, y: leftContact ? 0.02 : 0.2, z: i * 0.025 },
      rightToe: { x: 0.1, y: rightContact ? 0.02 : 0.2, z: i * 0.025 },
      clipTime: null,
      travelHeading: 0,
      legWorlds: {
        hipL,
        kneeL: { x: hipL.x, y: hipL.y + 0.4 * tL.y, z: hipL.z + 0.4 * tL.z },
        hipR,
        kneeR: { x: hipR.x, y: hipR.y + 0.4 * tR.y, z: hipR.z + 0.4 * tR.z },
      },
      upperBody: {
        pelvisL,
        pelvisR,
        pelvisMatrix: yawMatrix(5 * Math.sin(w)),
        spineBase: { x: 0, y: 1.0, z: i * 0.025 },
        spineTop: { x: 0, y: 1.5, z: i * 0.025 + 0.035 },
        shoulderL: shPosL,
        shoulderR: shPosR,
        elbowL: elPosL,
        elbowR: elPosR,
        wristL: { x: -0.2, y: elPosL.y + 0.25 * wL.y, z: elPosL.z + 0.25 * wL.z },
        wristR: { x: 0.2, y: elPosR.y + 0.25 * wR.y, z: elPosR.z + 0.25 * wR.z },
        head: { x: 0, y: 1.6 + 0.01 * Math.sin(w), z: i * 0.025 },
      },
    });
  }
  return frames;
}

describe("analyzeRun on a synthetic walk", () => {
  it("recovers the built excursions, zero phase lag, lean and speed", () => {
    const m = analyzeRun("synthetic", { actor: "physician", frames: syntheticFrames() });
    expect(m.nWalking).toBe(40);
    expect(m.cycleFrames).toBeCloseTo(20, 0);
    expect(m.nStridesL).toBe(1);
    expect(m.nStridesR).toBe(2);
    expect(m.nPartialTiles).toBe(3);
    expect(m.missingUpperBody).toBe(0);
    expect(m.aggregate["pelvisVerticalM"]).toBeCloseTo(0.04, 2);
    expect(m.aggregate["pelvisLateralM"]).toBeCloseTo(0.04, 2);
    expect(m.aggregate["pelvisYawDeg"]).toBeCloseTo(10, 0);
    expect(m.aggregate["pelvisObliquityDeg"]).toBeCloseTo(8, 0);
    expect(m.aggregate["shoulderLdeg"]).toBeCloseTo(30, 0);
    expect(m.aggregate["shoulderRdeg"]).toBeCloseTo(30, 0);
    expect(m.aggregate["elbowLdeg"]).toBeLessThan(2);
    expect(m.aggregate["elbowRdeg"]).toBeLessThan(2);
    expect(m.aggregate["phaseLagL"]).toBeCloseTo(0, 1);
    expect(m.aggregate["phaseLagR"]).toBeCloseTo(0, 1);
    expect(m.shoulderThighRL).toBeLessThan(-0.95);
    expect(m.shoulderThighRR).toBeLessThan(-0.95);
    expect(m.trunkLeanMeanDeg).toBeCloseTo(4.0, 1);
    expect(m.headVerticalM).toBeCloseTo(0.02, 2);
    // Slot path 39 * 0.025 m over 40/30 s.
    expect(m.walkingSpeedMps).toBeCloseTo((39 * 0.025) / (40 / 30), 2);
  });

  it("falls back to whole-walk tiles when the cycle is unknown", () => {
    const frames = syntheticFrames().slice(0, 12);
    const m = analyzeRun("short", { frames });
    expect(m.cycleFrames).toBeNull();
    expect(m.nStridesL).toBe(1);
    expect(m.nStridesR).toBe(1);
    expect(m.aggregate["pelvisVerticalM"]).not.toBeNull();
    expect(m.aggregate["phaseLagL"]).toBeNull();
    expect(m.trunkLeanMeanDeg).not.toBeNull();
  });
});
