import { headingRadiansToward } from "@openclinxr/asset-registry";
import {
  composeSupportedActorWorldPosition,
  supineActorWorldPosition,
} from "@openclinxr/asset-registry/actor-posture";
import { FOOT_CONTACT_HEIGHT_METERS } from "@openclinxr/asset-registry/approach-executor";
import { geometryRevisionDigest, resolveBedsideApproachIntent } from "@openclinxr/asset-registry/case-approach-intent";
import type { EncounterRuntimeActorPlacement } from "@openclinxr/asset-registry/runtime-bundles";
import type { Object3D } from "three";
import {
  advanceCaseOwnedBedsideApproach,
  applyCaseOwnedStanceLock,
  type CaseOwnedApproachFrame,
  type CaseOwnedBedsideApproach,
  createCaseOwnedBedsideApproach,
  measureStanceGroundAdvance,
  resolveToeBones,
  sampleLocomotionStanceTrack,
} from "./case-owned-approach-runtime-mod.js";
import { observeMountedApproachGeometry } from "./mounted-approach-geometry-mod.js";

/**
 * The station's own bedside approach: observed once the physician's skeleton is in the scene, then
 * stepped every frame.
 *
 * WHY IT IS LAZY. The physician's GLB loads asynchronously, so at boot there is no skeleton to
 * measure a stance advance from and no toe to pin. Resolving on the first frame that CAN resolve is
 * the difference between a producer that works in a browser and one that only works in a test. Each
 * outcome is recorded on the state — a refusal is readable rather than a silent null.
 *
 * WHY IT IS HERE. `apps/ui-xr/src` sits at an exact-equality composition-root budget of 10 files and
 * 6,069 logical lines, and `composition-root-conventions.ts` says why that matters: an app composes
 * and boots, it does not decide. main.ts holds one state object and one call.
 *
 * claimScope: wiring an observed room, a staged physician and a decoded clip into one approach.
 * notEvidenceFor: what a browser renders, gait quality, or clinical appropriateness.
 */

export type StationBedsideApproachState = {
  approach: CaseOwnedBedsideApproach | null;
  refusal: string | null;
  /** Set once a resolution has been attempted and refused, so it is not retried every frame. */
  settled: boolean;
  lastFrame: CaseOwnedApproachFrame | null;
};

export function createStationBedsideApproachState(): StationBedsideApproachState {
  return { approach: null, refusal: null, settled: false, lastFrame: null };
}

export type StationBedsideApproachContext = {
  scene: Object3D;
  /** The staged `additional_cast` slot the physician was mounted into. */
  physicianSlot: Object3D | null;
  physicianActorId: string;
  firstClinicalSlotActorId: string;
  firstClinicalSlotRole: string;
  patientActorId: string;
  placements: Record<string, EncounterRuntimeActorPlacement>;
  runId: string;
  /**
   * Sampled toe track of the locomotion clip in the actor's own frame, one full cycle.
   *
   * The clip's ground speed and travel direction are MEASURED from it rather than configured: the
   * shipped executor constant is 1.1 m/s and this clip walks at 0.676, a 1.63x error the stance
   * lock would otherwise absorb every frame.
   */
  clipStanceSamples?: ReadonlyArray<{ atMs: number; position: { x: number; y: number; z: number } }>;
  clipCycleSeconds?: number;
  /**
   * The physician's live animation slot. When no decoded track is supplied the stance track is
   * sampled off THIS mixer, so a browser measures the same quantity a node test decodes.
   */
  animationSlot?: Parameters<typeof sampleLocomotionStanceTrack>[0] | undefined;
  supportAccepted: boolean;
};

/**
 * Step the approach, resolving it first if it has not resolved yet. Returns the drive, or null when
 * there is no approach to drive — in which case the caller keeps whatever it did before.
 */
