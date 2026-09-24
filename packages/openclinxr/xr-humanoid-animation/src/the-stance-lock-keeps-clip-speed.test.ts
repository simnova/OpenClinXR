import { CLINICIAN_WALK_SPEED_MPS } from "@openclinxr/asset-registry/approach-executor";
import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { applyCaseOwnedStanceLock } from "./case-owned-approach-runtime.js";

/**
 * `applyStanceLockedGroundAdvance` (stance-lock-mod.ts) has no outside binder and is not on
 * this package's reviewed public surface (closed by `psr-01e`), so this drives it only through
 * `applyCaseOwnedStanceLock` — the one public function that calls it — with a hand-built
 * `CaseOwnedBedsideApproach`-shaped fixture, and reads the result back off `approach.lock`.
 */
// biome-ignore lint/suspicious/noExplicitAny: fixture shape, not the tested predicate
type Loose = any;

/**
 * The stance lock keeps the clip's ground speed instead of walking in place.
 *
 * Gait shaped from `.openclinxr/walk-integrate/advance-loss.json`: 1.1 s cycle at 60 Hz,
 * 6-7 frame double support, the incoming foot touching down lower (0.002 m vs 0.01 m),
 * then skating FORWARD in body space at ~40 mm/frame for 6 frames past liftoff — the
 * measured burst shape (26-50 mm/frame backward yank, anchor up to 0.24 m behind the
 * toe's new line). The executor prescribes CLINICIAN_WALK_SPEED_MPS; the lock derives
 * the rest from the planted foot. Old rule (instant-lower toe) crowns the skater and
 * pins it: the body advances ~0.66 m/s. Fixed rule (clip-motion stance + skate
 * follow + no-backward clamp): ~1.1 m/s with no per-frame retreat past the SC-00
 * perceptual floor.
 */

const HZ = 60;
const DT = 1 / HZ;
const CYCLE_SECONDS = 1.1;
const STANCE_FRACTION = 0.6;
const CONTACT_BAND_METERS = 0.06;
const FLOOR_Y = 0;
const SKATE_FRAMES = 6;
const SKATE_STEP_METERS = 0.04;
const STANCE_STEP_METERS = (CLINICIAN_WALK_SPEED_MPS * DT);
const TOUCHDOWN_Z = 0.31;
const PERCEPTUAL_FLOOR_METERS = 0.005;

function buildRig(): {
  actorSlot: THREE.Group;
  leftToe: THREE.Object3D;
  rightToe: THREE.Object3D;
} {
  // Toes ride the slot directly, with no leg chain above them. Without a chain the lock
  // takes its XZ-only path; the stance selection, switch pin, skate follow and
  // no-backward clamp under test are identical on both paths (the chain branch only adds
  // the Y solve after the XZ correction, and stored positions are pre-correction either
  // way). A positional knee bend would read as extra flexion to the absolute knee set,
  // so chains would measure the fixture, not the lock. Y correction itself is graded by
  // the standing/walking-foot suites on rigs built for it.
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
  return { actorSlot, leftToe, rightToe };
}

type FootPose = { z: number; y: number; stanceAge: number | null };

