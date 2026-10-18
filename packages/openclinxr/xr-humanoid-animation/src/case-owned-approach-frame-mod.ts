import {
  stepBedsideApproachExecution,
} from "@openclinxr/xr-runtime-state/bedside-approach-execution";
import { AnimationMixer, type Object3D, Vector3 as ThreeVector3 } from "three";
import {
  captureRestStance,
} from "./arrival-stance-close-mod.js";
import { applyCaseOwnedArrivedLock } from "./case-owned-approach-arrived-mod.js";
import type {
  CaseOwnedApproachFrame,
  CaseOwnedBedsideApproach,
} from "./case-owned-approach-runtime-mod.js";
import { applyWalkingPhaseLocks } from "./case-owned-approach-walking-tail-mod.js";
import {
  applyClipDrivenSettlingTurn,
  createClipDrivenSettlingTurnState,
} from "./clip-driven-settling-turn-mod.js";
import { applyFootFlatten, resetFootFlatten } from "./foot-flatten-mod.js";
import { applyFootstepCorrection, captureFootstepRest } from "./footstep-plan-amplitude-mod.js";
import { readFootstepExitDelaySubsteps } from "./footstep-plan-query-flag-mod.js";
import { FOOTSTEP_R_PASSING_S, FOOTSTEP_START_PHASE_S, FOOTSTEP_TRAVEL_COEFFS } from "./footstep-plan-schedule.js";
import { readFootstepToeSeparationM } from "./footstep-toe-separation-mod.js";
import { applyTimedHeadGazeLead } from "./head-lead-anticipation-mod.js";
import { footBaseActiveFor, footstepPlanActiveFor } from "./rig-capability-gate-mod.js";
import { applySettledPostureCorrection } from "./settled-posture-correction.js";
import {
  createStanceLockState,
} from "./stance-lock-mod.js";
import { applyFootPinAndSwingLift } from "./stance-toe-xz-pin-mod.js";
import { pinSteppingTurnArmHang } from "./stepping-turn-arm-settle-mod.js";
import {
  applySteppingTurn,
  enterSteppingTurn,
  seedSteppingTurnClose,
} from "./stepping-turn-frame-mod.js";
import {
  resolveClipStanceForFrame,
  resolveStopTriggerInput,
  updateStopPlayback,
} from "./stop-clip-playback-mod.js";
import { recaptureStopRestStance } from "./stop-rest-recapture-mod.js";
import type { GeneratedHumanoidAnimationSlot } from "./types.js";
import { readWalkExitWindowEnabled } from "./walk-exit-window-query-flag-mod.js";

type Vector3 = { x: number; y: number; z: number };

/**
 * Per-frame stepping of a case-owned approach: advancing the executor, sampling the bound clip's
 * own stance track, and applying the stance lock. Split out of `case-owned-approach-runtime-mod.ts`
 * to clear that file's 500-line budget; behaviour is unchanged, only the module boundary moved.
 */

/**
 * M2 toe-crossing event (default OFF with the plan flag): route-axis R-L
 * separation across consecutive substeps; true on the sign flip. Reads
 * only; the stored previous substep lives on the plan state.
 */
