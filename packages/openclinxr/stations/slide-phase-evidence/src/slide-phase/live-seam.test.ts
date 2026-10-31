import { describe, expect, it } from "vitest";
import {
  CAPTURE_FPS,
  computeRunSeam,
  detectPlants,
  type LiveSeamFrame,
  type LiveSeamRunFile,
} from "../../../../../../tools/openclinxr/evidence/slide-phase/live-seam.js";

const toe = (x: number, y: number, z: number) => ({ x, y, z });
const slot = (x: number, z: number, yaw = 0) => ({ x, y: 0, z, yaw });

/**
 * Synthetic capture: straight walk along +X (start 0,0 -> target 2,0), then
 * a 60 deg slot turn with two lift-and-place steps. Toes are frozen
 * (step 0) inside plants so the 0.02 m/s speed gate passes, and lifted
 * (y = 0.10, 0.05 m jumps) between plants so runs split.
 *
 * Frames (30 Hz):
 *  0-5  walking, left planted at (0.10,0); right swinging (lifted).
 *  6-11 walking, right planted at (0.50,0); left swinging.
 *  12-17 stopping: both planted (left 0.90, right 1.10), slot yaw 0.
 *  18-23 turn: slot yaw ramps 0 -> 60 deg; left lifts to (0.95, +0.08),
 *         right lifts to (1.15, -0.06); head yaw leads slot by 3 frames.
 *  24-29 arrived: both planted at new spots, slot yaw 60 deg.
 */
function syntheticRun(): LiveSeamRunFile {
  const frames: LiveSeamFrame[] = [];
  const startWorld = { x: 0, y: 0, z: 0 };
  const targetWorld = { x: 2, y: 0, z: 0 };
  const targetHeading = 0;
  const push = (f: LiveSeamFrame): void => {
    frames.push({ startWorld, targetWorld, targetHeading, ...f });
  };
  for (let i = 0; i < 6; i += 1) {
    push({
      phase: "walking",
      slot: slot(i * 0.05, 0, 0),
      leftToe: toe(0.1, 0.0, 0),
      rightToe: toe(0.5 + i * 0.05, 0.1, 0),
      headYaw: 0,
    });
  }
  for (let i = 6; i < 12; i += 1) {
    push({
      phase: "walking",
      slot: slot(i * 0.05, 0, 0),
      leftToe: toe(0.1 + (i - 6) * 0.05, 0.1, 0),
      rightToe: toe(0.5, 0.0, 0),
      headYaw: 0,
    });
  }
  for (let i = 12; i < 20; i += 1) {
    push({
      phase: "settling",
      slot: slot(0.6, 0, 0),
      leftToe: toe(0.9, 0.0, 0),
      rightToe: toe(1.1, 0.0, 0),
      // Head anticipates the turn 2 frames before the slot moves.
      headYaw: i >= 18 ? ((i - 17) * 5 * Math.PI) / 180 : 0,
    });
  }
  for (let k = 0; k < 6; k += 1) {
    const yaw = ((k + 1) * Math.PI) / 18; // 10..60 deg
    const head = ((k + 1 + 3) * Math.PI) / 36; // head ~2x lead, capped
    push({
      phase: "settling",
      slot: slot(0.6, 0, yaw),
      leftToe: k < 3 ? toe(0.9 + k * 0.05, 0.1, 0) : toe(0.95, 0.0, 0.08),
      rightToe: k < 3 ? toe(1.15, 0.0, -0.06) : toe(1.15 + (k - 3) * 0.05, 0.1, 0),
      headYaw: Math.min(head, Math.PI / 3),
    });
  }
  for (let i = 26; i < 32; i += 1) {
    push({
      phase: "arrived",
      slot: slot(0.6, 0, Math.PI / 3),
      leftToe: toe(0.95, 0.0, 0.08),
      rightToe: toe(1.15, 0.0, -0.06),
      headYaw: Math.PI / 3,
    });
  }
  return { vehicle: "synthetic", runIndex: 0, frames };
}

