import { describe, expect, it } from "vitest";
import {
  advanceCaseOwnedBedsideApproach,
  applyCaseOwnedStanceLock,
  createCaseOwnedBedsideApproach,
  measureStanceGroundAdvance,
} from "../../../../packages/openclinxr/xr-humanoid-animation/src/case-owned-approach-runtime-mod.js";
import { applySettledPostureCorrection } from "../../../../packages/openclinxr/xr-humanoid-animation/src/stance-lock-mod.js";
import { AnimationClip, Group, Object3D, VectorKeyframeTrack } from "three";

/**
 * The settled branch execution is observed, not assumed.
 *
 * Card tsk_4c0f66ebb0453372 exists because three fixes landed (or were built) on the
 * settled-foot defect and all three moved the SC-05 numbers by less than run-to-run noise:
 * settling 0.037747 -> 0.037598 -> 0.037578 m against a 0.005 m limit. The discriminator this
 * card measures is whether `case-owned-approach-runtime-mod.ts:477` — the arrived-phase
 * `applySettledPostureCorrection` call — executes at all in a run that reaches arrived, and on
 * how many frames. It sits after `return` at :464 (settling block) and after
 * `if (approach.turnStep.closing) return;` at :474 (rest-restore block).
 *
 * This test drives the production executor + stance lock over the production gait probe (the
 * same 1.2 s clip the behaviour test builds at
 * `apps/ui-xr/src/the-normal-encounter-physician-approaches-and-stops.test.ts:317`), reaches
 * arrived, and records per-frame: the execution phase, whether the :477-shaped correction ran
 * (arrived + locomotion <= 0 with restLocal null or closing false), whether
 * `applySettledPostureCorrection` reported corrected:true, the stance toe world Y immediately
 * after the correction, and the stance toe world Y at capture-sample time (the same frame, after
 * the lock — the capture samples the track the lock just wrote).
 *
 * Two control-flow facts shape the run. First, `stepBedsideApproachExecution` advances
 * walking -> settling only when one frame's advance would overshoot the route, and
 * settling -> arrived only when the terminal turn has closed; a route long enough to walk and a
 * heading change near zero produce a short settling interval and a long arrived observation.
 * Second, `applySettlingStepTurnPose` captures restLocal on its FIRST settling frame, so
 * restLocal is non-null for every later settling frame and for the whole arrived phase; and
 * `restoreSettlingRestToePose` returns closing:true after the swap frame, so :474's early return
 * fires exactly when closing is true. The frame log records restLocal/closing per frame so the
 * count is measured, not argued.
 *
 * claimScope: the frame count on which the :477 branch executes in a run reaching arrived,
 * plus corrected:true reporting and toe world Y after correction vs at sample time.
 * notEvidenceFor: browser pixels, gait realism, Quest readiness, or the shipped GLB clip.
 */

const SIMULATION_HZ = 60;
const CONTACT_BAND_METERS = 0.06;
const ARRIVED_OBSERVE_SECONDS = 2;

const GAIT_CYCLE_SECONDS = 1.2;
const GAIT_STEP_METERS = 0.5;
const GAIT_CLIP_NAME = "openclinxr_sc05_probe_walk";
void GAIT_CLIP_NAME;
void AnimationClip;
void VectorKeyframeTrack;

function sampleProbeTrack(side: "L" | "R", clipMs: number): { x: number; y: number; z: number } {
  const periodMs = GAIT_CYCLE_SECONDS * 1000;
  const local = ((clipMs % periodMs) + periodMs) % periodMs;
  const phase = local / periodMs;
  const planted = side === "L" ? phase < 0.5 : phase >= 0.5;
  const frac = side === "L" ? (planted ? phase * 2 : (phase - 0.5) * 2) : planted ? (phase - 0.5) * 2 : phase * 2;
  const stanceZ = GAIT_STEP_METERS / 2 - frac * GAIT_STEP_METERS;
  const swingZ = -GAIT_STEP_METERS / 2 + frac * GAIT_STEP_METERS;
  const swingY = 0.01 + Math.sin(frac * Math.PI) ** 0.3 * 0.28;
  return {
    x: side === "L" ? 0.09 : -0.09,
    y: planted ? 0.01 : swingY,
    z: planted ? stanceZ : swingZ,
  };
}

