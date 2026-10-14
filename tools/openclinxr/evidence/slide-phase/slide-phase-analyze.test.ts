import { describe, expect, it } from "vitest";
import {
  computeSlidePhase,
  type SlidePhaseFrame,
  type SlidePhaseRunFile,
} from "./slide-phase-analyze.js";

const toe = (x: number, y: number, z: number) => ({ x, y, z });
const slot = (x: number, z: number, yaw = 0) => ({ x, y: 0, z, yaw });

/**
 * Validation (a): synthetic record with a planted 0.05 m slide in ONE walking
 * stance window and zero motion everywhere else. The tool must report 0.05 in
 * that phase and 0 in the others.
 *
 * Construction: 12 walking frames (1/30 s steps). Frames 0-5 stance=left, left
 * toe planted (y = 0.02) stepping +0.01 m x per frame = 0.05 m span from base;
 * right toe airborne (y = 0.20) frozen. Frames 6-11 stance=right, right toe
 * planted frozen; left toe airborne frozen. Slot advances +0.05 m x per frame
 * (root path 11 * 0.05 = 0.55 m). Settling frames 12-17: two stance windows,
 * all toes planted frozen. Arrived 18-20 frozen, yaw on target.
 */
function syntheticRun(): SlidePhaseRunFile {
  const frames: SlidePhaseFrame[] = [];
  for (let i = 0; i < 6; i += 1) {
    frames.push({
      phase: "walking",
      slot: slot(i * 0.05, 0),
      leftToe: toe(i * 0.01, 0.02, 0),
      rightToe: toe(0.5, 0.2, 0),
      stanceFoot: "left",
      targetHeading: 0,
    });
  }
  for (let i = 6; i < 12; i += 1) {
    frames.push({
      phase: "walking",
      slot: slot(i * 0.05, 0),
      leftToe: toe(0.05, 0.2, 0),
      rightToe: toe(0.5, 0.02, 0),
      stanceFoot: "right",
      targetHeading: 0,
    });
  }
  for (let i = 12; i < 15; i += 1) {
    frames.push({
      phase: "settling",
      slot: slot(0.55, 0),
      leftToe: toe(0.05, 0.02, 0),
      rightToe: toe(0.5, 0.02, 0),
      stanceFoot: "left",
      targetHeading: 0,
    });
  }
  for (let i = 15; i < 18; i += 1) {
    frames.push({
      phase: "settling",
      slot: slot(0.55, 0),
      leftToe: toe(0.05, 0.02, 0),
      rightToe: toe(0.5, 0.02, 0),
      stanceFoot: "right",
      targetHeading: 0,
    });
  }
  for (let i = 18; i < 21; i += 1) {
    frames.push({
      phase: "arrived",
      slot: slot(0.55, 0),
      leftToe: toe(0, 0.01, 0),
      rightToe: toe(0.2, 0.01, 0.1),
      stanceFoot: "right",
      targetHeading: 0,
      stoppedSeconds: (i - 18) / 30,
    });
  }
  return { vehicle: "synthetic", runIndex: 0, frames };
}

describe("slide-phase validation (a): planted 0.05 m slide", () => {
  it("reports 0.05 in the planted walking window and 0 in the other phases", () => {
    const run = syntheticRun();
    // Print before/after so the plant is shown to have applied.
    const lx = run.frames.map((f) => f.leftToe?.x);
    process.stdout.write(`[plant] leftToe.x frames 0-6: ${lx.slice(0, 7).join(",")}\n`);
    process.stdout.write(
      `[plant] planted span frames 0-5: ${(lx[5]! - lx[0]!).toFixed(4)} m (expect 0.0500)\n`,
    );
    expect(lx[5]! - lx[0]!).toBeCloseTo(0.05, 9);

    const m = computeSlidePhase("synthetic-run0", run);

    // The planted window reads 0.05; the frozen window reads 0.
    expect(m.walking.windows).toHaveLength(2);
    expect(m.walking.windows[0]!.foot).toBe("left");
    expect(m.walking.windows[0]!.travelM).toBeCloseTo(0.05, 9);
    expect(m.walking.windows[1]!.travelM).toBeCloseTo(0, 9);
    expect(m.walking.sumM).toBeCloseTo(0.05, 9);
    expect(m.walking.rootPathM).toBeCloseTo(0.55, 9);
    expect(m.walking.slidePerMetre).toBeCloseTo(0.05 / 0.55, 9);

    // Deep gate (S1 M3): the plant rides at y = 0.02, inside the deep gate,
    // so the deep variant agrees with the band variant on this record.
    expect(m.walking.deepWindows).toHaveLength(2);
    expect(m.walking.deepSumM).toBeCloseTo(0.05, 9);
    expect(m.walking.deepSlidePerMetre).toBeCloseTo(0.05 / 0.55, 9);

    // Zero elsewhere: settle pair travel and both turn windows are frozen.
    expect(m.settle.leftTravelM).toBeCloseTo(0, 9);
    expect(m.settle.rightTravelM).toBeCloseTo(0, 9);
    expect(m.turn.windows).toHaveLength(2);
    expect(m.turn.maxM).toBeCloseTo(0, 9);

    // Start transient on the synthetic: left lifts at frame 6 after 0.05 m of
    // path; right is airborne from walk start so its travel is 0.
    expect(m.startTransient.liftFrame.left).toBe(6);
    expect(m.startTransient.leftTravelM).toBeCloseTo(0.05, 9);
    expect(m.startTransient.liftFrame.right).toBe(0);
    expect(m.startTransient.rightTravelM).toBeCloseTo(0, 9);

    // End stance reads E = last settling frame 17 (yaw 0: right=(1,0),
    // fwd=(0,1); toes there are L=(0.05,0), R=(0.5,0)), not the arrived pose.
    expect(m.endStance.frame).toBe(17);
    expect(m.endStance.lateralM).toBeCloseTo(0.45, 9);
    expect(m.endStance.foreAftM).toBeCloseTo(0, 9);
    expect(m.endStance.yawErrorRad).toBeCloseTo(0, 9);
    expect(m.endStance.bothInBand).toBe(true);
    expect(m.missing).toEqual([]);
  });
});

