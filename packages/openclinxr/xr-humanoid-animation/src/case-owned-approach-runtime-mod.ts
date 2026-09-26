import { planBedsideApproach } from "@openclinxr/asset-registry/bedside-approach-path";
import type {
  ObservedApproachGeometry,
  ResolvedBedsideApproach,
} from "@openclinxr/asset-registry/case-approach-intent";
import { resolveFloorBandPlantLocalY } from "@openclinxr/xr-pose/actor-floor-composition";
import {
  type BedsideApproachExecution,
  beginBedsideApproachExecution,
  travelYawForClipForward,
} from "@openclinxr/xr-runtime-state/bedside-approach-execution";
import { Box3, type Object3D } from "three";
import {
  type ArrivalCloseState,
  createArrivalCloseState,
  type RestStanceSnapshot,
} from "./arrival-stance-close-mod.js";
import {
  type ClipDrivenSettlingTurnState,
  createClipDrivenSettlingTurnState,
} from "./clip-driven-settling-turn-mod.js";
import type {
  LocomotionStanceLabels,
} from "./locomotion-stance-labels.js";
import { resolveToeBones } from "./resolve-toe-bones.js";
import {
  createSettlingStepTurnState,
  type SettlingStepTurnState,
} from "./settling-step-turn-mod.js";
import { createStanceLockState, type StanceLockState } from "./stance-lock-mod.js";
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
  /**
   * The bound locomotion clip's own stance labels, resolved once per clip and read every
   * walking frame. The stance lock pins only feet the clip labels stance; null on the
   * SC-05 probe rig (which carries marker toes, not the physician's skeleton) and on any
   * actor without a bound clip, where the lock keeps its legacy height-band decision.
   */
  /**
   * Resolved LAZILY from `stanceLabelSlot` by `resolveClipStanceForFrame`
   * (case-owned-approach-frame-mod.ts) the first frame either the walking lock or the settling
   * turn needs it — not by whoever constructs the approach. Starts null even when
   * `stanceLabelSlot` is populated; that is normal, not a bug, until the first frame reads it.
   */
  stanceLabels: LocomotionStanceLabels | null;
  /**
   * The slot carrying the playing walk action, or null when there is nothing to resolve labels
   * from. `resolveClipStanceForFrame` calls `resolveLocomotionStanceLabels(stanceLabelSlot)`
   * lazily and caches the result onto `stanceLabels` above — ANY caller that populates this field
   * gets labels for free, so a caller no longer has to remember to resolve them itself (that
   * asymmetry — only `station-bedside-approach-mod.ts` ever called
   * `resolveLocomotionStanceLabels` — is what left the offline SC-05 harness's settling turn stuck
   * forever with null labels; see that file's own history).
   */
  stanceLabelSlot:
    | Pick<
      GeneratedHumanoidAnimationSlot,
      // "root" added 2026-09-25 (turn-jump investigation) so the waiting-for-fade branch in
      // `case-owned-approach-frame-mod.ts` can read the clip action's own
      // `openClinXrLocomotionLegWeight` off `root.userData` — the same source
      // `locomotion-clip-playback-mod.ts` writes it to — rather than re-deriving it.
      // "actorSlot" added 2026-09-25 (lazy stance-label resolution): `resolveLocomotionStanceLabels`
      // samples the toe tracks IN this reference frame (`sampleTrack`'s `slot.actorSlot ?? slot.root`),
      // and its own type (`SlotLike`, locomotion-stance-labels.ts) requires the field.
      "mixer" | "locomotionClipName" | "responseClips" | "root" | "actorSlot"
    >
    | null;
  floorOriginY: number;
  contactBandMeters: number;
  walkSpeedMetersPerSecond: number;
  settleTurnRateRadiansPerSecond: number;
  /** One full cycle of the bound clip, in seconds — the settling turn's own stepping cadence. */
  clipCycleSeconds: number;
  travelHeadingRadians: number;
  start: Vector3;
  target: Vector3;
  /** False until a walking frame whose pose the clip has actually written; see the note on the lock. */
  lockArmed: boolean;
  /**
   * ## CHANGED: retained for `settling-step-turn-mod.ts`'s own restLocal fallback (the
   * no-restStance branch in `applyCaseOwnedStanceLock`'s arrived close) and its own tests, but no
   * longer driven during settling — see `clipTurn` below, which replaced it as the settling-phase
   * turn owner.
   */
  turnStep: SettlingStepTurnState;
  /**
   * The clip-driven settling turn's own state: which foot is this phase's pivot, its bounded
   * budget, and the reused stance-lock state the pivot/pin cycle runs through. See
   * `clip-driven-settling-turn-mod.ts`.
   */
  clipTurn: ClipDrivenSettlingTurnState;
  /**
   * The actor's own standing pose, snapshotted on the first walking frame while the
   * skeleton still holds the idle pose. Drives the arrived close and the settling
   * rest locals — the TRUE rest, not the mid-stride pose the turn used to capture.
   */
  restStance: RestStanceSnapshot | null;
  /** Progress of the gradual arrival close (arrived phase). */
  closeState: ArrivalCloseState;
  /** What the floor-band plant did to the physician before the walk, recorded for evidence. */
  floorBandPlant: ReturnType<typeof resolveFloorBandPlantLocalY>;
};

