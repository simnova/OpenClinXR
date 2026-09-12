import type {
  ObservedApproachGeometry,
  ResolvedBedsideApproach,
} from "@openclinxr/asset-registry/case-approach-intent";
import { resolveFloorBandPlantLocalY } from "@openclinxr/xr-pose/actor-floor-composition";
import {
  type BedsideApproachExecution,
  beginBedsideApproachExecution,
  stepBedsideApproachExecution,
  travelYawForClipForward,
} from "@openclinxr/xr-runtime-state/bedside-approach-execution";
import { AnimationMixer, Box3, type Object3D, PropertyBinding, Vector3 as ThreeVector3 } from "three";
import {
  applySettlingStepTurnPose,
  createSettlingStepTurnState,
  restoreSettlingRestToePose,
  type SettlingStepTurnState,
} from "./settling-step-turn-mod.js";
import {
  applyStanceLockedGroundAdvance,
  createStanceLockState,
  type StanceLockState,
} from "./stance-lock-mod.js";
import type { GeneratedHumanoidAnimationSlot } from "./types.js";

/**
 * The case-owned approach, driving the actor slot and producing the drive the frame loop reads.
 *
 * THIS IS THE PRODUCER THAT DID NOT EXIST. `apps/ui-xr/src/main.ts` reads
 * `floor.userData.genDrive ?? floor.userData.pedsRuntimeDrive` every frame and, measured on the
 * unchanged tree at 86dc0300, NOTHING in `apps`, `packages` or `tools` ever wrote either. The only
 * non-null value the read could take came from `window.__openClinXrPedsDrive`, a recorder global
 * this card's contract forbids as the driver of an acceptance run. `driveSource` is carried on
 * every frame's output so an instrument can tell this producer from that global rather than
 * inferring it.
 *
 * claimScope: one physician, one route, one room, driven in node or in a browser frame loop.
 * notEvidenceFor: gait realism, clinical appropriateness, worn-headset behaviour, or pixels.
 */

type Vector3 = { x: number; y: number; z: number };

export type CaseOwnedBedsideApproach = {
  intent: ResolvedBedsideApproach;
  execution: BedsideApproachExecution;
  lock: StanceLockState;
  actorSlot: Object3D;
  leftToe: Object3D | null;
  rightToe: Object3D | null;
  floorOriginY: number;
  contactBandMeters: number;
  walkSpeedMetersPerSecond: number;
  settleTurnRateRadiansPerSecond: number;
  travelHeadingRadians: number;
  start: Vector3;
  target: Vector3;
  /** False until a walking frame whose pose the clip has actually written; see the note on the lock. */
  lockArmed: boolean;
  /** Alternating plant/swing during the terminal turn. Slot XZ is not written here. */
  turnStep: SettlingStepTurnState;
  /** What the floor-band plant did to the physician before the walk, recorded for evidence. */
  floorBandPlant: ReturnType<typeof resolveFloorBandPlantLocalY>;
};

export type CaseOwnedBedsideApproachRefusal = { refused: true; reason: string };

/** The drive this producer hands the frame loop, plus what it did to get there. */
export type CaseOwnedApproachFrame = {
  locomotion: number;
  driveSource: "case_owned_bedside_approach";
  phase: BedsideApproachExecution["phase"];
  positionXz: { x: number; z: number };
  headingRadians: number;
  stanceFoot: StanceLockState["stanceFoot"];
  stanceCorrectionMeters: { x: number; z: number };
  toeHeightMeters: { left: number; right: number };
  doubleSupport: boolean;
  travelledMeters: number;
  stoppedSeconds: number;
  invalidationReason: string | null;
};

/**
 * Toe bones on this rig, resolved by EXACT name from the conventions the shipped rigs use.
 *
 * A pattern match is refused for the same reason `chain-ownership.ts` refuses one: `toe_ik_target`
 * would match `toe` and the lock would pin a control object instead of a foot. A rig that carries
 * none of these names returns nulls, the lock then does nothing, and `stanceFoot: null` says so —
 * which is a legible refusal rather than a silent pin on the wrong body part.
 */