/** Pathological transfer gait: stance, then a forward skate past liftoff, then stance. */
function footPose(cyclePhase: number, phaseOffset: number, skate: boolean): FootPose {
  const local = (((cyclePhase - phaseOffset) % 1) + 1) % 1;
  const stanceFrames = Math.round(CYCLE_SECONDS * STANCE_FRACTION * HZ);
  if (!skate) {
    // Clean foot: steady backward stance at the executor's own rate, continuous into a
    // fast swing. Proves the pin; never trips the skate counter.
    if (local >= STANCE_FRACTION) {
      const swing = (local - STANCE_FRACTION) / (1 - STANCE_FRACTION);
      return {
        z: -0.3667 + swing * 0.7334,
        y: 0.01 + 0.19 * Math.sin(swing * Math.PI) ** 1.2,
        stanceAge: null,
      };
    }
    const age = Math.floor((local / STANCE_FRACTION) * stanceFrames);
    return { z: 0.3667 - age * STANCE_STEP_METERS, y: age === 0 ? 0.002 : 0.01, stanceAge: age };
  }
  if (local >= STANCE_FRACTION) {
    const swing = (local - STANCE_FRACTION) / (1 - STANCE_FRACTION);
    return {
      z: -0.073 + swing * (TOUCHDOWN_Z + 0.073),
      y: 0.01 + 0.19 * Math.sin(swing * Math.PI) ** 1.2,
      stanceAge: null,
    };
  }
  const age = Math.floor((local / STANCE_FRACTION) * stanceFrames);
  // Only one foot skates: burst windows are a minority in the real capture (10 of 38),
  // which is what keeps the median meaningful. The clean foot proves the pin; the
  // skating foot proves the follow.
  let z = TOUCHDOWN_Z - Math.min(age, 6) * STANCE_STEP_METERS;
  if (age >= 6) z += Math.min(age - 6, SKATE_FRAMES) * SKATE_STEP_METERS;
  if (age >= 6 + SKATE_FRAMES) z -= (age - 6 - SKATE_FRAMES) * STANCE_STEP_METERS;
  return { z, y: age === 0 ? 0.002 : 0.01, stanceAge: age };
}

function runWalk(seconds: number): {
  meanSpeedMps: number;
  advancesMeters: number[];
  cadencePerMinute: number;
  medianWindowSlideMeters: number;
  windows: number;
} {
  const { actorSlot, leftToe, rightToe } = buildRig();
  const approach: Loose = {
    execution: { phase: "walking", drive: { locomotion: 1 } },
    actorSlot,
    leftToe,
    rightToe,
    floorOriginY: FLOOR_Y,
    contactBandMeters: CONTACT_BAND_METERS,
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
    stanceLabels: null,
    stanceLabelSlot: null,
    turnStep: {
      plantFoot: "right",
      stepStartHeadingRadians: 0,
      restLocal: null,
      plantAnchorXz: null,
      yawPerStepRadians: 0.4,
      opened: false,
      closing: false,
    },
    restStance: null,
    closeState: { anchorXz: null, done: false, framesRun: 0, plantFoot: null },
    // TRAVEL_UNIT is {x:0, z:1}; start/target give applyCaseOwnedStanceLock the same route.
    start: { x: 0, y: 0, z: 0 },
    target: { x: 0, y: 0, z: 1 },
    intent: { target: { headingRadians: 0 } },
  };
  const frames: Array<{ slotZ: number; stanceFoot: string | null; lx: number; lz: number; rx: number; rz: number }> = [];
  const totalFrames = Math.round(seconds * HZ);
  for (let frame = 0; frame < totalFrames; frame += 1) {
    // Executor prescribes the planned advance from where the body is.
    actorSlot.position.z += CLINICIAN_WALK_SPEED_MPS * DT;
    // Fresh clip pose, as the mixer writes it before the lock runs.
    const phase = (frame * DT) / CYCLE_SECONDS;
    const left = footPose(phase, 0, false);
    const right = footPose(phase, 0.5, true);
    leftToe.position.set(0.09, left.y, left.z);
    rightToe.position.set(-0.09, right.y, right.z);
    actorSlot.updateMatrixWorld(true);
    applyCaseOwnedStanceLock(approach);
    actorSlot.updateMatrixWorld(true);
    frames.push({
      slotZ: actorSlot.position.z,
      stanceFoot: approach.lock.stanceFoot,
      lx: leftToe.matrixWorld.elements[12] ?? 0,
      lz: leftToe.matrixWorld.elements[14] ?? 0,
      rx: rightToe.matrixWorld.elements[12] ?? 0,
      rz: rightToe.matrixWorld.elements[14] ?? 0,
    });
  }
  // Drop the first cycle: anchors and velocity history are not settled there.
  const warm = Math.round(CYCLE_SECONDS * HZ);
  const kept = frames.slice(warm);
  const first = kept[0]!;
  const last = kept[kept.length - 1]!;
  const timeSeconds = (kept.length - 1) * DT;
  const advancesMeters: number[] = [];
  for (let i = 1; i < kept.length; i += 1) {
    advancesMeters.push(kept[i]!.slotZ - kept[i - 1]!.slotZ);
  }
  let transitions = 0;
  for (let i = 1; i < kept.length; i += 1) {
    if (kept[i]!.stanceFoot !== kept[i - 1]!.stanceFoot) transitions += 1;
  }
  // Windows mirror the capture: maximal runs of one reported stance foot. Per-window
  // hold is the XZ span over frames incident to pinned steps (consecutive stance-toe
  // steps under 10 mm) — skate frames step far and are excluded by construction, exactly
  // as `detectStanceWindows` in the foot-plant video capture grades them.
  const windowHolds: number[] = [];
  let run: typeof kept = [];
  const flush = (): void => {
    if (run.length >= 2 && run[0]!.stanceFoot !== null) {
      const foot = run[0]!.stanceFoot;
      const at = (entry: (typeof kept)[number]): { x: number; z: number } =>
        foot === "left" ? { x: entry.lx, z: entry.lz } : { x: entry.rx, z: entry.rz };
      const pinned = new Set<number>();
      for (let i = 1; i < run.length; i += 1) {
        const a = at(run[i - 1]!);
        const b = at(run[i]!);
        if (Math.hypot(b.x - a.x, b.z - a.z) < 0.01) {
          pinned.add(i - 1);
          pinned.add(i);
        }
      }
      const pts = run.filter((_, i) => pinned.has(i)).map(at);
      if (pts.length >= 2) {
        const xs = pts.map((p) => p.x);
        const zs = pts.map((p) => p.z);
        windowHolds.push(
          Math.hypot(Math.max(...xs) - Math.min(...xs), Math.max(...zs) - Math.min(...zs)),
        );
      } else {
        windowHolds.push(0);
      }
    }
    run = [];
  };
  for (const entry of kept) {
    if (run.length > 0 && run[run.length - 1]!.stanceFoot !== entry.stanceFoot) flush();
    run.push(entry);
  }
  flush();
  const sorted = [...windowHolds].sort((a, b) => a - b);
  const median = sorted.length === 0 ? 0 : sorted[Math.floor(sorted.length / 2)]!;
  return {
    meanSpeedMps: (last.slotZ - first.slotZ) / timeSeconds,
    advancesMeters,
    cadencePerMinute: (transitions / timeSeconds) * 60,
    medianWindowSlideMeters: median,
    windows: windowHolds.length,
  };
}

