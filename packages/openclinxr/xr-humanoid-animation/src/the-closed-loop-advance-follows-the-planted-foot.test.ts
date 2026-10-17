import * as THREE from "three";
import { describe, expect, it, afterEach, beforeEach } from "vitest";
import { applyCaseOwnedStanceLock } from "./case-owned-approach-runtime.js";

/**
 * Footstep-plan S1 (opt-in port of walk-closed-loop stage 2): the slot advances
 * by what the planted foot does.
 *
 * Driven only through `applyCaseOwnedStanceLock` — the one public function on
 * the walking path — with a synthetic two-foot track: the test moves the toes
 * (the clip's job) and prescribes the executor advance (the executor's job),
 * then reads the slot back. The closed loop is default-OFF on main, so every
 * test sets `?closedLoopWalk=1&footstepPlan=0&footBase=0` (the last one adds `?plannedWalkSpeed=1` to pin
 * the opt-out). The track is unambiguous by construction (centimetre steps
 * against a 6 cm band and a strict-backward rule), so each assertion pins one
 * clause: single support advances by the planted displacement, double support
 * hands over when the other foot's backward displacement exceeds the
 * incumbent's, and flight carries the last advance.
 */
// biome-ignore lint/suspicious/noExplicitAny: fixture shape, not the tested predicate
type Loose = any;

const DT = 1 / 60;
const EXECUTOR_MPS = 1.3735;
const PRESCRIBED = EXECUTOR_MPS * DT;

function buildTrack(): {
  approach: Loose;
  actorSlot: THREE.Group;
  leftToe: THREE.Object3D;
  rightToe: THREE.Object3D;
} {
  const actorSlot = new THREE.Group();
  const leftToe = new THREE.Object3D();
  leftToe.name = "toe1-1L";
  leftToe.position.set(0.09, 0.01, 0);
  actorSlot.add(leftToe);
  const rightToe = new THREE.Object3D();
  rightToe.name = "toe1-1R";
  rightToe.position.set(-0.09, 0.01, 0);
  actorSlot.add(rightToe);
  actorSlot.updateMatrixWorld(true);
  const approach: Loose = {
    execution: { phase: "walking", drive: { locomotion: 1 }, travelledMeters: 0 },
    actorSlot,
    leftToe,
    rightToe,
    floorOriginY: 0,
    contactBandMeters: 0.06,
    walkSpeedMetersPerSecond: EXECUTOR_MPS,
    lock: {
      stanceFoot: null,
      anchorWorldXz: null,
      windowFrames: 0,
      correctionMeters: { x: 0, z: 0 },
      toeHeightMeters: { left: Number.NaN, right: Number.NaN },
      doubleSupport: false,
      prevToeWorldXz: null,
      prevSlotXz: null,
      forwardLeft: 0,
      forwardRight: 0,
      labelledStance: null,
    },
    lockArmed: true,
    // Literal initial state (same shape `createClosedLoopWalkState` builds in
    // production; the lock fixture above is literal the same way, so this test
    // adds no internal import edge).
    closedLoop: {
      prevToeWorldXz: null,
      prevToeY: null,
      prevFinalSlotXz: null,
      lastAdvanceMeters: 0,
      plantAgeLeft: 0,
      plantAgeRight: 0,
      plantedFoot: null,
    },
    stanceLabels: null,
    stanceLabelSlot: null,
    start: { x: 0, y: 0, z: 0 },
    target: { x: 0, y: 0, z: 1 },
    intent: { target: { headingRadians: 0 } },
  };
  return { approach, actorSlot, leftToe, rightToe };
}

/** One synthetic frame: executor prescribes, clip poses, the frame runs. */
function step(
  track: ReturnType<typeof buildTrack>,
  pose: { lz: number; ly: number; rz: number; ry: number },
): void {
  const { approach, actorSlot, leftToe, rightToe } = track;
  actorSlot.position.z += PRESCRIBED;
  leftToe.position.set(0.09, pose.ly, pose.lz);
  rightToe.position.set(-0.09, pose.ry, pose.rz);
  actorSlot.updateMatrixWorld(true);
  applyCaseOwnedStanceLock(approach, DT);
  actorSlot.updateMatrixWorld(true);
}

afterEach(() => {
  delete (globalThis as unknown as { window?: unknown }).window;
});

// Default-OFF wiring: every test below opts in, exactly as production runs it.
beforeEach(() => {
  (globalThis as unknown as { window?: unknown }).window = {
    location: { search: "?closedLoopWalk=1&footstepPlan=0&footBase=0" },
  };
});