function makeLegRig(): { actorSlot: Group; humanoid: Object3D; toeL: Object3D; toeR: Object3D } {
  const actorSlot = new Group();
  actorSlot.position.set(0, 0, 0);
  const humanoid = new Group();
  humanoid.name = "observation_humanoid";
  actorSlot.add(humanoid);
  const hip = new Object3D();
  hip.name = "upperleg01.L";
  hip.position.set(0.09, 0.52, 0);
  humanoid.add(hip);
  const knee = new Object3D();
  knee.name = "lowerleg01.L";
  knee.position.set(0, -0.45, 0);
  hip.add(knee);
  const heel = new Object3D();
  heel.name = "foot.L";
  heel.position.set(0, -0.33, 0);
  knee.add(heel);
  const toeL = new Object3D();
  toeL.name = "toe1-1.L";
  toeL.position.set(0, -0.1, 0.05);
  heel.add(toeL);
  const hipR = new Object3D();
  hipR.name = "upperleg01.R";
  hipR.position.set(-0.09, 0.52, 0);
  humanoid.add(hipR);
  const kneeR = new Object3D();
  kneeR.name = "lowerleg01.R";
  kneeR.position.set(0, -0.45, 0);
  hipR.add(kneeR);
  const heelR = new Object3D();
  heelR.name = "foot.R";
  heelR.position.set(0, -0.33, 0);
  kneeR.add(heelR);
  const toeR = new Object3D();
  toeR.name = "toe1-1.R";
  toeR.position.set(0, -0.1, 0.05);
  heelR.add(toeR);
  actorSlot.updateMatrixWorld(true);
  return { actorSlot, humanoid, toeL, toeR };
}

function worldY(node: Object3D): number {
  return node.matrixWorld.elements[13] ?? Number.NaN;
}

type ObservedFrame = {
  index: number;
  phase: string;
  locomotion: number;
  restLocalNull: boolean;
  closing: boolean;
  settledBranchReached: boolean;
  corrected: boolean | null;
  stanceFoot: string | null;
  toeYBeforeCorrection: number | null;
  toeYAfterCorrection: number | null;
  toeYSample: number;
};