export function updateStationBedsideApproach(
  state: StationBedsideApproachState,
  context: StationBedsideApproachContext,
  frame: { nowMs: number; deltaSeconds: number },
): CaseOwnedApproachFrame | null {
  if (state.approach === null && !state.settled) resolveStationBedsideApproach(state, context);
  const approach = state.approach;
  if (approach === null) {
    publishBedsideApproachRuntimeEvidence(state, null, false);
    return null;
  }
  // RE-OBSERVED WHILE WALKING, and only while walking. `acceptance-v2.md` requires a change during
  // travel to stop or invalidate the approach, so the room is re-measured on every frame of the
  // walk; once the actor has stopped there is no travel left to invalidate and re-running a full
  // Box3 sweep of the scene every frame would be cost with nothing to buy.
  const observedGeometryRevision =
    approach.execution.phase === "walking" || approach.execution.phase === "not_started"
      ? geometryRevisionDigest(
          observeMountedApproachGeometry(context.scene, { supportInstanceId: supportInstanceIdFor(context) }),
        )
      : approach.execution.boundGeometryRevision;
  // A ROOM THAT CHANGES BEFORE THE WALK STARTS IS RE-RESOLVED, NOT INVALIDATED. `acceptance-v2.md`
  // requires a change DURING TRAVEL to stop the approach; an actor who has not moved has nothing to
  // stop, and refusing there would be permanent. Measured in a browser: the compiled room GLB lands
  // about six seconds after boot and replaces the shell's fixtures, so an approach resolved against
  // the pre-load room was invalidated on its first frame and never walked.
  if (approach.execution.phase === "not_started" && observedGeometryRevision !== approach.execution.boundGeometryRevision) {
    state.approach = null;
    state.settled = false;
    state.refusal = `the room changed before the walk began (${approach.execution.boundGeometryRevision} -> ${observedGeometryRevision}); re-resolving`;
    publishBedsideApproachRuntimeEvidence(state, null, false);
    return null;
  }
  const advanced = advanceCaseOwnedBedsideApproach(approach, {
    nowMs: frame.nowMs,
    deltaSeconds: frame.deltaSeconds,
    observedGeometryRevision,
    supportAccepted: context.supportAccepted,
  });
  state.lastFrame = advanced;
  publishBedsideApproachRuntimeEvidence(state, advanced, false);
  return advanced;
}

function supportInstanceIdFor(context: StationBedsideApproachContext): string {
  return context.placements[context.patientActorId]?.supportInstanceId ?? "";
}

/** One resolution attempt. Records the refusal instead of throwing, so a frame loop can continue. */
export function resolveStationBedsideApproach(
  state: StationBedsideApproachState,
  context: StationBedsideApproachContext,
): void {
  const slot = context.physicianSlot;
  if (slot === null) {
    state.refusal = "the physician slot is not staged yet";
    return;
  }
  const humanoidRoot = slot.children.find((child) => resolveToeBones(child).left !== null) ?? null;
  if (humanoidRoot === null) {
    // NAME WHAT WAS THERE INSTEAD. "not loaded yet" and "loaded under a name this code does not
    // know" are different answers and a bare refusal cannot tell them apart; a capture that waited
    // three minutes on the first while the second was true would report a timeout and nothing else.
    const seen: string[] = [];
    slot.traverse((node) => {
      if (seen.length < 40 && typeof node.name === "string" && node.name.length > 0) seen.push(node.name);
    });
    state.refusal =
      `the physician's skeleton has not loaded yet, so no stance foot can be pinned. Slot children: `
      + `${slot.children.length}; first names under the slot: ${seen.join(", ") || "(none)"}`;
    return;
  }
  const geometry = observeMountedApproachGeometry(context.scene, {
    supportInstanceId: supportInstanceIdFor(context),
  });
  const patientPlacement = context.placements[context.patientActorId];
  const physicianPlacement = context.placements[context.physicianActorId];
  if (patientPlacement === undefined || physicianPlacement === undefined) {
    state.settled = true;
    state.refusal = "the runtime manifest carries no placement for the patient or the physician";
    return;
  }
  const composedPatient = composeSupportedActorWorldPosition({
    posture: "supine",
    fixtureAnchor: supineActorWorldPosition({}),
    ...(patientPlacement.plantOffsetMeters ? { authoredOffsetMeters: patientPlacement.plantOffsetMeters } : {}),
    resolvedPosition: patientPlacement.position,
  });
  const composedStart = composeSupportedActorWorldPosition({
    posture: "standing",
    fixtureAnchor: physicianPlacement.position,
    ...(physicianPlacement.plantOffsetMeters ? { authoredOffsetMeters: physicianPlacement.plantOffsetMeters } : {}),
    resolvedPosition: physicianPlacement.position,
    ...(geometry.floorFrame ? { floorFrame: geometry.floorFrame } : {}),
  });
  const intent = resolveBedsideApproachIntent({
    physicianActorId: context.physicianActorId,
    firstClinicalSlotActorId: context.firstClinicalSlotActorId,
    firstClinicalSlotRole: context.firstClinicalSlotRole,
    patientWorldPosition: "refused" in composedPatient ? patientPlacement.position : composedPatient,
    start: "refused" in composedStart ? { refused: true, reason: composedStart.reason } : composedStart,
    geometry,
  });
  if (intent.refused) {
    state.settled = true;
    state.refusal = `${intent.code}: ${intent.reason}`;
    return;
  }
  const toes = resolveToeBones(humanoidRoot);
  const sampled =
    context.clipStanceSamples !== undefined && context.clipStanceSamples.length > 0
      ? { samples: context.clipStanceSamples, cycleSeconds: context.clipCycleSeconds ?? 0 }
      : context.animationSlot !== undefined && toes.left !== null
        ? sampleLocomotionStanceTrack(context.animationSlot, {
            toe: toes.left,
            sampleCount: 48,
            referenceFrame: slot,
          })
        : null;
  if (sampled === null || sampled.cycleSeconds <= 0) {
    state.settled = true;
    state.refusal =
      "no locomotion stance track could be sampled for this actor, so its ground advance is unknown; "
      + "walking at a configured constant instead would be a fabricated input";
    return;
  }
  const approach = createCaseOwnedBedsideApproach({
    intent,
    geometry,
    observedGeometryRevision: intent.geometryRevision,
    runId: context.runId,
    actorSlot: slot,
    humanoidRoot,
    contactBandMeters: FOOT_CONTACT_HEIGHT_METERS,
    clipAdvance: measureStanceGroundAdvance(sampled.samples, {
      contactBandMeters: FOOT_CONTACT_HEIGHT_METERS,
      floorOriginY: 0,
    }),
    clipCycleSeconds: sampled.cycleSeconds,
    routeHeadingRadians: headingRadiansToward(intent.start, intent.target.position),
  });
  if ("refused" in approach) {
    state.settled = true;
    state.refusal = approach.reason;
    return;
  }
  state.approach = approach;
  state.settled = true;
  state.refusal = null;
}

