import {
  stepBedsideApproachExecution,
} from "@openclinxr/xr-runtime-state/bedside-approach-execution";
import { AnimationMixer, type Object3D, Vector3 as ThreeVector3 } from "three";
import {
  applySettlingStepTurnPose,
  restoreSettlingRestToePose,
} from "./settling-step-turn-mod.js";
import {
  captureRestStance,
  applyArrivalStanceClose,
} from "./arrival-stance-close-mod.js";
import {
  applyStanceLockedGroundAdvance,
  createStanceLockState,
} from "./stance-lock-mod.js";
import { applySettledPostureCorrection } from "./settled-posture-correction.js";
import type { LocomotionStanceLabels } from "./locomotion-stance-labels.js";
import type { GeneratedHumanoidAnimationSlot } from "./types.js";
import type {
  CaseOwnedApproachFrame,
  CaseOwnedBedsideApproach,
} from "./case-owned-approach-runtime-mod.js";

type Vector3 = { x: number; y: number; z: number };

/**
 * Per-frame stepping of a case-owned approach: advancing the executor, sampling the bound clip's
 * own stance track, and applying the stance lock. Split out of `case-owned-approach-runtime-mod.ts`
 * to clear that file's 500-line budget; behaviour is unchanged, only the module boundary moved.
 */

export function advanceCaseOwnedBedsideApproach(
  approach: CaseOwnedBedsideApproach | null,
  input: {
    nowMs: number;
    deltaSeconds: number;
    observedGeometryRevision: string;
    supportAccepted: boolean;
  },
): CaseOwnedApproachFrame | null {
  if (approach === null) return null;
  const previousPhase = approach.execution.phase;
  const execution = stepBedsideApproachExecution({
    execution: approach.execution,
    plan: approach.intent.plan,
    start: approach.start,
    target: approach.target,
    targetHeadingRadians: approach.intent.target.headingRadians,
    travelHeadingRadians: approach.travelHeadingRadians,
    observedGeometryRevision: input.observedGeometryRevision,
    supportAccepted: input.supportAccepted,
    observedPositionXz: { x: approach.actorSlot.position.x, z: approach.actorSlot.position.z },
    nowMs: input.nowMs,
    deltaSeconds: input.deltaSeconds,
    walkSpeedMetersPerSecond: approach.walkSpeedMetersPerSecond,
    settleTurnRateRadiansPerSecond: approach.settleTurnRateRadiansPerSecond,
  });
  approach.execution = execution;
  if (execution.phase !== "invalidated") {
    approach.actorSlot.position.x = execution.prescribedPositionXz.x;
    approach.actorSlot.position.z = execution.prescribedPositionXz.z;
    approach.actorSlot.rotation.y = execution.headingRadians;
  }
  approach.actorSlot.updateMatrixWorld(true);
  // THE FIRST WALKING FRAME'S POSE PREDATES THE CLIP, so the lock skips it and takes its anchor on
  // the next one. On the frame the drive first asks for locomotion the skeleton still holds the idle
  // pose; the clip's first sample lands one frame later. A lock that anchored on the idle pose would
  // read the idle-to-walk pose change as foot slide and drag the whole body by it — measured on a
  // 0.5 m-stride probe gait, 0.077 m of lateral error, half the arrival cap, from that one frame.
  if (previousPhase !== "walking" && execution.phase === "walking") {
    approach.lock = createStanceLockState();
    approach.lockArmed = false;
    // Snapshot the standing rest BEFORE the clip poses the skeleton: on this frame the
    // drive first asks for locomotion but the pose is still idle (see the note below).
    // Seeds the settling rest locals so arrived frames close to the TRUE rest.
    approach.restStance = captureRestStance({
      actorSlot: approach.actorSlot,
      leftToe: approach.leftToe,
      rightToe: approach.rightToe,
    });
    if (approach.restStance !== null) {
      approach.turnStep.restLocal = {
        left: { ...approach.restStance.toeLeft },
        right: { ...approach.restStance.toeRight },
      };
    }
  } else if (execution.phase === "walking") {
    approach.lockArmed = true;
  }
  return {
    locomotion: execution.drive.locomotion,
    driveSource: execution.driveSource,
    phase: execution.phase,
    positionXz: { x: approach.actorSlot.position.x, z: approach.actorSlot.position.z },
    headingRadians: approach.actorSlot.rotation.y,
    stanceFoot: approach.lock.stanceFoot,
    stanceCorrectionMeters: approach.lock.correctionMeters,
    toeHeightMeters: approach.lock.toeHeightMeters,
    doubleSupport: approach.lock.doubleSupport,
    travelledMeters: execution.travelledMeters,
    stoppedSeconds: execution.stoppedSeconds,
    invalidationReason: execution.invalidationReason,
  };
}