describe("live-seam plant detection", () => {
  it("finds toe-own plants and ignores the lifted swing", () => {
    const run = syntheticRun();
    const left = detectPlants(run.frames, "left", 0, null);
    const right = detectPlants(run.frames, "right", 0, null);
    // Left: frames 0-5 plant + 20-29 plant (21-23 + 24-29 merge: same spot,
    // Y-gated, zero steps). Right: 6-11 + 14-16 (14-16 frozen mid-turn).
    expect(left.length).toBeGreaterThanOrEqual(2);
    expect(left[0]!.startFrame).toBe(0);
    expect(left[0]!.endFrame).toBe(5);
    expect(right[0]!.startFrame).toBe(6);
    expect(right[0]!.endFrame).toBe(11);
    for (const p of [...left, ...right]) {
      expect(p.nFrames).toBeGreaterThanOrEqual(3);
      expect(p.endFrame - p.startFrame + 1).toBe(p.nFrames);
    }
  });
});

describe("live-seam seam + timing on the synthetic capture", () => {
  it("measures the walk->turn seam and the stop/turn clock from live toes only", () => {
    const m = computeRunSeam("synthetic-run0", syntheticRun());

    // Walk frame along +X: last walking plants at x=0.10 (left, frames 0-5)
    // and x=0.50 (right, frames 6-11); laterals ~0 (on the route line).
    expect(m.left.lastWalkPlant!.startFrame).toBe(0);
    expect(m.right.lastWalkPlant!.startFrame).toBe(6);
    expect(m.left.lastWalkPlant!.lateralM).toBeCloseTo(0, 9);
    expect(m.right.lastWalkPlant!.lateralM).toBeCloseTo(0, 9);

    // First post-walk plants differ by > 0.01 m; seam distances are live
    // toe distances, not a planner formula.
    expect(m.left.firstTurnPlant).not.toBeNull();
    expect(m.right.firstTurnPlant).not.toBeNull();
    expect(m.left.seamDistM).toBeCloseTo(
      Math.hypot(
        m.left.firstTurnPlant!.x - m.left.lastWalkPlant!.x,
        m.left.firstTurnPlant!.z - m.left.lastWalkPlant!.z,
      ),
      9,
    );
    // Lateral seam: the first post-walk plant is the stop stance itself
    // (frames 12-17, still on the route line z = 0), so both seams are pure
    // along-route steps; the off-line turn plants come later.
    // Walk frame: fwd=(1,0), right=(0,-1), so lateral = -z.
    expect(m.left.firstTurnPlant!.startFrame).toBe(12);
    expect(m.right.firstTurnPlant!.startFrame).toBe(12);
    expect(m.left.seamLateralM).toBeCloseTo(0, 6);
    expect(m.left.seamAlongM).toBeCloseTo(0.8, 6);
    expect(m.right.seamLateralM).toBeCloseTo(0, 6);
    expect(m.right.seamAlongM).toBeCloseTo(0.6, 6);

    // Timing at 30 Hz: walk ends frame 11; the 8-frame stop hold yields a
    // 6-frame both-planted window starting frame 13 (frame 12 is excluded by
    // the walk->stop landing step); slot leaves stop yaw at frame 20, head
    // 2 frames earlier, slot reaches 60 deg at frame 25.
    expect(m.timing.fps).toBe(CAPTURE_FPS);
    expect(m.timing.walkEndFrame).toBe(11);
    expect(m.timing.stopFrame).toBe(13);
    expect(m.timing.turnStartFrame).toBe(20);
    expect(m.timing.headTurnStartFrame).toBe(18);
    expect(m.timing.turnEndFrame).toBe(25);
    expect(m.timing.pauseS).toBeCloseTo((20 - 13) / CAPTURE_FPS, 9);
    expect(m.timing.turnS).toBeCloseTo((25 - 20) / CAPTURE_FPS, 9);
    expect(m.timing.headLeadS).toBeCloseTo(
      (m.timing.turnStartFrame! - m.timing.headTurnStartFrame!) / CAPTURE_FPS,
      9,
    );
    expect(m.timing.headLeadS).toBeGreaterThan(0);
    expect(m.timing.turnPlants).toBeGreaterThanOrEqual(1);

    // Heading from slot yaw: final slot 60 deg vs target 0 -> -60 deg.
    expect(m.headingMethod).toBe("slot-yaw");
    expect(m.headingErrDeg).toBeCloseTo(-60, 6);
  });
});