export const KNOWN_TOE_BONE_NAMES = [
  { left: "toe1-1.L", right: "toe1-1.R" },
  { left: "mixamorig:LeftToeBase", right: "mixamorig:RightToeBase" },
  { left: "toe.L", right: "toe.R" },
] as const;

/**
 * THE LOADER RENAMES THE BONES, and this is the only place that knows it.
 *
 * `GLTFLoader` runs every node name through `PropertyBinding.sanitizeNodeName`, which strips the
 * characters three.js uses as animation-track path separators — a dot among them. The rig's own
 * bones are `toe1-1.L` and `toe1-1.R` in the GLB and `toe1-1L` and `toe1-1R` once loaded.
 *
 * MEASURED IN A BROWSER, not reasoned about: the first UI-XR capture run of this card refused with
 * "the physician's skeleton has not loaded yet" for its whole 45-second wait while all four
 * humanoids had in fact loaded, and the refusal's own diagnostic listed `toe1-1L` and `toe1-1R`
 * under the slot. Both names are tried, and the sanitised form comes from three's own function
 * rather than from a transcription of its rule.
 */
export function resolveToeBones(root: Object3D): { left: Object3D | null; right: Object3D | null } {
  for (const names of KNOWN_TOE_BONE_NAMES) {
    for (const [rawLeft, rawRight] of [
      [names.left, names.right],
      [PropertyBinding.sanitizeNodeName(names.left), PropertyBinding.sanitizeNodeName(names.right)],
    ] as const) {
      const left = root.getObjectByName(rawLeft) ?? null;
      const right = root.getObjectByName(rawRight) ?? null;
      if (left !== null && right !== null) return { left, right };
    }
  }
  return { left: null, right: null };
}

/**
 * The clip's OWN ground speed and travel direction, measured from a sampled stance window.
 *
 * WHY MEASURED AND NOT CONFIGURED. The executor's shipped `CLINICIAN_WALK_SPEED_MPS` is 1.1 m/s and
 * `sc-04.json` measured this clip walking at 0.676 m/s — a 1.63x mismatch that the stance lock
 * would have to absorb every frame. `sc-04.md` handed the decision here in as many words: "SC-05
 * owns the speed decision: time-scale the clip by about 1.63, or lower the executor's constant."
 * The advance is lowered to what the clip actually does, so the lock corrects a residual rather
 * than a systematic error.
 *
 * The direction is a FINDING, not a formality. The shipped physician rig faces +Z — its toes sit
 * 0.126 m in +Z of the ankle in the rest frame and its left foot sits at +X — while this clip's
 * stance windows advance the body along body -Z. The bound take travels 180 degrees from the rig's
 * own facing. Reading the direction off the clip is what keeps the plant correct on an asset whose
 * bind is wrong.
 */
export function measureStanceGroundAdvance(
  samples: ReadonlyArray<{ atMs: number; position: Vector3 }>,
  input: { contactBandMeters: number; floorOriginY: number },
): { metersPerSecond: number; forward: { x: number; z: number }; windowFrames: number } {
  const inContact = samples.map(
    (sample) => sample.position.y - input.floorOriginY <= input.contactBandMeters,
  );
  let best = { start: -1, end: -1, length: 0 };
  let index = 0;
  while (index < inContact.length) {
    if (inContact[index] !== true) {
      index += 1;
      continue;
    }
    let end = index;
    while (end + 1 < inContact.length && inContact[end + 1] === true) end += 1;
    if (end - index + 1 > best.length) best = { start: index, end, length: end - index + 1 };
    index = end + 1;
  }
  const first = samples[best.start];
  const last = samples[best.end];
  if (first === undefined || last === undefined || best.length < 2) {
    return { metersPerSecond: 0, forward: { x: 0, z: -1 }, windowFrames: best.length };
  }
  const dx = first.position.x - last.position.x;
  const dz = first.position.z - last.position.z;
  const distance = Math.hypot(dx, dz);
  const seconds = (last.atMs - first.atMs) / 1000;
  if (distance === 0 || seconds === 0) {
    return { metersPerSecond: 0, forward: { x: 0, z: -1 }, windowFrames: best.length };
  }
  return {
    metersPerSecond: distance / seconds,
    forward: { x: dx / distance, z: dz / distance },
    windowFrames: best.length,
  };
}