/**
 * Sample the locomotion clip's own stance track by stepping this actor's mixer.
 *
 * WHY IT STEPS THE REAL MIXER. The clip's ground advance is a property of the ANIMATED skeleton,
 * not of the clip's raw channels: a retargeted take carries rotations, and the toe's displacement
 * only exists once forward kinematics has run. Reading it off the running rig is the same
 * measurement SC-00 made offline by decoding the GLB, taken through the consumer instead.
 *
 * The mixer's time is restored before returning, so this is an observation and not a side effect.
 * Returns null when the actor has no locomotion clip or no mixer, which is a legible "nothing to
 * measure" rather than a fabricated speed.
 */
export function sampleLocomotionStanceTrack(
  slot: Pick<GeneratedHumanoidAnimationSlot, "root" | "mixer" | "locomotionClipName" | "responseClips">,
  input: { toe: Object3D; sampleCount: number; referenceFrame?: Object3D | undefined },
): { samples: Array<{ atMs: number; position: Vector3 }>; cycleSeconds: number } | null {
  const clipName = slot.locomotionClipName;
  const mixer = slot.mixer;
  if (!clipName || !mixer) return null;
  const clip = slot.responseClips?.find((candidate) => candidate.name === clipName);
  if (!clip || clip.duration <= 0) return null;
  // A PRIVATE MIXER, so the calibration measures THIS clip and not a blend. The actor's own mixer
  // is already running an idle take, and `clipAction` on it produces a pose weighted between the
  // two: measured in a browser, a stance advance of 0.097 m/s for a clip whose own advance is
  // 0.676. A second mixer over the same root binds the same bones, so what it writes is a real pose
  // — the actor's mixer overwrites it on the next frame.
  void mixer;
  const calibrationMixer = new AnimationMixer(slot.root);
  const action = calibrationMixer.clipAction(clip);
  action.reset().play();
  const step = clip.duration / Math.max(2, input.sampleCount);
  const samples: Array<{ atMs: number; position: Vector3 }> = [];
  for (let index = 0; index <= input.sampleCount; index += 1) {
    calibrationMixer.update(index === 0 ? 0 : step);
    const reference = input.referenceFrame ?? slot.root;
    // `updateWorldMatrix(true, true)`: PARENTS as well as children. `updateMatrixWorld` only walks
    // downward, so a reference whose own parent is stale composes against a stale world matrix and
    // the samples come out in no frame at all — measured, a 0.5 m stance read as 2.16 m along the
    // wrong axis, which then pointed the walk 86 degrees off its own route.
    reference.updateWorldMatrix(true, true);
    // IN THE REFERENCE FRAME, not root-relative. Subtracting the ROOT's world translation puts the
    // toe's y about a hip-height below zero on every frame, so a contact test against a 0.06 m band
    // calls the whole clip one long stance and divides its cyclic displacement by its full duration.
    // Measured in a browser that way: 0.1137 m/s for a clip whose stance advance is 0.676 m/s. The
    // actor slot stands ON the floor, so a position in its frame IS a height above the floor.
    const elements = input.toe.matrixWorld.elements;
    const world = new ThreeVector3(elements[12] ?? 0, elements[13] ?? 0, elements[14] ?? 0);
    const local = reference.worldToLocal(world);
    samples.push({ atMs: index * step * 1000, position: { x: local.x, y: local.y, z: local.z } });
  }
  action.stop();
  calibrationMixer.stopAllAction();
  return { samples, cycleSeconds: clip.duration };
}


