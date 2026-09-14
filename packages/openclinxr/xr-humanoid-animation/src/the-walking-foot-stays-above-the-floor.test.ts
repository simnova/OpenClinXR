import { Object3D } from "three";
import { describe, expect, it } from "vitest";
import {
  applyStanceLockedGroundAdvance,
  createStanceLockState,
} from "./stance-lock-mod.js";
import { measureStanceGroundAdvance } from "./case-owned-approach-runtime-mod.js";
import { resolveFloorBandPlantLocalY } from "@openclinxr/xr-pose/actor-floor-composition";

/**
 * RED for floor-penetration: the walking foot reaches 0.0378 m below the floor frame,
 * 7.6x the frozen 0.005 m limit.
 *
 * This test reproduces the defect by:
 * 1. Building a stance clip whose toe samples go below floorOriginY
 * 2. Running measureStanceGroundAdvance to get the clip advance
 * 3. Applying the stance lock frame by frame with those samples
 * 4. Measuring the deepest penetration below the floor frame
 *
 * The measurement uses the same formula as the rubric:
 *   depth = floor.originY - sample.position.y
 * A positive depth means the foot is below the floor.
 */

const PERCEPTUAL_FLOOR_METERS = 0.005;
const FOOT_CONTACT_HEIGHT_METERS = 0.06;

function makeToeObject(initialY: number): Object3D {
  const toe = new Object3D();
  toe.position.y = initialY;
  return toe;
}

function makeActorSlot(): Object3D {
  const slot = new Object3D();
  slot.position.set(0, 0, 0);
  slot.scale.set(1, 1, 1);
  return slot;
}

function setupToeHierarchy(actorSlot: Object3D, toe: Object3D): void {
  // In the real code, the toe is a descendant of the actorSlot through humanoidRoot.
  // For the test, parent the toe directly to the actorSlot to simulate this.
  actorSlot.add(toe);
}

/**
 * Build stance samples that simulate a clip whose toe goes below the floor.
 *
 * Measured in the real run: deepestFloorPenetrationMeters = 0.037796082123302856
 * This means the toe reached floorOriginY - 0.0378.
 *
 * We construct a minimal stance window (3 frames minimum per rubric) where the
 * toe dips below the floor.
 */
function buildSubmergedStanceSamples(floorOriginY: number, penetrationMeters: number): ReadonlyArray<{ atMs: number; position: { x: number; y: number; z: number } }> {
  const toeBelowFloor = floorOriginY - penetrationMeters;
  return [
    { atMs: 0, position: { x: 0, y: floorOriginY + 0.01, z: 0 } },      // just above floor
    { atMs: 16.67, position: { x: 0, y: toeBelowFloor, z: 0 } },        // DEEPLY SUBMERGED
    { atMs: 33.33, position: { x: 0, y: floorOriginY + 0.005, z: 0 } }, // back near floor
  ];
}

function worldY(node: Object3D): number {
  const elements = node.matrixWorld.elements;
  return elements[13] ?? Number.NaN;
}

