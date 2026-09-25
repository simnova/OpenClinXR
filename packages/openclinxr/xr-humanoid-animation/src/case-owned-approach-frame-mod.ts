import {
  stepBedsideApproachExecution,
} from "@openclinxr/xr-runtime-state/bedside-approach-execution";
import { AnimationMixer, type Object3D, Vector3 as ThreeVector3 } from "three";
import {
  restoreSettlingRestToePose,
} from "./settling-step-turn-mod.js";
import {
  applyClipDrivenSettlingTurn,
  createClipDrivenSettlingTurnState,
} from "./clip-driven-settling-turn-mod.js";
import { applyHeadGazeLeadYaw } from "./head-gaze-lead-mod.js";
import { applyStanceToeXzPin } from "./stance-toe-xz-pin-mod.js";
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
    observedHeadingRadians: approach.actorSlot.rotation.y,
  });
  approach.execution = execution;
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
    locomotionTimeScaleFactor: execution.drive.timeScaleFactor ?? 1,
    locomotionLegWeight: execution.drive.legWeight ?? 1,
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
/** The clip's own stance labels with this frame's action time, or undefined with nothing bound. */
function resolveClipStanceForFrame(
  approach: CaseOwnedBedsideApproach,
): { labels: LocomotionStanceLabels; actionTimeSeconds: number } | undefined {
  const stanceSlot = approach.stanceLabelSlot;
  const labels = approach.stanceLabels;
  if (stanceSlot === null || labels === null || stanceSlot.mixer === undefined) return undefined;
  const clipName = stanceSlot.locomotionClipName;
  const clip = clipName ? stanceSlot.responseClips?.find((candidate) => candidate.name === clipName) : undefined;
  const action = clip && stanceSlot.mixer ? stanceSlot.mixer.existingAction(clip) : null;
  return action ? { labels, actionTimeSeconds: action.time } : undefined;
}

export function applyCaseOwnedStanceLock(approach: CaseOwnedBedsideApproach | null, deltaSeconds: number): void {
  if (approach === null) return;
  // HEAD LEADS THE TURN. Ahead of both the entry and the settling turns of a phase (walking,
  // settling), the head yaws toward the target heading first — bounded, so the neck does not
  // exceed a natural range while the torso still faces the travel heading. `arrived`/`not_started`
  // are excluded: by `arrived` body heading already equals target heading, so the lead computes to
  // zero, and `not_started` has no target-facing decision to anticipate yet.
  if (approach.execution.phase === "walking" || approach.execution.phase === "settling") {
    applyHeadGazeLeadYaw({
      actorSlot: approach.actorSlot,
      bodyHeadingRadians: approach.actorSlot.rotation.y,
      targetHeadingRadians: approach.intent.target.headingRadians,
    });
  }
  if (approach.execution.phase === "settling") {
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
      });
    } else {
      // WAITING FOR THE FADE: no more stepping, so the WALKING-STYLE re-anchoring lock
      // (`applyStanceLockedGroundAdvance`) does not run — the ~0.3-0.4 m "chasing" drift this
      // branch's header describes.
      //
      // TOE-XZ PIN HELD AT ITS EXISTING WEIGHT for the whole branch, UNCONDITIONALLY — not
      // dropped, not ramped down, not gated on the clip's own fading leg weight (measured
      // 2026-09-25, turn-jump investigation).
      //
      // Dropping the pin outright on the first frame here revealed, in one frame, whatever the
      // clip's own gait motion had quietly carried in body space while the pin corrected it —
      // MEASURED: a 0.18 m one-frame stance-toe jump (sample 79). A 3-frame ramp-down only shrank
      // the reveal window; the clip action's leg weight (`openClinXrLocomotionLegWeight`) fades
      // over the SAME window this branch runs for, so the mixer keeps writing a changing raw pose
      // the whole time and needs correcting the whole time, not for a fixed 3 frames.
      //
      // Gating on `legWeight > 0` (tried first) still left a 0.098 m residual: `playLocomotionClip`
      // (the mixer step) and this function run as separate steps in the same frame, so on the
      // frame leg weight first hit 0 the mixer had ALREADY frozen its pose while the `> 0` gate
      // ALSO stopped the pin that same frame — the one frame it was still needed. Unconditional
      // sidesteps that ordering: once the mixer stops changing the pose, re-applying the same
      // fixed-anchor correction to an already-converged pose is a no-op, not new drift — a fixed
      // anchor held every frame, unlike the re-anchoring lock's measured chasing.
      const pin = approach.clipTurn.pin;
      for (const side of ["left", "right"] as const) {
        const current = pin[side];
        if (current.weight <= 0 || current.anchorXz === null) continue;
        applyStanceToeXzPin({
          actorSlot: approach.actorSlot,
          stanceFoot: side,
          anchorXz: current.anchorXz,
          floorOriginY: approach.floorOriginY,
          weight: current.weight,
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
        // ## CHANGED — see `arrival-stance-close-mod.ts`'s own header note. The close now
        // publishes which foot is this frame's PLANT vs its SWING onto `approach.lock`, in the
        // same `labelledStance` shape the walking lock already uses, so SC-05's stop-slide clause
        // can read it instead of the 0.06 m contact band — a closing step's swing foot passes
        // below that band while it glides beside the plant, the same reason the walking clauses
        // already read clip labels rather than the band. Two prior `maxStepMeters` gate attempts
        // were reverted here for a different reason (see the arrival-stance-close-mod header); this
        // does not change the close's own step sizing, only what SC-05 grades.
        const closed = applyArrivalStanceClose({
          actorSlot: approach.actorSlot,
          leftToe: approach.leftToe,
          rightToe: approach.rightToe,
          snapshot: approach.restStance,
          state: approach.closeState,
        });
        approach.closeState = closed.state;
        closeActive = !closed.state.done;
        if (closed.state.plantFoot !== null) {
          approach.lock = {
            ...approach.lock,
            stanceFoot: closed.state.plantFoot,
            doubleSupport: false,
            labelledStance: {
              left: closed.state.plantFoot === "left",
              right: closed.state.plantFoot === "right",
            },
          };
        }
      }
      if (!closeActive) {
        // ## CHANGED: once the close has yielded, both toes are settled and neither is a
        // swing foot mid-step — publish double support so `stopSlideL/R` grades both, the
        // same as any double-support frame the walking lock already labels this way. Scoped
        // to the `restStance !== null` (real close) branch only: the legacy no-snapshot
        // fallback below never ran a close and must leave `approach.lock` untouched — see
        // `the-arrived-stance-closes.test.ts`'s clause (1), which pins that fact by identity.
        approach.lock = {
          ...approach.lock,
          stanceFoot: null,
          doubleSupport: true,
          labelledStance: { left: true, right: true },
        };
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
    ...(routeLength > 0
      ? { travelUnit: { x: routeDx / routeLength, z: routeDz / routeLength }, routeStart: approach.start }
      : {}),
    ...(clipStance ? { clipStance } : {}),
  });
}