describe("the settled branch execution is observed", () => {
  it("settled-branch-execution-report", () => {
    const { actorSlot, toeL, toeR } = makeLegRig();
    const start = { x: -1.95, y: 0, z: 1.72 };
    const target = { x: -0.9, y: 0, z: 1.29 };
    const routeHeading = Math.atan2(target.x - start.x, target.z - start.z);
    const targetHeading = routeHeading;
    const clipAdvance = measureStanceGroundAdvance(
      Array.from({ length: 48 }, (_, index) => ({
        atMs: (index / 48) * GAIT_CYCLE_SECONDS * 1000,
        position: sampleProbeTrack("L", (index / 48) * GAIT_CYCLE_SECONDS * 1000),
      })),
      { contactBandMeters: CONTACT_BAND_METERS, floorOriginY: 0 },
    );
    expect(clipAdvance.metersPerSecond).toBeGreaterThan(0);
    const approach = createCaseOwnedBedsideApproach({
      intent: {
        refused: false,
        physicianActorId: "observation_physician",
        start,
        target: { position: target, headingRadians: targetHeading, approachSide: "patient_right" },
        standoffMeters: 0.75,
        approachSideSource: "case_authored_start_position",
        plan: {
          waypoints: [
            { position: start, headingRadians: routeHeading },
            { position: target, headingRadians: targetHeading },
          ],
          pathViolations: [],
          arrivesAtTarget: true,
          finalPoseErrorMeters: 0,
        },
        sweptViolations: [],
        workingClearanceViolations: [],
        monitorVisibility: null,
        observedObstacleIds: [],
        floorFrameId: "observation:floor",
        geometryRevision: "observation-rev-1",
      },
      geometry: {
        floorFrame: { frameId: "observation:floor", originY: 0, originXz: { x: 0, z: 0 }, normal: { x: 0, y: 1, z: 0 } },
        supportInstanceId: "observation:bed",
        supportBounds: { min: { x: -2, y: 0, z: -2 }, max: { x: 2, y: 1, z: 2 } },
        obstacles: [{ id: "observation:far-wall", bounds: { min: { x: 8, y: 0, z: 8 }, max: { x: 9, y: 2, z: 9 } } }],
        monitorBounds: null,
        monitorInstanceId: null,
        roomCentre: { x: 0, y: 0, z: 0 },
      },
      observedGeometryRevision: "observation-rev-1",
      runId: "settled-branch-observation",
      actorSlot,
      humanoidRoot: actorSlot,
      contactBandMeters: CONTACT_BAND_METERS,
      clipAdvance,
      clipCycleSeconds: GAIT_CYCLE_SECONDS,
      routeHeadingRadians: routeHeading,
    });
    if ("refused" in approach) throw new Error(`observation approach refused: ${approach.reason}`);

    const dt = 1 / SIMULATION_HZ;
    const frames: ObservedFrame[] = [];
    let clipMs = 0;
    let locomotionActive = false;
    const maxFrames = Math.round(30 * SIMULATION_HZ);
    let arrivedFrames = 0;
    for (let index = 0; index < maxFrames; index += 1) {
      const nowMs = index * dt * 1000;
      if (locomotionActive) clipMs += dt * 1000;
      const walking = locomotionActive || index === 0;
      const localL = walking ? sampleProbeTrack("L", clipMs) : { x: 0.09, y: 0.01 - 0.6, z: 0.0 };
      const localR = walking ? sampleProbeTrack("R", clipMs) : { x: -0.09, y: 0.01 - 0.6, z: 0.0 };
      toeL.position.set(localL.x, localL.y, localL.z);
      toeR.position.set(localR.x, localR.y, localR.z);
      actorSlot.updateMatrixWorld(true);
      const frame = advanceCaseOwnedBedsideApproach(approach, {
        nowMs,
        deltaSeconds: dt,
        observedGeometryRevision: "observation-rev-1",
        supportAccepted: true,
      });
      if (frame === null) throw new Error("advanceCaseOwnedBedsideApproach returned null for a live approach");
      locomotionActive = frame.locomotion > 0;
      const restLocalNull = approach.turnStep.restLocal === null;
      const closing = approach.turnStep.closing;
      // The :477-shaped branch: arrived, no locomotion, and :474 did not return early.
      const settledBranchReached =
        frame.phase === "arrived" && frame.locomotion <= 0 && (restLocalNull || !closing);
      let corrected: boolean | null = null;
      let stanceFoot: string | null = null;
      let toeYAfterCorrection: number | null = null;
      let toeYBeforeCorrection: number | null = null;
      if (settledBranchReached && frame.phase === "arrived") {
        actorSlot.updateMatrixWorld(true);
        toeYBeforeCorrection = Math.min(worldY(toeL), worldY(toeR));
        const direct = applySettledPostureCorrection({
          actorSlot,
          leftToe: toeL,
          rightToe: toeR,
          floorOriginY: 0,
          contactBandMeters: CONTACT_BAND_METERS,
        });
        corrected = direct.corrected;
        stanceFoot = direct.stanceFoot;
        actorSlot.updateMatrixWorld(true);
        toeYAfterCorrection = worldY(direct.stanceFoot === "right" ? toeR : toeL);
      }
      applyCaseOwnedStanceLock(approach);
      actorSlot.updateMatrixWorld(true);
      const toeYSample = worldY(toeL) <= worldY(toeR) ? worldY(toeL) : worldY(toeR);
      frames.push({
        index,
        phase: frame.phase,
        locomotion: frame.locomotion,
        restLocalNull,
        closing,
        settledBranchReached,
        corrected,
        stanceFoot,
        toeYBeforeCorrection,
        toeYAfterCorrection,
        toeYSample,
      });
      if (frame.phase === "arrived") {
        arrivedFrames += 1;
        if (arrivedFrames >= Math.round(ARRIVED_OBSERVE_SECONDS * SIMULATION_HZ)) break;
      }
    }

    const phases = [...new Set(frames.map((entry) => entry.phase))];
    const arrived = frames.filter((entry) => entry.phase === "arrived");
    const branchFrames = frames.filter((entry) => entry.settledBranchReached);
    const correctedFrames = branchFrames.filter((entry) => entry.corrected === true);
    const mean = (values: number[]): number => values.reduce((a, b) => a + b, 0) / Math.max(1, values.length);

    console.log("=== SETTLED BRANCH EXECUTION OBSERVATION ===");
    console.log(`phases: ${phases.join(",")}`);
    console.log(`totalFrames: ${frames.length}`);
    console.log(`arrivedFrames: ${arrived.length}`);
    console.log(`settledBranchReachedFrames (:477 count): ${branchFrames.length}`);
    console.log(`correctedTrueFrames: ${correctedFrames.length}`);
    console.log(
      `arrivedRestLocalNullFrames: ${arrived.filter((entry) => entry.restLocalNull).length}`,
    );
    console.log(`arrivedClosingTrueFrames: ${arrived.filter((entry) => entry.closing).length}`);
    console.log(
      `meanToeYBeforeCorrection: ${mean(branchFrames.map((entry) => entry.toeYBeforeCorrection ?? Number.NaN))}`,
    );
    console.log(
      `meanToeYAfterCorrection: ${mean(branchFrames.map((entry) => entry.toeYAfterCorrection ?? Number.NaN))}`,
    );
    console.log(`meanToeYSample: ${mean(branchFrames.map((entry) => entry.toeYSample))}`);
    if (branchFrames.length > 0) {
      const first = branchFrames[0];
      const last = branchFrames[branchFrames.length - 1];
      console.log(
        `firstBranchFrame: index=${first?.index} corrected=${first?.corrected} stance=${first?.stanceFoot} toeYBefore=${first?.toeYBeforeCorrection} toeYAfter=${first?.toeYAfterCorrection} toeYSample=${first?.toeYSample}`,
      );
      console.log(
        `lastBranchFrame: index=${last?.index} corrected=${last?.corrected} stance=${last?.stanceFoot} toeYBefore=${last?.toeYBeforeCorrection} toeYAfter=${last?.toeYAfterCorrection} toeYSample=${last?.toeYSample}`,
      );
    }

    expect(phases).toContain("walking");
    expect(phases).toContain("arrived");
    expect(arrived.length).toBeGreaterThanOrEqual(Math.round(ARRIVED_OBSERVE_SECONDS * SIMULATION_HZ));
    expect(branchFrames.length).toBeGreaterThan(0);
  });
});