export type CaseOwnedBedsideApproachRefusal = { refused: true; reason: string };

/** The drive this producer hands the frame loop, plus what it did to get there. */
export type CaseOwnedApproachFrame = {
  locomotion: number;
  /** Multiplies the clip's derived playback rate; below 1 only during the settling turn. */
  locomotionTimeScaleFactor: number;
  /** Target leg-chain effective weight; below 1 only during the settling turn. */
  locomotionLegWeight: number;
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
    stanceLabels: null,
    stanceLabelSlot: null,
    floorOriginY: floorFrame.originY,
    contactBandMeters: input.contactBandMeters,
    walkSpeedMetersPerSecond: input.clipAdvance.metersPerSecond,
    settleTurnRateRadiansPerSecond:
      absoluteYawDelta(travelHeadingRadians, input.intent.target.headingRadians)
      / Math.max(input.clipCycleSeconds, Number.EPSILON),
    clipCycleSeconds: input.clipCycleSeconds,
    travelHeadingRadians,
    start: input.intent.start,
    target,
    lockArmed: false,
    turnStep: createSettlingStepTurnState(),
    clipTurn: createClipDrivenSettlingTurnState(),
    restStance: null,
    closeState: createArrivalCloseState(),
    floorBandPlant,
  };
}

/**
 * `createCaseOwnedBedsideApproach` for an ARBITRARY actor and target, not the frozen physician
 * plan. Added 2026-09-26 so an order-driven walker (`locomotion-order-mod.ts`) and the frozen-plan
 * physician run through the SAME producer instead of a second, independently-built walker.
 *
 * WHY THIS WAS NEEDED, MEASURED NOT ASSUMED. A separate order-driven walker (straight-line-
 * kinematics-then-stance-lock) was built first and measured against the physician himself as a
 * control (same actor, same clip, same route length, frozen plan disabled for that run): lurch
 * 4.5 (bar <= 1.4) and cadence 169.7/min, against the frozen-plan producer's own 1.044 / 90.6 on
 * the identical actor and clip. The defect is in the SEPARATE walker, not the nurse's rig -- so
 * the fix is not to debug a second implementation, it is to stop having one.
 *
 * A full `ResolvedBedsideApproach` needs a `plan` (clearance-checked waypoints) and other bedside-
 * target fields that make sense for "walk to the patient's bedside" and not for an arbitrary order
 * -- so this builds the MINIMAL valid one: `planBedsideApproach` with `obstacles: []` (clearance
 * checking is out of scope for an order-driven walk; `notEvidenceFor` says so), and placeholder
 * values for the bedside-specific bookkeeping fields (`standoffMeters: 0`, `approachSide:
 * "patient_left"`, no swept/working clearance violations, no monitor visibility) that
 * `createCaseOwnedBedsideApproach`/`advanceCaseOwnedBedsideApproach` never branch on for a route
 * that carries no violations. `geometryRevision` is set equal to `observedGeometryRevision` --
 * an order has no PERSISTED frozen plan to go stale against, so it is always "current" by
 * construction, and `beginBedsideApproachExecution`'s revision-match check passes trivially.
 *
 * claimScope: the SAME producer (`createCaseOwnedBedsideApproach`) driving an arbitrary actor
 * toward an arbitrary target, sharing its stance-lock integration, clip time-scale coupling and
 * settling/arrival machinery with the frozen-plan physician.
 * notEvidenceFor: obstacle avoidance or clearance checking for the ordered route (obstacles: []).
 */