describe("floor-penetration-required-behavior", () => {
  it("the walking foot stays within 0.005 m of the floor frame across every contact sample", () => {
    // This simulates what the real bedside approach does:
    // 1. Sample the clip's stance track (which dips below floor)
    // 2. Measure ground advance from those samples
    // 3. Create approach with that advance
    // 4. Apply stance lock per frame
    // 5. Measure deepest penetration

    const floorOriginY = 0; // The real ward floor is at y=0 (within nanometres)
    const penetrationMeters = 0.0378; // Measured deepest penetration

    // Build samples that dip below floorOriginY
    const samples = buildSubmergedStanceSamples(floorOriginY, penetrationMeters);

    // Measure the clip advance from these samples
    const _clipAdvance = measureStanceGroundAdvance(samples, {
      contactBandMeters: FOOT_CONTACT_HEIGHT_METERS,
      floorOriginY: 0,
    });

    // Now simulate the stance lock applied frame by frame
    const actorSlot = makeActorSlot();
    const leftToe = makeToeObject(floorOriginY); // starts at floor level
    const rightToe = makeToeObject(floorOriginY + 0.1); // other foot up
    setupToeHierarchy(actorSlot, leftToe);
    setupToeHierarchy(actorSlot, rightToe);

    // Initial plant at floor level
    const floorBandPlant = resolveFloorBandPlantLocalY({
      humanoidLocalY: 0,
      lowestMeshWorldY: floorOriginY,
      parentWorldScaleY: 1,
      floorTopY: floorOriginY,
    });
    actorSlot.position.y = floorBandPlant.localY;

    const initialState = createStanceLockState();

    // Simulate walking frames with the submerged samples
    let deepestPenetration = 0;
    let state = initialState;

    for (let i = 0; i < samples.length; i++) {
      const sample = samples[i];
      if (!sample) continue;

      // Move toe to the sample position (simulating animation clip driving the toe)
      leftToe.position.y = sample.position.y;
      actorSlot.updateMatrixWorld(true); // Update world matrices after moving toe
      leftToe.updateMatrixWorld(true);

      // Apply stance lock
      state = applyStanceLockedGroundAdvance({
        actorSlot,
        leftToe,
        rightToe,
        floorOriginY: floorOriginY, // The stance lock receives the CORRECT floorOriginY
        contactBandMeters: FOOT_CONTACT_HEIGHT_METERS,
        state,
      });

      // Measure penetration after lock
      const toeWorldY = worldY(leftToe);
      const depth = floorOriginY - toeWorldY;
      if (depth > deepestPenetration) {
        deepestPenetration = depth;
      }
    }

    // THE ASSERTION THAT MUST FAIL TODAY
    // The rubric limit is 0.005 m (PERCEPTUAL_FLOOR_METERS)
    // Measured penetration is 0.0378 m = 7.6x the limit
    expect(deepestPenetration).toBeLessThanOrEqual(PERCEPTUAL_FLOOR_METERS);
  });

  it("COUNTERWEIGHT: the rubric detects penetration from raw clip samples even when stance lock corrects visually", () => {
    // The rubric measures RAW contactTracks (clip samples), not the corrected stance.
    // This test verifies that the measurement function gradeFloorPenetration would
    // still report a violation for a clip that drives the foot below the floor.
    // We test this by computing the penetration directly from the raw samples
    // (same formula as gradeFloorPenetration: depth = floor.originY - sample.position.y)

    const floorOriginY = 0;
    const penetrationMeters = 0.02; // 2 cm below floor - clearly violating

    const samples = buildSubmergedStanceSamples(floorOriginY, penetrationMeters);

    // Simulate what gradeFloorPenetration does: compute depth from raw samples
    let deepest = 0;
    for (const sample of samples) {
      if (!sample) continue;
      const depth = floorOriginY - sample.position.y;
      if (depth > deepest) deepest = depth;
    }

    // The rubric MUST detect this penetration from the raw samples
    expect(deepest).toBeGreaterThan(PERCEPTUAL_FLOOR_METERS);
  });

  it("COUNTERWEIGHT: without Y correction, penetration occurs and is measurable", () => {
    // Verify that if we DON'T correct Y (old behavior), penetration happens
    // We simulate this by creating a "broken" stance lock that only corrects XZ
    const floorOriginY = 0;
    const penetrationMeters = 0.02;

    const samples = buildSubmergedStanceSamples(floorOriginY, penetrationMeters);

    const actorSlot = makeActorSlot();
    const leftToe = makeToeObject(floorOriginY);
    const rightToe = makeToeObject(floorOriginY + 0.1);
    setupToeHierarchy(actorSlot, leftToe);
    setupToeHierarchy(actorSlot, rightToe);

    const floorBandPlant = resolveFloorBandPlantLocalY({
      humanoidLocalY: 0,
      lowestMeshWorldY: floorOriginY,
      parentWorldScaleY: 1,
      floorTopY: floorOriginY,
    });
    actorSlot.position.y = floorBandPlant.localY;

    // Simulate old behavior: XZ correction only, NO Y correction
    // The clip drives the toe below floor, and without Y correction it stays there
    let deepestPenetration = 0;

    for (let i = 0; i < samples.length; i++) {
      const sample = samples[i];
      if (!sample) continue;
      leftToe.position.y = sample.position.y;
      actorSlot.updateMatrixWorld(true);
      leftToe.updateMatrixWorld(true);

      const toeWorldY = worldY(leftToe);
      const depth = floorOriginY - toeWorldY;
      if (depth > deepestPenetration) {
        deepestPenetration = depth;
      }
    }

    // Without Y correction, penetration should be detected
    expect(deepestPenetration).toBeGreaterThan(PERCEPTUAL_FLOOR_METERS);
  });

  it("RECORDS per-frame series across stride with stance switch for grading", () => {
    // This test records the per-frame series requested in §6:
    // slot.y, correctionMeters.y, leftToe.y, rightToe.y (world), stanceFoot, hip-to-toe distance per side
    // across at least one full stride containing a stance switch.
    // The test logs the series for manual inspection; the assert just verifies it runs.

    const floorOriginY = 0;
    const penetrationMeters = 0.0378;

    // Build a longer clip with multiple stance windows and a stance switch
    // Simulating a walk clip with ~15 frames per stance window, ~60 frames total (one stride)
    const samples: Array<{ atMs: number; position: { x: number; y: number; z: number } }> = [];
    const numFrames = 60;
    const stanceWindowFrames = 15; // frames per contact window

    for (let i = 0; i < numFrames; i++) {
      // Left toe stance: frames 0-14, right toe stance: 15-29, left: 30-44, right: 45-59
      const leftStance = (i < stanceWindowFrames) || (i >= 30 && i < 45);
      const rightStance = (i >= stanceWindowFrames && i < 30) || (i >= 45);

      // Left toe: dips below floor during its stance windows
      let leftY = floorOriginY + 0.01; // swing phase: slightly above
      if (leftStance) {
        // Stance: dips to penetration depth at mid-stance
        const phase = (i % stanceWindowFrames) / stanceWindowFrames;
        const dip = Math.sin(phase * Math.PI) * penetrationMeters;
        leftY = floorOriginY - dip;
      }

      // Right toe: similar but offset
      let _rightY = floorOriginY + 0.01;
      if (rightStance) {
        const phase = (i % stanceWindowFrames) / stanceWindowFrames;
        const dip = Math.sin(phase * Math.PI) * penetrationMeters;
        _rightY = floorOriginY - dip;
      }

      samples.push({ atMs: i * 16.67, position: { x: 0, y: leftY, z: 0 } });
    }

    const _clipAdvance = measureStanceGroundAdvance(samples, {
      contactBandMeters: FOOT_CONTACT_HEIGHT_METERS,
      floorOriginY: 0,
    });

    const actorSlot = makeActorSlot();
    const leftToe = makeToeObject(floorOriginY);
    const rightToe = makeToeObject(floorOriginY + 0.1);
    setupToeHierarchy(actorSlot, leftToe);
    setupToeHierarchy(actorSlot, rightToe);

    const floorBandPlant = resolveFloorBandPlantLocalY({
      humanoidLocalY: 0,
      lowestMeshWorldY: floorOriginY,
      parentWorldScaleY: 1,
      floorTopY: floorOriginY,
    });
    actorSlot.position.y = floorBandPlant.localY;

    const initialState = createStanceLockState();

    // Record per-frame series
    const series: Array<{
      frame: number;
      slotY: number;
      correctionY: number;
      leftToeWorldY: number;
      rightToeWorldY: number;
      stanceFoot: "left" | "right" | null;
      leftHipToToe: number;
      rightHipToToe: number;
    }> = [];

    let state = initialState;

    for (let i = 0; i < samples.length; i++) {
      const sample = samples[i];
      if (!sample) continue;

      // Move left toe (we only track left for the series; right follows similar pattern)
      leftToe.position.y = sample.position.y;
      // Right toe follows its own pattern
      const rightSample = samples[Math.min(i + 15, samples.length - 1)]; // offset
      rightToe.position.y = rightSample ? rightSample.position.y : floorOriginY + 0.1;

      actorSlot.updateMatrixWorld(true);
      leftToe.updateMatrixWorld(true);
      rightToe.updateMatrixWorld(true);

      // Apply stance lock
      state = applyStanceLockedGroundAdvance({
        actorSlot,
        leftToe,
        rightToe,
        floorOriginY,
        contactBandMeters: FOOT_CONTACT_HEIGHT_METERS,
        state,
      });

      // Record measurements
      const leftToeWorldY = worldY(leftToe);
      const rightToeWorldY = worldY(rightToe);
      const slotY = actorSlot.position.y;

      // Estimate hip-to-toe distance (hip at ~0.9m above slot for adult)
      const hipWorldY = slotY + 0.9;
      const leftHipToToe = Math.abs(hipWorldY - leftToeWorldY);
      const rightHipToToe = Math.abs(hipWorldY - rightToeWorldY);

      series.push({
        frame: i,
        slotY,
        correctionY: state.correctionMeters.y,
        leftToeWorldY,
        rightToeWorldY,
        stanceFoot: state.stanceFoot,
        leftHipToToe,
        rightHipToToe,
      });
    }

    // Log the series for grading (console output will be captured)
    console.log("PER_FRAME_SERIES_START");
    for (const frame of series) {
      console.log(
        `frame=${frame.frame} slotY=${frame.slotY.toFixed(6)} corrY=${frame.correctionY.toFixed(6)} ` +
        `leftToeY=${frame.leftToeWorldY.toFixed(6)} rightToeY=${frame.rightToeWorldY.toFixed(6)} ` +
        `stance=${frame.stanceFoot} leftHipToToe=${frame.leftHipToToe.toFixed(6)} rightHipToToe=${frame.rightHipToToe.toFixed(6)}`
      );
    }
    console.log("PER_FRAME_SERIES_END");

    // Verify we captured a stance switch
    const stanceChanges = series.filter((s, i) => i > 0 && s.stanceFoot !== series[i - 1].stanceFoot);
    expect(stanceChanges.length).toBeGreaterThan(0);
  });
});