/** Shortest absolute angle between two yaws, in radians. */
function absoluteYawDelta(from: number, to: number): number {
  const twoPi = Math.PI * 2;
  return Math.abs((((to - from + Math.PI) % twoPi) + twoPi) % twoPi - Math.PI);
}

export function createCaseOwnedBedsideApproach(input: {
  intent: ResolvedBedsideApproach;
  geometry: ObservedApproachGeometry;
  observedGeometryRevision: string;
  runId: string;
  actorSlot: Object3D;
  humanoidRoot: Object3D;
  contactBandMeters: number;
  /** The clip's own measured advance, from `measureStanceGroundAdvance`. */
  clipAdvance: { metersPerSecond: number; forward: { x: number; z: number } };
  /** One full cycle of the clip, in seconds. The terminal turn completes in exactly one. */
  clipCycleSeconds: number;
  routeHeadingRadians: number;
}): CaseOwnedBedsideApproach | CaseOwnedBedsideApproachRefusal {
  const floorFrame = input.geometry.floorFrame;
  if (floorFrame === null) {
    return { refused: true, reason: "no floor frame was observed, so a signed contact height has no datum" };
  }
  if (input.clipAdvance.metersPerSecond <= 0) {
    return {
      refused: true,
      reason:
        "the locomotion clip has no measurable stance window, so its ground advance is unknown. Walking at "
        + "a configured constant instead would be the fabricated input this measurement exists to refuse.",
    };
  }
  const travelHeadingRadians = travelYawForClipForward(
    input.routeHeadingRadians,
    input.clipAdvance.forward,
  );
  const target: Vector3 = {
    x: input.intent.target.position.x,
    y: input.intent.start.y,
    z: input.intent.target.position.z,
  };
  const execution = beginBedsideApproachExecution({
    runId: input.runId,
    physicianActorId: input.intent.physicianActorId,
    plan: input.intent.plan,
    planGeometryRevision: input.intent.geometryRevision,
    observedGeometryRevision: input.observedGeometryRevision,
    start: input.intent.start,
    travelHeadingRadians,
  });
  if ("refused" in execution) return execution;
  const toes = resolveToeBones(input.humanoidRoot);
  // PLANT THE FEET BEFORE WALKING, through the shipped function that had no caller.
  //
  // `resolveFloorBandPlantLocalY` (xr-pose/actor-floor-composition.ts:114) is written, tested and
  // called by NOTHING in `apps` or `packages` — measured on the unchanged tree at 86dc0300. It is
  // wired here because a walk whose feet are outside the floor band has no stance to lock and no
  // contact window to grade.
  //
  // MEASURED ON THIS ACTOR IT IS A NO-OP, and that is recorded rather than dressed up: the framing
  // pass puts a standing slot at y = 0 and `resolveEffectiveVerticalOffsetMeters` then returns 0 for
  // the physician's -0.95 authored offset, so his soles are already in the band and the plant
  // reports `planted: false`. An earlier draft of this comment claimed it corrected a 0.192 m float;
  // that float was an artefact of a harness that used the RAW offset instead of the loader's
  // resolved one, and the claim was wrong. What the wire buys is the actor for whom it is not a
  // no-op, and a `planted` flag that says which case this run was.
  input.actorSlot.updateMatrixWorld(true);
  const lowestMeshWorldY = new Box3().setFromObject(input.humanoidRoot).min.y;
  // A `Box3` over an object that carries no geometry is EMPTY, and its `min.y` is +Infinity. Feeding
  // that to the plant produces `-Infinity` and every downstream transform becomes NaN — measured,
  // and it is the difference between "the actor has not loaded yet" and "the actor is at negative
  // infinity". An unmeasurable extent means no plant, said out loud rather than applied blindly.
  const floorBandPlant = Number.isFinite(lowestMeshWorldY)
    ? resolveFloorBandPlantLocalY({
        humanoidLocalY: input.humanoidRoot.position.y,
        lowestMeshWorldY,
        parentWorldScaleY: input.actorSlot.scale.y,
        floorTopY: floorFrame.originY,
      })
    : {
        localY: input.humanoidRoot.position.y,
        planted: false,
        previousLowestMeshWorldY: lowestMeshWorldY,
        targetLowestMeshWorldY: lowestMeshWorldY,
      };
  input.humanoidRoot.position.y = floorBandPlant.localY;
  // X AND Z ONLY. The slot's Y is owned by the framing pass, which puts a standing actor on the
  // floor at y = 0; writing the placement's own 0.95 back over it lifts the physician off the floor
  // and every contact metric then observes nothing.
  input.actorSlot.position.x = input.intent.start.x;
  input.actorSlot.position.z = input.intent.start.z;
  input.actorSlot.rotation.y = travelHeadingRadians;
  return {
    intent: input.intent,
    execution,
    lock: createStanceLockState(),
    actorSlot: input.actorSlot,
    leftToe: toes.left,
    rightToe: toes.right,
    floorOriginY: floorFrame.originY,
    contactBandMeters: input.contactBandMeters,
    walkSpeedMetersPerSecond: input.clipAdvance.metersPerSecond,
    settleTurnRateRadiansPerSecond:
      absoluteYawDelta(travelHeadingRadians, input.intent.target.headingRadians)
      / Math.max(input.clipCycleSeconds, Number.EPSILON),
    travelHeadingRadians,
    start: input.intent.start,
    target,
    lockArmed: false,
    turnStep: createSettlingStepTurnState(),
    floorBandPlant,
  };
}