export function createCaseOwnedApproachForOrder(input: {
  actorId: string;
  start: Vector3;
  target: Vector3;
  /** Facing once arrived. Defaults to facing the direction of travel. */
  facing?: Vector3;
  geometry: ObservedApproachGeometry;
  observedGeometryRevision: string;
  runId: string;
  actorSlot: Object3D;
  humanoidRoot: Object3D;
  contactBandMeters: number;
  clipAdvance: { metersPerSecond: number; forward: { x: number; z: number } };
  clipCycleSeconds: number;
  /**
   * SETTLING-STALL ROOT CAUSE, MEASURED WITH FRAME NUMBERS (2026-09-26). Without this,
   * `createCaseOwnedBedsideApproach` returns `stanceLabelSlot: null` (its own hardcoded default),
   * and NOTHING else ever sets it for an order-driven actor -- the only assignment anywhere in
   * this package is `station-bedside-approach-mod.ts:252`, physician-only orchestration this
   * module does not call. `resolveClipStanceForFrame` (case-owned-approach-frame-mod.ts) can then
   * never resolve `approach.stanceLabels`, so `applyClipDrivenSettlingTurn` never receives a
   * labelled stance and never picks a `phaseFoot`.
   *
   * Captured live on the nurse's order-driven walk (fixed 1/30 s fake-clock, 1198 samples): she
   * enters "settling" at frame 25 (atMs 3771) needing a ~110 deg turn (targetHeadingRadians
   * 1.5708, observedHeadingRadians -0.354, remainingTurnRadians 1.925). Every one of the following
   * 1173 settling frames (25 through 1197, the full 40 s capture) reads `phaseFoot: null`,
   * `phaseBudgetRadians: 0`, `phaseElapsedSeconds: 0`, `phaseAppliedRadians: 0` and
   * `labelledStance: null` -- the turn never starts, so `remainingTurnRadians` only ever drifts
   * with gait wobble (0.94-1.95 rad across the run) and never approaches `SETTLE_TURN_TOLERANCE_
   * RADIANS` (~0.035 rad), which is why `phase: "arrived"` (bedside-approach-execution-mod.ts's
   * own condition: `abs(remainingTurn) <= tolerance && stoppedSeconds >= 0.3`) never triggers.
   *
   * Passing this (the same `Pick<...>` shape `station-bedside-approach-mod.ts` builds) closes the
   * gap: `resolveClipStanceForFrame` can now sample the bound clip's own stance track for this
   * actor exactly as it does for the frozen-plan physician.
   */
  stanceLabelSlot: Pick<GeneratedHumanoidAnimationSlot, "mixer" | "locomotionClipName" | "responseClips" | "root" | "actorSlot">;
}): CaseOwnedBedsideApproach | CaseOwnedBedsideApproachRefusal {
  const floorFrame = input.geometry.floorFrame;
  if (floorFrame === null) {
    return { refused: true, reason: "no floor frame was observed, so a signed contact height has no datum" };
  }
  // DEFAULT FACING MUST NOT BE THE TARGET ITSELF. `facing ?? target` looks harmless but makes
  // every heading below `atan2(0, 0)` -- a degenerate zero vector, not "face the direction you
  // walked" -- because the arrival heading is computed FROM the target TO facing. Measured live:
  // with no explicit facing, the settling turn was asked to reach heading 0 regardless of the
  // actual travel heading, and on a route that already faced elsewhere it never converged (stuck
  // in "settling" for the whole 30 s capture window). Default to a point one route-length further
  // along the SAME direction of travel instead, so "no facing given" means "keep facing the way
  // you were walking" -- already the target heading whenever travel heading needs no correction.
  const facing = input.facing ?? {
    x: input.target.x + (input.target.x - input.start.x),
    y: input.target.y,
    z: input.target.z + (input.target.z - input.start.z),
  };
  const routeHeadingRadians = Math.atan2(input.target.x - input.start.x, input.target.z - input.start.z);
  const plan = planBedsideApproach({ from: input.start, target: input.target, facing, obstacles: [] });
  const intent: ResolvedBedsideApproach = {
    refused: false,
    physicianActorId: input.actorId,
    start: input.start,
    target: {
      position: input.target,
      headingRadians: Math.atan2(facing.x - input.target.x, facing.z - input.target.z),
      approachSide: "patient_left",
    },
    standoffMeters: 0,
    approachSideSource: "case_authored_start_position",
    plan,
    sweptViolations: [],
    workingClearanceViolations: [],
    monitorVisibility: null,
    observedObstacleIds: [],
    floorFrameId: floorFrame.frameId,
    geometryRevision: input.observedGeometryRevision,
  };
  const approach = createCaseOwnedBedsideApproach({
    intent,
    geometry: input.geometry,
    observedGeometryRevision: input.observedGeometryRevision,
    runId: input.runId,
    actorSlot: input.actorSlot,
    humanoidRoot: input.humanoidRoot,
    contactBandMeters: input.contactBandMeters,
    clipAdvance: input.clipAdvance,
    clipCycleSeconds: input.clipCycleSeconds,
    routeHeadingRadians,
  });
  // See the `stanceLabelSlot` parameter's own doc comment: without this, the settling turn never
  // starts for an order-driven actor. `station-bedside-approach-mod.ts:252` does the same
  // assignment for the physician, after its own call to `createCaseOwnedBedsideApproach`.
  if (!("refused" in approach)) approach.stanceLabelSlot = input.stanceLabelSlot as never;
  return approach;
}
