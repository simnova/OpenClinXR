import { describe, expect, it } from "vitest";
import { evaluateWalkSymmetry, MPFB_WALK_JOINTS, sampleWalkClip } from "../index.js";
import { evaluateMovementGate, MOVEMENT_GATE_BARS } from "./movement_gate.js";

type GateInput = Parameters<typeof evaluateMovementGate>[0];
type WalkJoints = Parameters<typeof evaluateWalkSymmetry>[1];

/**
 * The movement-agnostic gate on real shipped bytes plus one planted defect per bar.
 *
 * Source/bound pair: the nurse and physician GLBs ship the same walk clip bound to
 * near-identical MPFB rigs, so the generic gate must pass on the pair (rotation
 * ranges agree to < 1 % per joint, measured 2026-10-13) exactly where the walk
 * gate's own generic bar (root drift) already passes on the physician clip. Each
 * planted defect touches one bar only (plants use unit quats / positions outside
 * the other bars' inputs), is proven red, then the pristine pair is proven green.
 * Console lines print the before/after number per plant.
 */

const PHYSICIAN_GLB = "../../../apps/ui-xr/public/generated-humanoids/mpfb-clinical-physician-adult.glb";
const NURSE_GLB = "../../../apps/ui-xr/public/generated-humanoids/mpfb-clinical-nurse-adult.glb";
const CLIP = "openclinxr_retarget_walk_source";

const PAIRS: GateInput["pairs"] = [
  "upperleg01", "lowerleg01", "foot", "upperarm01", "lowerarm01",
].flatMap((stem) => (["L", "R"] as const).map((side) => ({
  source: `${stem}.${side}`,
  bound: `${stem}.${side}`,
})));

async function shippedPair(): Promise<{ input: GateInput; joints: WalkJoints }> {
  const joints = MPFB_WALK_JOINTS;
  const source = await sampleWalkClip({ glbPath: NURSE_GLB, clipName: CLIP, joints });
  const bound = await sampleWalkClip({ glbPath: PHYSICIAN_GLB, clipName: CLIP, joints });
  const input: GateInput = {
    source: source.sample,
    bound: bound.sample,
    pairs: PAIRS,
    sourceRoot: joints.root,
    boundRoot: joints.root,
    boundScale: joints.scale,
    looping: true,
    provenance: { sourceGlb: NURSE_GLB, sourceClip: CLIP, boundGlb: PHYSICIAN_GLB, boundClip: CLIP },
  };
  return { input, joints };
}

function cloneSample(sample: GateInput["source"]): GateInput["source"] {
  return {
    times: [...sample.times],
    pos: Object.fromEntries(Object.entries(sample.pos).map(([k, v]) => [k, v.map((p) => [...p] as [number, number, number])])),
    quat: Object.fromEntries(
      Object.entries(sample.quat).map(([k, v]) => [k, v.map((q) => [...q] as [number, number, number, number])]),
    ),
  };
}

/** Unit-quaternion multiply (plant rotations without touching norms). */
function quatMul(a: [number, number, number, number], b: [number, number, number, number]): [number, number, number, number] {
  return [
    a[3]! * b[0]! + a[0]! * b[3]! + a[1]! * b[2]! - a[2]! * b[1]!,
    a[3]! * b[1]! - a[0]! * b[2]! + a[1]! * b[3]! + a[2]! * b[0]!,
    a[3]! * b[2]! + a[0]! * b[1]! - a[1]! * b[0]! + a[2]! * b[3]!,
    a[3]! * b[3]! - a[0]! * b[0]! - a[1]! * b[1]! - a[2]! * b[2]!,
  ];
}