describe("slide-phase handback T1: arrived-phase stance", () => {
  it("reads the last recorded frame and the arrived excursion, not the settling end", () => {
    const run = syntheticRun();
    // Feet move after settling: frame 20 drifts right and below the floor.
    run.frames[20]!.leftToe = toe(0, 0.01, 0);
    run.frames[20]!.rightToe = toe(0.25, -0.01, 0.1);
    const m = computeSlidePhase("synthetic-arrived-drift-run0", run);

    // Settling end unchanged: frame 17, the frozen pair.
    expect(m.endStance.frame).toBe(17);
    expect(m.endStance.lateralM).toBeCloseTo(0.45, 9);
    expect(m.endStance.foreAftM).toBeCloseTo(0, 9);

    // Arrived stance reads the LAST frame (yaw 0: lat = dx, fore = dz).
    expect(m.arrivedStance.frame).toBe(20);
    expect(m.arrivedStance.lateralM).toBeCloseTo(0.25, 9);
    expect(m.arrivedStance.foreAftM).toBeCloseTo(0.1, 9);
    // Excursion over arrived frames 18-20: fore is 0.1 throughout, min toe -0.01.
    expect(m.arrivedStance.maxAbsForeM).toBeCloseTo(0.1, 9);
    expect(m.arrivedStance.minToeYM).toBeCloseTo(-0.01, 9);
    expect(m.missing).toEqual([]);
  });
});

describe("slide-phase deep gate (S1 M3): in-band roll above 0.02 m", () => {
  it("band variant reports the travel while the deep variant reads 0", () => {
    const run = syntheticRun();
    // Lift the planted window's travel into the 0.02-0.06 m shelf: inside the
    // contact band (still one band-gated window) but outside the deep gate.
    for (let i = 0; i < 6; i += 1) {
      run.frames[i]!.leftToe = toe(i * 0.01, 0.05, 0);
    }
    const m = computeSlidePhase("synthetic-shelf-run0", run);
    expect(m.walking.windows).toHaveLength(2);
    expect(m.walking.windows[0]!.travelM).toBeCloseTo(0.05, 9);
    expect(m.walking.sumM).toBeCloseTo(0.05, 9);
    expect(m.walking.deepWindows).toHaveLength(1);
    expect(m.walking.deepWindows[0]!.foot).toBe("right");
    expect(m.walking.deepSumM).toBeCloseTo(0, 9);
    expect(m.walking.deepSlidePerMetre).toBeCloseTo(0, 9);
    expect(m.walking.deepSingleFrameRuns).toBe(0);
  });

  it("counts an isolated sub-0.02 m frame as a singleton, not a window (S1 T1)", () => {
    const run = syntheticRun();
    for (let i = 0; i < 6; i += 1) {
      run.frames[i]!.leftToe = toe(i * 0.01, 0.05, 0);
    }
    // One frame dips below the deep gate amid the shelf: isolated, no window.
    run.frames[3]!.leftToe = toe(0.03, 0.019, 0);
    const m = computeSlidePhase("synthetic-single-run0", run);
    expect(m.walking.deepWindows).toHaveLength(1);
    expect(m.walking.deepSingleFrameRuns).toBe(1);
    expect(m.walking.deepSumM).toBeCloseTo(0, 9);
  });
});