/**
 * The read-only telemetry a browser capture reads, published from the runtime that produced it.
 *
 * `acceptance-v2.md` fixes the boundary this sits on: "Capture code may observe exposed telemetry;
 * it must not write transforms, call the approach executor directly, mark readiness, inject a
 * plan/locomotion global or skip production consumers." This is the exposed-telemetry half. Every
 * number in it is READ off the running scene after the frame has already been driven — the samples
 * are the world positions of the loaded skeleton's own toe bones and the slot the executor moved,
 * taken after the fact. Nothing here decides anything, and a capture that read it and then wrote a
 * transform would still be the thing the contract forbids.
 *
 * ZERO SAMPLES IS A LEGIBLE ANSWER, not an absent one. `skeletonSampleCount` and
 * `toeBonesResolved` are published whether or not the rig carried the bones, so a capture that
 * observed nothing reports nothing observed rather than an empty pass.
 */
export type BedsideApproachRuntimeEvidence = {
  schemaVersion: "openclinxr.bedside-approach-runtime-evidence.v1";
  driveSource: string | null;
  refusal: string | null;
  /** Why the executor stopped, when it did. A stop with no reason is not a legible stop. */
  invalidationReason: string | null;
  phase: string | null;
  physicianActorId: string | null;
  /** True when the rig carried both named toe bones. False means the lock pinned nothing. */
  toeBonesResolved: boolean;
  skeletonSampleCount: number;
  /** Ring of per-frame world samples: slot pose plus both toe bones off the LOADED skeleton. */
  samples: Array<{
    atMs: number;
    phase: string;
    locomotion: number;
    slot: { x: number; y: number; z: number; yaw: number };
    leftToe: { x: number; y: number; z: number } | null;
    rightToe: { x: number; y: number; z: number } | null;
    stanceFoot: string | null;
  }>;
  startWorld: { x: number; y: number; z: number } | null;
  targetWorld: { x: number; y: number; z: number } | null;
  /** The heading the case's own target computes. Asserted by IDENTITY, not only by tolerance. */
  targetHeadingRadians: number | null;
  travelHeadingRadians: number | null;
  floorFrameId: string | null;
  floorOriginY: number | null;
  observedObstacleIds: string[];
  geometryRevision: string | null;
  clipStanceAdvanceMetersPerSecond: number | null;
  monitorVisible: boolean | null;
  approachSide: string | null;
  standoffMeters: number | null;
  arrivedAtMs: number | null;
  stoppedSeconds: number;
  notEvidenceFor: string[];
};

/** How many frames of the ring are kept. 20 s at 60 Hz, which covers walk, turn and stop. */
export const BEDSIDE_APPROACH_EVIDENCE_SAMPLE_LIMIT = 1200;

const NOT_EVIDENCE_FOR = [
  "clinical_validity",
  "worn_headset_readiness",
  "public_deployment",
  "gait_realism",
  "scoring_validity",
] as const;

function worldOf(node: Object3D | null): { x: number; y: number; z: number } | null {
  if (node === null) return null;
  const elements = node.matrixWorld.elements;
  return { x: elements[12] ?? Number.NaN, y: elements[13] ?? Number.NaN, z: elements[14] ?? Number.NaN };
}

/**
 * Publish this frame's observation onto the page, when there is a page to publish to.
 *
 * `globalThis`, not `window`: this module is imported by node tests as well as by the browser
 * entry, and a bare `window` reference throws in node.
 */