/**
 * Head bone world forward-vector (+Z column) pitch below horizontal, in degrees.
 *
 * Read off the running scene after the frame has been driven — the same telemetry
 * posture as the toe samples in the runtime evidence. Null when the rig carries no
 * head bone. Yaw-invariant: slot yaw rotates about Y and never moves e[9].
 */
export function readHeadPitchDeg(actorSlot: Object3D | null): number | null {
  if (actorSlot === null) return null;
  const found: Object3D[] = [];
  actorSlot.traverse((node) => {
    if (typeof node.name === "string" && node.name.replaceAll(".", "") === "head") found.push(node);
  });
  const head = found[0];
  if (head === undefined) return null;
  head.updateWorldMatrix(true, false);
  const y = head.matrixWorld.elements[9] ?? Number.NaN;
  if (!Number.isFinite(y)) return null;
  return (-Math.asin(Math.max(-1, Math.min(1, y))) * 180) / Math.PI;
}

/**
 * Pin the planted toe. Call this AFTER the pose for this frame has been written, never before.
 *
 *
 * THE ORDER IS THE MECHANISM AND IT WAS MEASURED WRONG ONCE. `main.ts` produces the drive before it
 * runs `updateGeneratedHumanoidAnimations`, because the animation pass consumes that drive — so a
 * lock folded into the drive step reads the PREVIOUS frame's pose and its correction is always one
 * frame stale. Measured in a browser at 60 Hz on the shipped clip: `toe1-1.R` slid 0.30796 m in a
 * single frame and 4.09996 m in total across the walk, which is a lock cancelling nothing. Split
 * out, it runs after the mixer has posed the skeleton and cancels the same frame's drift.
 *
 * It is a no-op until `lockArmed`, which the drive step sets on the second walking frame.
 *
 * SETTLED POSTURE CORRECTION: During settling (after turn completes) and arrived phases,
 * the figure stands still with locomotion = 0, so the stance lock does not run. This leaves
 * the standing foot penetrating the floor (SC-05 measured 0.037172 m settling, 0.036384 m arrived).
 * The settled posture correction reuses the same two-bone IK solve (solveTwoBoneIK) to lift
 * the stance toe to at or above floorOriginY without moving actorSlot Y. This is a NEW call
 * site with its own gate, NOT a deletion of the locomotion gate.
 */
