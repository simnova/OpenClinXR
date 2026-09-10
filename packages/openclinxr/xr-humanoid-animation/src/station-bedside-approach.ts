import {
  composeSupportedActorWorldPosition,
  headingRadiansToward,
  supineActorWorldPosition,
} from "@openclinxr/asset-registry";
import { FOOT_CONTACT_HEIGHT_METERS } from "@openclinxr/asset-registry/approach-executor";
import { geometryRevisionDigest, resolveBedsideApproachIntent } from "@openclinxr/asset-registry/case-approach-intent";
import type { EncounterRuntimeActorPlacement } from "@openclinxr/asset-registry/runtime-bundles";
import type { Object3D } from "three";
import {
  advanceCaseOwnedBedsideApproach,
  type CaseOwnedApproachFrame,
  type CaseOwnedBedsideApproach,
  createCaseOwnedBedsideApproach,
  measureStanceGroundAdvance,
  resolveToeBones,
  sampleLocomotionStanceTrack,
} from "./case-owned-approach-runtime.js";
import { observeMountedApproachGeometry } from "./mounted-approach-geometry.js";

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
  if (approach === null) return null;
  // RE-OBSERVED WHILE WALKING, and only while walking. `acceptance-v2.md` requires a change during
  // travel to stop or invalidate the approach, so the room is re-measured on every frame of the
  // walk; once the actor has stopped there is no travel left to invalidate and re-running a full
  // Box3 sweep of the scene every frame would be cost with nothing to buy.
  const observedGeometryRevision =
    approach.execution.phase === "walking"
      ? geometryRevisionDigest(
          observeMountedApproachGeometry(context.scene, { supportInstanceId: supportInstanceIdFor(context) }),
        )
      : approach.execution.boundGeometryRevision;
  const advanced = advanceCaseOwnedBedsideApproach(approach, {
    nowMs: frame.nowMs,
    deltaSeconds: frame.deltaSeconds,
    observedGeometryRevision,
    supportAccepted: context.supportAccepted,
  });
  state.lastFrame = advanced;
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
    state.refusal = "the physician's skeleton has not loaded yet, so no stance foot can be pinned";
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
        ? sampleLocomotionStanceTrack(context.animationSlot, { toe: toes.left, sampleCount: 48 })
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
