import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { advanceCaseOwnedBedsideApproach } from "./case-owned-approach-runtime.js";

/**
 * After a distance-indexed stop, the arrived close must converge toward the take's
 * own hold pose, not the walk-start rest snapshot: forcing stop-planted feet into
 * walk rest drags the slot ~0.2 m and slides toes ~0.1-0.3 m through arrived on
 * every rig (stop-takes slide decomposition). Exercised through the public advance
 * with a fabricated stopping approach so the test pins the wiring, not just a unit.
 */

const HOLD_SPLIT = Math.hypot(0.45, 0.5);

function holdStanceApproach(): Record<string, never> {
  const actorSlot = new THREE.Group();
  const leftToe = new THREE.Object3D();
  leftToe.position.set(-0.2, 0.05, 0.3);
  const rightToe = new THREE.Object3D();
  rightToe.position.set(0.25, 0.05, -0.2);
  actorSlot.add(leftToe);
  actorSlot.add(rightToe);
  actorSlot.updateMatrixWorld(true);
  const target = { x: 3, y: 0, z: 0 };
  return {
    execution: {
      phase: "stopping",
      stopClipTimeS: 4.5,
      stopElapsedSeconds: 99,
      drive: { locomotion: 1 },
      travelledMeters: 1,
      routeLengthMeters: 3,
      boundGeometryRevision: "geom-test",
      prescribedPositionXz: { x: 0, z: 0 },
      headingRadians: Math.PI / 2,
      runId: "stop-unit",
      arrivedAtMs: null,
      stoppedSeconds: 0,
    },
    intent: {
      plan: { waypoints: [], pathViolations: [], arrivesAtTarget: true, finalPoseErrorMeters: 0 },
      target: { headingRadians: Math.PI / 2, position: { ...target } },
    },
    start: { x: 0, y: 0, z: 0 },
    target: { ...target },
    travelHeadingRadians: Math.PI / 2,
    walkSpeedMetersPerSecond: 1,
    settleTurnRateRadiansPerSecond: 1,
    actorSlot,
    leftToe,
    rightToe,
    // Walk-start rest: feet together. The markers above hold a 0.67 m split.
    restStance: {
      quats: {},
      toeLeft: { x: -0.1, y: 0.05, z: 0 },
      toeRight: { x: 0.1, y: 0.05, z: 0 },
      sepXz: 0.2,
      heightLeft: 0.05,
      heightRight: 0.05,
    },
    stopWiring: {
      clipName: "openclinxr_retarget_kimodo_stop_unit",
      durationSeconds: 5.5,
      rootTrackXz: [
        { t: 0, x: 0, z: 0 },
        { t: 5.5, x: 0, z: 2.5 },
      ],
      routeYawRadians: Math.PI / 2,
      distCurve: [],
      tEarliestS: 0,
      rMaxM: 2,
      rDecelM: 1,
      decelOnsetS: 2,
      holdOnsetS: 4.5,
    },
    stanceLabelSlot: null,
    stanceLabels: null,
    lock: null,
    stopFired: null,
    stopSettleBlendT: null,
    clipTurn: { lock: { stanceFoot: null, correctionMeters: { x: 0, z: 0 } } },
  } as unknown as Record<string, never>;
}

describe("the stop recaptures rest at settling", () => {
  it("replaces the walk-start rest with the take hold pose", () => {
    const approach = holdStanceApproach() as unknown as {
      execution: { phase: string };
      restStance: { sepXz: number; toeLeft: { x: number; z: number }; toeRight: { x: number; z: number } } | null;
      [key: string]: unknown;
    };
    const frame = advanceCaseOwnedBedsideApproach(approach as never, {
      nowMs: 1000,
      deltaSeconds: 1 / 60,
      observedGeometryRevision: "geom-test",
      supportAccepted: true,
    });
    expect(frame?.phase).toBe("settling");
    expect(approach.restStance?.sepXz).not.toBeCloseTo(0.2, 6);
    expect(approach.restStance?.sepXz).toBeCloseTo(HOLD_SPLIT, 3);
    expect(approach.restStance?.toeLeft.x).toBeCloseTo(-0.2, 6);
    expect(approach.restStance?.toeLeft.z).toBeCloseTo(0.3, 6);
    expect(approach.restStance?.toeRight.x).toBeCloseTo(0.25, 6);
    expect(approach.restStance?.toeRight.z).toBeCloseTo(-0.2, 6);
  });

  it("leaves an approach with no toes untouched", () => {
    const approach = holdStanceApproach() as unknown as {
      execution: { phase: string };
      restStance: { sepXz: number } | null;
      leftToe: THREE.Object3D | null;
      [key: string]: unknown;
    };
    approach.leftToe = null;
    const frame = advanceCaseOwnedBedsideApproach(approach as never, {
      nowMs: 1000,
      deltaSeconds: 1 / 60,
      observedGeometryRevision: "geom-test",
      supportAccepted: true,
    });
    expect(frame?.phase).toBe("settling");
    expect(approach.restStance?.sepXz).toBeCloseTo(0.2, 6);
  });
});