/**
 * One frame: step the executor, move the slot, then let the stance lock pin the planted toe.
 *
 * ORDER MATTERS AND IS THE WHOLE MECHANISM. The executor prescribes an advance from where the body
 * actually is; the slot is moved there; the pose for this frame is already applied by the mixer;
 * then the lock measures the planted toe and translates the slot back so the toe did not move. What
 * survives is a body that advanced by exactly what the foot allowed.
 *
 * The lock runs ONLY while the drive asks for locomotion. Once the walk ends there is no stance to
 * derive an advance from, and a lock that kept running would drag the body wherever the frozen pose
 * drifted.
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
 * Pin the planted toe. Call this AFTER the pose for this frame has been written, never before.
 *
 * THE ORDER IS THE MECHANISM AND IT WAS MEASURED WRONG ONCE. `main.ts` produces the drive before it
 * runs `updateGeneratedHumanoidAnimations`, because the animation pass consumes that drive — so a
 * lock folded into the drive step reads the PREVIOUS frame's pose and its correction is always one
 * frame stale. Measured in a browser at 60 Hz on the shipped clip: `toe1-1.R` slid 0.30796 m in a
 * single frame and 4.09996 m in total across the walk, which is a lock cancelling nothing. Split
 * out, it runs after the mixer has posed the skeleton and cancels the same frame's drift.
 *
 * It is a no-op until `lockArmed`, which the drive step sets on the second walking frame.
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
    return;
  }
  if (approach.turnStep.restLocal !== null) {
    approach.turnStep = restoreSettlingRestToePose({
      leftToe: approach.leftToe,
      rightToe: approach.rightToe,
      state: approach.turnStep,
      contactBandMeters: approach.contactBandMeters,
    });
    approach.actorSlot.updateMatrixWorld(true);
    if (approach.turnStep.closing) return;
  }
  if (approach.execution.drive.locomotion <= 0 || !approach.lockArmed) return;
  approach.lock = applyStanceLockedGroundAdvance({
    actorSlot: approach.actorSlot,
    leftToe: approach.leftToe,
    rightToe: approach.rightToe,
    floorOriginY: approach.floorOriginY,
    contactBandMeters: approach.contactBandMeters,
    state: approach.lock,
  });
}