export function applyCaseOwnedStanceLock(approach: CaseOwnedBedsideApproach | null): void {
  if (approach === null) return;
  if (approach.execution.phase === "settling") {
    approach.turnStep = applySettlingStepTurnPose({
      headingRadians: approach.actorSlot.rotation.y,
      targetHeadingRadians: approach.intent.target.headingRadians,
      actorSlot: approach.actorSlot,
      leftToe: approach.leftToe,
      rightToe: approach.rightToe,
      contactBandMeters: approach.contactBandMeters,
      initialPlant: approach.lock.stanceFoot,
      state: approach.turnStep,
    });
    // After the settling turn completes, apply settled posture correction
    // The turnStep.closing flag indicates the rest pose is being restored
    if (approach.turnStep.closing && approach.turnStep.restLocal !== null) {
      applySettledPostureCorrection({
        actorSlot: approach.actorSlot,
        leftToe: approach.leftToe,
        rightToe: approach.rightToe,
        floorOriginY: approach.floorOriginY,
        contactBandMeters: approach.contactBandMeters,
      });
    }
    return;
  }
  // Arrived: gradual close toward the walk-start rest snapshot, then settled
  // correction. The old snap-restore teleported the trailing toe 0.39 m on the
  // settling→arrived transition and froze a 0.50 m split stance (rest: 0.391 m).
  // It survives below as the no-snapshot fallback only.
  //
  // The settled correction is SKIPPED while the close runs: its absolute-knee IK
  // solve snapped the closing leg 0.40 m on the first arrived frame of the
  // instrumented run (toe below floor + absolute reconfiguration). The close owns
  // the transition and converges toes to rest heights (above the floor); the
  // correction owns the steady state after the close yields.
  if (approach.execution.phase === "arrived" && approach.execution.drive.locomotion <= 0) {
    let closeActive = false;
    if (approach.restStance !== null) {
      if (!approach.closeState.done) {
        const closed = applyArrivalStanceClose({
          actorSlot: approach.actorSlot,
          leftToe: approach.leftToe,
          rightToe: approach.rightToe,
          snapshot: approach.restStance,
          state: approach.closeState,
        });
        approach.closeState = closed.state;
        closeActive = !closed.state.done;
      }
    } else if (approach.turnStep.restLocal !== null) {
      approach.turnStep = restoreSettlingRestToePose({
        leftToe: approach.leftToe,
        rightToe: approach.rightToe,
        state: approach.turnStep,
        contactBandMeters: approach.contactBandMeters,
      });
      approach.actorSlot.updateMatrixWorld(true);
    }
    if (!closeActive) {
      applySettledPostureCorrection({
        actorSlot: approach.actorSlot,
        leftToe: approach.leftToe,
        rightToe: approach.rightToe,
        floorOriginY: approach.floorOriginY,
        contactBandMeters: approach.contactBandMeters,
      });
    }
    return;
  }
  // Settled/arrived phase: apply posture correction when not walking
  if (approach.execution.phase === "arrived" && approach.execution.drive.locomotion <= 0) {
    applySettledPostureCorrection({
      actorSlot: approach.actorSlot,
      leftToe: approach.leftToe,
      rightToe: approach.rightToe,
      floorOriginY: approach.floorOriginY,
      contactBandMeters: approach.contactBandMeters,
    });
    return;
  }
  if (approach.execution.drive.locomotion <= 0 || !approach.lockArmed) return;
  // The route the executor walks, as a unit direction: the stance rule reads clip-space toe
  // travel along it, and the no-backward clamp holds the slot against it. The executor steps
  // start-to-target, so this is its own axis, not a second opinion about the route.
  const routeDx = approach.target.x - approach.start.x;
  const routeDz = approach.target.z - approach.start.z;
  const routeLength = Math.hypot(routeDx, routeDz);
  // The clip labels stance once per bound clip; the action time is this frame's.
  // The slot is set by the station resolve (browser) or stays null (probe rigs).
  let clipStance: { labels: LocomotionStanceLabels; actionTimeSeconds: number } | undefined;
  const stanceSlot = approach.stanceLabelSlot;
  const labels = approach.stanceLabels;
  if (stanceSlot !== null && labels !== null && stanceSlot.mixer !== undefined) {
    const clipName = stanceSlot.locomotionClipName;
    const clip = clipName ? stanceSlot.responseClips?.find((candidate) => candidate.name === clipName) : undefined;
    const action = clip && stanceSlot.mixer ? stanceSlot.mixer.existingAction(clip) : null;
    if (action) clipStance = { labels, actionTimeSeconds: action.time };
  }
  approach.lock = applyStanceLockedGroundAdvance({
    actorSlot: approach.actorSlot,
    leftToe: approach.leftToe,
    rightToe: approach.rightToe,
    floorOriginY: approach.floorOriginY,
    contactBandMeters: approach.contactBandMeters,
    state: approach.lock,
    ...(routeLength > 0 ? { travelUnit: { x: routeDx / routeLength, z: routeDz / routeLength } } : {}),
    ...(clipStance ? { clipStance } : {}),
  });
}