export function publishBedsideApproachRuntimeEvidence(
  state: StationBedsideApproachState,
  frame: CaseOwnedApproachFrame | null,
  /**
   * Append this frame to the sample ring. FALSE from the drive step, which runs BEFORE the pose and
   * before the lock: appending there too put two samples per frame into the ring, one uncorrected
   * and one corrected, and a slide metric reading that ring measured the difference between them as
   * foot travel. Measured in a browser: 0.25209 m worst frame and 9.29180 m total on a run whose
   * feet were in fact pinned.
   */
  appendSample = true,
): void {
  // `globalThis`, never a bare `window`: this module reaches the tools-relaxed TypeScript program,
  // which has no DOM lib, and it is imported by node tests where `window` throws on reference.
  const host = (globalThis as unknown as { window?: Record<string, unknown> }).window
    ?? (globalThis as unknown as Record<string, unknown>);
  const previousEvidence = host["__openClinXrBedsideApproachEvidence"] as BedsideApproachRuntimeEvidence | undefined;
  const approach = state.approach;
  const previous = previousEvidence;
  const samples = previous?.samples ?? [];
  // A WALKING FRAME WHOSE LOCK IS NOT YET ARMED IS NOT A WALK SAMPLE. `main.ts` produces the drive
  // before the animation pass consumes it, so on the frame the drive first asks for locomotion the
  // skeleton still holds the IDLE pose; publishing it as a walking sample publishes the idle pose as
  // a walk pose, and a slide metric then reads the idle-to-walk pose change as a planted foot
  // travelling — measured in a browser, a 0.25457 m "worst walking frame" on a run whose stance foot
  // was pinned to five decimal places for every frame after it.
  const posed = approach === null || frame === null || frame.phase !== "walking" || approach.lockArmed;
  if (appendSample && posed && approach !== null && frame !== null) {
    approach.actorSlot.updateMatrixWorld(true);
    samples.push({
      atMs: frame.travelledMeters >= 0 ? Date.now() : Date.now(),
      phase: frame.phase,
      locomotion: frame.locomotion,
      slot: {
        x: approach.actorSlot.position.x,
        y: approach.actorSlot.position.y,
        z: approach.actorSlot.position.z,
        yaw: approach.actorSlot.rotation.y,
      },
      leftToe: worldOf(approach.leftToe),
      rightToe: worldOf(approach.rightToe),
      stanceFoot: frame.stanceFoot,
    });
    while (samples.length > BEDSIDE_APPROACH_EVIDENCE_SAMPLE_LIMIT) samples.shift();
  }
  host["__openClinXrBedsideApproachEvidence"] = {
    schemaVersion: "openclinxr.bedside-approach-runtime-evidence.v1",
    driveSource: frame?.driveSource ?? null,
    refusal: state.refusal,
    invalidationReason: frame?.invalidationReason ?? previous?.invalidationReason ?? null,
    phase: frame?.phase ?? null,
    physicianActorId: approach?.intent.physicianActorId ?? null,
    toeBonesResolved: approach !== null && approach.leftToe !== null && approach.rightToe !== null,
    skeletonSampleCount: samples.filter((sample) => sample.leftToe !== null && sample.rightToe !== null).length,
    samples,
    startWorld: approach?.start ?? null,
    targetWorld: approach?.target ?? null,
    targetHeadingRadians: approach?.intent.target.headingRadians ?? null,
    travelHeadingRadians: approach?.travelHeadingRadians ?? null,
    floorFrameId: approach?.intent.floorFrameId ?? null,
    floorOriginY: approach?.floorOriginY ?? null,
    observedObstacleIds: approach?.intent.observedObstacleIds ?? [],
    geometryRevision: approach?.intent.geometryRevision ?? null,
    clipStanceAdvanceMetersPerSecond: approach?.walkSpeedMetersPerSecond ?? null,
    monitorVisible: approach?.intent.monitorVisibility?.visible ?? null,
    approachSide: approach?.intent.target.approachSide ?? null,
    standoffMeters: approach?.intent.standoffMeters ?? null,
    arrivedAtMs: frame?.phase === "arrived" ? (previous?.arrivedAtMs ?? Date.now()) : null,
    stoppedSeconds: frame?.stoppedSeconds ?? 0,
    notEvidenceFor: [...NOT_EVIDENCE_FOR],
  } satisfies BedsideApproachRuntimeEvidence;
}


/**
 * Pin the planted toe for this frame. Call AFTER the animation pass has posed the skeleton.
 *
 * `main.ts` produces the drive before `updateGeneratedHumanoidAnimations` consumes it, so the pose
 * the lock must measure does not exist until that pass has run. See the note on
 * `applyCaseOwnedStanceLock` for the measurement that forced the split.
 */
export function applyStationBedsideStanceLock(state: StationBedsideApproachState): void {
  applyCaseOwnedStanceLock(state.approach);
  publishBedsideApproachRuntimeEvidence(state, state.lastFrame);
}
