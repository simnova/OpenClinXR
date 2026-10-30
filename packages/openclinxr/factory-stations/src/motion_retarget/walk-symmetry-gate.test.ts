import { describe, expect, it } from "vitest";
import { evaluateWalkSymmetry, GATE_BARS } from "./walk_symmetry_gate.js";

type SampleInput = Parameters<typeof evaluateWalkSymmetry>[0];
type JointsInput = Parameters<typeof evaluateWalkSymmetry>[1];

/**
 * The symmetry gate decides on synthetic clips before it ever sees a GLB.
 *
 * Contact is cyclic and crossings are sub-frame interpolated, so rigidly rephasing the
 * loop (resampling the same motion at a phase offset) must read the same numbers: stride
 * compares identical endpoint pairs, duty and steps come from interpolated continuum
 * crossings. Each case pins exactly one property so a wrong bar cannot hide behind a
 * right verdict. (Rotating sample arrays against fixed timestamps is NOT a rephase — it
 * shears the timeline at the cut — so the sweep resamples the motion instead.)
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

/** The same motion sampled at phase offset delta (toe 0.2/swing puts duty near 0.6). */
function buildSample(delta: number, opts: { strideScaleR?: number } = {}): SampleInput {
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
    const p = ((2 * Math.PI * t) / SPAN + delta) % (2 * Math.PI);
    for (const side of ["L", "R"] as const) {
      const phase = side === "L" ? p : (p + Math.PI) % (2 * Math.PI);
      const swing = Math.max(0, Math.sin(phase));
      const fore = Math.cos(phase);
      const strideK = side === "R" ? (opts.strideScaleR ?? 1) : 1;
      const toeZ = 0.3 * fore * strideK;
      const toeY = 0.2 * swing;
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
  return { times, pos, quat };
}

describe("walk symmetry gate on synthetic clips", () => {
  it("a symmetric loop whose left contact spans the seam passes with stride asymmetry near 0", () => {
    const report = evaluateWalkSymmetry(buildSample(-0.2), JOINTS);
    expect(report.pass).toBe(true);
    expect(report.strideAsymmetryPct).toBeLessThan(0.5);
    expect(report.stepDurationAsymmetryPct).toBeLessThan(0.5);
    expect(report.bars.filter((b) => !b.pass)).toEqual([]);
  });

  it("eight phase offsets read identical numbers", () => {
    // Interpolated crossings carry ~1e-4 s noise; tolerances sit 10x below the 5 % bars
    // (the old wiring bug read 10 %+ stride and 10 % step gaps on the same sweep).
    const refs = evaluateWalkSymmetry(buildSample(0), JOINTS);
    for (const k of [1, 2, 3, 4, 5, 6, 7]) {
      const rep = evaluateWalkSymmetry(buildSample((k * Math.PI) / 4), JOINTS);
      expect(rep.strideAsymmetryPct).toBeCloseTo(refs.strideAsymmetryPct, 1);
      expect(rep.stepDurationAsymmetryPct).toBeCloseTo(refs.stepDurationAsymmetryPct, 1);
      expect(rep.foot.left.duty).toBeCloseTo(refs.foot.left.duty, 2);
      expect(rep.foot.right.duty).toBeCloseTo(refs.foot.right.duty, 2);
      expect(rep.thighRomDeg.asymmetryPct).toBeCloseTo(refs.thighRomDeg.asymmetryPct, 1);
      expect(rep.seamErrorDeg).toBeCloseTo(refs.seamErrorDeg, 1);
      expect(rep.pass).toBe(refs.pass);
    }
  });

  it("a 20 % stride-asymmetric loop fails the stride bar", () => {
    const report = evaluateWalkSymmetry(buildSample(0.3, { strideScaleR: 1.2 }), JOINTS);
    expect(report.pass).toBe(false);
    const stride = report.bars.find((b) => b.id === "stride-asymmetry")!;
    expect(stride.pass).toBe(false);
    expect(report.strideAsymmetryPct).toBeGreaterThan(5);
  });

  it("a loop repeating its first frame at the end drops it and passes the seam", () => {
    const base = buildSample(0.7);
    const dt = base.times[1]! - base.times[0]!;
    const pos: SampleInput["pos"] = {};
    const quat: SampleInput["quat"] = {};
    for (const name of Object.keys(base.pos)) pos[name] = [...base.pos[name]!, [...base.pos[name]![0]!]];
    for (const name of Object.keys(base.quat)) quat[name] = [...base.quat[name]!, [...base.quat[name]![0]!]];
    const report = evaluateWalkSymmetry({ times: [...base.times, base.times[base.times.length - 1]! + dt], pos, quat }, JOINTS);
    expect(report.seamDroppedEndFrame).toBe(true);
    expect(report.bars.find((b) => b.id === "seam-error")!.pass).toBe(true);
  });

  it("a 5 deg last-frame jump fails the seam bar", () => {
    const sample = buildSample(0);
    const last = sample.times.length - 1;
    const half = ((5 / 2) * Math.PI) / 180;
    sample.quat["kneeL"]![last] = [Math.sin(half), 0, 0, Math.cos(half)];
    const report = evaluateWalkSymmetry(sample, JOINTS);
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