describe("the stance lock keeps the clip's ground speed (walk-advance-required-behavior)", () => {
  it("walk-advance-required-behavior", () => {
    const result = runWalk(8);
    expect(result.windows, "the walk produced stance windows to grade").toBeGreaterThan(4);
    expect(result.meanSpeedMps).toBeGreaterThan(CLINICIAN_WALK_SPEED_MPS * 0.85);
    expect(result.meanSpeedMps).toBeLessThan(CLINICIAN_WALK_SPEED_MPS * 1.15);
    // No backward yank: the measured defect class is 3-7 consecutive frames retreating
    // 26-50 mm each. A 1-2 frame transient full pin (push-off, skate onset) is the plant
    // the frozen SC-00 rubric demands — its single-frame cost is bounded at 50 mm and it
    // never runs past the second frame, when the follow takes over. A per-frame -5 mm
    // floor for every frame would forbid those transient pins and reintroduce SC-05's
    // 12.5 mm worst frame, so the assertion refuses the burst shape instead of all retreat.
    for (const advance of result.advancesMeters) {
      expect(advance).toBeGreaterThanOrEqual(-0.05);
    }
    let retreatRun = 0;
    for (const advance of result.advancesMeters) {
      retreatRun = advance < -PERCEPTUAL_FLOOR_METERS ? retreatRun + 1 : 0;
      expect(retreatRun).toBeLessThan(3);
    }
    expect(result.cadencePerMinute).toBeGreaterThanOrEqual(90);
    expect(result.cadencePerMinute).toBeLessThanOrEqual(125);
    expect(result.medianWindowSlideMeters).toBeLessThanOrEqual(0.02);
  });
});
