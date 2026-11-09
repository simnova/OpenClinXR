import {
  resolveActorPosture,
  seatedVerticalOffsetForSeatHeight,
  supineVerticalOffsetSeed,
} from "@openclinxr/asset-registry/actor-posture";
import type {
  EncounterRuntimeActorPlacement,
  LearnerRuntimeAssetBundle,
} from "@openclinxr/asset-registry/runtime-bundles";
import { supportedActorPlacementPosition } from "@openclinxr/xr-runtime-state";
import type { Group } from "three";

/** The shipped station's canonical patient fallback for capture-time staging resolution. */
export const defaultPatientActorPlacement = {
  slotKind: "primary_patient",
  position: { x: -0.72, y: 1.06, z: -0.12 },
  scale: { x: 1.1, y: 1.1, z: 1.1 },
  verticalOffsetMeters: -0.98,
  labelPrefix: "Patient",
} satisfies EncounterRuntimeActorPlacement;

function hasVector3(value: unknown): value is { x: number; y: number; z: number } {
  if (!value || typeof value !== "object") return false;
  const vector = value as { x?: unknown; y?: unknown; z?: unknown };
  return typeof vector.x === "number" && typeof vector.y === "number" && typeof vector.z === "number";
}

/**
 * The app's actor-placement decision, extracted so the station runtime and
 * isolated product-rig bridge consume one contract.
 */
export function resolveRuntimeActorPlacement(input: {
  bundle: Pick<LearnerRuntimeAssetBundle, "sceneManifest">;
  actorId: string;
  fallback: EncounterRuntimeActorPlacement;
  mountedSupportInstanceIds?: readonly string[];
  scenarioId: string;
  environmentId: string;
  patientChairSeatHeightMeters: number;
  onRefusalReason?: (reason: string) => void;
}): EncounterRuntimeActorPlacement {
  const placement = input.bundle.sceneManifest.actorPlacements?.[input.actorId];
  const slotKind = placement?.slotKind ?? input.fallback.slotKind;
  const posture = resolveActorPosture({
    declared: placement?.posture ?? input.fallback.posture,
    scenarioId: input.scenarioId,
    environmentId: input.environmentId,
    slotKind,
  });
  const verticalOffsetMeters = posture === "seated"
    ? seatedVerticalOffsetForSeatHeight(input.patientChairSeatHeightMeters)
    : posture === "supine"
      ? supineVerticalOffsetSeed()
      : (placement?.verticalOffsetMeters ?? input.fallback.verticalOffsetMeters);
  const position = hasVector3(placement?.position) ? placement.position : input.fallback.position;
  const supported = supportedActorPlacementPosition({
    posture,
    actorId: input.actorId,
    slotKind,
    mountedSupportInstanceIds: input.mountedSupportInstanceIds,
    scenarioId: input.scenarioId,
    environmentId: input.environmentId,
    resolvedPosition: position,
    ...(placement?.supportInstanceId ? { supportInstanceId: placement.supportInstanceId } : {}),
    ...(placement?.plantOffsetMeters ? { authoredOffsetMeters: placement.plantOffsetMeters } : {}),
    ...(posture === "standing" && placement?.plantOffsetMeters
      ? { floorFrame: { frameId: `${input.environmentId}:floor`, originY: 0, originXz: { x: 0, z: 0 } } }
      : {}),
  });
  if (supported.refusalReason) input.onRefusalReason?.(supported.refusalReason);
  return {
    ...input.fallback,
    ...placement,
    position: supported.position,
    placementProvenance: placement?.placementProvenance ?? supported.provenance,
    scale: hasVector3(placement?.scale) ? placement.scale : input.fallback.scale,
    supportAcceptance: supported.supportAcceptance,
    verticalOffsetMeters,
    labelPrefix: placement?.labelPrefix ?? input.fallback.labelPrefix,
    posture,
  };
}

/** Stamp whether authored framing owns the resolved patient position. */
export function stampAuthoredFramingIntent(
  actor: Group,
  placement: EncounterRuntimeActorPlacement,
): void {
  actor.userData["openClinXrPreserveResolvedPlacement"] =
    placement.placementProvenance === "authored_intent";
}

/** Consume authored yaw after framing and record the stable frame-loop base. */
export function consumeAuthoredHeading(
  actor: Group,
  placement: EncounterRuntimeActorPlacement,
  actorId: string,
): void {
  if (actorId && typeof placement.headingRadians === "number") {
    actor.rotation.y = placement.headingRadians;
    actor.userData["openClinXrConsumedHeadingRadians"] = placement.headingRadians;
  }
  actor.userData["openClinXrBaseHeadingRadians"] = actor.rotation.y;
}

/** Apply the patient-root transform in the same order used by the shipped station. */
export function applyStagedPatientRootTransform(input: {
  patient: Group;
  placement: EncounterRuntimeActorPlacement;
  patientActorId: string;
  applyActorFraming: (
    actor: Group,
    actorId: string,
    placement: EncounterRuntimeActorPlacement,
  ) => void;
}): void {
  const { patient, placement, patientActorId } = input;
  patient.position.set(placement.position.x, placement.position.y, placement.position.z);
  patient.scale.set(placement.scale.x, placement.scale.y, placement.scale.z);
  patient.userData["openClinXrActorPosture"] = placement.posture ?? "standing";
  stampAuthoredFramingIntent(patient, placement);
  if (patientActorId) input.applyActorFraming(patient, patientActorId, placement);
  // Preserve the shipped ordering: framing sees role/posture but not the slot-kind stamp.
  patient.userData["openClinXrSlotKind"] = "primary_patient";
  consumeAuthoredHeading(patient, placement, patientActorId);
  patient.updateMatrixWorld(true);
}