describe("movement gate on the shipped Walk pair", () => {
  it("passes on nurse-as-source to physician-as-bound where the walk root-drift bar passes", async () => {
    const { input, joints } = await shippedPair();
    const report = evaluateMovementGate(input);
    expect(report.bars.filter((b) => !b.pass)).toEqual([]);
    expect(report.pass).toBe(true);
    expect(report.worstRomDeviationPct).toBeLessThan(15);

    const bound = await sampleWalkClip({ glbPath: PHYSICIAN_GLB, clipName: CLIP, joints });
    const walk = evaluateWalkSymmetry(bound.sample, joints);
    expect(walk.bars.find((b) => b.id === "root-drift")!.pass).toBe(true);
  });

  it("every bar carries a threshold and a provenance", () => {
    expect(Object.keys(MOVEMENT_GATE_BARS)).toHaveLength(4);
    for (const bar of Object.values(MOVEMENT_GATE_BARS)) {
      expect(bar.threshold.length).toBeGreaterThan(0);
      expect(bar.provenance.length).toBeGreaterThan(0);
    }
  });

  it("a frozen knee fails rom-fidelity, then reverts to green", async () => {
    const { input } = await shippedPair();
    const green = evaluateMovementGate(input);
    const planted = { ...input, bound: cloneSample(input.bound) };
    // Freeze the knee at its first frame: rotation range 0, ratio 0. Unit quats
    // throughout, so seam and norm bars cannot see the plant.
    const track = planted.bound.quat["lowerleg01.L"]!;
    planted.bound.quat["lowerleg01.L"] = track.map(() => [...track[0]!] as [number, number, number, number]);
    const red = evaluateMovementGate(planted);
    const knee = (r: typeof red) => r.romRatios.find((p) => p.bound === "lowerleg01.L")!.ratio;
    console.log(`rom plant lowerleg01.L ratio before=${knee(green).toFixed(3)} after=${knee(red).toFixed(3)}`);
    expect(knee(red)).toBeLessThan(1e-6);
    expect(red.bars.find((b) => b.id === "rom-fidelity")!.pass).toBe(false);
    expect(red.pass).toBe(false);
    expect(red.bars.filter((b) => b.id !== "rom-fidelity" && !b.pass)).toEqual([]);
    expect(evaluateMovementGate(input).pass).toBe(true);
  });

  it("a 5 deg last-frame jump fails loop-seam, then reverts to green", async () => {
    const { input } = await shippedPair();
    const green = evaluateMovementGate(input);
    const planted = { ...input, bound: cloneSample(input.bound) };
    const track = planted.bound.quat["lowerleg01.L"]!;
    const half = ((5 / 2) * Math.PI) / 180;
    const rot: [number, number, number, number] = [Math.sin(half), 0, 0, Math.cos(half)];
    track[track.length - 1] = quatMul(rot, track[track.length - 1]!);
    const red = evaluateMovementGate(planted);
    console.log(`seam plant bound seam before=${green.boundSeamDeg.toFixed(2)}deg after=${red.boundSeamDeg.toFixed(2)}deg`);
    expect(red.boundSeamDeg).toBeGreaterThan(green.sourceSeamDeg + 1);
    expect(red.bars.find((b) => b.id === "loop-seam")!.pass).toBe(false);
    expect(red.pass).toBe(false);
    expect(red.bars.filter((b) => b.id !== "loop-seam" && !b.pass)).toEqual([]);
    expect(evaluateMovementGate(input).pass).toBe(true);
  });

  it("a 5 cm root offset fails root-drift, then reverts to green", async () => {
    const { input } = await shippedPair();
    const green = evaluateMovementGate(input);
    const planted = { ...input, bound: cloneSample(input.bound) };
    const track = planted.bound.pos[input.boundRoot]!;
    const last = track[track.length - 1]!;
    track[track.length - 1] = [last[0], last[1], last[2]! + 0.05];
    const red = evaluateMovementGate(planted);
    console.log(`drift plant bound drift before=${green.boundRootDriftM.toFixed(4)}m after=${red.boundRootDriftM.toFixed(4)}m`);
    expect(red.boundRootDriftM).toBeGreaterThan(0.01);
    expect(red.bars.find((b) => b.id === "root-drift")!.pass).toBe(false);
    expect(red.pass).toBe(false);
    // A drifted loop no longer closes, so the duplicated-end-frame drop stops
    // applying and the seam bar co-fires by construction; rom and norm stay green.
    expect(red.bars.filter((b) => (b.id === "rom-fidelity" || b.id === "quaternion-norm") && !b.pass)).toEqual([]);
    expect(evaluateMovementGate(input).pass).toBe(true);
  });

  it("a 0.9-norm joint track fails quaternion-norm, then reverts to green", async () => {
    const { input } = await shippedPair();
    const green = evaluateMovementGate(input);
    const planted = { ...input, bound: cloneSample(input.bound) };
    planted.bound.quat["foot.L"] = planted.bound.quat["foot.L"]!.map(
      (q) => [q[0] * 0.9, q[1] * 0.9, q[2] * 0.9, q[3] * 0.9] as [number, number, number, number],
    );
    const red = evaluateMovementGate(planted);
    console.log(`norm plant worst deviation before=${green.worstNormDeviation.toExponential(1)} after=${red.worstNormDeviation.toExponential(1)}`);
    expect(red.worstNormDeviation).toBeGreaterThan(1e-3);
    expect(red.bars.find((b) => b.id === "quaternion-norm")!.pass).toBe(false);
    expect(red.pass).toBe(false);
    expect(red.bars.filter((b) => b.id !== "quaternion-norm" && !b.pass)).toEqual([]);
    expect(evaluateMovementGate(input).pass).toBe(true);
  });
});