describe("closed-loop root advance through the public entrypoint", () => {
  it("single support: the advance equals the planted foot's displacement", () => {
    const track = buildTrack();
    // Bootstrap frame (no previous pose: prescription kept), right foot parked high.
    step(track, { lz: 0, ly: 0.01, rz: 0, ry: 0.5 });
    // Left steps 36 mm backward in the body frame; right stays parked.
    step(track, { lz: -0.036, ly: 0.01, rz: 0, ry: 0.5 });
    expect(track.approach.closedLoop.plantedFoot).toBe("left");
    // Replacement semantics: the slot sits exactly one foot-displacement past
    // last frame's final, whatever the prescription was.
    expect(track.actorSlot.position.z).toBeCloseTo(PRESCRIBED + 0.036, 9);
    // A second identical step repeats exactly (no drift, no averaging).
    step(track, { lz: -0.072, ly: 0.01, rz: 0, ry: 0.5 });
    expect(track.actorSlot.position.z).toBeCloseTo(PRESCRIBED + 0.072, 9);
  });

  it("double support: the longer-planted foot holds until a dwelled rival exceeds it", () => {
    const track = buildTrack();
    step(track, { lz: 0, ly: 0.01, rz: 0, ry: 0.01 });
    // Both feet backward for three frames, left faster throughout: ages tie at
    // every frame, so the incumbent (left, crowned first) keeps the crown and
    // the advance follows the left displacement exactly.
    step(track, { lz: -0.012, ly: 0.01, rz: -0.01, ry: 0.01 });
    step(track, { lz: -0.024, ly: 0.01, rz: -0.02, ry: 0.01 });
    expect(track.approach.closedLoop.plantedFoot).toBe("left");
    step(track, { lz: -0.036, ly: 0.01, rz: -0.03, ry: 0.01 });
    expect(track.approach.closedLoop.plantedFoot).toBe("left");
    const afterLeft = track.actorSlot.position.z;
    expect(afterLeft).toBeCloseTo(PRESCRIBED + 0.036, 9);
    // Right has now dwelled three candidate frames and outpaces left
    // (50 mm vs 5 mm): the crown hands over on this frame, no average.
    step(track, { lz: -0.041, ly: 0.01, rz: -0.08, ry: 0.01 });
    expect(track.approach.closedLoop.plantedFoot).toBe("right");
    expect(track.actorSlot.position.z).toBeCloseTo(afterLeft + 0.05, 9);
  });

  it("counterweight: a young fast descender does not take the crown", () => {
    const track = buildTrack();
    step(track, { lz: 0, ly: 0.01, rz: 0.2, ry: 0.5 });
    // Left plants steadily; right swings down late and fast.
    step(track, { lz: -0.036, ly: 0.01, rz: 0.1, ry: 0.3 });
    step(track, { lz: -0.072, ly: 0.012, rz: 0.0, ry: 0.05 });
    // Right's first in-band frame: backward 100 mm, far faster than left's
    // 36 mm — but one candidate frame is a landing, not a plant.
    step(track, { lz: -0.108, ly: 0.014, rz: -0.1, ry: 0.03 });
    expect(track.approach.closedLoop.plantedFoot).toBe("left");
    expect(track.actorSlot.position.z).toBeCloseTo(PRESCRIBED + 0.108, 9);
    // Left lifts off (forward and up): the crown transfers to the right,
    // which has dwelled by now, without any speed comparison firing first.
    step(track, { lz: -0.058, ly: 0.5, rz: -0.136, ry: 0.032 });
    expect(track.approach.closedLoop.plantedFoot).toBe("right");
    expect(track.actorSlot.position.z).toBeCloseTo(PRESCRIBED + 0.108 + 0.036, 9);
  });

  it("flight: the last advance is carried", () => {
    const track = buildTrack();
    step(track, { lz: 0, ly: 0.01, rz: 0, ry: 0.5 });
    step(track, { lz: -0.036, ly: 0.01, rz: 0, ry: 0.5 });
    const afterPlant = track.actorSlot.position.z;
    // Both feet leave the band: nothing is planted, the 36 mm advance carries.
    step(track, { lz: -0.036, ly: 0.5, rz: 0, ry: 0.5 });
    expect(track.approach.closedLoop.plantedFoot).toBeNull();
    expect(track.actorSlot.position.z).toBeCloseTo(afterPlant + 0.036, 9);
  });

  it("counterweight: the planned-speed flag restores the prescription", () => {
    (globalThis as unknown as { window?: unknown }).window = {
      location: { search: "?closedLoopWalk=1&footstepPlan=0&footBase=0&plannedWalkSpeed=1" },
    };
    const track = buildTrack();
    // The shared fixture pre-seeds a literal initial state; clear it so the
    // null below pins "the function was never called" (lazy init lives
    // inside the guarded block).
    track.approach.closedLoop = null;
    step(track, { lz: 0, ly: 0.01, rz: 0, ry: 0.5 });
    step(track, { lz: -0.036, ly: 0.01, rz: 0, ry: 0.5 });
    // No replacement: the module never engaged (no state created). The slot is
    // where prescription plus the still-acting default lock put it — on main
    // the lock acts by default, so the exact-z pin from the observe-only
    // branch does not transfer; the null state is the opt-out pin.
    expect(track.approach.closedLoop).toBeNull();
  });
});