function readFootstepToeCrossed(approach: CaseOwnedBedsideApproach): boolean {
  const plan = approach.footstep;
  if (plan === null) return false;
  const curr = readFootstepToeSeparationM({
    leftToe: approach.leftToe,
    rightToe: approach.rightToe,
    startX: approach.start.x,
    startZ: approach.start.z,
    targetX: approach.target.x,
    targetZ: approach.target.z,
  });
  const prev = plan.lastToeSeparationM ?? null;
  if (curr !== null) plan.lastToeSeparationM = curr;
  return prev !== null && curr !== null && prev !== curr
    && (curr === 0 || Math.sign(prev) !== Math.sign(curr));
}

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
  // The baked-stop handoff inputs (`resolveStopTriggerInput`, stop-clip-playback-mod.ts): null
  // while the actor carries no stop take, which keeps the legacy ending.
  const { stop: stopTrigger } = resolveStopTriggerInput(approach);
  // Contact-window walk exit (fixed-clock slice): the walk clip's stance labels
  // at the action's current clip time gate the executor's exit band, so the exit
  // substep is a clip-phase event. Read BEFORE stepping (one substep stale, exactly
  // like the stance lock's pose read); null off the walking phase keeps legacy exits.
  const clipStanceForExit =
    approach.execution.phase === "walking" ? resolveClipStanceForFrame(approach) : undefined;
  // `walkExitWindow=1` opts into the contact-window exit (null contact =
  // legacy immediate exit). Default OFF since the 2026-10-13 handback: the
  // window's exit-phase steering of the clip-driven turn could not be landed
  // back on the legacy arrival in two attempts. Fixed clock unaffected.
  const walkExitWindowEnabled = readWalkExitWindowEnabled();
  const walkExit =
    clipStanceForExit === undefined || !walkExitWindowEnabled
      ? null
      : {
          cycleSeconds: clipStanceForExit.labels.cycleSeconds,
          atMs: clipStanceForExit.labels.atMs,
          left: clipStanceForExit.labels.left,
          right: clipStanceForExit.labels.right,
          clipTimeSeconds: clipStanceForExit.actionTimeSeconds,
        };
  // S2c M2 (default OFF): k-th-passing phase exit; needs the flag, a clip
  // read, and a captured plan, else null (default and band paths untouched).
  // M3 rides the same struct: the per-foot coefficients and the seed scale
  // cross as data — this module owns the clip constants, so no package
  // boundary is crossed. The coefficients stay TRUE model (the G6 probe
  // seeds only the plan, never the correction).
  // FOOTBASE-6: suppress the M2 toe-crossing exit while the foot-base
  // retarget owns the slot. Its foothold-planned swing toes flip the R-L
  // separation ~3 substeps before the clip's k-th passing (after5: flip3 at
  // unw 2.96 vs target 3.088, 42 vs 45 frames); plan-only's flip and target
  // coincide. The phase target stays the single terminator, and the
  // flag-absent path never reads this branch (false without `?footBase=1`).
  const routeDxExit = approach.target.x - approach.start.x;
  const routeDzExit = approach.target.z - approach.start.z;
  const footBaseExitActive = footBaseActiveFor(approach.actorSlot, Math.hypot(routeDxExit, routeDzExit));
  const footstepExit =
    clipStanceForExit === undefined || !footstepPlanActiveFor(approach.actorSlot) || approach.footstep === null
      ? null
      : {
          steps: approach.footstep.steps,
          startPhaseS: FOOTSTEP_START_PHASE_S,
          rPassingS: FOOTSTEP_R_PASSING_S,
          cycleS: clipStanceForExit.labels.cycleSeconds,
          clipTimeS: clipStanceForExit.actionTimeSeconds,
          aEndR: FOOTSTEP_TRAVEL_COEFFS.aEndR,
          bEndR: FOOTSTEP_TRAVEL_COEFFS.bEndR,
          aEndL: FOOTSTEP_TRAVEL_COEFFS.aEndL,
          bEndL: FOOTSTEP_TRAVEL_COEFFS.bEndL,
          planScale: approach.footstep.scale,
          // Separation read still runs (owns the stored datum); only the signal is gated.
          toeCrossed: readFootstepToeCrossed(approach) && !footBaseExitActive,
          exitDelaySubsteps: readFootstepExitDelaySubsteps(),
        };
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
    observedHeadingRadians: approach.actorSlot.rotation.y,
    ...(stopTrigger ? { stop: stopTrigger } : {}),
    walkExit,
    footstepExit,
  });
  approach.execution = execution;
  // M3 apply (default OFF): consume the executor's late-correction request
  // into the plan state and drain the passing log, right after the step.
  applyFootstepCorrection(approach);
  // Stop mixer management (entry, crossfade, exits, settle-blend) lives in stop-clip-playback.
  updateStopPlayback(approach, previousPhase, input.deltaSeconds, stopTrigger ? { trigger: stopTrigger } : null);
  // Stop handoff rest re-target: the take's hold pose, not walk-start rest.
  if (previousPhase === "stopping" && execution.phase === "settling") recaptureStopRestStance(approach);
  // ## CHANGED: "settling" is excluded here. The clip-driven settling turn
  // (`applyClipDrivenSettlingTurn`, run later in the frame from `applyCaseOwnedStanceLock`, after
  // the mixer has posed the skeleton) owns `actorSlot.rotation.y` and any drift-correcting XZ
  // nudge for the whole settling phase; `execution.headingRadians`/`prescribedPositionXz` are not
  // advanced during settling (see `bedside-approach-execution-mod.ts`'s `## CHANGED` note), so
  // writing them here would reset the turn's progress back to the phase's entry pose every frame.
  if (execution.phase !== "invalidated" && execution.phase !== "settling") {
    approach.actorSlot.position.x = execution.prescribedPositionXz.x;
    approach.actorSlot.position.z = execution.prescribedPositionXz.z;
    approach.actorSlot.rotation.y = execution.headingRadians;
  }
  if (previousPhase !== "settling" && execution.phase === "settling") {
    approach.clipTurn = createClipDrivenSettlingTurnState();
    enterSteppingTurn(approach);
  }
  if (previousPhase === "settling" && execution.phase === "arrived" && approach.clipTurn.phaseFoot !== null) {
    // SEED THE CLOSE'S PLANT DESIGNATION from the settling turn's own last pivot foot, rather than
    // leaving `applyArrivalStanceClose` to discover it cold from a raw height comparison on its
    // first frame. MEASURED: without this, a full clip-driven turn can hand the close a stance gap
    // wide enough that its plant-role hysteresis re-anchors the slot several times while narrowing
    // it (~0.16 m of "stopped" root travel from the ratchet alone, on top of a further snap once
    // the close's own frame cap ends it) — the incumbent bias `applyArrivalStanceClose` already
    // has (it prefers `state.plantFoot` unless a challenger clears the hysteresis margin) simply
    // had nothing to be biased BY on its first frame. This gives it that.
    approach.closeState = { ...approach.closeState, plantFoot: approach.clipTurn.phaseFoot };
  }
  if (previousPhase === "settling" && execution.phase === "arrived") seedSteppingTurnClose(approach);
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
    captureFootstepRest(approach);
  } else if (execution.phase === "walking") {
    approach.lockArmed = true;
  }
  // THE STEPPING TURN OWNS THE LEGS (flag on, live plan, settling): the walk clip
  // stands down. Otherwise the mixer keeps marching underneath at leg weight 0.4 and
  // the stance pin chases its per-frame perturbation — measured in a browser, the slot
  // inherits the march (~0.28 m/s ≈ clip advance × weight) while the toes stay pinned,
  // so the pelvis ends the turn ~0.48 m behind the feet with straight legs (a mid-turn
  // lean-back read). Headless holds the markers instead (runtime-approach-measurement's
  // steppingHoldMarkers) and the bake is upright. Forcing the drive to 0 ramps the
  // action and leg weight to 0 over 0.3 s (locomotion-clip-playback-mod, never snapped);
  // CCD then solves from a stable pose and the pin stops chasing. A null plan (failed
  // entry) skips this and keeps the executor's own drive for the clip path.
  const steppingOwnsLegs =
    approach.steppingTurnEnabled && approach.steppingTurn !== null && execution.phase === "settling";
  if (steppingOwnsLegs) pinSteppingTurnArmHang(approach.stanceLabelSlot?.root ?? null);
  return {
    locomotion: steppingOwnsLegs ? 0 : execution.drive.locomotion,
    locomotionTimeScaleFactor: execution.drive.timeScaleFactor ?? 1,
    locomotionLegWeight: steppingOwnsLegs ? 0 : (execution.drive.legWeight ?? 1),
    driveSource: execution.driveSource,
    phase: execution.phase,
    positionXz: { x: approach.actorSlot.position.x, z: approach.actorSlot.position.z },
    headingRadians: approach.actorSlot.rotation.y,
    // ## CHANGED: during "settling" the walking-phase stance LOCK never runs again (see
    // `applyCaseOwnedStanceLock`), so `approach.lock.stanceFoot` is frozen at the walk's last
    // stance foot for the whole turn. The CLIP-DRIVEN settling turn runs its own reused lock
    // instance (`approach.clipTurn.lock`), crowned by the same clip stance labels it pivots
    // about — that is the one this evidence field should report while turning, or any
    // capture-based metric measuring "does the labelled stance foot stay planted" reads the stale
    // walking-phase label the whole settling phase through.
    stanceFoot: execution.phase === "settling" ? approach.clipTurn.lock.stanceFoot : approach.lock.stanceFoot,
    stanceCorrectionMeters:
      execution.phase === "settling" ? approach.clipTurn.lock.correctionMeters : approach.lock.correctionMeters,
    toeHeightMeters:
      execution.phase === "settling" ? approach.clipTurn.lock.toeHeightMeters : approach.lock.toeHeightMeters,
    doubleSupport: execution.phase === "settling" ? approach.clipTurn.lock.doubleSupport : approach.lock.doubleSupport,
    travelledMeters: execution.travelledMeters,
    stoppedSeconds: execution.stoppedSeconds,
    stopTimeSeconds:
      execution.phase === "stopping" ? (execution.stopClipTimeS ?? null) : null,
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
 * Head bone world yaw, in radians, same `atan2(x, z)` convention as `travelYawForClipForward` and
 * the rest of this executor. Read off the running scene after the frame — including the gaze-lead
 * write below — the same telemetry posture as the toe samples and the pitch above.
 */
export function readHeadYawWorldRadians(actorSlot: Object3D | null): number | null {
  if (actorSlot === null) return null;
  const found: Object3D[] = [];
  actorSlot.traverse((node) => {
    if (typeof node.name === "string" && node.name.replaceAll(".", "") === "head") found.push(node);
  });
  const head = found[0];
  if (head === undefined) return null;
  head.updateWorldMatrix(true, false);
  const elements = head.matrixWorld.elements;
  const x = elements[8] ?? Number.NaN;
  const z = elements[10] ?? Number.NaN;
  if (!Number.isFinite(x) || !Number.isFinite(z)) return null;
  return Math.atan2(x, z);
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
export function applyCaseOwnedStanceLock(approach: CaseOwnedBedsideApproach | null, deltaSeconds: number): void {
  if (approach === null) return;
  // Read-only diagnostic: a frame with no leg solve reports null, never a stale miss.
  approach.lastHeelMissM = null;
  // HEAD LEADS THE TURN (timed anticipation lives in head-lead-anticipation-mod.ts).
  applyTimedHeadGazeLead(approach, deltaSeconds);
  if (approach.execution.phase === "settling") {
    if (applySteppingTurn(approach, deltaSeconds)) return;
    // ## CHANGED: retired the procedural lift-and-slide turn (`applySettlingStepTurnPose`) for
    // this call site. Measured on it (`.openclinxr/evidence/foot-plant-video/foot-plant-
    // video.json`, `turn-quality-metrics.ts`): floorPenetrationM -0.036, minStepLiftM 0.006 over 4
    // episodes, plantedSlideM 0.110 — both shoes swivelling on the floor with no visible steps.
    // The turn is now driven by the walk clip's own steps: the action keeps playing (zero
    // executor forward advance — see `bedside-approach-execution-mod.ts`'s settling branch), and
    // `applyClipDrivenSettlingTurn` rotates the slot only on frames the clip itself labels
    // stance, pivoting about the planted toe through the SAME stance-lock machinery the walk
    // uses. See `clip-driven-settling-turn-mod.ts` for the full mechanism.
    //
    // GATED ON `drive.locomotion > 0` — the "waiting for the fade" sub-stage
    // (`bedside-approach-execution-mod.ts`'s `SETTLING_DRIVE_STOP_TOLERANCE_RADIANS` branch) stops
    // asking the clip to play but STAYS in `settling` for up to `SETTLING_FADE_SETTLE_SECONDS`, and
    // `playLocomotionClip`'s crossfade shrinks the action's weight toward 0 across exactly that
    // window. Left running through it, the stance lock's steady-state pin (capped at 0.02 m per
    // frame — `capCorrection`) reads the toe's own steady convergence toward the BOUND pose as
    // clip-motion drift and chases it every frame — measured, ~0.3-0.4 m of ADDITIONAL slot
    // translation on top of the pivot's own, over the ~9-18 frames the fade takes. The lock has
    // nothing left to do here (locomotion is 0; nothing is stepping), so it simply does not run.
    // While the stop settle-blend runs, the whole settling lock waits: the mixer is morphing
    // hold into stride, so pin, posture correction, yaw ease, and turn would all fight the
    // morph (measured 0.2-0.35 m opening jumps on the nurse). They resume on converged poses.
    const settleBlending =
      approach.stopSettleBlendT !== null && approach.stopSettleBlendT !== undefined;
    if (settleBlending) {
      return;
    }
    if (approach.execution.drive.locomotion > 0) {
      approach.clipTurn = applyClipDrivenSettlingTurn({
        actorSlot: approach.actorSlot,
        leftToe: approach.leftToe,
        rightToe: approach.rightToe,
        floorOriginY: approach.floorOriginY,
        contactBandMeters: approach.contactBandMeters,
        targetHeadingRadians: approach.intent.target.headingRadians,
        deltaSeconds,
        clipCycleSeconds: approach.clipCycleSeconds,
        timeScaleFactor: approach.execution.drive.timeScaleFactor ?? 1,
        clipStance: resolveClipStanceForFrame(approach),
        state: approach.clipTurn,
        // Post-stop stillness (see `postStop` on the turn input): pin nothing spurious.
        postStop: approach.execution.stopClipTimeS != null,
      });
    } else {
      // WAITING FOR THE FADE: no more stepping, so the re-anchoring lock does not run (that is the
      // ~0.3-0.4 m "chasing" drift this branch's header describes).
      //
      // TOE-XZ PIN HELD AT ITS EXISTING WEIGHT, UNCONDITIONALLY, for the whole branch — not
      // dropped, not ramped, not gated on the clip's fading leg weight (measured 2026-09-25:
      // dropping outright revealed a 0.18 m one-frame jump; a 3-frame ramp-down only shrank the
      // reveal window since the clip's leg weight fades over this WHOLE branch's window, not 3
      // frames; gating on `legWeight > 0` still left a 0.098 m residual — see git history).
      // + DIRECT ANKLE CORRECTION: see `correctPlantedFootHeight`'s own header
      // (stance-toe-xz-pin-mod.ts) for why the XZ pin alone leaves the toe ~3-5 cm high.
      // SWING-FOOT LIFT ASSIST continues here off the SAME `pin` state the turning-phase loop
      // (`applyClipDrivenSettlingTurn`) was updating a moment ago — see `applyFootPinAndSwingLift`'s
      // own header (stance-toe-xz-pin-mod.ts) for why sharing that state is what makes this
      // transition continuous instead of a second, independently-timed correction.
      const pin = approach.clipTurn.pin;
      for (const side of ["left", "right"] as const) {
        applyFootPinAndSwingLift({
          actorSlot: approach.actorSlot,
          side,
          pinState: pin[side],
          floorOriginY: approach.floorOriginY,
        });
      }

      // The residual heading this sub-stage started with (up to `SETTLING_DRIVE_STOP_
      // TOLERANCE_RADIANS`, ~4 deg — local copy, same reason as `SETTLE_TURN_TOLERANCE_RADIANS` in
      // `clip-driven-settling-turn-mod.ts`) still needs to close, or the phase can sit forever a
      // couple of degrees short with nothing left driving it there. Eased over the SAME fade
      // window; unrelated to the toe pin above (XZ only, not slot yaw).
      const residual = ((approach.intent.target.headingRadians - approach.actorSlot.rotation.y + Math.PI) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI) - Math.PI;
      const closeRatePerSecond = ((4 * Math.PI) / 180) / 0.3;
      const step = Math.sign(residual) * Math.min(Math.abs(residual), closeRatePerSecond * deltaSeconds);
      if (step !== 0) {
        approach.actorSlot.rotation.y += step;
        approach.actorSlot.updateMatrixWorld(true);
      }
      applySettledPostureCorrection({
        actorSlot: approach.actorSlot,
        leftToe: approach.leftToe,
        rightToe: approach.rightToe,
        floorOriginY: approach.floorOriginY,
        contactBandMeters: approach.contactBandMeters,
      });
      // FOOT-FLATTEN settling-end half (flat-stance slice, see
      // foot-flatten-mod.ts): the clock carries across to arrived.
      applyFootFlatten({ actorSlot: approach.actorSlot, deltaSeconds, floorOriginY: approach.floorOriginY });
    }
    return;
  }
  if (applyCaseOwnedArrivedLock(approach, deltaSeconds)) return;
  // Non-standing phases restart the flatten clocks (pose-neutral; settling
  // returns above, arrived inside the lock, so this is walk/stop).
  resetFootFlatten(approach.actorSlot);
  // No second arrived correction here: the arrived lock above owns EVERY
  // arrived frame with locomotion <= 0 (it returns true for all of them), so a
  // correction after this point is dead code — and were it live it would apply
  // the settled solve twice in one frame. The single per-frame application
  // lives in `case-owned-approach-arrived-mod.ts`.
  if (approach.execution.drive.locomotion <= 0 || !approach.lockArmed) return;
  applyWalkingPhaseLocks(approach, deltaSeconds);
}
