import { describe, expect, it } from "vitest";
import { evaluateWalkSymmetry, GATE_BARS } from "../index.js";

type SampleInput = Parameters<typeof evaluateWalkSymmetry>[0];
type JointsInput = Parameters<typeof evaluateWalkSymmetry>[1];

/**
 * The symmetry gate decides on synthetic clips before it ever sees a GLB.
 *
 * A mirrored-symmetric sine walk passes every bar; a 20 % stride-asymmetric variant fails
 * the stride bar; a 5-degree last-frame rotation jump fails the seam bar. Each case pins
 * exactly one bar so a wrong bar cannot hide behind a right verdict.
 */

const JOINTS: JointsInput = {
  hips: ["pelvis"],
  thighL: "thighL",
  kneeL: "kneeL",
  ankleL: "ankleL",
  toeL: "toeL",
  thighR: "thighR",
  kneeR: "kneeR",
  ankleR: "ankleR",
  toeR: "toeR",
  shoulderL: "shoulderL",
  elbowL: "elbowL",
  shoulderR: "shoulderR",
  elbowR: "elbowR",
  root: "root",
  scale: 1,
};

const FRAMES = 41;
const SPAN = 1.6;
const ID_QUAT: [number, number, number, number] = [0, 0, 0, 1];

function buildSample(opts: { strideScaleR?: number; seamJumpDeg?: number } = {}): SampleInput {
  const times = Array.from({ length: FRAMES }, (_, j) => (j * SPAN) / (FRAMES - 1));
  const pos: SampleInput["pos"] = {};
  const quat: SampleInput["quat"] = {};
  const names = [
    "pelvis", "root",
    "thighL", "kneeL", "ankleL", "toeL",
    "thighR", "kneeR", "ankleR", "toeR",
    "shoulderL", "elbowL", "shoulderR", "elbowR",
  ];
  for (const name of names) {
    pos[name] = [];
    quat[name] = [];
  }
  for (const t of times) {
    const p = (2 * Math.PI * t) / SPAN;
    for (const side of ["L", "R"] as const) {
      const phase = side === "L" ? p : p + Math.PI;
      const swing = Math.max(0, Math.sin(phase));
      const fore = Math.cos(phase);
      const strideK = side === "R" ? (opts.strideScaleR ?? 1) : 1;
      const toeZ = 0.3 * fore * strideK;
      const toeY = 0.15 * swing;
      const ankleY = 0.05 + 0.12 * swing;
      pos[`toe${side}`]!.push([0, toeY, toeZ]);
      pos[`ankle${side}`]!.push([0, ankleY, toeZ]);
      pos[`knee${side}`]!.push([0, 0.5, 0.5 * toeZ]);
      pos[`thigh${side}`]!.push([0, 0.9, 0]);
      const sx = side === "L" ? -0.2 : 0.2;
      pos[`shoulder${side}`]!.push([sx, 1.4, 0]);
      pos[`elbow${side}`]!.push([sx, 0.9, 0.3 * Math.sin(phase)]);
    }
    pos["pelvis"]!.push([0, 0.9, 0]);
    pos["root"]!.push([0, 0.9, 0]);
    for (const name of names) quat[name]!.push([...ID_QUAT]);
  }
  if (opts.seamJumpDeg) {
    const half = ((opts.seamJumpDeg / 2) * Math.PI) / 180;
    quat["kneeL"]![FRAMES - 1] = [Math.sin(half), 0, 0, Math.cos(half)];
  }
  return { times, pos, quat };
}

describe("walk symmetry gate on synthetic clips", () => {
  it("a mirrored-symmetric clip passes every bar", () => {
    const report = evaluateWalkSymmetry(buildSample(), JOINTS);
    expect(report.pass).toBe(true);
    expect(report.bars.filter((b) => !b.pass)).toEqual([]);
  });

  it("a 20 % stride-asymmetric clip fails the stride bar", () => {
    const report = evaluateWalkSymmetry(buildSample({ strideScaleR: 1.2 }), JOINTS);
    expect(report.pass).toBe(false);
    const stride = report.bars.find((b) => b.id === "stride-asymmetry")!;
    expect(stride.pass).toBe(false);
    expect(report.strideAsymmetryPct).toBeGreaterThan(5);
  });

  it("a 5 deg last-frame jump fails the seam bar", () => {
    const report = evaluateWalkSymmetry(buildSample({ seamJumpDeg: 5 }), JOINTS);
    expect(report.pass).toBe(false);
    const seam = report.bars.find((b) => b.id === "seam-error")!;
    expect(seam.pass).toBe(false);
    expect(report.seamErrorDeg).toBeGreaterThan(1);
  });

  it("every bar carries a threshold and a provenance", () => {
    expect(Object.keys(GATE_BARS)).toHaveLength(9);
    for (const bar of Object.values(GATE_BARS)) {
      expect(bar.threshold.length).toBeGreaterThan(0);
      expect(bar.provenance.length).toBeGreaterThan(0);
    }
  });
});
